use crate::catalog;
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
        .get_async("/api/manage/resources", |req, ctx| {
            list(req, ctx, email.clone())
        })
        .delete_async("/api/manage/resources/:id", |_, ctx| remove(ctx, false))
        .delete_async("/api/manage/resources/:id/upload", |_, ctx| {
            remove(ctx, true)
        })
        .post_async("/api/manage/resources", crate::uploads::create)
        .post_async("/api/manage/resources/:id/upload", crate::uploads::renew)
        .put_async(
            "/api/manage/resources/:id/publication",
            crate::uploads::publish,
        )
        .run(req, env)
        .await
}

async fn list(req: Request, ctx: RouteContext<()>, email: String) -> Result<Response> {
    let drafts = ctx
        .d1("DB")?
        .prepare(
            "SELECT id, path, size_bytes, description, expires_at FROM resources
         WHERE published_at IS NULL AND expires_at > unixepoch()
         ORDER BY expires_at DESC, id DESC",
        )
        .all()
        .await?
        .results::<Value>()?;
    catalog::list(req, ctx, true, json!({ "email": email, "drafts": drafts })).await
}

async fn remove(ctx: RouteContext<()>, draft: bool) -> Result<Response> {
    let id = ctx.param("id").expect("resource route has an id");
    let state = if draft { "IS NULL" } else { "IS NOT NULL" };
    let deleted_id = ctx
        .d1("DB")?
        .prepare(format!(
            "DELETE FROM resources WHERE id = ? AND published_at {state} RETURNING id"
        ))
        .bind(&[id.as_str().into()])?
        .first::<String>(Some("id"))
        .await?;
    let Some(id) = deleted_id else {
        return if draft {
            Response::error("This draft is no longer available.", 404)
        } else {
            Ok(Response::empty()?.with_status(204))
        };
    };
    if let Err(error) = ctx.bucket("FILES")?.delete(&id).await {
        console_error!("R2 deletion for {id} deferred to orphan cleanup: {error}");
    }
    Ok(Response::empty()?.with_status(204))
}
