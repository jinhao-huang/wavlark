use crate::publisher::Publisher;
use std::collections::BTreeMap;
use std::time::Duration;

use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use rusty_s3::S3Action;
use serde::Deserialize;
use serde_json::json;
use worker::wasm_bindgen::prelude::*;
use worker::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = crypto, js_name = randomUUID)]
    fn random_uuid() -> String;
}

#[derive(Deserialize)]
struct Upload {
    name: String,
    #[serde(default)]
    description: String,
    size_bytes: u64,
}

pub async fn create(mut req: Request, ctx: RouteContext<Publisher>) -> Result<Response> {
    let content_type = req.headers().get("Content-Type")?.unwrap_or_default();
    if content_type.split(';').next() != Some("application/json") {
        return Response::error("Send file details as JSON.", 415);
    }
    let Ok(upload) = req.json::<Upload>().await else {
        return Response::error("Provide a file name and size.", 400);
    };
    if upload.name.trim().is_empty()
        || upload.name.contains(['/', '\\'])
        || upload.name.chars().any(char::is_control)
    {
        return Response::error("Choose a file with a valid name.", 400);
    }
    if upload.size_bytes > 100 * 1024 * 1024 {
        return Response::error("Choose a file of 100 MiB or smaller.", 413);
    }

    let id = random_uuid();
    let disposition = format!(
        "attachment; filename*=UTF-8''{}",
        utf8_percent_encode(&upload.name, NON_ALPHANUMERIC)
    );
    let headers = BTreeMap::from([
        ("content-disposition", disposition.as_str()),
        ("content-type", "application/octet-stream"),
        ("if-none-match", "*"),
    ]);
    let (bucket, credentials) = crate::storage::signer(&req, &ctx.env)?;
    let mut put = bucket.put_object(Some(&credentials), &id);
    for (&name, &value) in &headers {
        put.headers_mut().insert(name, value);
    }
    // The browser supplies Content-Length when it sends a File.
    put.headers_mut()
        .insert("content-length", upload.size_bytes.to_string());
    let url = put.sign(Duration::from_secs(900));

    ctx.d1("DB")?
        .prepare(
            "INSERT INTO resources (id, name, description, size_bytes, publisher_id)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&[
            id.as_str().into(),
            upload.name.as_str().into(),
            upload.description.trim().into(),
            (upload.size_bytes as f64).into(),
            ctx.data.id.as_str().into(),
        ])?
        .run()
        .await?;
    Ok(
        Response::from_json(&json!({ "id": id, "url": url.as_str(), "headers": headers }))?
            .with_status(201),
    )
}

#[derive(Deserialize)]
struct Publication {
    size_bytes: u64,
    published_at: Option<i64>,
}

pub async fn publish(_req: Request, ctx: RouteContext<Publisher>) -> Result<Response> {
    let id = ctx.param("id").expect("resource route has an id");
    let db = ctx.d1("DB")?;
    let resource_and_owner = [id.as_str().into(), ctx.data.id.as_str().into()];
    let record = db
        .prepare("SELECT size_bytes, published_at FROM resources WHERE id = ? AND publisher_id = ?")
        .bind(&resource_and_owner)?
        .first::<Publication>(None)
        .await?;
    let Some(record) = record else {
        return Response::error("File not found.", 404);
    };
    if record.published_at.is_none() {
        let object = ctx.bucket("FILES")?.head(id).await?;
        if !object.is_some_and(|file| file.size() == record.size_bytes) {
            return Response::error(
                "The uploaded file is missing or its size does not match.",
                409,
            );
        }
        db.prepare(
            "UPDATE resources SET published_at = unixepoch()
                    WHERE id = ? AND publisher_id = ? AND published_at IS NULL",
        )
        .bind(&resource_and_owner)?
        .run()
        .await?;
    }
    Ok(Response::empty()?.with_status(204))
}
