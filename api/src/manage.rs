use crate::catalog;
use serde_json::json;
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
            catalog::list(req, ctx, true, json!({ "email": email }))
        })
        .delete_async("/api/manage/resources/:id", delete_file)
        .post_async("/api/manage/resources", crate::uploads::create)
        .post_async("/api/manage/resources/:id/upload", crate::uploads::renew)
        .put_async(
            "/api/manage/resources/:id/publication",
            crate::uploads::publish,
        )
        .run(req, env)
        .await
}

async fn delete_file(_req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let id = ctx.param("id").expect("resource route has an id");
    let deleted_id = ctx
        .d1("DB")?
        .prepare("DELETE FROM resources WHERE id = ? AND published_at IS NOT NULL RETURNING id")
        .bind(&[id.as_str().into()])?
        .first::<String>(Some("id"))
        .await?;
    if let Some(id) = deleted_id
        && let Err(error) = ctx.bucket("FILES")?.delete(&id).await
    {
        console_error!("R2 deletion for {id} deferred to orphan cleanup: {error}");
    }
    Ok(Response::empty()?.with_status(204))
}
