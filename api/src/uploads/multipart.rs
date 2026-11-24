use super::{PART_SIZE, Resource, expired, ticket_lifetime};
use rusty_s3::S3Action;
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use worker::*;

impl Resource {
    async fn multipart_session(&self, env: &Env) -> Result<Option<String>> {
        if self.upload_id.is_some() {
            return Ok(self.upload_id.clone());
        }
        let session = env
            .bucket("FILES")?
            .create_multipart_upload(&self.id)
            .http_metadata(HttpMetadata {
                content_disposition: Some(self.disposition()),
                content_type: Some("application/octet-stream".into()),
                ..Default::default()
            })
            .custom_metadata(HashMap::from([("wavlark".into(), "upload".into())]))
            .execute()
            .await?;
        let candidate = session.upload_id().await;
        let chosen = env
            .d1("DB")?
            .prepare(
                "UPDATE resources SET upload_id = coalesce(upload_id, ?) WHERE id = ?
                 AND expires_at > unixepoch() RETURNING upload_id",
            )
            .bind(&[candidate.as_str().into(), self.id.as_str().into()])?
            .first::<String>(Some("upload_id"))
            .await?;
        if chosen.as_ref() != Some(&candidate) {
            session.abort().await?;
        }
        Ok(chosen)
    }

    pub(super) async fn part_ticket(
        &self,
        req: &Request,
        env: &Env,
        deadline: u64,
    ) -> Result<Response> {
        let parts: Vec<String> = serde_json::from_str(&self.part_etags)?;
        let offset = (parts.len() as u64 * PART_SIZE).min(self.size_bytes);
        let mut ticket = json!({ "id": self.id, "path": self.path, "offset": offset });
        if offset < self.size_bytes {
            let Some(upload_id) = self.multipart_session(env).await? else {
                return expired();
            };
            let number = parts.len() as u16 + 1;
            let length = (self.size_bytes - offset).min(PART_SIZE);
            let ttl = ticket_lifetime(deadline);
            if ttl.is_zero() {
                return expired();
            }
            let (bucket, credentials) = crate::storage::signer(req, env)?;
            let mut put = bucket.upload_part(Some(&credentials), &self.id, number, &upload_id);
            put.headers_mut()
                .insert("content-length", length.to_string());
            ticket["url"] = put.sign(ttl).as_str().into();
            ticket["number"] = number.into();
            ticket["length"] = length.into();
        }
        Response::from_json(&ticket)
    }
}

#[derive(Deserialize)]
struct Receipt {
    etag: String,
}

pub async fn record_part(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let Some(number) = ctx
        .param("number")
        .and_then(|s| s.parse::<u16>().ok())
        .filter(|&n| n > 0)
    else {
        return Response::error("Invalid part number.", 400);
    };
    let Ok(receipt) = req.json::<Receipt>().await else {
        return Response::error("Provide the part ETag.", 400);
    };
    let etag = receipt.etag.trim_matches('"');
    if etag.is_empty() || !etag.bytes().all(|b| b.is_ascii_graphic() && b != b'"') {
        return Response::error("Invalid part ETag.", 400);
    }
    let id = ctx.param("id").unwrap();
    // Append in order. Replaying an acknowledged part just returns the current ticket.
    let index = u32::from(number - 1);
    let slot = format!("$[{index}]");
    let row = ctx
        .d1("DB")?
        .prepare(
            "UPDATE resources SET part_etags = json_set(part_etags, ?, ?)
         WHERE id = ? AND upload_id IS NOT NULL AND expires_at > unixepoch()
           AND ? < size_bytes AND (json_array_length(part_etags) = ? OR json_extract(part_etags, ?) = ?)
         RETURNING *",
        )
        .bind(&[
            slot.as_str().into(),
            etag.into(),
            id.as_str().into(),
            (f64::from(index) * PART_SIZE as f64).into(),
            index.into(),
            slot.as_str().into(),
            etag.into(),
        ])?
        .first::<Resource>(None)
        .await?;
    match row {
        Some(resource) => resource.upload_ticket(&req, &ctx.env).await,
        None => Response::error(
            "This part could not be confirmed. Reopen the draft and retry.",
            409,
        ),
    }
}
