use std::time::Duration;

use rusty_s3::S3Action;
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
            "SELECT path, size_bytes, published_at FROM published_resources
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

fn public_path(ctx: &RouteContext<()>) -> std::borrow::Cow<'_, str> {
    let path = ctx.param("path").expect("catalog route has a path");
    percent_encoding::percent_decode_str(path.trim_end_matches('/')).decode_utf8_lossy()
}

pub async fn detail(_req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let path = public_path(&ctx);
    let resource = ctx
        .d1("DB")?
        .prepare("SELECT path, description, size_bytes, published_at FROM published_resources WHERE path = ?")
        .bind(&[path.as_ref().into()])?
        .first::<Value>(None)
        .await?;
    match resource {
        Some(resource) => Response::from_json(&resource),
        None => Response::error("File not found.", 404),
    }
}

pub async fn download(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let path = public_path(&ctx);
    let published_id = ctx
        .d1("DB")?
        .prepare("SELECT id FROM published_resources WHERE path = ?")
        .bind(&[path.as_ref().into()])?
        .first::<String>(Some("id"))
        .await?;
    let Some(key) = published_id else {
        return Response::error("File not found.", 404);
    };

    let (bucket, credentials) = crate::storage::signer(&req, &ctx.env)?;
    let url = bucket
        .get_object(Some(&credentials), &key)
        .sign(Duration::from_secs(300));
    let mut response = Response::empty()?.with_status(302);
    response.headers_mut().set("Location", url.as_str())?;
    response.headers_mut().set("Cache-Control", "no-store")?;
    Ok(response)
}
