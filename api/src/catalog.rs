use serde_json::Value;
use worker::wasm_bindgen::prelude::*;
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
        .prepare("SELECT path, description, size_bytes, published_at, public_mbps FROM published_resources CROSS JOIN download_settings WHERE path = ? AND download_settings.id = 1")
        .bind(&[path.as_ref().into()])?
        .first::<Value>(None)
        .await?;
    match resource {
        Some(resource) => Response::from_json(&resource),
        None => Response::error("File not found.", 404),
    }
}

#[wasm_bindgen(module = "/src/download.js")]
extern "C" {
    #[wasm_bindgen(catch, js_name = sendDownload)]
    async fn send_download(
        request: &web_sys::Request,
        env: &Env,
        identifier: &str,
        by_id: bool,
        admin: bool,
    ) -> std::result::Result<web_sys::Response, JsValue>;
}

pub async fn download(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let id = ctx.param("id");
    let identifier = id
        .map(|id| id.as_str().into())
        .unwrap_or_else(|| public_path(&ctx));
    Ok(
        send_download(req.inner(), &ctx.env, &identifier, id.is_some(), false)
            .await?
            .into(),
    )
}

pub async fn admin_download(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let id = ctx.param("id").expect("admin download route has an id");
    Ok(send_download(req.inner(), &ctx.env, id, true, true)
        .await?
        .into())
}

pub async fn missing_files(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let Ok(ids) = req.json::<Vec<String>>().await else {
        return Response::error("Provide an array of file IDs.", 400);
    };
    let missing = ctx.d1("DB")?
        .prepare("SELECT s.value AS id FROM json_each(?) s LEFT JOIN published_resources f ON f.id = s.value WHERE f.id IS NULL")
        .bind(&[serde_json::to_string(&ids)?.into()])?
        .all().await?.results::<Value>()?;
    let mut response = Response::from_json(&missing)?;
    response.headers_mut().set("Cache-Control", "no-store")?;
    Ok(response)
}
