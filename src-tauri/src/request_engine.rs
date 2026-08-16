use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::time::Instant;

use crate::http_client::{FirvResponse, PreparedBody, prepare_request, run_request};
use crate::models::flow::FirvFlow;
use crate::models::request::{BeforeRunStep, ChainCondition, FirvRequest, HttpMethod, KeyValue, RequestChainStep, RequestExtractionRule};
use crate::variables::{VariableResolver, VariableTraceEntry};
use urlencoding::encode;

#[derive(Debug, Serialize, Clone)]
pub struct HydratedRequestInfo {
    pub url: String,
    pub method: HttpMethod,
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

fn serialize_form_pairs(pairs: &[(String, String)]) -> String {
    pairs
        .iter()
        .map(|(key, value)| format!("{}={}", encode(key), encode(value)))
        .collect::<Vec<_>>()
        .join("&")
}

fn redacted_preview(resolver: &VariableResolver, value: &str) -> String {
    let redacted = resolver.redact_secrets(value);
    if redacted.len() > 80 {
        format!("{}...", &redacted[..80])
    } else {
        redacted
    }
}

#[async_recursion::async_recursion]
async fn run_request_step_by_id(
    workspace_root: &str,
    workspace_vars: &[KeyValue],
    environment_vars: &[KeyValue],
    secrets: &HashMap<String, String>,
    request_id: &str,
    current_resolver: &mut VariableResolver,
    depth: usize,
) -> Result<Option<LifecycleResultSummary>, String> {
    let next_path = Path::new(workspace_root).join("requests").join(format!("{}.yaml", request_id));
    let next_request = match std::fs::read_to_string(&next_path)
        .ok()
        .and_then(|content| serde_yaml::from_str::<FirvRequest>(&content).ok())
    {
        Some(req) => req,
        None => return Ok(None),
    };

    let next_result = execute_chain(
        workspace_root.to_string(),
        next_request,
        workspace_vars.to_vec(),
        environment_vars.to_vec(),
        secrets.clone(),
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
    workspace_root: &str,
    workspace_vars: &[KeyValue],
    environment_vars: &[KeyValue],
    secrets: &HashMap<String, String>,
    step: &BeforeRunStep,
    current_resolver: &mut VariableResolver,
    depth: usize,
) -> Result<Option<LifecycleResultSummary>, String> {
    run_request_step_by_id(
        workspace_root,
        workspace_vars,
        environment_vars,
        secrets,
        &step.request_id,
        current_resolver,
        depth,
    )
    .await
}

#[async_recursion::async_recursion]
async fn run_chain_step(
    workspace_root: &str,
    workspace_vars: &[KeyValue],
    environment_vars: &[KeyValue],
    secrets: &HashMap<String, String>,
    step: &RequestChainStep,
    current_resolver: &mut VariableResolver,
    depth: usize,
) -> Result<Option<LifecycleResultSummary>, String> {
    run_request_step_by_id(
        workspace_root,
        workspace_vars,
        environment_vars,
        secrets,
        &step.next_request_id,
        current_resolver,
        depth,
    )
    .await
}

#[async_recursion::async_recursion]
pub async fn execute_chain(
    workspace_root: String,
    request: FirvRequest,
    workspace_vars: Vec<KeyValue>,
    environment_vars: Vec<KeyValue>,
    secrets: HashMap<String, String>,
    depth: usize,
) -> Result<LifecycleResult, String> {
    execute_chain_with_overrides(
        workspace_root,
        request,
        workspace_vars,
        environment_vars,
        secrets,
        HashMap::new(),
        depth,
    )
    .await
}

/// Same as `execute_chain`, but accepts per-execution `overrides` (e.g. request variable
/// values supplied from the UI or an MCP tool call) that take precedence over both the
/// request's persisted `request_variables` defaults and any workspace/environment variable.
pub async fn execute_chain_with_overrides(
    workspace_root: String,
    request: FirvRequest,
    workspace_vars: Vec<KeyValue>,
    environment_vars: Vec<KeyValue>,
    secrets: HashMap<String, String>,
    overrides: HashMap<String, String>,
    depth: usize,
) -> Result<LifecycleResult, String> {
    execute_chain_with_skip(
        workspace_root,
        request,
        workspace_vars,
        environment_vars,
        secrets,
        overrides,
        false,
        false,
        false,
        depth,
    )
    .await
}

/// Same as `execute_chain_with_overrides`, but additionally allows suppressing this
/// request's own persisted `before_run` chain and/or `chain_steps` (by `ChainCondition`)
/// for this execution only, without mutating the request. Used by the flow executor so
/// a flow step can opt out of a member request's nested chains selectively.
#[async_recursion::async_recursion]
pub async fn execute_chain_with_skip(
    workspace_root: String,
    request: FirvRequest,
    workspace_vars: Vec<KeyValue>,
    environment_vars: Vec<KeyValue>,
    secrets: HashMap<String, String>,
    overrides: HashMap<String, String>,
    skip_before_chain: bool,
    skip_on_success_chain: bool,
    skip_on_failure_chain: bool,
    depth: usize,
) -> Result<LifecycleResult, String> {
    const MAX_CHAIN_DEPTH: usize = 8;
    if depth > MAX_CHAIN_DEPTH {
        return Err(format!("Request chain exceeded max depth of {}", MAX_CHAIN_DEPTH));
    }

    let start_time = Instant::now();
    let mut logs = Vec::new();
    let mut script_errors = Vec::new();
    let workspace_vars_for_chain = workspace_vars.clone();

    logs.push(format!("Executing request '{}'", request.id));
    let environment_vars_for_chain = environment_vars.clone();

    // Setup variable resolver
    let mut resolver = VariableResolver::from_scopes(&workspace_vars, &environment_vars, &secrets);

    // Seed the request-scoped variables: persisted defaults first, then any
    // per-execution overrides on top (both land in `request_vars`, the highest
    // precedence scope in `VariableResolver::merge`).
    for rv in &request.transforms.request_variables {
        resolver.seed_request_variable(&rv.key, &rv.value, rv.secret_ref.as_deref());
    }
    for (key, value) in &overrides {
        resolver.request_vars.insert(key.trim().to_string(), value.clone());
    }

    let seeded_count = request.transforms.request_variables.len() + overrides.len();
    if seeded_count > 0 {
        logs.push(format!("Seeded {} request-scoped variable(s)", seeded_count));
    }

    let mut before_run_results = Vec::new();

    // --- Before-run chain ---
    if skip_before_chain {
        logs.push("Skipping before-run chain".to_string());
    } else if request.transforms.before_run.is_empty() {
        logs.push("No before-run steps".to_string());
    } else {
        logs.push(format!("Running {} before-run step(s)", request.transforms.before_run.len()));
    }

    if !skip_before_chain {
        for step in &request.transforms.before_run {
            if let Some(summary) = run_before_run_step(
                &workspace_root,
                &workspace_vars_for_chain,
                &environment_vars_for_chain,
                &secrets,
                step,
                &mut resolver,
                depth + 1,
            )
            .await?
            {
                before_run_results.push(summary);
            }
        }
    }

    // --- Declarative rendering ---
    let mut prepared_request = prepare_request(&request, &mut resolver);
    let mut hydrated_info = HydratedRequestInfo {
        url: prepared_request.url.clone(),
        method: prepared_request.method.clone(),
        headers: prepared_request.headers.clone(),
        body: match &prepared_request.body {
            PreparedBody::None => None,
            PreparedBody::Text(body) => Some(body.clone()),
            PreparedBody::Form(pairs) => Some(serialize_form_pairs(pairs)),
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

    logs.push(format!("Rendered {:?} {}", hydrated_info.method, resolver.redact_secrets(&hydrated_info.url)));
    if let Some(body) = &hydrated_info.body {
        logs.push(format!("Request body: {}", body));
    } else {
        logs.push("No request body".to_string());
    }

    // Stage 3: Network Execution
    let firv_resp = match run_request(prepared_request).await {
        Ok(response) => {
            logs.push(format!(
                "Network returned status {} in {} ms ({} bytes)",
                response.status, response.time_ms, response.size_bytes
            ));
            logs.push(format!("Response body: {}", response.body));
            Some(response)
        }
        Err(e) => {
            logs.push(format!("Network request failed: {}", e));
            script_errors.push(format!("Network request failed: {}", e));
            None
        }
    };

    // --- Post-response extraction ---
    if let Some(resp) = &firv_resp {
        for rule in &request.transforms.response_extractions {
            match resolver.apply_extraction_rule(rule, &resp.body) {
                Ok(Some(value)) => {
                    logs.push(format!(
                        "Extracted '{}' = '{}'",
                        rule.target,
                        redacted_preview(&resolver, &value)
                    ));
                    resolver.request_vars.insert(rule.target.clone(), value);
                }
                Ok(None) => {
                    logs.push(format!("Extraction '{}' returned no value", rule.target));
                    script_errors.push(format!("Extraction '{}' returned no value", rule.target));
                }
                Err(err) => {
                    logs.push(format!("Extraction '{}' failed", rule.target));
                    script_errors.push(err);
                }
            }
        }
    }

    let total_time = start_time.elapsed().as_millis() as u64;

    let mut chained_results = Vec::new();

    if request.transforms.chain_steps.is_empty() {
        logs.push("No chained steps configured".to_string());
    } else if firv_resp.is_none() {
        logs.push("Skipping chained steps because the request failed".to_string());
    } else {
        logs.push(format!("Evaluating {} chained step(s)", request.transforms.chain_steps.len()));
    }

    if let Some(resp) = &firv_resp {
        for step in &request.transforms.chain_steps {
            let is_skipped = match step.when {
                ChainCondition::OnSuccess => skip_on_success_chain,
                ChainCondition::OnFailure => skip_on_failure_chain,
            };
            let should_run = !is_skipped
                && match step.when {
                    ChainCondition::OnSuccess => resp.status < 400,
                    ChainCondition::OnFailure => resp.status >= 400,
                };

            if should_run {
                if let Some(summary) = run_chain_step(
                    &workspace_root,
                    &workspace_vars_for_chain,
                    &environment_vars_for_chain,
                    &secrets,
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

    // Redact any resolved secret values out of the debug/preview payload before it
    // reaches the frontend. The outgoing network request above already used the
    // real values; this only sanitizes what gets displayed.
    hydrated_info.url = resolver.redact_secrets(&hydrated_info.url);
    hydrated_info.headers = hydrated_info
        .headers
        .into_iter()
        .map(|(k, v)| (k, resolver.redact_secrets(&v)))
        .collect();
    if let Some(body) = hydrated_info.body.as_deref() {
        hydrated_info.body = Some(resolver.redact_secrets(body));
    }

    logs.push(format!("Finished request '{}' in {} ms", request.id, total_time));

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

pub async fn run_request_by_id_with_overrides(
    workspace_root: &str,
    request_id: &str,
    workspace_vars: Vec<KeyValue>,
    environment_vars: Vec<KeyValue>,
    secrets: HashMap<String, String>,
    overrides: HashMap<String, String>,
) -> Result<LifecycleResult, String> {
    let request_path = Path::new(workspace_root).join("requests").join(format!("{}.yaml", request_id));
    let content = std::fs::read_to_string(&request_path)
        .map_err(|e| format!("Failed to read request {}: {}", request_id, e))?;
    let request: FirvRequest = serde_yaml::from_str(&content)
        .map_err(|e| format!("Failed to parse request {}: {}", request_id, e))?;
    execute_chain_with_overrides(workspace_root.to_string(), request, workspace_vars, environment_vars, secrets, overrides, 0).await
}

#[derive(Debug, Serialize, Clone)]
pub struct FlowStepResult {
    pub request_id: String,
    pub success: bool,
    pub status: Option<u16>,
    pub execution_time_ms: u64,
    pub error: Option<String>,
    pub logs: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct FlowResult {
    pub steps: Vec<FlowStepResult>,
    /// True if the flow halted before running every step, either because a step's
    /// response was a failure (network error or status >= 400) or because a step's
    /// request_id could not be resolved to a persisted request.
    pub stopped_early: bool,
}

/// Runs a persisted `FirvFlow`'s steps in order, stopping immediately if any step
/// fails. Each step still fully honors its own request's persisted `before_run` and
/// `chain_steps`, unless suppressed by that step's `skip_before_chain`/
/// `skip_on_success_chain`/`skip_on_failure_chain` flags. Variables extracted by a
/// step (via its `response_extractions`) are carried forward and available to
/// subsequent steps. Each step's own `input_variables` take precedence over
/// carried variables.
pub async fn execute_flow(
    workspace_root: String,
    flow: FirvFlow,
    workspace_vars: Vec<KeyValue>,
    environment_vars: Vec<KeyValue>,
    secrets: HashMap<String, String>,
) -> Result<FlowResult, String> {
    let mut step_results = Vec::new();
    let mut carried_vars: HashMap<String, String> = HashMap::new();
    let mut stopped_early = false;

    for (step_index, step) in flow.steps.iter().enumerate() {
        let mut step_logs = Vec::new();
        step_logs.push(format!("Step {}: executing '{}'", step_index + 1, step.request_id));
        if !carried_vars.is_empty() {
            step_logs.push(format!("Carried {} variable(s) into step", carried_vars.len()));
        }

        let request_path = Path::new(&workspace_root)
            .join("requests")
            .join(format!("{}.yaml", step.request_id));

        let request: FirvRequest = match std::fs::read_to_string(&request_path)
            .ok()
            .and_then(|content| serde_yaml::from_str(&content).ok())
        {
            Some(req) => req,
            None => {
                step_logs.push(format!("Request '{}' could not be found or parsed", step.request_id));
                step_results.push(FlowStepResult {
                    request_id: step.request_id.clone(),
                    success: false,
                    status: None,
                    execution_time_ms: 0,
                    error: Some(format!("Request '{}' could not be found or parsed", step.request_id)),
                    logs: step_logs,
                });
                stopped_early = true;
                break;
            }
        };

        // Apply flow-scoped query parameter overrides to a mutable copy of the
        // request. Matching keys replace the persisted param entirely; new keys
        // are appended. This keeps the persisted request unchanged.
        let mut request = request;
        let mut applied_overrides = 0;
        for override_kv in &step.query_param_overrides {
            let key = override_kv.key.trim();
            if key.is_empty() {
                continue;
            }
            if let Some(existing) = request.params.iter_mut().find(|p| p.key.trim() == key) {
                *existing = override_kv.clone();
            } else {
                request.params.push(override_kv.clone());
            }
            applied_overrides += 1;
        }
        if applied_overrides > 0 {
            step_logs.push(format!("Applied {} query param override(s)", applied_overrides));
        }

        // Resolve this step's input variables against the flow context.
        let mut resolver = VariableResolver::from_scopes(&workspace_vars, &environment_vars, &secrets);
        for (k, v) in &carried_vars {
            resolver.request_vars.insert(k.clone(), v.clone());
        }

        let mut step_overrides = carried_vars.clone();
        let mut input_keys = Vec::new();
        for iv in &step.input_variables {
            if !iv.enabled {
                continue;
            }
            let key = iv.key.trim();
            if key.is_empty() {
                continue;
            }
            let resolved = resolver.resolve_string(&iv.value);
            step_overrides.insert(key.to_string(), resolved);
            input_keys.push(key.to_string());
        }
        if !input_keys.is_empty() {
            step_logs.push(format!("Resolved input variable(s): {}", input_keys.join(", ")));
        }

        let result = execute_chain_with_skip(
            workspace_root.clone(),
            request,
            workspace_vars.clone(),
            environment_vars.clone(),
            secrets.clone(),
            step_overrides,
            step.skip_before_chain,
            step.skip_on_success_chain,
            step.skip_on_failure_chain,
            0,
        )
        .await;

        match result {
            Ok(lifecycle) => {
                let status = lifecycle.response.as_ref().map(|r| r.status);
                let success = status.map(|s| s < 400).unwrap_or(false);

                step_logs.extend(lifecycle.logs);

                for (key, value) in lifecycle.variables {
                    carried_vars.insert(key, value);
                }

                // Apply flow-level export variables from the response.
                if let Some(resp) = &lifecycle.response {
                    let mut export_resolver = VariableResolver::from_scopes(&workspace_vars, &environment_vars, &secrets);
                    for (k, v) in &carried_vars {
                        export_resolver.request_vars.insert(k.clone(), v.clone());
                    }
                    for ev in &step.export_variables {
                        if !ev.enabled || ev.target.trim().is_empty() {
                            continue;
                        }
                        let rule = RequestExtractionRule {
                            target: ev.target.clone(),
                            source: ev.source.clone(),
                            pattern: ev.pattern.clone(),
                        };
                        match export_resolver.apply_extraction_rule(&rule, &resp.body) {
                            Ok(Some(value)) => {
                                carried_vars.insert(ev.target.clone(), value.clone());
                                step_logs.push(format!("Exported '{}' to flow context", ev.target));
                            }
                            Ok(None) => {
                                step_logs.push(format!("Export '{}' returned no value", ev.target));
                            }
                            Err(_) => {
                                step_logs.push(format!("Export '{}' failed", ev.target));
                            }
                        }
                    }
                }

                if success {
                    step_logs.push(format!("Step succeeded with status {}", status.unwrap_or(0)));
                } else if let Some(err) = lifecycle.script_errors.first() {
                    step_logs.push(format!("Step failed: {}", err));
                } else if let Some(status) = status {
                    step_logs.push(format!("Step failed with status {}", status));
                }

                step_logs.push(format!("Carried {} variable(s) forward", carried_vars.len()));

                step_results.push(FlowStepResult {
                    request_id: step.request_id.clone(),
                    success,
                    status,
                    execution_time_ms: lifecycle.execution_time_ms,
                    error: if success { None } else { lifecycle.script_errors.first().cloned() },
                    logs: step_logs,
                });

                if !success {
                    stopped_early = true;
                    break;
                }
            }
            Err(err) => {
                step_logs.push(format!("Step failed: {}", err));
                step_results.push(FlowStepResult {
                    request_id: step.request_id.clone(),
                    success: false,
                    status: None,
                    execution_time_ms: 0,
                    error: Some(err),
                    logs: step_logs,
                });
                stopped_early = true;
                break;
            }
        }
    }

    Ok(FlowResult { steps: step_results, stopped_early })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::flow::{FlowExtractionRule, FlowInputVariable, FlowStep};
    use crate::models::request::{
        BeforeRunStep, ChainCondition, ExtractionSource, HttpMethod, KeyValue, RequestBody,
        RequestChainStep, RequestExtractionRule, RequestTransforms, RequestVariable,
    };
    use httpmock::prelude::*;

    fn write_request(workspace_root: &std::path::Path, request: &FirvRequest) {
        let requests_dir = workspace_root.join("requests");
        std::fs::create_dir_all(&requests_dir).expect("create requests dir");
        let content = serde_yaml::to_string(request).expect("serialize request");
        std::fs::write(requests_dir.join(format!("{}.yaml", request.id)), content).expect("write request");
    }

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

        let result = execute_chain("C:/Repos/firv".to_string(), request, vec![], vec![], HashMap::new(), 9).await;

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
            secret_ref: None,
        }];

        let result = execute_chain(".".to_string(), request, workspace_vars, vec![], HashMap::new(), 0)
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
            secret_ref: None,
        }];

        let environment_vars = vec![KeyValue {
            key: "base_path".to_string(),
            value: "env".to_string(),
            enabled: true,
            secret_ref: None,
        }, KeyValue {
            key: "environment".to_string(),
            value: "dev".to_string(),
            enabled: true,
            secret_ref: None,
        }];

        let result = execute_chain(".".to_string(), request, workspace_vars, environment_vars, HashMap::new(), 0)
            .await
            .expect("chain should succeed");

        mock.assert();
        assert_eq!(result.final_request.url, format!("{}/env/dev", server.base_url()));
        assert_eq!(result.variable_trace.iter().find(|entry| entry.key == "base_path").unwrap().scope, "environment");
    }

    #[tokio::test]
    async fn request_variable_default_is_used_when_no_override_is_supplied() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/books/123");
            then.status(200).body("ok");
        });

        let request = FirvRequest {
            id: "id".to_string(),
            name: "request variable default".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/books/{{{{bookid}}}}", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms {
                request_variables: vec![RequestVariable {
                    key: "bookid".to_string(),
                    value: "123".to_string(),
                    secret_ref: None,
                }],
                ..Default::default()
            },
        };

        let result = execute_chain_with_overrides(".".to_string(), request, vec![], vec![], HashMap::new(), HashMap::new(), 0)
            .await
            .expect("chain should succeed");

        mock.assert();
        assert_eq!(result.final_request.url, format!("{}/books/123", server.base_url()));
    }

    #[tokio::test]
    async fn per_execution_override_takes_precedence_over_request_variable_default() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/books/999");
            then.status(200).body("ok");
        });

        let request = FirvRequest {
            id: "id".to_string(),
            name: "request variable override".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/books/{{{{bookid}}}}", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms {
                request_variables: vec![RequestVariable {
                    key: "bookid".to_string(),
                    value: "123".to_string(),
                    secret_ref: None,
                }],
                ..Default::default()
            },
        };

        let overrides = HashMap::from([("bookid".to_string(), "999".to_string())]);

        let result = execute_chain_with_overrides(".".to_string(), request, vec![], vec![], HashMap::new(), overrides, 0)
            .await
            .expect("chain should succeed");

        mock.assert();
        assert_eq!(result.final_request.url, format!("{}/books/999", server.base_url()));
    }

    #[tokio::test]
    async fn request_variable_secret_ref_is_resolved_from_secret_store() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/books/hunter2");
            then.status(200).body("ok");
        });

        let request = FirvRequest {
            id: "id".to_string(),
            name: "request variable secret".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/books/{{{{bookid}}}}", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms {
                request_variables: vec![RequestVariable {
                    key: "bookid".to_string(),
                    value: String::new(),
                    secret_ref: Some("secret-1".to_string()),
                }],
                ..Default::default()
            },
        };

        let secrets = HashMap::from([("secret-1".to_string(), "hunter2".to_string())]);

        let result = execute_chain_with_overrides(".".to_string(), request, vec![], vec![], secrets, HashMap::new(), 0)
            .await
            .expect("chain should succeed");

        mock.assert();
        assert_eq!(result.final_request.url, format!("{}/books/{}", server.base_url(), crate::variables::REDACTED_SECRET_PLACEHOLDER));
    }

    #[tokio::test]
    async fn execute_flow_stops_on_failed_step_and_skips_remaining() {
        let dir = tempfile::tempdir().expect("tempdir");
        let workspace_root = dir.path().to_string_lossy().to_string();
        let server = MockServer::start();

        let failing_mock = server.mock(|when, then| {
            when.method(GET).path("/fail");
            then.status(500).body("boom");
        });
        let never_called_mock = server.mock(|when, then| {
            when.method(GET).path("/never-called");
            then.status(200).body("ok");
        });

        write_request(dir.path(), &FirvRequest {
            id: "step-a".to_string(),
            name: "step a".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/fail", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms::default(),
        });
        write_request(dir.path(), &FirvRequest {
            id: "step-b".to_string(),
            name: "step b".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/never-called", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms::default(),
        });

        let flow = FirvFlow {
            id: "flow-1".to_string(),
            name: "Flow".to_string(),
            steps: vec![
                FlowStep { request_id: "step-a".to_string(), ..Default::default() },
                FlowStep { request_id: "step-b".to_string(), ..Default::default() },
            ],
        };

        let result = execute_flow(workspace_root, flow, vec![], vec![], HashMap::new())
            .await
            .expect("flow should return a result even when a step fails");

        failing_mock.assert();
        never_called_mock.assert_hits(0);
        assert!(result.stopped_early);
        assert_eq!(result.steps.len(), 1);
        assert!(!result.steps[0].success);
        assert_eq!(result.steps[0].status, Some(500));
    }

    #[tokio::test]
    async fn execute_flow_carries_extracted_variables_between_steps() {
        let dir = tempfile::tempdir().expect("tempdir");
        let workspace_root = dir.path().to_string_lossy().to_string();
        let server = MockServer::start();

        let first_mock = server.mock(|when, then| {
            when.method(GET).path("/login");
            then.status(200).body("{\"token\":\"secret-token\"}");
        });
        let second_mock = server.mock(|when, then| {
            when.method(GET).path("/books/secret-token");
            then.status(200).body("ok");
        });

        write_request(dir.path(), &FirvRequest {
            id: "login".to_string(),
            name: "login".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/login", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms {
                response_extractions: vec![RequestExtractionRule {
                    target: "token".to_string(),
                    source: ExtractionSource::ResponseBodyJson,
                    pattern: "token".to_string(),
                }],
                ..Default::default()
            },
        });
        write_request(dir.path(), &FirvRequest {
            id: "fetch-book".to_string(),
            name: "fetch book".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/books/{{{{token}}}}", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms::default(),
        });

        let flow = FirvFlow {
            id: "flow-2".to_string(),
            name: "Flow".to_string(),
            steps: vec![
                FlowStep { request_id: "login".to_string(), ..Default::default() },
                FlowStep { request_id: "fetch-book".to_string(), ..Default::default() },
            ],
        };

        let result = execute_flow(workspace_root, flow, vec![], vec![], HashMap::new())
            .await
            .expect("flow should succeed");

        first_mock.assert();
        second_mock.assert();
        assert!(!result.stopped_early);
        assert_eq!(result.steps.len(), 2);
        assert!(result.steps.iter().all(|s| s.success));
    }

    #[tokio::test]
    async fn execute_flow_resolves_input_variables_against_step_context() {
        let dir = tempfile::tempdir().expect("tempdir");
        let workspace_root = dir.path().to_string_lossy().to_string();
        let server = MockServer::start();

        let mock = server.mock(|when, then| {
            when.method(GET).path("/hello/world");
            then.status(200).body("ok");
        });

        write_request(dir.path(), &FirvRequest {
            id: "greet".to_string(),
            name: "greet".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/hello/{{{{name}}}}", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms::default(),
        });

        let flow = FirvFlow {
            id: "flow-input".to_string(),
            name: "Flow".to_string(),
            steps: vec![FlowStep {
                request_id: "greet".to_string(),
                input_variables: vec![FlowInputVariable {
                    key: "name".to_string(),
                    value: "world".to_string(),
                    enabled: true,
                }],
                ..Default::default()
            }],
        };

        let result = execute_flow(workspace_root, flow, vec![], vec![], HashMap::new())
            .await
            .expect("flow should succeed");

        mock.assert();
        assert!(!result.stopped_early);
        assert!(result.steps[0].success);
    }

    #[tokio::test]
    async fn execute_flow_applies_query_param_overrides_to_enable_and_change_param() {
        let dir = tempfile::tempdir().expect("tempdir");
        let workspace_root = dir.path().to_string_lossy().to_string();
        let server = MockServer::start();

        let mock = server.mock(|when, then| {
            when.method(GET).path("/items").query_param("type", "book");
            then.status(200).body("ok");
        });

        write_request(dir.path(), &FirvRequest {
            id: "list".to_string(),
            name: "list".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/items", server.base_url()),
            headers: vec![],
            params: vec![KeyValue {
                key: "type".to_string(),
                value: "all".to_string(),
                enabled: false,
                secret_ref: None,
            }],
            body: RequestBody::None,
            transforms: RequestTransforms::default(),
        });

        let flow = FirvFlow {
            id: "flow-params".to_string(),
            name: "Flow".to_string(),
            steps: vec![FlowStep {
                request_id: "list".to_string(),
                query_param_overrides: vec![KeyValue {
                    key: "type".to_string(),
                    value: "book".to_string(),
                    enabled: true,
                    secret_ref: None,
                }],
                ..Default::default()
            }],
        };

        let result = execute_flow(workspace_root, flow, vec![], vec![], HashMap::new())
            .await
            .expect("flow should succeed");

        mock.assert();
        assert!(!result.stopped_early);
        assert!(result.steps[0].success);
    }

    #[tokio::test]
    async fn execute_flow_can_disable_query_param_via_override() {
        let dir = tempfile::tempdir().expect("tempdir");
        let workspace_root = dir.path().to_string_lossy().to_string();
        let server = MockServer::start();

        let mock = server.mock(|when, then| {
            when.method(GET).path("/items");
            then.status(200).body("ok");
        });

        write_request(dir.path(), &FirvRequest {
            id: "list".to_string(),
            name: "list".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/items", server.base_url()),
            headers: vec![],
            params: vec![KeyValue {
                key: "type".to_string(),
                value: "book".to_string(),
                enabled: true,
                secret_ref: None,
            }],
            body: RequestBody::None,
            transforms: RequestTransforms::default(),
        });

        let flow = FirvFlow {
            id: "flow-disable".to_string(),
            name: "Flow".to_string(),
            steps: vec![FlowStep {
                request_id: "list".to_string(),
                query_param_overrides: vec![KeyValue {
                    key: "type".to_string(),
                    value: "".to_string(),
                    enabled: false,
                    secret_ref: None,
                }],
                ..Default::default()
            }],
        };

        let result = execute_flow(workspace_root, flow, vec![], vec![], HashMap::new())
            .await
            .expect("flow should succeed");

        mock.assert();
        assert!(!result.stopped_early);
        assert!(result.steps[0].success);
    }

    #[tokio::test]
    async fn execute_flow_appends_new_query_param_via_override() {
        let dir = tempfile::tempdir().expect("tempdir");
        let workspace_root = dir.path().to_string_lossy().to_string();
        let server = MockServer::start();

        let mock = server.mock(|when, then| {
            when.method(GET).path("/items").query_param("type", "book");
            then.status(200).body("ok");
        });

        write_request(dir.path(), &FirvRequest {
            id: "list".to_string(),
            name: "list".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/items", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms::default(),
        });

        let flow = FirvFlow {
            id: "flow-add".to_string(),
            name: "Flow".to_string(),
            steps: vec![FlowStep {
                request_id: "list".to_string(),
                query_param_overrides: vec![KeyValue {
                    key: "type".to_string(),
                    value: "book".to_string(),
                    enabled: true,
                    secret_ref: None,
                }],
                ..Default::default()
            }],
        };

        let result = execute_flow(workspace_root, flow, vec![], vec![], HashMap::new())
            .await
            .expect("flow should succeed");

        mock.assert();
        assert!(!result.stopped_early);
        assert!(result.steps[0].success);
    }

    #[tokio::test]
    async fn execute_flow_exports_variables_from_step_response() {
        let dir = tempfile::tempdir().expect("tempdir");
        let workspace_root = dir.path().to_string_lossy().to_string();
        let server = MockServer::start();

        let produce_mock = server.mock(|when, then| {
            when.method(GET).path("/produce");
            then.status(200).body("{\"id\":\"42\"}");
        });
        let consume_mock = server.mock(|when, then| {
            when.method(GET).path("/consume/42");
            then.status(200).body("ok");
        });

        write_request(dir.path(), &FirvRequest {
            id: "produce".to_string(),
            name: "produce".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/produce", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms::default(),
        });
        write_request(dir.path(), &FirvRequest {
            id: "consume".to_string(),
            name: "consume".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/consume/{{{{id}}}}", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms::default(),
        });

        let flow = FirvFlow {
            id: "flow-export".to_string(),
            name: "Flow".to_string(),
            steps: vec![
                FlowStep {
                    request_id: "produce".to_string(),
                    export_variables: vec![FlowExtractionRule {
                        target: "id".to_string(),
                        source: ExtractionSource::ResponseBodyJson,
                        pattern: "id".to_string(),
                        enabled: true,
                    }],
                    ..Default::default()
                },
                FlowStep {
                    request_id: "consume".to_string(),
                    ..Default::default()
                },
            ],
        };

        let result = execute_flow(workspace_root, flow, vec![], vec![], HashMap::new())
            .await
            .expect("flow should succeed");

        produce_mock.assert();
        consume_mock.assert();
        assert!(!result.stopped_early);
        assert_eq!(result.steps.len(), 2);
        assert!(result.steps.iter().all(|s| s.success));
    }

    #[tokio::test]
    async fn on_success_chain_step_runs_when_response_is_successful() {
        let dir = tempfile::tempdir().expect("tempdir");
        let server = MockServer::start();

        let next_mock = server.mock(|when, then| {
            when.method(GET).path("/next");
            then.status(200).body("ok");
        });

        write_request(dir.path(), &FirvRequest {
            id: "next".to_string(),
            name: "next".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/next", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms::default(),
        });

        let main_mock = server.mock(|when, then| {
            when.method(GET).path("/main-ok");
            then.status(200).body("ok");
        });

        let request = FirvRequest {
            id: "main".to_string(),
            name: "main".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/main-ok", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms {
                chain_steps: vec![RequestChainStep {
                    when: ChainCondition::OnSuccess,
                    next_request_id: "next".to_string(),
                }],
                ..Default::default()
            },
        };

        let result = execute_chain(dir.path().to_string_lossy().to_string(), request, vec![], vec![], HashMap::new(), 0)
            .await
            .expect("chain should succeed");

        main_mock.assert();
        next_mock.assert();
        assert_eq!(result.chained_results.len(), 1);
        assert_eq!(result.chained_results[0].request_id, "next");
    }

    #[tokio::test]
    async fn on_success_chain_step_does_not_run_when_response_is_a_failure() {
        let dir = tempfile::tempdir().expect("tempdir");
        let server = MockServer::start();

        let next_mock = server.mock(|when, then| {
            when.method(GET).path("/next");
            then.status(200).body("ok");
        });

        write_request(dir.path(), &FirvRequest {
            id: "next".to_string(),
            name: "next".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/next", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms::default(),
        });

        let main_mock = server.mock(|when, then| {
            when.method(GET).path("/main-fail");
            then.status(500).body("boom");
        });

        let request = FirvRequest {
            id: "main".to_string(),
            name: "main".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/main-fail", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms {
                chain_steps: vec![RequestChainStep {
                    when: ChainCondition::OnSuccess,
                    next_request_id: "next".to_string(),
                }],
                ..Default::default()
            },
        };

        let result = execute_chain(dir.path().to_string_lossy().to_string(), request, vec![], vec![], HashMap::new(), 0)
            .await
            .expect("chain should succeed even though the main response failed");

        main_mock.assert();
        next_mock.assert_hits(0);
        assert!(result.chained_results.is_empty());
    }

    #[tokio::test]
    async fn on_failure_chain_step_runs_only_when_response_is_a_failure() {
        let dir = tempfile::tempdir().expect("tempdir");
        let server = MockServer::start();

        let next_mock = server.mock(|when, then| {
            when.method(GET).path("/next");
            then.status(200).body("ok");
        });

        write_request(dir.path(), &FirvRequest {
            id: "next".to_string(),
            name: "next".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/next", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms::default(),
        });

        let main_mock = server.mock(|when, then| {
            when.method(GET).path("/main-fail");
            then.status(500).body("boom");
        });

        let request = FirvRequest {
            id: "main".to_string(),
            name: "main".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/main-fail", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms {
                chain_steps: vec![RequestChainStep {
                    when: ChainCondition::OnFailure,
                    next_request_id: "next".to_string(),
                }],
                ..Default::default()
            },
        };

        let result = execute_chain(dir.path().to_string_lossy().to_string(), request, vec![], vec![], HashMap::new(), 0)
            .await
            .expect("chain should succeed");

        main_mock.assert();
        next_mock.assert();
        assert_eq!(result.chained_results.len(), 1);
        assert_eq!(result.chained_results[0].request_id, "next");
    }

    #[tokio::test]
    async fn skip_on_success_chain_suppresses_chain_step_even_on_success() {
        let dir = tempfile::tempdir().expect("tempdir");
        let server = MockServer::start();

        let next_mock = server.mock(|when, then| {
            when.method(GET).path("/next");
            then.status(200).body("ok");
        });

        write_request(dir.path(), &FirvRequest {
            id: "next".to_string(),
            name: "next".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/next", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms::default(),
        });

        let main_mock = server.mock(|when, then| {
            when.method(GET).path("/main-ok");
            then.status(200).body("ok");
        });

        let request = FirvRequest {
            id: "main".to_string(),
            name: "main".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/main-ok", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms {
                chain_steps: vec![RequestChainStep {
                    when: ChainCondition::OnSuccess,
                    next_request_id: "next".to_string(),
                }],
                ..Default::default()
            },
        };

        let result = execute_chain_with_skip(
            dir.path().to_string_lossy().to_string(),
            request,
            vec![],
            vec![],
            HashMap::new(),
            HashMap::new(),
            false,
            true,
            false,
            0,
        )
        .await
        .expect("chain should succeed");

        main_mock.assert();
        next_mock.assert_hits(0);
        assert!(result.chained_results.is_empty());
    }

    #[tokio::test]
    async fn before_run_step_executes_and_its_variables_are_visible_to_main_request() {
        let dir = tempfile::tempdir().expect("tempdir");
        let server = MockServer::start();

        write_request(dir.path(), &FirvRequest {
            id: "login".to_string(),
            name: "login".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/login", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms {
                response_extractions: vec![RequestExtractionRule {
                    target: "token".to_string(),
                    source: ExtractionSource::ResponseBodyJson,
                    pattern: "token".to_string(),
                }],
                ..Default::default()
            },
        });

        let login_mock = server.mock(|when, then| {
            when.method(GET).path("/login");
            then.status(200).body("{\"token\":\"abc123\"}");
        });
        let main_mock = server.mock(|when, then| {
            when.method(GET).path("/books/abc123");
            then.status(200).body("ok");
        });

        let request = FirvRequest {
            id: "main".to_string(),
            name: "main".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/books/{{{{token}}}}", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms {
                before_run: vec![BeforeRunStep { request_id: "login".to_string() }],
                ..Default::default()
            },
        };

        let result = execute_chain(dir.path().to_string_lossy().to_string(), request, vec![], vec![], HashMap::new(), 0)
            .await
            .expect("chain should succeed");

        login_mock.assert();
        main_mock.assert();
        assert_eq!(result.before_run_results.len(), 1);
        assert_eq!(result.before_run_results[0].request_id, "login");
        assert!(result.before_run_results[0].success);
        assert_eq!(result.final_request.url, format!("{}/books/abc123", server.base_url()));
    }

    #[tokio::test]
    async fn skip_before_chain_prevents_before_run_step_from_executing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let server = MockServer::start();

        write_request(dir.path(), &FirvRequest {
            id: "login".to_string(),
            name: "login".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/login", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms::default(),
        });

        let login_mock = server.mock(|when, then| {
            when.method(GET).path("/login");
            then.status(200).body("ok");
        });
        let main_mock = server.mock(|when, then| {
            when.method(GET).path("/main-ok");
            then.status(200).body("ok");
        });

        let request = FirvRequest {
            id: "main".to_string(),
            name: "main".to_string(),
            method: HttpMethod::GET,
            url: format!("{}/main-ok", server.base_url()),
            headers: vec![],
            params: vec![],
            body: RequestBody::None,
            transforms: RequestTransforms {
                before_run: vec![BeforeRunStep { request_id: "login".to_string() }],
                ..Default::default()
            },
        };

        let result = execute_chain_with_skip(
            dir.path().to_string_lossy().to_string(),
            request,
            vec![],
            vec![],
            HashMap::new(),
            HashMap::new(),
            true,
            false,
            false,
            0,
        )
        .await
        .expect("chain should succeed");

        login_mock.assert_hits(0);
        main_mock.assert();
        assert!(result.before_run_results.is_empty());
    }
}
