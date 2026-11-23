use std::time::Duration;

use rusty_s3::{Bucket, Credentials, S3Action, UrlStyle};
use serde_json::{Value, json};
use worker::*;

const PAGE_SIZE: u32 = 20;

pub async fn list(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let url = req.url()?;
    let page = url.query_pairs().find(|(key, _)| key == "page");
    let page = match page {
        None => 1,
        Some((_, value)) => match value.parse::<u32>() {
            Ok(page) if page > 0 => page,
            _ => return Response::error("Page must be a positive integer.", 400),
        },
    };
    let offset = f64::from(page - 1) * f64::from(PAGE_SIZE);
    let mut resources = ctx
        .d1("DB")?
        .prepare(
            "SELECT id, name, size_bytes, published_at FROM published_resources
                  ORDER BY published_at DESC, id DESC LIMIT ? OFFSET ?",
        )
        .bind(&[(PAGE_SIZE + 1).into(), offset.into()])?
        .all()
        .await?
        .results::<Value>()?;
    let has_next = resources.len() > PAGE_SIZE as usize;
    resources.truncate(PAGE_SIZE as usize);
    Response::from_json(&json!({ "resources": resources, "page": page, "has_next": has_next }))
}

pub async fn detail(_req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let id = ctx.param("id").expect("resource route has an id");
    let resource = ctx
        .d1("DB")?
        .prepare("SELECT * FROM published_resources WHERE id = ?")
        .bind(&[id.as_str().into()])?
        .first::<Value>(None)
        .await?;
    match resource {
        Some(resource) => Response::from_json(&resource),
        None => Response::error("File not found.", 404),
    }
}

pub async fn download(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let id = ctx.param("id").expect("download route has an id");
    let published_id = ctx
        .d1("DB")?
        .prepare("SELECT id FROM published_resources WHERE id = ?")
        .bind(&[id.as_str().into()])?
        .first::<String>(Some("id"))
        .await?;
    let Some(key) = published_id else {
        return Response::error("File not found.", 404);
    };

    let endpoint = req.url()?.join(&ctx.var("R2_ENDPOINT")?.to_string())?;
    let bucket = Bucket::new(
        endpoint,
        UrlStyle::Path,
        ctx.var("R2_BUCKET_NAME")?.to_string(),
        "auto",
    )
    .map_err(|e| Error::from(e.to_string()))?;
    let credentials = Credentials::new(
        ctx.secret("R2_ACCESS_KEY_ID")?.to_string(),
        ctx.secret("R2_SECRET_ACCESS_KEY")?.to_string(),
    );
    let url = bucket
        .get_object(Some(&credentials), &key)
        .sign(Duration::from_secs(300));
    let mut response = Response::empty()?.with_status(302);
    response.headers_mut().set("Location", url.as_str())?;
    response.headers_mut().set("Cache-Control", "no-store")?;
    Ok(response)
}
