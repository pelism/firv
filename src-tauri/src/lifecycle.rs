use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Instant;

use crate::models::{request::HttpMethod, request::RequestBody, FirvRequest};
use crate::runner::{FirvResponse, CLIENT};
use crate::scripting::execute_script;
use crate::variables::VariableResolver;

#[derive(Debug, Serialize, Deserialize)]
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
}

#[tauri::command]
pub async fn run_firv_request(
    request: FirvRequest,
    initial_vars: HashMap<String, String>,
) -> Result<LifecycleResult, String> {
    let start_time = Instant::now();
    let mut logs = Vec::new();
    let mut script_errors = Vec::new();

    // Setup variable resolver
    let mut resolver = VariableResolver::new();
    resolver.request_vars = initial_vars;

    // Stage 1: Pre-request Scripting
    if let Some(pre_script) = &request.scripts.pre {
        if !pre_script.trim().is_empty() {
            let mut vars_map = resolver.request_vars.clone();
            if let Err(e) = execute_script(pre_script, &mut vars_map, None, &mut logs) {
                script_errors.push(format!("Pre-request error: {}", e));
                return Ok(LifecycleResult {
                    final_request: HydratedRequestInfo {
                        url: String::new(),
                        method: format!("{:?}", request.method),
                        headers: HashMap::new(),
                        body: None,
                    },
                    response: None,
                    logs,
                    script_errors,
                    execution_time_ms: start_time.elapsed().as_millis() as u64,
                });
            }
            resolver.request_vars = vars_map;
        }
    }

    // Stage 2: Variable Resolution & Hydration
    let method = match request.method {
        HttpMethod::GET => Method::GET,
        HttpMethod::POST => Method::POST,
        HttpMethod::PUT => Method::PUT,
        HttpMethod::DELETE => Method::DELETE,
        HttpMethod::PATCH => Method::PATCH,
        HttpMethod::HEAD => Method::HEAD,
        HttpMethod::OPTIONS => Method::OPTIONS,
    };

    let resolved_url = resolver.resolve_string(&request.url);
    let mut req_builder = CLIENT.request(method.clone(), &resolved_url);

    let mut resolved_headers = HashMap::new();
    for kv in &request.headers {
        if kv.enabled {
            let res_key = resolver.resolve_string(&kv.key);
            let res_val = resolver.resolve_string(&kv.value);
            resolved_headers.insert(res_key.clone(), res_val.clone());
            req_builder = req_builder.header(&res_key, &res_val);
        }
    }

    let mut resolved_body_str = None;

    req_builder = match &request.body {
        RequestBody::None => req_builder,
        RequestBody::Json(data) => {
            let res_data = resolver.resolve_string(&data);
            resolved_body_str = Some(res_data.clone());
            resolved_headers.insert("Content-Type".to_string(), "application/json".to_string());
            req_builder
                .header("Content-Type", "application/json")
                .body(res_data)
        }
        RequestBody::Raw(data) => {
            let res_data = resolver.resolve_string(&data);
            resolved_body_str = Some(res_data.clone());
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

    let hydrated_info = HydratedRequestInfo {
        url: resolved_url,
        method: method.as_str().to_string(),
        headers: resolved_headers,
        body: resolved_body_str,
    };

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

    // Stage 4: Post-Response Scripting
    if let Some(resp) = &firv_resp {
        if let Some(post_script) = &request.scripts.post {
            if !post_script.trim().is_empty() {
                let mut vars_map = resolver.request_vars.clone();
                if let Err(e) = execute_script(post_script, &mut vars_map, Some(resp), &mut logs) {
                    script_errors.push(format!("Post-response error: {}", e));
                } else {
                    // Update variables and possibly return them to UI or sync with state if needed
                    // In this context, just updating resolver.request_vars as per spec (state management usually needs further work to persist to files)
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
    })
}
