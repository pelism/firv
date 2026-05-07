pub mod api;

use crate::lifecycle::HydratedRequestInfo;
use crate::runner::FirvResponse;
use rquickjs::{Context, Runtime, Result};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use api::{setup_firv_api, ScriptState};

pub fn execute_script(
    script: &str,
    workspace_vars: &mut HashMap<String, String>,
    request_vars: &mut HashMap<String, String>,
    mut request: Option<&mut HydratedRequestInfo>,
    response: Option<&FirvResponse>,
    logs: &mut Vec<String>,
) -> std::result::Result<(), String> {
    let runtime = Runtime::new().map_err(|e| e.to_string())?;
    let context = Context::full(&runtime).map_err(|e| e.to_string())?;

    let state = Arc::new(ScriptState {
        workspace_vars: Arc::new(Mutex::new(workspace_vars.clone())),
        request_vars: Arc::new(Mutex::new(request_vars.clone())),
        logs: Arc::new(Mutex::new(Vec::new())),
    });

    let shared_request = request.as_ref().map(|r| Arc::new(Mutex::new((*r).clone())));
    let shared_response = response.map(|r| Arc::new((*r).clone()));

    let script_owned = script.to_string();
    
    let eval_res: Result<()> = context.with(|ctx| {
        setup_firv_api(&ctx, Arc::clone(&state), shared_request.clone(), shared_response.clone())?;
        
        ctx.eval(script_owned)
    });

    // Sync state back
    if let Ok(ws) = state.workspace_vars.lock() {
        *workspace_vars = ws.clone();
    }
    if let Ok(req) = state.request_vars.lock() {
        *request_vars = req.clone();
    }
    if let Ok(l) = state.logs.lock() {
        logs.extend(l.clone());
    }

    // Sync hydrated request back if it was modified
    if let Some(shared_req) = shared_request {
        if let (Some(original_req), Ok(modified_req)) = (request.as_mut(), shared_req.lock()) {
            **original_req = modified_req.clone();
        }
    }

    eval_res.map_err(|e| format!("JS Error: {}", e))?;

    Ok(())
}
