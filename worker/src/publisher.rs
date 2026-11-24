use serde::{Deserialize, Serialize};
use worker::wasm_bindgen::prelude::*;
use worker::*;

#[wasm_bindgen(module = "/src/access.js")]
extern "C" {
    #[wasm_bindgen(catch, js_name = verifyPublisher)]
    async fn verify_publisher(
        token: &str,
        issuer: &str,
        audience: &str,
    ) -> std::result::Result<JsValue, JsValue>;
}

#[derive(Deserialize, Serialize)]
pub struct Publisher {
    #[serde(rename(deserialize = "sub"))]
    pub id: String,
    email: String,
}

pub async fn handle(req: Request, env: Env) -> Result<Response> {
    let unauthorized = || Response::error("Publisher sign-in required.", 401);
    let Some(token) = req.headers().get("Cf-Access-Jwt-Assertion")? else {
        return unauthorized();
    };
    let (Ok(issuer), Ok(audience)) = (env.var("ACCESS_ISSUER"), env.var("ACCESS_AUD")) else {
        return Response::error("Publisher access is not configured.", 503);
    };
    let claims = match verify_publisher(&token, &issuer.to_string(), &audience.to_string()).await {
        Ok(claims) => claims,
        Err(error) => {
            console_error!("Access verification unavailable: {error:?}");
            return Response::error("Publisher authentication is unavailable.", 503);
        }
    };
    let Ok(publisher) = serde_wasm_bindgen::from_value::<Publisher>(claims) else {
        return unauthorized();
    };
    if publisher.id.is_empty() || publisher.email.is_empty() {
        return unauthorized();
    }
    Router::with_data(publisher)
        .get("/api/manage/me", |_, ctx| Response::from_json(&ctx.data))
        .post_async("/api/manage/resources", crate::uploads::create)
        .post_async("/api/manage/resources/:id/upload", crate::uploads::renew)
        .put_async(
            "/api/manage/resources/:id/publication",
            crate::uploads::publish,
        )
        .run(req, env)
        .await
}
