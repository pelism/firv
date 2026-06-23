use serde::Serialize;
use std::collections::HashMap;
use std::time::Instant;
use std::path::Path;
use tokio::sync::oneshot;
use tauri::Manager;

use crate::models::{request::{BeforeRunStep, ChainCondition, FirvRequest, RequestChainStep}};
use crate::models::request::HttpMethod;
use crate::runner::{FirvResponse, PreparedBody, prepare_request, run_request};
use crate::variables::{VariableResolver, VariableTraceEntry};
use crate::RequestCancellationState;

#[derive(Debug, Serialize, Clone)]
pub struct HydratedRequestInfo {
    pub url: String,
    pub method: HttpMethod,
    pub headers: HashMap<String, String>, 
    pub body: Option<String>,
}

#[async_recursion::async_recursion]
async fn run_request_step_by_id(
    project_root: &str,
    workspace_vars: &[crate::models::request::KeyValue],
    environment_vars: &[crate::models::request::KeyValue],
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

    let next_result = execute_chain(
        project_root.to_string(),
        next_request,
        workspace_vars.to_vec(),
        environment_vars.to_vec(),
        depth,
    )
    .await?;

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
    environment_vars: &[crate::models::request::KeyValue],
    step: &BeforeRunStep,
    current_resolver: &mut VariableResolver,
    depth: usize,
) -> Result<Option<LifecycleResultSummary>, String> {
    run_request_step_by_id(
        project_root,
        workspace_vars,
        environment_vars,
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
    environment_vars: &[crate::models::request::KeyValue],
    step: &RequestChainStep,
    current_resolver: &mut VariableResolver,
    depth: usize,
) -> Result<Option<LifecycleResultSummary>, String> {
    run_request_step_by_id(
        project_root,
        workspace_vars,
        environment_vars,
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
    environment_vars: Vec<crate::models::request::KeyValue>,
) -> Result<LifecycleResult, String> {
    let (cancel_tx, cancel_rx) = oneshot::channel();
    {
        let state = app.state::<RequestCancellationState>();
        let mut guard = state.0.lock().map_err(|e| format!("Failed to lock request cancellation state: {}", e))?;
        *guard = Some(cancel_tx);
    }

    let result = tokio::select! {
        result = execute_chain(project_root, request, workspace_vars, environment_vars, 0) => result,
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
    environment_vars: Vec<crate::models::request::KeyValue>,
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
    let environment_vars_for_chain = environment_vars.clone();

    // Setup variable resolver
    let mut resolver = VariableResolver::from_scopes(&workspace_vars, &environment_vars);

    let mut before_run_results = Vec::new();

    // --- Before-run chain ---
    for step in &request.transforms.before_run {
        if let Some(summary) = run_before_run_step(
            &project_root,
            &workspace_vars_for_chain,
            &environment_vars_for_chain,
            step,
            &mut resolver,
            depth + 1,
        )
        .await?
        {
            before_run_results.push(summary);
        }
    }

    // --- Declarative rendering ---
    let mut prepared_request = prepare_request(&request, &mut resolver);
    let mut hydrated_info = HydratedRequestInfo {
        url: prepared_request.url.clone(),
        method: prepared_request.method.clone(),
        headers: prepared_request.headers.clone(),
        body: match &prepared_request.body {
            crate::runner::PreparedBody::None => None,
            crate::runner::PreparedBody::Text(body) => Some(body.clone()),
            crate::runner::PreparedBody::Form(_) => None,
        },
    };

    // --- Request-level modifications via declarative transforms ---
    if let Some(template) = request.transforms.pre_request_template.as_deref() {
        if let Ok(rendered_body) = resolver.render_liquid(template) {
            if !rendered_body.is_empty() {
                hydrated_info.body = Some(rendered_body.clone());
                prepared_request.body = PreparedBody::Text(rendered_body);
            }
        }
    }

    // Stage 3: Network Execution
    let firv_resp = match run_request(prepared_request).await
    {
        Ok(response) => Some(response),
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
                if let Some(summary) = run_chain_step(
                    &project_root,
                    &workspace_vars_for_chain,
                    &environment_vars_for_chain,
                    step,
                    &mut resolver,
                    depth + 1,
                )
                .await?
                {
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
    use crate::models::request::{HttpMethod, KeyValue, RequestBody, RequestTransforms};
    use httpmock::prelude::*;

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

    #[tokio::test]
    async fn execute_chain_rejects_depth_beyond_limit() {
        let request = FirvRequest {
            id: "id".to_string(),
            name: "name".to_string(),
            method: HttpMethod::GET,
            url: "https://example.com".to_string(),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms::default(),
        };

        let result = execute_chain("C:/Repos/firv".to_string(), request, vec![], vec![], 9).await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("exceeded max depth"));
    }

    #[tokio::test]
    async fn pre_request_template_body_is_sent_over_network() {
        let server = MockServer::start();
        let expected_body = "{\"greeting\":\"Hello Firv\"}";

        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/greet")
                .body(expected_body);
            then.status(200)
                .header("Content-Type", "text/plain")
                .body("ok");
        });

        let request = FirvRequest {
            id: "id".to_string(),
            name: "template".to_string(),
            method: HttpMethod::POST,
            url: format!("{}/greet", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms {
                pre_request_template: Some("{\"greeting\":\"Hello {{name}}\"}".to_string()),
                ..Default::default()
            },
        };

        let workspace_vars = vec![KeyValue {
            key: "name".to_string(),
            value: "Firv".to_string(),
            enabled: true,
        }];

        let result = execute_chain(".".to_string(), request, workspace_vars, vec![], 0)
            .await
            .expect("chain should succeed");

        mock.assert();
        assert_eq!(result.final_request.body.as_deref(), Some(expected_body));
    }

    #[tokio::test]
    async fn active_environment_variables_override_globals_in_request_preparation() {
        let server = MockServer::start();

        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/env/dev");
            then.status(200)
                .header("Content-Type", "text/plain")
                .body("ok");
        });

        let request = FirvRequest {
            id: "id".to_string(),
            name: "environment override".to_string(),
            method: HttpMethod::POST,
            url: format!("{}/{{{{base_path}}}}/{{{{environment}}}}", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms::default(),
        };

        let workspace_vars = vec![KeyValue {
            key: "base_path".to_string(),
            value: "global".to_string(),
            enabled: true,
        }];

        let environment_vars = vec![KeyValue {
            key: "base_path".to_string(),
            value: "env".to_string(),
            enabled: true,
        }, KeyValue {
            key: "environment".to_string(),
            value: "dev".to_string(),
            enabled: true,
        }];

        let result = execute_chain(".".to_string(), request, workspace_vars, environment_vars, 0)
            .await
            .expect("chain should succeed");

        mock.assert();
        assert_eq!(result.final_request.url, format!("{}/env/dev", server.base_url()));
        assert_eq!(result.variable_trace.iter().find(|entry| entry.key == "base_path").unwrap().scope, "environment");
    }
}
