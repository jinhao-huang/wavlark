mod catalog;
mod publisher;

use serde_json::json;
use worker::*;

#[event(fetch)]
async fn fetch(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    let path = req.path();
    if path == "/api/manage" || path.starts_with("/api/manage/") {
        let mut response = publisher::handle(req, env).await?;
        response.headers_mut().set("Cache-Control", "no-store")?;
        return Ok(response);
    }
    Router::new()
        .get("/api/health", |_, _| {
            Response::from_json(&json!({ "status": "ok" }))
        })
        .get_async("/api/resources", catalog::list)
        .get_async("/api/resources/:id", catalog::detail)
        .get_async("/download/:id", catalog::download)
        .run(req, env)
        .await
}
