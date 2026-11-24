use crate::{catalog, uploads};
use serde::Deserialize;
use serde_json::{Value, json};
use worker::wasm_bindgen::prelude::*;
use worker::*;

#[wasm_bindgen(module = "/src/access.js")]
extern "C" {
    #[wasm_bindgen(catch, js_name = verifyAccessEmail)]
    async fn verify_access_email(
        token: &str,
        issuer: &str,
        audience: &str,
    ) -> std::result::Result<JsValue, JsValue>;
}

pub async fn handle(req: Request, env: Env) -> Result<Response> {
    let unauthorized = || Response::error("Admin sign-in required.", 401);
    let Some(token) = req.headers().get("Cf-Access-Jwt-Assertion")? else {
        return unauthorized();
    };
    let (Ok(issuer), Ok(audience)) = (env.var("ACCESS_ISSUER"), env.var("ACCESS_AUD")) else {
        return Response::error("Admin access is not configured.", 503);
    };
    let verified =
        match verify_access_email(&token, &issuer.to_string(), &audience.to_string()).await {
            Ok(value) => value,
            Err(error) => {
                console_error!("Access verification unavailable: {error:?}");
                return Response::error("Admin authentication is unavailable.", 503);
            }
        };
    let Some(email) = verified.as_string() else {
        return unauthorized();
    };
    Router::new()
        .put_async("/api/manage/download-settings", save_download_settings)
        .get_async(
            "/api/manage/resources/:id/download",
            catalog::admin_download,
        )
        .head_async(
            "/api/manage/resources/:id/download",
            catalog::admin_download,
        )
        .get_async("/api/manage/resources", |req, ctx| {
            list(req, ctx, email.clone())
        })
        .delete_async("/api/manage/resources/:id", |_, ctx| remove(ctx, false))
        .delete_async("/api/manage/resources/:id/upload", |_, ctx| {
            remove(ctx, true)
        })
        .post_async("/api/manage/resources", uploads::create)
        .post_async("/api/manage/resources/:id/upload", uploads::renew)
        .put_async(
            "/api/manage/resources/:id/upload/parts/:number",
            uploads::record_part,
        )
        .put_async("/api/manage/resources/:id/publication", uploads::publish)
        .run(req, env)
        .await
}

async fn list(req: Request, ctx: RouteContext<()>, email: String) -> Result<Response> {
    let drafts = ctx
        .d1("DB")?
        .prepare(
            "SELECT id, path, size_bytes, description, expires_at,
                CASE WHEN sha256 IS NOT NULL THEN min(size_bytes, json_array_length(part_etags) * ?) END AS uploaded_bytes FROM resources
             WHERE published_at IS NULL AND expires_at > unixepoch()
             ORDER BY expires_at DESC, id DESC",
        )
        .bind(&[(uploads::PART_SIZE as u32).into()])?
        .all()
        .await?
        .results::<Value>()?;
    let settings = ctx
        .d1("DB")?
        .prepare("SELECT public_mbps, admin_mbps FROM download_settings WHERE id = 1")
        .first::<Value>(None)
        .await?;
    catalog::list(req, ctx, json!({ "download_settings": settings, "email": email, "drafts": drafts, "part_size": uploads::PART_SIZE, "max_upload_size": uploads::MAX_SIZE })).await
}

#[derive(Deserialize)]
struct DownloadSettings {
    public_mbps: f64,
    admin_mbps: f64,
}

async fn save_download_settings(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let Ok(settings) = req.json::<DownloadSettings>().await else {
        return Response::error("Provide both download speeds in MB/s.", 400);
    };
    if [settings.public_mbps, settings.admin_mbps]
        .iter()
        .any(|&rate| rate != 0.0 && rate < 0.000001)
    {
        return Response::error("Use 0 for unlimited or at least 0.000001 MB/s.", 400);
    }
    ctx.d1("DB")?
        .prepare("UPDATE download_settings SET public_mbps = ?, admin_mbps = ? WHERE id = 1")
        .bind(&[settings.public_mbps.into(), settings.admin_mbps.into()])?
        .run()
        .await?;
    Ok(Response::empty()?.with_status(204))
}

async fn remove(ctx: RouteContext<()>, draft: bool) -> Result<Response> {
    let id = ctx.param("id").expect("resource route has an id");
    let state = if draft { "IS NULL" } else { "IS NOT NULL" };
    let deleted = ctx
        .d1("DB")?
        .prepare(format!(
            "DELETE FROM resources WHERE id = ? AND published_at {state} RETURNING id, upload_id"
        ))
        .bind(&[id.as_str().into()])?
        .first::<uploads::StoredUpload>(None)
        .await?;
    let Some(file) = deleted else {
        return if draft {
            Response::error("This draft is no longer available.", 404)
        } else {
            Ok(Response::empty()?.with_status(204))
        };
    };
    let bucket = ctx.bucket("FILES")?;
    file.abort(&bucket).await?;
    let id = file.id;
    if let Err(error) = bucket.delete(&id).await {
        console_error!("R2 deletion for {id} deferred to orphan cleanup: {error}");
    }
    Ok(Response::empty()?.with_status(204))
}
