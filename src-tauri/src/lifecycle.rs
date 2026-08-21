use crate::models::flow::FirvFlow;
use crate::models::request::FirvRequest;
use crate::request_engine::{
    execute_chain_with_overrides, execute_flow, FlowResult, LifecycleResult,
};
use crate::workspace_context::WorkspaceContext;
use crate::RequestCancellationState;
use std::collections::HashMap;
use tauri::Manager;
use tokio::sync::oneshot;

#[tauri::command]
pub async fn run_firv_request(
    app: tauri::AppHandle,
    workspace_root: String,
    request: FirvRequest,
    overrides: Option<HashMap<String, String>>,
) -> Result<LifecycleResult, String> {
    let workspace = WorkspaceContext::load(workspace_root.clone())?;
    let workspace_vars = workspace.workspace_vars();
    let environment_vars = workspace.environment_vars();
    let secrets = workspace.secrets();

    let (cancel_tx, cancel_rx) = oneshot::channel();
    {
        let state = app.state::<RequestCancellationState>();
        let mut guard = state
            .0
            .lock()
            .map_err(|e| format!("Failed to lock request cancellation state: {}", e))?;
        *guard = Some(cancel_tx);
    }

    let result = tokio::select! {
        result = execute_chain_with_overrides(workspace_root, request, workspace_vars, environment_vars, secrets, overrides.unwrap_or_default(), 0) => result,
        _ = cancel_rx => Err("Request canceled".to_string()),
    };

    let state = app.state::<RequestCancellationState>();
    if let Ok(mut guard) = state.0.lock() {
        *guard = None;
    }

    result
}

#[tauri::command]
pub async fn run_firv_flow(
    app: tauri::AppHandle,
    workspace_root: String,
    flow: FirvFlow,
) -> Result<FlowResult, String> {
    let workspace = WorkspaceContext::load(workspace_root.clone())?;
    let workspace_vars = workspace.workspace_vars();
    let environment_vars = workspace.environment_vars();
    let secrets = workspace.secrets();

    let (cancel_tx, cancel_rx) = oneshot::channel();
    {
        let state = app.state::<RequestCancellationState>();
        let mut guard = state
            .0
            .lock()
            .map_err(|e| format!("Failed to lock request cancellation state: {}", e))?;
        *guard = Some(cancel_tx);
    }

    let result = tokio::select! {
        result = execute_flow(workspace_root, flow, workspace_vars, environment_vars, secrets) => result,
        _ = cancel_rx => Err("Flow canceled".to_string()),
    };

    let state = app.state::<RequestCancellationState>();
    if let Ok(mut guard) = state.0.lock() {
        *guard = None;
    }

    result
}
