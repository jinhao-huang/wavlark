use rusty_s3::{Bucket, Credentials, UrlStyle};
use worker::{Env, Error, Request, Result};

pub fn signer(req: &Request, env: &Env) -> Result<(Bucket, Credentials)> {
    let endpoint = req.url()?.join(&env.var("R2_ENDPOINT")?.to_string())?;
    let bucket = Bucket::new(
        endpoint,
        UrlStyle::Path,
        env.var("R2_BUCKET_NAME")?.to_string(),
        "auto",
    )
    .map_err(|e| Error::from(e.to_string()))?;
    let credentials = Credentials::new(
        env.secret("R2_ACCESS_KEY_ID")?.to_string(),
        env.secret("R2_SECRET_ACCESS_KEY")?.to_string(),
    );
    Ok((bucket, credentials))
}
