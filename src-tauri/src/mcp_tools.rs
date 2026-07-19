use serde::Deserialize;
use serde_json::{json, Value};

use crate::mcp_server::McpServerState;
use crate::models::manifest::SidebarItem;
use crate::models::request::{FirvRequest, HttpMethod};
use crate::request_engine::{execute_chain, run_request_by_id};
use crate::storage;

#[derive(Debug, Deserialize)]
struct ExecuteRequestArgs {
    request_id: String,
}

#[derive(Debug, Deserialize)]
struct RequestPayloadArgs {
    #[serde(flatten)]
    request: FirvRequest,
}

#[derive(Debug, Deserialize)]
struct SetEnvironmentArgs {
    environment_id: String,
}

#[derive(Debug, Deserialize)]
struct ScratchpadIdArgs {
    request_id: String,
}

#[derive(Debug, Deserialize)]
struct CreateScratchpadArgs {
    name: String,
    method: HttpMethod,
    url: String,
    #[serde(default)]
    headers: Vec<crate::models::request::KeyValue>,
    #[serde(default)]
    params: Vec<crate::models::request::KeyValue>,
    #[serde(default)]
    body: crate::models::request::RequestBody,
}

#[derive(Debug, Deserialize)]
struct UpdateScratchpadArgs {
    request_id: String,
    #[serde(flatten)]
    request: FirvRequest,
}

#[derive(Debug, Deserialize)]
struct PromoteScratchpadArgs {
    request_id: String,
    #[serde(default)]
    parent_path: Vec<String>,
}

pub fn tools_schema() -> Value {
    json!({
        "tools": [
            {
                "name": "load_project",
                "description": "Load or reload a firv project from disk by path. Required before most other operations.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "project_root": { "type": "string", "description": "Absolute or relative path to the project directory containing firv.yaml" }
                    },
                    "required": ["project_root"]
                }
            },
            {
                "name": "list_requests",
                "description": "List all persisted HTTP and WebSocket requests in the workspace manifest.",
                "inputSchema": {
                    "type": "object",
                    "properties": {}
                }
            },
            {
                "name": "get_request",
                "description": "Get the full YAML definition of a persisted workspace request by ID.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "request_id": { "type": "string" }
                    },
                    "required": ["request_id"]
                }
            },
            {
                "name": "execute_request",
                "description": "Execute a persisted workspace request by ID using the current active environment.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "request_id": { "type": "string" }
                    },
                    "required": ["request_id"]
                }
            },
            {
                "name": "execute_request_by_payload",
                "description": "Execute an ad-hoc request payload against the loaded project using the current active environment.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" },
                        "name": { "type": "string" },
                        "method": { "type": "string", "enum": ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"] },
                        "url": { "type": "string" },
                        "headers": { "type": "array" },
                        "params": { "type": "array" },
                        "body": { "type": "object" },
                        "transforms": { "type": "object" }
                    },
                    "required": ["id", "name", "method", "url"]
                }
            },
            {
                "name": "list_environments",
                "description": "List the workspace environments and the currently active environment.",
                "inputSchema": {
                    "type": "object",
                    "properties": {}
                }
            },
            {
                "name": "set_active_environment",
                "description": "Set the active environment for the current MCP session only (not persisted to disk).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "environment_id": { "type": "string" }
                    },
                    "required": ["environment_id"]
                }
            },
            {
                "name": "list_ws_requests",
                "description": "List WebSocket request entries from the workspace manifest.",
                "inputSchema": {
                    "type": "object",
                    "properties": {}
                }
            },
            {
                "name": "list_scratchpad_requests",
                "description": "List ad-hoc requests in the current session scratchpad.",
                "inputSchema": {
                    "type": "object",
                    "properties": {}
                }
            },
            {
                "name": "get_scratchpad_request",
                "description": "Get a scratchpad request by ID.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "request_id": { "type": "string" }
                    },
                    "required": ["request_id"]
                }
            },
            {
                "name": "create_scratchpad_request",
                "description": "Create a new ad-hoc request in the session scratchpad.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "method": { "type": "string", "enum": ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"] },
                        "url": { "type": "string" },
                        "headers": { "type": "array" },
                        "params": { "type": "array" },
                        "body": { "type": "object" }
                    },
                    "required": ["name", "method", "url"]
                }
            },
            {
                "name": "update_scratchpad_request",
                "description": "Replace an existing scratchpad request by ID.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "request_id": { "type": "string" },
                        "id": { "type": "string" },
                        "name": { "type": "string" },
                        "method": { "type": "string", "enum": ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"] },
                        "url": { "type": "string" },
                        "headers": { "type": "array" },
                        "params": { "type": "array" },
                        "body": { "type": "object" },
                        "transforms": { "type": "object" }
                    },
                    "required": ["request_id", "id", "name", "method", "url"]
                }
            },
            {
                "name": "delete_scratchpad_request",
                "description": "Delete a request from the session scratchpad.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "request_id": { "type": "string" }
                    },
                    "required": ["request_id"]
                }
            },
            {
                "name": "execute_scratchpad_request",
                "description": "Execute a scratchpad request by ID using the current active environment.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "request_id": { "type": "string" }
                    },
                    "required": ["request_id"]
                }
            },
            {
                "name": "promote_scratchpad_request",
                "description": "Persist a scratchpad request to the workspace and add it to the manifest order.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "request_id": { "type": "string" },
                        "parent_path": { "type": "array", "items": { "type": "string" }, "description": "Optional folder path for placement in the manifest tree" }
                    },
                    "required": ["request_id"]
                }
            }
        ]
    })
}

pub fn handle_tool_call(name: &str, arguments: Value, state: &mut McpServerState) -> Result<Value, String> {
    match name {
        "load_project" => load_project(arguments, state),
        "list_requests" => list_requests(state),
        "get_request" => get_request(arguments, state),
        "execute_request" => execute_request(arguments, state),
        "execute_request_by_payload" => execute_request_by_payload(arguments, state),
        "list_environments" => list_environments(state),
        "set_active_environment" => set_active_environment(arguments, state),
        "list_ws_requests" => list_ws_requests(state),
        "list_scratchpad_requests" => list_scratchpad_requests(state),
        "get_scratchpad_request" => get_scratchpad_request(arguments, state),
        "create_scratchpad_request" => create_scratchpad_request(arguments, state),
        "update_scratchpad_request" => update_scratchpad_request(arguments, state),
        "delete_scratchpad_request" => delete_scratchpad_request(arguments, state),
        "execute_scratchpad_request" => execute_scratchpad_request(arguments, state),
        "promote_scratchpad_request" => promote_scratchpad_request(arguments, state),
        _ => Err(format!("Unknown tool: {}", name)),
    }
}

fn load_project(arguments: Value, state: &mut McpServerState) -> Result<Value, String> {
    let args: std::collections::HashMap<String, Value> = serde_json::from_value(arguments)
        .map_err(|e| format!("Invalid arguments: {}", e))?;
    let project_root = args
        .get("project_root")
        .and_then(|v| v.as_str())
        .ok_or("Missing project_root")?;
    state.load_project(project_root.to_string())?;
    Ok(json!({ "status": "ok" }))
}

fn list_requests(state: &McpServerState) -> Result<Value, String> {
    if state.manifest.is_none() {
        return Err("No project loaded".to_string());
    }
    let items = state.list_request_items();
    let requests: Vec<Value> = items
        .into_iter()
        .map(|(item, path)| match item {
            SidebarItem::Request { id, name, method } => json!({
                "type": "request",
                "id": id,
                "name": name,
                "method": format!("{:?}", method),
                "path": path
            }),
            SidebarItem::Ws { id, name } => json!({
                "type": "ws",
                "id": id,
                "name": name,
                "path": path
            }),
            _ => unreachable!(),
        })
        .collect();
    Ok(json!({ "requests": requests }))
}

fn get_request(arguments: Value, state: &McpServerState) -> Result<Value, String> {
    let args: ExecuteRequestArgs = serde_json::from_value(arguments)
        .map_err(|e| format!("Invalid arguments: {}", e))?;
    let project_root = state.project_root.as_ref().ok_or("No project loaded")?;
    let request = storage::get_request(project_root.clone(), args.request_id)?;
    Ok(json!({ "request": request }))
}

fn execute_request(arguments: Value, state: &McpServerState) -> Result<Value, String> {
    let args: ExecuteRequestArgs = serde_json::from_value(arguments)
        .map_err(|e| format!("Invalid arguments: {}", e))?;
    let project_root = state.project_root.as_ref().ok_or("No project loaded")?;
    let workspace_vars = state.workspace_vars();
    let environment_vars = state.environment_vars();

    let result = state.runtime.block_on(run_request_by_id(
        project_root,
        &args.request_id,
        workspace_vars,
        environment_vars,
    ));

    Ok(json!({ "result": result? }))
}

fn execute_request_by_payload(arguments: Value, state: &McpServerState) -> Result<Value, String> {
    let args: RequestPayloadArgs = serde_json::from_value(arguments)
        .map_err(|e| format!("Invalid arguments: {}", e))?;
    let project_root = state.project_root.as_ref().ok_or("No project loaded")?;
    let workspace_vars = state.workspace_vars();
    let environment_vars = state.environment_vars();

    let result = state.runtime.block_on(execute_chain(
        project_root.clone(),
        args.request,
        workspace_vars,
        environment_vars,
        0,
    ));

    Ok(json!({ "result": result? }))
}

fn list_environments(state: &McpServerState) -> Result<Value, String> {
    let environments: Vec<Value> = state
        .list_environments()
        .into_iter()
        .map(|e| json!({"id": e.id, "name": e.name}))
        .collect();
    Ok(json!({
        "environments": environments,
        "active_environment_id": state.active_environment_id
    }))
}

fn set_active_environment(arguments: Value, state: &mut McpServerState) -> Result<Value, String> {
    let args: SetEnvironmentArgs = serde_json::from_value(arguments)
        .map_err(|e| format!("Invalid arguments: {}", e))?;

    let manifest = state.manifest.as_ref().ok_or("No project loaded")?;
    if !manifest.workspace.environments.iter().any(|e| e.id == args.environment_id) {
        return Err(format!("Environment {} not found", args.environment_id));
    }

    state.active_environment_id = Some(args.environment_id);
    Ok(json!({ "status": "ok" }))
}

fn list_ws_requests(state: &McpServerState) -> Result<Value, String> {
    if state.manifest.is_none() {
        return Err("No project loaded".to_string());
    }
    let items = state.list_ws_request_items();
    let requests: Vec<Value> = items
        .into_iter()
        .map(|(item, path)| match item {
            SidebarItem::Ws { id, name } => json!({
                "id": id,
                "name": name,
                "path": path
            }),
            _ => unreachable!(),
        })
        .collect();
    Ok(json!({ "ws_requests": requests }))
}

fn list_scratchpad_requests(state: &McpServerState) -> Result<Value, String> {
    let requests: Vec<&FirvRequest> = state.scratchpad.list();
    Ok(json!({ "requests": requests }))
}

fn get_scratchpad_request(arguments: Value, state: &McpServerState) -> Result<Value, String> {
    let args: ScratchpadIdArgs = serde_json::from_value(arguments)
        .map_err(|e| format!("Invalid arguments: {}", e))?;
    let request = state
        .scratchpad
        .get(&args.request_id)
        .ok_or_else(|| format!("Scratchpad request {} not found", args.request_id))?;
    Ok(json!({ "request": request }))
}

fn create_scratchpad_request(arguments: Value, state: &mut McpServerState) -> Result<Value, String> {
    let args: CreateScratchpadArgs = serde_json::from_value(arguments)
        .map_err(|e| format!("Invalid arguments: {}", e))?;

    let request = FirvRequest {
        id: String::new(),
        name: args.name,
        method: args.method,
        url: args.url,
        headers: args.headers,
        params: args.params,
        body: args.body,
        transforms: Default::default(),
    };

    let id = state.scratchpad.create(request);
    Ok(json!({ "id": id }))
}

fn update_scratchpad_request(arguments: Value, state: &mut McpServerState) -> Result<Value, String> {
    let args: UpdateScratchpadArgs = serde_json::from_value(arguments)
        .map_err(|e| format!("Invalid arguments: {}", e))?;
    state.scratchpad.update(&args.request_id, args.request)?;
    Ok(json!({ "status": "ok" }))
}

fn delete_scratchpad_request(arguments: Value, state: &mut McpServerState) -> Result<Value, String> {
    let args: ScratchpadIdArgs = serde_json::from_value(arguments)
        .map_err(|e| format!("Invalid arguments: {}", e))?;
    state.scratchpad.delete(&args.request_id)?;
    Ok(json!({ "status": "ok" }))
}

fn execute_scratchpad_request(arguments: Value, state: &mut McpServerState) -> Result<Value, String> {
    let args: ScratchpadIdArgs = serde_json::from_value(arguments)
        .map_err(|e| format!("Invalid arguments: {}", e))?;
    let request = state
        .scratchpad
        .get(&args.request_id)
        .ok_or_else(|| format!("Scratchpad request {} not found", args.request_id))?
        .clone();

    let project_root = state.project_root.as_ref().ok_or("No project loaded")?;
    let workspace_vars = state.workspace_vars();
    let environment_vars = state.environment_vars();

    let result = state.runtime.block_on(execute_chain(
        project_root.clone(),
        request,
        workspace_vars,
        environment_vars,
        0,
    ));

    Ok(json!({ "result": result? }))
}

fn promote_scratchpad_request(arguments: Value, state: &mut McpServerState) -> Result<Value, String> {
    let args: PromoteScratchpadArgs = serde_json::from_value(arguments)
        .map_err(|e| format!("Invalid arguments: {}", e))?;
    let mut request = state
        .scratchpad
        .take(&args.request_id)
        .ok_or_else(|| format!("Scratchpad request {} not found", args.request_id))?;

    let project_root = state.project_root.as_ref().ok_or("No project loaded")?.clone();

    if request.id.is_empty() || request.id != args.request_id {
        request.id = args.request_id.clone();
    }

    storage::update_request(project_root.clone(), request.clone())?;

    let manifest_path = std::path::Path::new(&project_root).join("firv.yaml");
    let content = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read manifest: {}", e))?;
    let mut manifest: crate::models::manifest::FirvManifest = serde_yaml::from_str(&content)
        .map_err(|e| format!("Failed to parse manifest: {}", e))?;

    let request_item = SidebarItem::Request {
        id: request.id.clone(),
        name: request.name.clone(),
        method: request.method.clone(),
    };

    if args.parent_path.is_empty() {
        manifest.workspace.order.push(request_item);
    } else {
        insert_into_folder(&mut manifest.workspace.order, &args.parent_path, request_item)?;
    }

    storage::update_manifest_structure(
        project_root,
        manifest.workspace,
        Some(manifest.name),
    )?;

    Ok(json!({ "id": request.id }))
}

fn insert_into_folder(
    items: &mut Vec<SidebarItem>,
    path: &[String],
    new_item: SidebarItem,
) -> Result<(), String> {
    if path.is_empty() {
        items.push(new_item);
        return Ok(());
    }

    let target = &path[0];
    for item in items.iter_mut() {
        if let SidebarItem::Folder { name, items: children } = item {
            if name == target {
                return insert_into_folder(children, &path[1..], new_item);
            }
        }
    }

    Err(format!("Folder '{}' not found", target))
}
