use std::time::Duration;

use rusty_s3::S3Action;
use serde_json::Value;
use worker::*;

const PAGE_SIZE: u32 = 20;

pub async fn list(req: Request, ctx: RouteContext<()>, mut response: Value) -> Result<Response> {
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
            "SELECT id, path, size_bytes, published_at FROM published_resources
             ORDER BY published_at DESC, id DESC LIMIT ? OFFSET ?",
        )
        .bind(&[(PAGE_SIZE + 1).into(), offset.into()])?
        .all()
        .await?
        .results::<Value>()?;
    let has_next = resources.len() > PAGE_SIZE as usize;
    resources.truncate(PAGE_SIZE as usize);
    response["resources"] = resources.into();
    response["page"] = page.into();
    response["has_next"] = has_next.into();
    Response::from_json(&response)
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

pub async fn missing_files(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let ids: Vec<_> = req
        .url()?
        .query_pairs()
        .filter(|(name, _)| name == "file")
        .map(|(_, id)| id.into_owned())
        .collect();
    let missing = ctx.d1("DB")?
        .prepare("SELECT s.value AS id FROM json_each(?) s LEFT JOIN published_resources f ON f.id = s.value WHERE f.id IS NULL")
        .bind(&[serde_json::to_string(&ids)?.into()])?
        .all().await?.results::<Value>()?;
    let mut response = Response::from_json(&missing)?;
    response.headers_mut().set("Cache-Control", "no-store")?;
    Ok(response)
}

pub async fn selected_file(_req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let id = ctx.param("id").expect("download route has an id");
    let published = ctx
        .d1("DB")?
        .prepare("SELECT id FROM published_resources WHERE id = ?")
        .bind(&[id.as_str().into()])?
        .first::<String>(Some("id"))
        .await?;
    if published.is_none() {
        return Response::error("The selected file is no longer available.", 404);
    }
    let Some(object) = ctx.bucket("FILES")?.get(id).execute().await? else {
        return Response::error("The stored file is missing.", 503);
    };
    let body = object.body().expect("unconditional R2 GET returns a body");
    let mut response = Response::from_body(body.response_body()?)?;
    let disposition = object.http_metadata().content_disposition;
    response.headers_mut().set(
        "Content-Disposition",
        disposition.as_deref().unwrap_or("attachment"),
    )?;
    response
        .headers_mut()
        .set("Content-Type", "application/octet-stream")?;
    response.headers_mut().set("Cache-Control", "no-store")?;
    Ok(response)
}
