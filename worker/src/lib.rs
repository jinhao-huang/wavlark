use serde_json::json;
use worker::*;

#[event(fetch)]
async fn fetch(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    Router::new()
        .get("/api/health", |_, _| {
            Response::from_json(&json!({ "status": "ok" }))
        })
        .run(req, env)
        .await
}
