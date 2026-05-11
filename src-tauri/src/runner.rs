use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Instant;

use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};

use crate::models::{request::HttpMethod, request::RequestBody, FirvRequest};
use crate::variables::VariableResolver;

pub static CLIENT: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .build()
        .expect("Failed to initialize reqwest client")
});

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FirvResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub time_ms: u64,
    pub size_bytes: usize,
}

pub async fn run_request(
    request: FirvRequest,
    resolver: VariableResolver,
) -> Result<FirvResponse, String> {
    let method = match request.method {
        HttpMethod::GET => Method::GET,
        HttpMethod::POST => Method::POST,
        HttpMethod::PUT => Method::PUT,
        HttpMethod::DELETE => Method::DELETE,
        HttpMethod::PATCH => Method::PATCH,
        HttpMethod::HEAD => Method::HEAD,
        HttpMethod::OPTIONS => Method::OPTIONS,
    };

    // TODO: Variable substitution on URL
    let url = resolver.resolve_string(&request.url);

    let mut req_builder = CLIENT.request(method, &url);

    for kv in &request.headers {
        if kv.enabled {
            let res_key = resolver.resolve_string(&kv.key);
            let res_val = resolver.resolve_string(&kv.value);
            req_builder = req_builder.header(&res_key, &res_val);
        }
    }

    req_builder = match &request.body {
        RequestBody::None => req_builder,
        RequestBody::Json(data) => {
            let res_data = resolver.resolve_string(&data);
            req_builder
                .header("Content-Type", "application/json")
                .body(res_data)
        }
        RequestBody::Raw(data) => {
            let res_data = resolver.resolve_string(&data);
            req_builder.body(res_data)
        }
        RequestBody::Formdata(fields) => {
            let mut form = reqwest::multipart::Form::new();
            for field in fields {
                if field.enabled {
                    let res_key = resolver.resolve_string(&field.key);
                    let res_val = resolver.resolve_string(&field.value);
                    form = form.text(res_key, res_val);
                }
            }
            req_builder.multipart(form)
        }
    };

    let start_time = Instant::now();
    let response_result = req_builder.send().await;
    let elapsed = start_time.elapsed().as_millis() as u64;

    let response = response_result.map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status();
    let status_code = status.as_u16();
    let status_text = status.canonical_reason().unwrap_or("Unknown").to_string();

    let mut headers = HashMap::new();
    for (key, value) in response.headers() {
        if let Ok(v_str) = value.to_str() {
            headers.insert(key.to_string(), v_str.to_string());
        }
    }

    let body_bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read body: {}", e))?;
    let size_bytes = body_bytes.len();

    // For Phase 1, just map to string
    let body_str = String::from_utf8_lossy(&body_bytes).to_string();

    let firv_resp = FirvResponse {
        status: status_code,
        status_text,
        headers,
        body: body_str,
        time_ms: elapsed,
        size_bytes,
    };

    Ok(firv_resp)
}
