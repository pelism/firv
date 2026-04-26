use reqwest::Method;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Instant;

use crate::models::manifest::ScriptConfig;
use crate::models::{request::HttpMethod, request::RequestBody, FirvRequest};
use crate::runner::{FirvResponse, CLIENT};
use crate::scripting::execute_script;
use crate::variables::VariableResolver;

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

#[tauri::command]
pub async fn run_firv_request(
    request: FirvRequest,
    initial_vars: HashMap<String, String>,
    workspace_scripts: Option<ScriptConfig>,
    folder_scripts: Option<Vec<ScriptConfig>>,
) -> Result<LifecycleResult, String> {
    let start_time = Instant::now();
    let mut logs = Vec::new();
    let mut script_errors = Vec::new();

    // Setup variable resolver
    let mut resolver = VariableResolver::new();
    resolver.request_vars = initial_vars;

    // --- Pre-request Scripting ---
    
    // 1. Workspace Level
    if let Some(ws_scripts) = &workspace_scripts {
        if let Some(pre) = &ws_scripts.pre {
            if let Err(e) = execute_script(pre, &mut resolver.request_vars, None, None, &mut logs) {
                script_errors.push(format!("Workspace Pre-request error: {}", e));
            }
        }
    }

    // 2. Folder Level
    if let Some(folders) = &folder_scripts {
        for (i, folder) in folders.iter().enumerate() {
            if let Some(pre) = &folder.pre {
                if let Err(e) = execute_script(pre, &mut resolver.request_vars, None, None, &mut logs) {
                    script_errors.push(format!("Folder[{}] Pre-request error: {}", i, e));
                }
            }
        }
    }

    // 3. Request Level (Before hydration - can modify variables)
    if let Some(pre) = &request.scripts.pre {
        if let Err(e) = execute_script(pre, &mut resolver.request_vars, None, None, &mut logs) {
            script_errors.push(format!("Request Pre-request error: {}", e));
        }
    }

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

    let resolved_url = resolver.resolve_string(&request.url);
    let mut resolved_headers = HashMap::new();
    for kv in &request.headers {
        if kv.enabled {
            let res_key = resolver.resolve_string(&kv.key);
            let res_val = resolver.resolve_string(&kv.value);
            resolved_headers.insert(res_key.clone(), res_val.clone());
        }
    }

    let resolved_body_str = match &request.body {
        RequestBody::None => None,
        RequestBody::Json(data) => {
            let res_data = resolver.resolve_string(&data);
            resolved_headers.insert("Content-Type".to_string(), "application/json".to_string());
            Some(res_data)
        }
        RequestBody::Raw(data) => Some(resolver.resolve_string(&data)),
        RequestBody::Formdata(_) => None, // Formdata handled separately below
    };

    let mut hydrated_info = HydratedRequestInfo {
        url: resolved_url,
        method: method.as_str().to_string(),
        headers: resolved_headers,
        body: resolved_body_str,
    };

    // --- Request-level modifications via JS ---
    // This allows the request script to modify the final hydrated URL/headers/body
    if let Some(pre) = &request.scripts.pre {
        if let Err(e) = execute_script(pre, &mut resolver.request_vars, Some(&mut hydrated_info), None, &mut logs) {
             // Second pass error handling (optional, already handled for variables)
             script_errors.push(format!("Request Pre-request (Request Object) error: {}", e));
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
                let res_key = resolver.resolve_string(&field.key);
                let res_val = resolver.resolve_string(&field.value);
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

    // --- Post-Response Scripting ---
    if let Some(resp) = &firv_resp {
        // 1. Request Level
        if let Some(post) = &request.scripts.post {
            if let Err(e) = execute_script(post, &mut resolver.request_vars, Some(&mut hydrated_info), Some(resp), &mut logs) {
                script_errors.push(format!("Request Post-response error: {}", e));
            }
        }

        // 2. Folder Level (Reverse order)
        if let Some(folders) = &folder_scripts {
            for (i, folder) in folders.iter().enumerate().rev() {
                if let Some(post) = &folder.post {
                    if let Err(e) = execute_script(post, &mut resolver.request_vars, Some(&mut hydrated_info), Some(resp), &mut logs) {
                        script_errors.push(format!("Folder[{}] Post-response error: {}", i, e));
                    }
                }
            }
        }

        // 3. Workspace Level
        if let Some(ws_scripts) = &workspace_scripts {
            if let Some(post) = &ws_scripts.post {
                if let Err(e) = execute_script(post, &mut resolver.request_vars, Some(&mut hydrated_info), Some(resp), &mut logs) {
                    script_errors.push(format!("Workspace Post-response error: {}", e));
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
