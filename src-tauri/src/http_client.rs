use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Instant;

use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::models::request::{FirvRequest, HttpMethod, RequestBody};
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PreparedBody {
    None,
    Text(String),
    Form(Vec<(String, String)>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreparedRequest {
    pub method: HttpMethod,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: PreparedBody,
}

pub fn prepare_request(request: &FirvRequest, resolver: &mut VariableResolver) -> PreparedRequest {
    let url = resolver.render_liquid(&request.url).unwrap_or_else(|_| resolver.resolve_string(&request.url));

    let mut headers = HashMap::new();
    for kv in &request.headers {
        if kv.enabled {
            let res_key = resolver.render_liquid(&kv.key).unwrap_or_else(|_| resolver.resolve_string(&kv.key));
            let res_val = resolver.render_liquid(&kv.value).unwrap_or_else(|_| resolver.resolve_string(&kv.value));
            headers.insert(res_key, res_val);
        }
    }

    let body = match &request.body {
        RequestBody::None => PreparedBody::None,
        RequestBody::Json(data) => {
            headers.insert("Content-Type".to_string(), "application/json".to_string());
            PreparedBody::Text(resolver.render_liquid(data).unwrap_or_else(|_| resolver.resolve_string(data)))
        }
        RequestBody::Raw(data) => PreparedBody::Text(resolver.render_liquid(data).unwrap_or_else(|_| resolver.resolve_string(data))),
        RequestBody::Formdata(fields) => {
            let mut form_pairs = Vec::new();
            for field in fields {
                if field.enabled {
                    let res_key = resolver.render_liquid(&field.key).unwrap_or_else(|_| resolver.resolve_string(&field.key));
                    let res_val = resolver.render_liquid(&field.value).unwrap_or_else(|_| resolver.resolve_string(&field.value));
                    form_pairs.push((res_key, res_val));
                }
            }
            PreparedBody::Form(form_pairs)
        }
    };

    PreparedRequest {
        method: request.method.clone(),
        url,
        headers,
        body,
    }
}

pub async fn run_request(request: PreparedRequest) -> Result<FirvResponse, String> {
    let method = request.method.to_reqwest_method();
    let mut req_builder = CLIENT.request(method, &request.url);

    for (key, value) in &request.headers {
        req_builder = req_builder.header(key, value);
    }

    req_builder = match request.body {
        PreparedBody::None => req_builder,
        PreparedBody::Text(data) => req_builder.body(data),
        PreparedBody::Form(form_pairs) => req_builder
            .header("Content-Type", "application/x-www-form-urlencoded")
            .form(&form_pairs),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::request::{KeyValue, RequestBody};

    fn resolver_with_values() -> VariableResolver {
        let mut resolver = VariableResolver::new();
        resolver.globals.insert("name".to_string(), "Firv".to_string());
        resolver.globals.insert("token".to_string(), "abc123".to_string());
        resolver
    }

    fn base_request(body: RequestBody) -> FirvRequest {
        FirvRequest {
            id: "req-1".to_string(),
            name: "Test Request".to_string(),
            method: HttpMethod::POST,
            url: "https://example.com/{{name}}".to_string(),
            headers: vec![KeyValue {
                key: "Authorization".to_string(),
                value: "Bearer {{token}}".to_string(),
                enabled: true,
            }],
            params: vec![],
            body,
            transforms: Default::default(),
        }
    }

    #[test]
    fn prepare_request_renders_url_headers_and_json_body() {
        let request = base_request(RequestBody::Json(r#"{\"greeting\":\"Hello {{name}}\"}"#.to_string()));
        let mut resolver = resolver_with_values();

        let prepared = prepare_request(&request, &mut resolver);

        assert_eq!(prepared.method, HttpMethod::POST);
        assert_eq!(prepared.url, "https://example.com/Firv");
        assert_eq!(prepared.headers.get("Authorization").unwrap(), "Bearer abc123");
        assert_eq!(prepared.headers.get("Content-Type").unwrap(), "application/json");

        match prepared.body {
            PreparedBody::Text(body) => assert_eq!(body, r#"{\"greeting\":\"Hello Firv\"}"#),
            other => panic!("expected text body, got {:?}", other),
        }

        let trace = resolver.trace();
        let used_keys: Vec<_> = trace.iter().map(|entry| entry.key.as_str()).collect();
        assert!(used_keys.contains(&"name"));
        assert!(used_keys.contains(&"token"));
        assert_eq!(trace.len(), 2);
    }

    #[test]
    fn prepare_request_renders_formdata_and_ignores_disabled_fields() {
        let request = base_request(RequestBody::Formdata(vec![
            KeyValue {
                key: "first_name".to_string(),
                value: "{{name}}".to_string(),
                enabled: true,
            },
            KeyValue {
                key: "disabled".to_string(),
                value: "{{token}}".to_string(),
                enabled: false,
            },
        ]));
        let mut resolver = resolver_with_values();

        let prepared = prepare_request(&request, &mut resolver);

        match prepared.body {
            PreparedBody::Form(pairs) => {
                assert_eq!(pairs, vec![("first_name".to_string(), "Firv".to_string())]);
            }
            other => panic!("expected form body, got {:?}", other),
        }

        let trace = resolver.trace();
        assert!(trace.iter().any(|entry| entry.key == "name"));
        assert!(trace.iter().any(|entry| entry.key == "token"));
        assert!(!trace.iter().any(|entry| entry.key == "disabled"));
    }
}
