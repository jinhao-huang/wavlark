mod catalog;

use serde_json::json;
use worker::*;

#[event(fetch)]
async fn fetch(req: Request, env: Env, _ctx: Context) -> Result<Response> {
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
