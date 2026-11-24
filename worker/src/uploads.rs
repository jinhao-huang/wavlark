use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use rusty_s3::S3Action;
use serde::Deserialize;
use serde_json::json;
use std::collections::BTreeMap;
use std::time::Duration;
use worker::wasm_bindgen::prelude::*;
use worker::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = crypto, js_name = randomUUID)]
    fn random_uuid() -> String;
}

#[derive(Deserialize)]
struct Upload {
    request_id: String,
    name: String,
    #[serde(default)]
    directory: String,
    #[serde(default)]
    description: String,
    size_bytes: u64,
}

#[derive(Deserialize)]
struct Resource {
    id: String,
    path: String,
    size_bytes: u64,
    // Cleared on publication.
    expires_at: Option<u64>,
}

fn valid_segment(segment: &str) -> bool {
    !segment.trim().is_empty()
        && !matches!(segment, "." | "..")
        && !segment.contains(['/', '\\'])
        && !segment.chars().any(char::is_control)
}

fn expired() -> Result<Response> {
    Response::error(
        "This draft expired. Its path will be available after cleanup.",
        410,
    )
}

fn now() -> u64 {
    Date::now().as_millis() / 1000
}

impl Resource {
    fn upload_ticket(&self, req: &Request, env: &Env) -> Result<Response> {
        let Some(deadline) = self.expires_at else {
            return Response::error("This file is already published.", 409);
        };
        let seconds = deadline.saturating_sub(now()).min(900);
        if seconds == 0 {
            return expired();
        }
        let name = self.path.rsplit('/').next().unwrap();
        let disposition = format!(
            "attachment; filename*=UTF-8''{}",
            utf8_percent_encode(name, NON_ALPHANUMERIC)
        );
        let headers = BTreeMap::from([
            ("content-disposition", disposition.as_str()),
            ("content-type", "application/octet-stream"),
            ("if-none-match", "*"),
            ("x-amz-meta-wavlark", "upload"),
        ]);
        let (bucket, credentials) = crate::storage::signer(req, env)?;
        let mut put = bucket.put_object(Some(&credentials), &self.id);
        for (&name, &value) in &headers {
            put.headers_mut().insert(name, value);
        }
        // The browser supplies Content-Length when it sends a File.
        put.headers_mut()
            .insert("content-length", self.size_bytes.to_string());
        let url = put.sign(Duration::from_secs(seconds));
        Response::from_json(
            &json!({ "id": self.id, "path": self.path, "url": url.as_str(), "headers": headers }),
        )
    }
}

pub async fn create(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let content_type = req.headers().get("Content-Type")?.unwrap_or_default();
    if content_type.split(';').next() != Some("application/json") {
        return Response::error("Send file details as JSON.", 415);
    }
    let Ok(upload) = req.json::<Upload>().await else {
        return Response::error("Provide a file name and size.", 400);
    };
    if upload.request_id.len() != 36 {
        return Response::error("Provide an upload request ID.", 400);
    }
    if !valid_segment(&upload.name) {
        return Response::error("Choose a file with a valid name.", 400);
    }
    let directory = upload.directory.trim_matches('/');
    if !directory.is_empty() && !directory.split('/').all(valid_segment) {
        return Response::error("Enter folder names separated by a single slash.", 400);
    }
    if upload.size_bytes > 100 * 1024 * 1024 {
        return Response::error("Choose a file of 100 MiB or smaller.", 413);
    }
    let path = if directory.is_empty() {
        upload.name
    } else {
        format!("{directory}/{}", upload.name)
    };
    let id = random_uuid();
    let resource = ctx
        .d1("DB")?
        .prepare(
            "INSERT INTO resources (id, path, description, size_bytes, request_id, expires_at)
             VALUES (?, ?, ?, ?, ?, unixepoch() + 86400)
             ON CONFLICT(path) DO UPDATE SET path = excluded.path
             WHERE resources.request_id = excluded.request_id
               AND resources.size_bytes = excluded.size_bytes
               AND resources.description = excluded.description
             RETURNING id, path, size_bytes, expires_at",
        )
        .bind(&[
            id.as_str().into(),
            path.as_str().into(),
            upload.description.trim().into(),
            (upload.size_bytes as f64).into(),
            upload.request_id.as_str().into(),
        ])?
        .first::<Resource>(None)
        .await?;
    let Some(resource) = resource else {
        return Response::error(
            "This path is already in use. Choose another directory or file name.",
            409,
        );
    };
    let ticket = resource.upload_ticket(&req, &ctx.env)?;
    if ticket.status_code() == 200 && resource.id == id {
        return Ok(ticket.with_status(201));
    }
    Ok(ticket)
}

async fn find_resource(ctx: &RouteContext<()>) -> Result<Option<Resource>> {
    let id = ctx.param("id").expect("resource route has an id");
    ctx.d1("DB")?
        .prepare("SELECT id, path, size_bytes, expires_at FROM resources WHERE id = ?")
        .bind(&[id.as_str().into()])?
        .first(None)
        .await
}

pub async fn renew(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    match find_resource(&ctx).await? {
        Some(resource) => resource.upload_ticket(&req, &ctx.env),
        None => Response::error("Draft not found.", 404),
    }
}

pub async fn publish(_req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let Some(record) = find_resource(&ctx).await? else {
        return Response::error("File not found.", 404);
    };
    if let Some(deadline) = record.expires_at {
        if deadline <= now() {
            return expired();
        }
        let object = ctx.bucket("FILES")?.head(&record.id).await?;
        let Some(file) = object else {
            return Response::error("The file is missing. Retry the upload.", 409);
        };
        if file.size() != record.size_bytes {
            return Response::error(
                "The stored file has the wrong size. Upload to a different path.",
                409,
            );
        }
        // A repeated confirmation succeeds, even when another request just published it.
        let updated = ctx.d1("DB")?.prepare(
            "UPDATE resources SET published_at = coalesce(published_at, unixepoch()), expires_at = NULL
             WHERE id = ? AND (published_at IS NOT NULL OR expires_at > unixepoch()) RETURNING id"
        ).bind(&[record.id.into()])?.first::<String>(Some("id")).await?;
        if updated.is_none() {
            return expired();
        }
    }
    Ok(Response::empty()?.with_status(204))
}

pub async fn clean_expired(env: Env) -> Result<()> {
    let db = env.d1("DB")?;
    let ids: Vec<String> = db
        .prepare(
            "SELECT id FROM resources WHERE published_at IS NULL AND expires_at <= unixepoch()
         ORDER BY expires_at LIMIT 1000",
        )
        .raw::<String>()
        .await?
        .into_iter()
        .flatten()
        .collect();
    if !ids.is_empty() {
        let batch = serde_json::to_string(&ids)?;
        env.bucket("FILES")?.delete_multiple(ids).await?;
        db.prepare("DELETE FROM resources WHERE id IN (SELECT value FROM json_each(?)) AND published_at IS NULL")
            .bind(&[batch.into()])?.run().await?;
    }
    Ok(())
}

// A PUT started before expiry can finish after its draft was removed.
pub async fn clean_orphans(env: Env) -> Result<()> {
    let bucket = env.bucket("FILES")?;
    let db = env.d1("DB")?;
    let mut cursor = None;
    loop {
        let mut list = bucket.list().include(vec![Include::CustomMetadata]);
        if let Some(cursor) = cursor {
            list = list.cursor(cursor);
        }
        let page = list.execute().await?;
        let mut keys = Vec::new();
        for object in page.objects() {
            if object
                .custom_metadata()?
                .get("wavlark")
                .is_some_and(|v| v == "upload")
            {
                keys.push(object.key());
            }
        }
        if !keys.is_empty() {
            let orphans: Vec<String> = db
                .prepare("SELECT value FROM json_each(?) WHERE NOT EXISTS (SELECT 1 FROM resources WHERE id = value)")
                .bind(&[serde_json::to_string(&keys)?.into()])?
                .raw::<String>()
                .await?
                .into_iter()
                .flatten()
                .collect();
            if !orphans.is_empty() {
                bucket.delete_multiple(orphans).await?;
            }
        }
        cursor = page.cursor();
        if cursor.is_none() {
            return Ok(());
        }
    }
}
