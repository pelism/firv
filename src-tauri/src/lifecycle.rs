use tokio::sync::oneshot;
use tauri::Manager;
use crate::models::request::FirvRequest;
use crate::request_engine::{execute_chain, LifecycleResult};
use crate::RequestCancellationState;

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
