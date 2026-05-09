use reqwest::Method;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Instant;

use crate::models::{request::HttpMethod, request::RequestBody, FirvRequest};
use crate::runner::{FirvResponse, CLIENT};
use crate::variables::{ExtractionRule, VariableResolver};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HydratedRequestInfo {
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>, 
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LifecycleResult {
    pub final_request: HydratedRequestInfo,
    pub response: Option<FirvResponse>,
    pub logs: Vec<String>,
    pub script_errors: Vec<String>,
    pub execution_time_ms: u64,
    pub variables: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct DeclarativeExtraction {
    target: String,
    source: Option<String>,
    pattern: String,
}

#[tauri::command]
pub async fn run_firv_request(
    _app: tauri::AppHandle,
    request: FirvRequest,
    workspace_vars: Vec<crate::models::request::KeyValue>,
) -> Result<LifecycleResult, String> {
    let start_time = Instant::now();
    let mut logs = Vec::new();
    let mut script_errors = Vec::new();

    // Setup variable resolver
    let mut resolver = VariableResolver::new();
    resolver.globals = workspace_vars
        .into_iter()
        .filter(|kv| kv.enabled)
        .map(|kv| (kv.key, kv.value))
        .collect();

    // --- Declarative rendering ---
    let rendered_url = resolver
        .render_liquid(&request.url)
        .unwrap_or_else(|_| resolver.resolve_string(&request.url));

    // --- Hydration ---
    let method = match request.method {
        HttpMethod::GET => Method::GET,
        HttpMethod::POST => Method::POST,
        HttpMethod::PUT => Method::PUT,
        HttpMethod::DELETE => Method::DELETE,
        HttpMethod::PATCH => Method::PATCH,
        HttpMethod::HEAD => Method::HEAD,
        HttpMethod::OPTIONS => Method::OPTIONS,
    };

    let resolved_url = rendered_url;
    let mut resolved_headers = HashMap::new();
    for kv in &request.headers {
        if kv.enabled {
            let res_key = resolver.render_liquid(&kv.key).unwrap_or_else(|_| resolver.resolve_string(&kv.key));
            let res_val = resolver.render_liquid(&kv.value).unwrap_or_else(|_| resolver.resolve_string(&kv.value));
            resolved_headers.insert(res_key.clone(), res_val.clone());
        }
    }

    let resolved_body_str = match &request.body {
        RequestBody::None => None,
        RequestBody::Json(data) => {
            let res_data = resolver.render_liquid(&data).unwrap_or_else(|_| resolver.resolve_string(&data));
            resolved_headers.insert("Content-Type".to_string(), "application/json".to_string());
            Some(res_data)
        }
        RequestBody::Raw(data) => Some(resolver.render_liquid(&data).unwrap_or_else(|_| resolver.resolve_string(&data))),
        RequestBody::Formdata(_) => None, // Formdata handled separately below
    };

    let mut hydrated_info = HydratedRequestInfo {
        url: resolved_url,
        method: method.as_str().to_string(),
        headers: resolved_headers,
        body: resolved_body_str,
    };

    // --- Request-level modifications via declarative transforms ---
    if let Ok(rendered_body) = resolver.render_liquid(request.transforms.pre_request.as_deref().unwrap_or("")) {
        if !rendered_body.is_empty() {
            hydrated_info.body = Some(rendered_body);
        }
    }

    // Build the final reqwest builder
    let final_method = Method::from_bytes(hydrated_info.method.as_bytes()).unwrap_or(Method::GET);
    let mut req_builder = CLIENT.request(final_method, &hydrated_info.url);

    for (k, v) in &hydrated_info.headers {
        req_builder = req_builder.header(k, v);
    }

    if let Some(body) = &hydrated_info.body {
        req_builder = req_builder.body(body.clone());
    } else if let RequestBody::Formdata(fields) = &request.body {
        let mut form = reqwest::multipart::Form::new();
        for field in fields {
            if field.enabled {
                let res_key = resolver.render_liquid(&field.key).unwrap_or_else(|_| resolver.resolve_string(&field.key));
                let res_val = resolver.render_liquid(&field.value).unwrap_or_else(|_| resolver.resolve_string(&field.value));
                form = form.text(res_key, res_val);
            }
        }
        req_builder = req_builder.multipart(form);
    }

    // Stage 3: Network Execution
    let req_start = Instant::now();
    let response_result = req_builder.send().await;
    let req_elapsed = req_start.elapsed().as_millis() as u64;

    let firv_resp = match response_result {
        Ok(response) => {
            let status = response.status();
            let status_code = status.as_u16();
            let status_text = status.canonical_reason().unwrap_or("Unknown").to_string();

            let mut resp_headers = HashMap::new();
            for (key, value) in response.headers() {
                if let Ok(v_str) = value.to_str() {
                    resp_headers.insert(key.to_string(), v_str.to_string());
                }
            }

            let body_bytes = response
                .bytes()
                .await
                .map_err(|e| format!("Failed to read body: {}", e))?;
            let size_bytes = body_bytes.len();
            let body_str = String::from_utf8_lossy(&body_bytes).to_string();

            Some(FirvResponse {
                status: status_code,
                status_text,
                headers: resp_headers,
                body: body_str,
                time_ms: req_elapsed,
                size_bytes,
            })
        }
        Err(e) => {
            script_errors.push(format!("Network request failed: {}", e));
            None
        }
    };

    // --- Post-response extraction ---
    if let Some(resp) = &firv_resp {
        if let Ok(rule_text) = resolver.render_liquid(request.transforms.post_response.as_deref().unwrap_or("")) {
            if !rule_text.trim().is_empty() {
                if let Ok(parsed) = serde_json::from_str::<DeclarativeExtraction>(&rule_text) {
                    let source = match parsed.source.as_deref() {
                        Some("response_body_raw") => crate::variables::ExtractionSource::ResponseBodyRaw,
                        _ => crate::variables::ExtractionSource::ResponseBodyJson,
                    };
                    let rule = ExtractionRule { target: parsed.target, source, pattern: parsed.pattern };
                    if let Some(value) = resolver.apply_extraction_rule(&rule, &resp.body) {
                        resolver.request_vars.insert(rule.target, value);
                    }
                }
            }
        }
    }

    let total_time = start_time.elapsed().as_millis() as u64;

    Ok(LifecycleResult {
        final_request: hydrated_info,
        response: firv_resp,
        logs,
        script_errors,
        execution_time_ms: total_time,
        variables: resolver.request_vars,
    })
}
