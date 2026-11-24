mod catalog;
mod manage;
mod storage;
mod uploads;

use serde_json::json;
use worker::*;

#[event(fetch)]
async fn fetch(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    let path = req.path();
    if path == "/api/manage" || path.starts_with("/api/manage/") {
        let mut response = manage::handle(req, env).await?;
        response.headers_mut().set("Cache-Control", "no-store")?;
        return Ok(response);
    }
    Router::new()
        .get("/api/health", |_, _| {
            Response::from_json(&json!({ "status": "ok" }))
        })
        .get_async("/api/resources", |req, ctx| {
            catalog::list(req, ctx, json!({}))
        })
        .get_async("/api/resources/*path", catalog::detail)
        .get_async("/api/downloads/:id", catalog::selected_file)
        .get_async("/api/downloads", catalog::missing_files)
        .get_async("/download/*path", catalog::download)
        .run(req, env)
        .await
}

#[event(scheduled)]
async fn scheduled(event: ScheduledEvent, env: Env, _ctx: ScheduleContext) {
    let result = if event.cron() == "0 3 * * *" {
        uploads::clean_orphans(env).await
    } else {
        uploads::clean_expired(env).await
    };
    if let Err(error) = result {
        console_error!("Storage cleanup failed: {error}");
    }
}
