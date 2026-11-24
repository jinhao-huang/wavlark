mod multipart;
pub use multipart::record_part;

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

pub const PART_SIZE: u64 = 5 * 1024 * 1024;
// R2 accepts up to 10,000 parts per multipart upload.
pub const MAX_SIZE: u64 = PART_SIZE * 10_000;

#[derive(Deserialize)]
struct Upload {
    request_id: String,
    name: String,
    #[serde(default)]
    directory: String,
    #[serde(default)]
    description: String,
    size_bytes: u64,
    sha256: Option<String>,
}

#[derive(Deserialize)]
struct Resource {
    id: String,
    path: String,
    size_bytes: u64,
    sha256: Option<String>,
    upload_id: Option<String>,
    part_count: u16,
    // Cleared on publication.
    expires_at: Option<u64>,
}

// Upload tickets need only the receipt count, even when acknowledging the last of 10,000 parts.
const TICKET_FIELDS: &str = "id, path, size_bytes, sha256, upload_id, expires_at, json_array_length(part_etags) AS part_count";

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

fn ticket_lifetime(deadline: u64) -> Duration {
    Duration::from_secs(deadline.saturating_sub(now()).min(900))
}

impl Resource {
    fn disposition(&self) -> String {
        let name = self.path.rsplit('/').next().unwrap();
        format!(
            "attachment; filename*=UTF-8''{}",
            utf8_percent_encode(name, NON_ALPHANUMERIC)
        )
    }

    async fn upload_ticket(&self, req: &Request, env: &Env) -> Result<Response> {
        let Some(deadline) = self.expires_at else {
            return Response::error("This file is already published.", 409);
        };
        let ttl = ticket_lifetime(deadline);
        if ttl.is_zero() {
            return expired();
        }
        if self.sha256.is_some() {
            return self.part_ticket(req, env, deadline).await;
        }
        let (bucket, credentials) = crate::storage::signer(req, env)?;
        let disposition = self.disposition();
        let headers = BTreeMap::from([
            ("content-disposition", disposition.as_str()),
            ("content-type", "application/octet-stream"),
            ("if-none-match", "*"),
            ("x-amz-meta-wavlark", "upload"),
        ]);
        let mut put = bucket.put_object(Some(&credentials), &self.id);
        for (&name, &value) in &headers {
            put.headers_mut().insert(name, value);
        }
        // The browser supplies Content-Length when it sends a File.
        put.headers_mut()
            .insert("content-length", self.size_bytes.to_string());
        let url = put.sign(ttl);
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
    if upload.size_bytes > MAX_SIZE {
        return Response::error(
            format!(
                "Choose a file of {} MiB or smaller.",
                MAX_SIZE / (1024 * 1024)
            ),
            413,
        );
    }
    if upload.size_bytes > PART_SIZE {
        if !upload.sha256.as_deref().is_some_and(|hash| {
            hash.len() == 64
                && hash
                    .bytes()
                    .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        }) {
            return Response::error(
                "Provide the original file digest for a resumable upload.",
                400,
            );
        }
    } else if upload.sha256.is_some() {
        return Response::error("Only multipart uploads take a file digest.", 400);
    }
    let path = if directory.is_empty() {
        upload.name
    } else {
        format!("{directory}/{}", upload.name)
    };
    let id = random_uuid();
    let resource = ctx
        .d1("DB")?
        .prepare(format!(
            "INSERT INTO resources (id, path, description, size_bytes, request_id, sha256, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, unixepoch() + 86400)
             ON CONFLICT(path) DO UPDATE SET path = excluded.path
             WHERE resources.request_id = excluded.request_id
               AND resources.size_bytes = excluded.size_bytes
               AND resources.description = excluded.description
               AND resources.sha256 IS excluded.sha256
             RETURNING {TICKET_FIELDS}",
        ))
        .bind(&[
            id.as_str().into(),
            path.as_str().into(),
            upload.description.trim().into(),
            (upload.size_bytes as f64).into(),
            upload.request_id.as_str().into(),
            upload.sha256.as_deref().map(JsValue::from_str).unwrap_or(JsValue::NULL),
        ])?
        .first::<Resource>(None)
        .await?;
    let Some(resource) = resource else {
        return Response::error(
            "This path is already in use. Choose another directory or file name.",
            409,
        );
    };
    let ticket = resource.upload_ticket(&req, &ctx.env).await?;
    if ticket.status_code() == 200 && resource.id == id {
        return Ok(ticket.with_status(201));
    }
    Ok(ticket)
}

#[derive(Deserialize)]
struct Resume {
    sha256: String,
}

pub async fn renew(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let id = ctx.param("id").expect("resource route has an id");
    let Some(resource) = ctx
        .d1("DB")?
        .prepare(format!(
            "SELECT {TICKET_FIELDS} FROM resources WHERE id = ?"
        ))
        .bind(&[id.as_str().into()])?
        .first::<Resource>(None)
        .await?
    else {
        return Response::error("Draft not found.", 404);
    };
    if let Some(expected) = &resource.sha256
        && resource.expires_at.is_some_and(|deadline| deadline > now())
        && !req
            .json::<Resume>()
            .await
            .is_ok_and(|data| &data.sha256 == expected)
    {
        return Response::error(
            "Choose the original file. Its contents differ from this draft.",
            422,
        );
    }
    resource.upload_ticket(&req, &ctx.env).await
}

#[derive(Deserialize)]
struct Publication {
    id: String,
    size_bytes: u64,
    upload_id: Option<String>,
    part_etags: String,
    expires_at: Option<u64>,
}

pub async fn publish(_req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let id = ctx.param("id").expect("resource route has an id");
    let Some(record) = ctx
        .d1("DB")?
        .prepare(
            "SELECT id, size_bytes, upload_id, part_etags, expires_at FROM resources WHERE id = ?",
        )
        .bind(&[id.as_str().into()])?
        .first::<Publication>(None)
        .await?
    else {
        return Response::error("File not found.", 404);
    };
    if let Some(deadline) = record.expires_at {
        if deadline <= now() {
            return expired();
        }
        let bucket = ctx.bucket("FILES")?;
        let mut object = bucket.head(&record.id).await?;
        if object.is_none()
            && let Some(upload_id) = &record.upload_id
        {
            let etags: Vec<String> = serde_json::from_str(&record.part_etags)?;
            if etags.len() as u64 != record.size_bytes.div_ceil(PART_SIZE) {
                return Response::error("Resume the upload to send the remaining parts.", 409);
            }
            let parts = etags
                .into_iter()
                .enumerate()
                .map(|(i, etag)| UploadedPart::new(i as u16 + 1, etag));
            let session = bucket.resume_multipart_upload(&record.id, upload_id)?;
            object = match session.complete(parts).await {
                Ok(file) => Some(file),
                Err(error) => match bucket.head(&record.id).await? {
                    Some(file) => Some(file),
                    None if error.to_string().contains("(10025)") => {
                        // R2 rejected a stored receipt, e.g. after concurrent retries of a part.
                        ctx.d1("DB")?.prepare(
                            "UPDATE resources SET part_etags = '[]' WHERE id = ? AND part_etags = ? AND expires_at > unixepoch()"
                        ).bind(&[record.id.as_str().into(), record.part_etags.as_str().into()])?.run().await?;
                        return Response::error(
                            "R2 could not verify the uploaded parts. Choose the original file to upload them again.",
                            409,
                        );
                    }
                    None => return Err(error),
                },
            };
        }
        let Some(file) = object else {
            return Response::error("The file is missing. Retry the upload.", 409);
        };
        if file.size() != record.size_bytes {
            return Response::error(
                "The stored file has the wrong size. Discard the draft and upload it again.",
                422,
            );
        }
        // A repeated confirmation succeeds, even when another request just published it.
        let updated = ctx.d1("DB")?.prepare(
            "UPDATE resources SET published_at = coalesce(published_at, unixepoch()), expires_at = NULL,
                upload_id = NULL, sha256 = NULL, part_etags = '[]'
             WHERE id = ? AND (published_at IS NOT NULL OR expires_at > unixepoch()) RETURNING id"
        ).bind(&[record.id.into()])?.first::<String>(Some("id")).await?;
        if updated.is_none() {
            return Response::error("This draft is no longer available.", 410);
        }
    }
    Ok(Response::empty()?.with_status(204))
}

#[derive(Deserialize)]
pub struct StoredUpload {
    pub id: String,
    upload_id: Option<String>,
}

impl StoredUpload {
    pub async fn abort(&self, bucket: &Bucket) -> Result<()> {
        if let Some(upload_id) = &self.upload_id {
            // The bucket lifecycle also expires sessions whose abort request fails.
            if let Err(error) = bucket
                .resume_multipart_upload(&self.id, upload_id)?
                .abort()
                .await
            {
                console_warn!("Could not abort multipart upload for {}: {error}", self.id);
            }
        }
        Ok(())
    }
}

pub async fn clean_expired(env: Env) -> Result<()> {
    let db = env.d1("DB")?;
    let bucket = env.bucket("FILES")?;
    // Each multipart draft may also require an R2 abort in this invocation.
    let rows = db.prepare(
        "SELECT id, upload_id FROM resources WHERE expires_at <= unixepoch() ORDER BY expires_at LIMIT 32"
    ).all().await?.results::<StoredUpload>()?;
    let mut ids = Vec::with_capacity(rows.len());
    for row in rows {
        row.abort(&bucket).await?;
        ids.push(row.id);
    }
    if !ids.is_empty() {
        let batch = serde_json::to_string(&ids)?;
        bucket.delete_multiple(ids).await?;
        db.prepare("DELETE FROM resources WHERE id IN (SELECT value FROM json_each(?)) AND published_at IS NULL")
            .bind(&[batch.into()])?.run().await?;
    }
    Ok(())
}

// Reclaim late uploads and files left behind when an R2 deletion fails.
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
