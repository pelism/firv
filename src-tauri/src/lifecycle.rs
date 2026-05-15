use reqwest::Method;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Instant;
use std::path::Path;
use tokio::sync::oneshot;
use tauri::Manager;

use crate::models::{request::{BeforeRunStep, ChainCondition, HttpMethod, RequestBody, FirvRequest, RequestChainStep}};
use crate::runner::{FirvResponse, CLIENT};
use crate::variables::{VariableResolver, VariableTraceEntry};
use crate::RequestCancellationState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HydratedRequestInfo {
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>, 
    pub body: Option<String>,
}

#[async_recursion::async_recursion]
async fn run_request_step_by_id(
    project_root: &str,
    workspace_vars: &[crate::models::request::KeyValue],
    request_id: &str,
    current_resolver: &mut VariableResolver,
    depth: usize,
) -> Result<Option<LifecycleResultSummary>, String> {
    let next_path = Path::new(project_root).join("requests").join(format!("{}.yaml", request_id));
    let next_request = match std::fs::read_to_string(&next_path)
        .ok()
        .and_then(|content| serde_yaml::from_str::<FirvRequest>(&content).ok())
    {
        Some(req) => req,
        None => return Ok(None),
    };

    let next_result = execute_chain(project_root.to_string(), next_request, workspace_vars.to_vec(), depth).await?;

    // Merge downstream request vars into the current resolver so the main request can see them.
    for (k, v) in next_result.variables {
        current_resolver.request_vars.insert(k, v);
    }

    Ok(Some(LifecycleResultSummary {
        request_id: request_id.to_string(),
        success: next_result.response.as_ref().map(|r| r.status < 400).unwrap_or(false),
        status: next_result.response.as_ref().map(|r| r.status),
        execution_time_ms: next_result.execution_time_ms,
    }))
}

#[async_recursion::async_recursion]
async fn run_before_run_step(
    project_root: &str,
    workspace_vars: &[crate::models::request::KeyValue],
    step: &BeforeRunStep,
    current_resolver: &mut VariableResolver,
    depth: usize,
) -> Result<Option<LifecycleResultSummary>, String> {
    run_request_step_by_id(
        project_root,
        workspace_vars,
        &step.request_id,
        current_resolver,
        depth,
    )
    .await
}

#[async_recursion::async_recursion]
async fn run_chain_step(
    project_root: &str,
    workspace_vars: &[crate::models::request::KeyValue],
    step: &RequestChainStep,
    current_resolver: &mut VariableResolver,
    depth: usize,
) -> Result<Option<LifecycleResultSummary>, String> {
    run_request_step_by_id(
        project_root,
        workspace_vars,
        &step.next_request_id,
        current_resolver,
        depth,
    )
    .await
}

#[derive(Debug, Serialize)]
pub struct LifecycleResult {
    pub final_request: HydratedRequestInfo,
    pub response: Option<FirvResponse>,
    pub logs: Vec<String>,
    pub script_errors: Vec<String>,
    pub execution_time_ms: u64,
    pub variables: HashMap<String, String>,
    pub variable_trace: Vec<VariableTraceEntry>,
    pub before_run_results: Vec<LifecycleResultSummary>,
    pub chained_results: Vec<LifecycleResultSummary>,
}

#[derive(Debug, Serialize)]
pub struct LifecycleResultSummary {
    pub request_id: String,
    pub success: bool,
    pub status: Option<u16>,
    pub execution_time_ms: u64,
}

#[tauri::command]
pub async fn run_firv_request(
    app: tauri::AppHandle,
    project_root: String,
    request: FirvRequest,
    workspace_vars: Vec<crate::models::request::KeyValue>,
) -> Result<LifecycleResult, String> {
    let (cancel_tx, cancel_rx) = oneshot::channel();
    {
        let state = app.state::<RequestCancellationState>();
        let mut guard = state.0.lock().map_err(|e| format!("Failed to lock request cancellation state: {}", e))?;
        *guard = Some(cancel_tx);
    }

    let result = tokio::select! {
        result = execute_chain(project_root, request, workspace_vars, 0) => result,
        _ = cancel_rx => Err("Request canceled".to_string()),
    };

    let state = app.state::<RequestCancellationState>();
    if let Ok(mut guard) = state.0.lock() {
        *guard = None;
    }

    result
}

#[async_recursion::async_recursion]
async fn execute_chain(
    project_root: String,
    request: FirvRequest,
    workspace_vars: Vec<crate::models::request::KeyValue>,
    depth: usize,
) -> Result<LifecycleResult, String> {
    const MAX_CHAIN_DEPTH: usize = 8;
    if depth > MAX_CHAIN_DEPTH {
        return Err(format!("Request chain exceeded max depth of {}", MAX_CHAIN_DEPTH));
    }

    let start_time = Instant::now();
    let logs = Vec::new();
    let mut script_errors = Vec::new();
    let workspace_vars_for_chain = workspace_vars.clone();

    // Setup variable resolver
    let mut resolver = VariableResolver::new();
    resolver.globals = workspace_vars
        .into_iter()
        .filter(|kv| kv.enabled)
        .map(|kv| (kv.key, kv.value))
        .collect();

    let mut before_run_results = Vec::new();

    // --- Before-run chain ---
    for step in &request.transforms.before_run {
        if let Some(summary) = run_before_run_step(&project_root, &workspace_vars_for_chain, step, &mut resolver, depth + 1).await? {
            before_run_results.push(summary);
        }
    }

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
    if let Some(template) = request.transforms.pre_request_template.as_deref() {
        if let Ok(rendered_body) = resolver.render_liquid(template) {
            if !rendered_body.is_empty() {
                hydrated_info.body = Some(rendered_body);
            }
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
        let mut form_pairs = Vec::new();
        for field in fields {
            if field.enabled {
                let res_key = resolver.render_liquid(&field.key).unwrap_or_else(|_| resolver.resolve_string(&field.key));
                let res_val = resolver.render_liquid(&field.value).unwrap_or_else(|_| resolver.resolve_string(&field.value));
                form_pairs.push((res_key, res_val));
            }
        }

        req_builder = req_builder
            .header("Content-Type", "application/x-www-form-urlencoded")
            .form(&form_pairs);
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
        for rule in &request.transforms.response_extractions {
            match resolver.apply_extraction_rule(rule, &resp.body) {
                Ok(Some(value)) => {
                    resolver.request_vars.insert(rule.target.clone(), value);
                }
                Ok(None) => {
                    script_errors.push(format!("Extraction '{}' returned no value", rule.target));
                }
                Err(err) => {
                    script_errors.push(err);
                }
            }
        }
    }

    let total_time = start_time.elapsed().as_millis() as u64;

    let mut chained_results = Vec::new();

    if let Some(resp) = &firv_resp {
        for step in &request.transforms.chain_steps {
            let should_run = match step.when {
                ChainCondition::OnSuccess => resp.status < 400,
                ChainCondition::OnFailure => resp.status >= 400,
            };

            if should_run {
                if let Some(summary) = run_chain_step(&project_root, &workspace_vars_for_chain, step, &mut resolver, depth + 1).await? {
                    chained_results.push(summary);
                }
            }
        }
    }

    Ok(LifecycleResult {
        final_request: hydrated_info,
        response: firv_resp,
        logs,
        script_errors,
        execution_time_ms: total_time,
        variables: resolver.request_vars.clone(),
        variable_trace: resolver.trace(),
        before_run_results,
        chained_results,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::request::{HttpMethod, RequestBody, RequestTransforms};

    #[test]
    fn trace_only_includes_used_variables() {
        let mut resolver = VariableResolver::new();
        resolver.globals.insert("used".to_string(), "1".to_string());
        resolver.globals.insert("unused".to_string(), "2".to_string());

        let rendered = resolver.resolve_string("/items/{{used}}");
        assert_eq!(rendered, "/items/1");

        let trace = resolver.trace();
        assert_eq!(trace.len(), 1);
        assert_eq!(trace[0].key, "used");
    }

    #[test]
    fn lifecycle_request_shape_still_compiles_for_trace_use() {
        let _request = FirvRequest {
            id: "id".to_string(),
            name: "name".to_string(),
            method: HttpMethod::GET,
            url: "https://example.com/{{used}}".to_string(),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms::default(),
        };
    }
}
