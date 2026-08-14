use std::collections::HashMap;

use serde::Deserialize;
use serde_json::{json, Value};

use crate::mcp_server::McpServerState;
use crate::models::manifest::SidebarItem;
use crate::models::request::{FirvRequest, HttpMethod};
use crate::workspace_context::WorkspaceContext;
use crate::request_engine::{execute_chain_with_overrides, run_request_by_id_with_overrides};
use crate::storage;

#[derive(Debug, Deserialize)]
struct ExecuteRequestArgs {
    request_id: String,
    #[serde(default)]
    variables: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct RequestPayloadArgs {
    #[serde(default)]
    variables: HashMap<String, String>,
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
    #[serde(default)]
    variables: HashMap<String, String>,
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

#[derive(Debug, Deserialize)]
struct CreateRequestArgs {
    id: String,
    name: String,
    method: HttpMethod,
    url: String,
    #[serde(default)]
    headers: Vec<crate::models::request::KeyValue>,
    #[serde(default)]
    params: Vec<crate::models::request::KeyValue>,
    #[serde(default)]
    body: crate::models::request::RequestBody,
    #[serde(default)]
    parent_path: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct UpdateRequestArgs {
    #[serde(flatten)]
    request: FirvRequest,
}

#[derive(Debug, Deserialize)]
struct DeleteRequestArgs {
    request_id: String,
}

#[derive(Debug, Deserialize)]
struct DuplicateRequestArgs {
    request_id: String,
    #[serde(default)]
    new_id: Option<String>,
}

pub fn tools_schema() -> Value {
    json!({
        "tools": [
            {
                "name": "load_workspace",
                "description": "Load or reload a firv workspace from disk by path. Required before most other operations.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "workspace_root": { "type": "string", "description": "Absolute or relative path to the workspace directory containing firv.yaml" }
                    },
                    "required": ["workspace_root"]
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
                "description": "Execute a persisted workspace request by ID using the current active environment. Use 'variables' to override any {{name}} placeholder in the request (e.g. a URL path slug like {{bookid}}) for this run only, without changing workspace globals or environment variables.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "request_id": { "type": "string" },
                        "variables": {
                            "type": "object",
                            "description": "Map of placeholder name to override value, e.g. { \"bookid\": \"42\" } for a URL containing {{bookid}}.",
                            "additionalProperties": { "type": "string" }
                        }
                    },
                    "required": ["request_id"]
                }
            },
            {
                "name": "execute_request_by_payload",
                "description": "Execute an ad-hoc request payload against the loaded workspace using the current active environment. Use 'variables' to override any {{name}} placeholder (e.g. a URL path slug like {{bookid}}) for this run only.",
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
                        "transforms": { "type": "object" },
                        "variables": {
                            "type": "object",
                            "description": "Map of placeholder name to override value, e.g. { \"bookid\": \"42\" } for a URL containing {{bookid}}.",
                            "additionalProperties": { "type": "string" }
                        }
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
                "description": "Execute a scratchpad request by ID using the current active environment. Use 'variables' to override any {{name}} placeholder (e.g. a URL path slug like {{bookid}}) for this run only.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "request_id": { "type": "string" },
                        "variables": {
                            "type": "object",
                            "description": "Map of placeholder name to override value, e.g. { \"bookid\": \"42\" } for a URL containing {{bookid}}.",
                            "additionalProperties": { "type": "string" }
                        }
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
            },
            {
                "name": "create_request",
                "description": "Create a new persisted workspace request, saving it to requests/<id>.yaml and adding it to the manifest order.",
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
                        "parent_path": { "type": "array", "items": { "type": "string" }, "description": "Optional folder path for placement in the manifest tree" }
                    },
                    "required": ["id", "name", "method", "url"]
                }
            },
            {
                "name": "update_request",
                "description": "Replace an existing persisted workspace request by ID.",
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
                "name": "delete_request",
                "description": "Delete a persisted workspace request by ID and remove it from the manifest order.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "request_id": { "type": "string" }
                    },
                    "required": ["request_id"]
                }
            },
            {
                "name": "duplicate_request",
                "description": "Duplicate an existing persisted workspace request. Generates a new ID and appends ' (copy)' to the name. Optionally specify new_id to override the generated ID.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "request_id": { "type": "string" },
                        "new_id": { "type": "string", "description": "Optional explicit ID for the duplicate. If omitted, a UUID is generated." }
                    },
                    "required": ["request_id"]
                }
            }
        ]
    })
}

pub fn handle_tool_call(name: &str, arguments: Value, state: &mut McpServerState) -> Result<Value, String> {
    match name {
        "load_workspace" => load_workspace(arguments, state),
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
        "create_request" => create_request(arguments, state),
        "update_request" => update_request(arguments, state),
        "delete_request" => delete_request(arguments, state),
        "duplicate_request" => duplicate_request(arguments, state),
        _ => Err(format!("Unknown tool: {}", name)),
    }
}

fn load_workspace(arguments: Value, state: &mut McpServerState) -> Result<Value, String> {
    let args: std::collections::HashMap<String, Value> = serde_json::from_value(arguments)
        .map_err(|e| format!("Invalid arguments: {}", e))?;
    let workspace_root = args
        .get("workspace_root")
        .and_then(|v| v.as_str())
        .ok_or("Missing workspace_root")?;
    state.load_workspace(workspace_root.to_string())?;
    Ok(json!({ "status": "ok" }))
}

fn list_requests(state: &McpServerState) -> Result<Value, String> {
    if state.workspace.is_none() {
        return Err("No workspace loaded".to_string());
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
    let workspace_root = state.workspace_root().ok_or("No workspace loaded")?;
    let request = storage::get_request(workspace_root.to_string(), args.request_id)?;
    Ok(json!({ "request": request }))
}

fn execute_request(arguments: Value, state: &McpServerState) -> Result<Value, String> {
    let args: ExecuteRequestArgs = serde_json::from_value(arguments)
        .map_err(|e| format!("Invalid arguments: {}", e))?;
    let workspace_root = state.workspace_root().ok_or("No workspace loaded")?;
    let workspace_vars = state.workspace_vars();
    let environment_vars = state.environment_vars();
    let secrets = state.secrets();

    let result = state.runtime.block_on(run_request_by_id_with_overrides(
        workspace_root,
        &args.request_id,
        workspace_vars,
        environment_vars,
        secrets,
        args.variables,
    ));

    Ok(json!({ "result": result? }))
}

fn execute_request_by_payload(arguments: Value, state: &McpServerState) -> Result<Value, String> {
    let args: RequestPayloadArgs = serde_json::from_value(arguments)
        .map_err(|e| format!("Invalid arguments: {}", e))?;
    let workspace_root = state.workspace_root().ok_or("No workspace loaded")?;
    let workspace_vars = state.workspace_vars();
    let environment_vars = state.environment_vars();
    let secrets = state.secrets();

    let result = state.runtime.block_on(execute_chain_with_overrides(
        workspace_root.to_string(),
        args.request,
        workspace_vars,
        environment_vars,
        secrets,
        args.variables,
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
        "active_environment_id": state.active_environment_id()
    }))
}

fn set_active_environment(arguments: Value, state: &mut McpServerState) -> Result<Value, String> {
    let args: SetEnvironmentArgs = serde_json::from_value(arguments)
        .map_err(|e| format!("Invalid arguments: {}", e))?;

    let manifest = state.workspace.as_ref().map(|w| w.manifest()).ok_or("No workspace loaded")?;
    if !manifest.workspace.environments.iter().any(|e| e.id == args.environment_id) {
        return Err(format!("Environment {} not found", args.environment_id));
    }

    state.set_active_environment(Some(args.environment_id));
    Ok(json!({ "status": "ok" }))
}

fn list_ws_requests(state: &McpServerState) -> Result<Value, String> {
    if state.workspace.is_none() {
        return Err("No workspace loaded".to_string());
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

    let workspace_root = state.workspace_root().ok_or("No workspace loaded")?;
    let workspace_vars = state.workspace_vars();
    let environment_vars = state.environment_vars();
    let secrets = state.secrets();

    let result = state.runtime.block_on(execute_chain_with_overrides(
        workspace_root.to_string(),
        request,
        workspace_vars,
        environment_vars,
        secrets,
        args.variables,
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

    let workspace_root = state.workspace_root().ok_or("No workspace loaded")?.to_string();
    let mut manifest = WorkspaceContext::load(workspace_root.to_string())?.manifest().clone();

    if request.id.is_empty() || request.id != args.request_id {
        request.id = args.request_id.clone();
    }

    storage::update_request(workspace_root.to_string(), request.clone())?;

    let request_item = SidebarItem::Request {
        id: request.id.clone(),
        name: request.name.clone(),
        method: request.method.clone(),
    };

    insert_into_folder(&mut manifest.workspace.order, &args.parent_path, request_item)?;

    storage::update_manifest_structure(
        workspace_root.to_string(),
        manifest.workspace,
        Some(manifest.name),
    )?;
    state.load_workspace(workspace_root.clone())?;

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

pub(crate) fn collect_request_ids(items: &[SidebarItem]) -> Vec<String> {
    let mut ids = Vec::new();
    for item in items {
        match item {
            SidebarItem::Request { id, .. } => ids.push(id.clone()),
            SidebarItem::Ws { id, .. } => ids.push(id.clone()),
            SidebarItem::Folder { items: children, .. } => ids.extend(collect_request_ids(children)),
            SidebarItem::Flow { .. } => {}
        }
    }
    ids
}

fn update_request_in_order(
    items: &mut Vec<SidebarItem>,
    id: &str,
    name: String,
    method: crate::models::request::HttpMethod,
) -> bool {
    for item in items.iter_mut() {
        match item {
            SidebarItem::Request { id: rid, name: rname, method: rmethod } if rid == id => {
                *rname = name;
                *rmethod = method;
                return true;
            }
            SidebarItem::Folder { items: children, .. } => {
                if update_request_in_order(children, id, name.clone(), method.clone()) {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn remove_from_order(items: &mut Vec<SidebarItem>, id: &str) {
    let mut i = 0;
    while i < items.len() {
        match &mut items[i] {
            SidebarItem::Request { id: rid, .. } | SidebarItem::Ws { id: rid, .. } if rid == id => {
                items.remove(i);
                continue;
            }
            SidebarItem::Folder { items: children, .. } => {
                remove_from_order(children, id);
            }
            _ => {}
        }
        i += 1;
    }
}

fn create_request(arguments: Value, state: &mut McpServerState) -> Result<Value, String> {
    let args: CreateRequestArgs = serde_json::from_value(arguments)
        .map_err(|e| format!("Invalid arguments: {}", e))?;

    let workspace_root = state.workspace_root().ok_or("No workspace loaded")?.to_string();
    let mut manifest = WorkspaceContext::load(workspace_root.to_string())?.manifest().clone();

    if collect_request_ids(&manifest.workspace.order).contains(&args.id) {
        return Err(format!("Request {} already exists", args.id));
    }

    let request = FirvRequest {
        id: args.id.clone(),
        name: args.name,
        method: args.method,
        url: args.url,
        headers: args.headers,
        params: args.params,
        body: args.body,
        transforms: Default::default(),
    };

    storage::update_request(workspace_root.to_string(), request.clone())?;

    let request_item = SidebarItem::Request {
        id: request.id.clone(),
        name: request.name.clone(),
        method: request.method.clone(),
    };

    insert_into_folder(&mut manifest.workspace.order, &args.parent_path, request_item)?;

    storage::update_manifest_structure(
        workspace_root.to_string(),
        manifest.workspace,
        Some(manifest.name),
    )?;
    state.load_workspace(workspace_root.clone())?;

    Ok(json!({ "id": request.id }))
}

fn update_request(arguments: Value, state: &mut McpServerState) -> Result<Value, String> {
    let args: UpdateRequestArgs = serde_json::from_value(arguments)
        .map_err(|e| format!("Invalid arguments: {}", e))?;

    let workspace_root = state.workspace_root().ok_or("No workspace loaded")?.to_string();
    let mut manifest = WorkspaceContext::load(workspace_root.to_string())?.manifest().clone();

    if !collect_request_ids(&manifest.workspace.order).contains(&args.request.id) {
        return Err(format!("Request {} not found", args.request.id));
    }

    storage::update_request(workspace_root.to_string(), args.request.clone())?;
    update_request_in_order(
        &mut manifest.workspace.order,
        &args.request.id,
        args.request.name.clone(),
        args.request.method.clone(),
    );

    storage::update_manifest_structure(
        workspace_root.to_string(),
        manifest.workspace,
        Some(manifest.name),
    )?;
    state.load_workspace(workspace_root.clone())?;

    Ok(json!({ "status": "ok" }))
}

fn delete_request(arguments: Value, state: &mut McpServerState) -> Result<Value, String> {
    let args: DeleteRequestArgs = serde_json::from_value(arguments)
        .map_err(|e| format!("Invalid arguments: {}", e))?;

    let workspace_root = state.workspace_root().ok_or("No workspace loaded")?.to_string();
    let mut manifest = WorkspaceContext::load(workspace_root.to_string())?.manifest().clone();

    storage::delete_request(workspace_root.to_string(), args.request_id.clone())?;
    remove_from_order(&mut manifest.workspace.order, &args.request_id);

    storage::update_manifest_structure(
        workspace_root.to_string(),
        manifest.workspace,
        Some(manifest.name),
    )?;
    state.load_workspace(workspace_root.clone())?;

    Ok(json!({ "status": "ok" }))
}

fn duplicate_request(arguments: Value, state: &mut McpServerState) -> Result<Value, String> {
    let args: DuplicateRequestArgs = serde_json::from_value(arguments)
        .map_err(|e| format!("Invalid arguments: {}", e))?;

    let workspace_root = state.workspace_root().ok_or("No workspace loaded")?.to_string();
    let mut manifest = WorkspaceContext::load(workspace_root.to_string())?.manifest().clone();

    let mut request = storage::get_request(workspace_root.to_string(), args.request_id.clone())?;
    let new_id = args.new_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    if collect_request_ids(&manifest.workspace.order).contains(&new_id) {
        return Err(format!("Request {} already exists", new_id));
    }

    request.id = new_id.clone();
    request.name = format!("{} (copy)", request.name);

    storage::update_request(workspace_root.to_string(), request.clone())?;

    let request_item = SidebarItem::Request {
        id: request.id.clone(),
        name: request.name.clone(),
        method: request.method.clone(),
    };
    manifest.workspace.order.push(request_item);

    storage::update_manifest_structure(
        workspace_root.to_string(),
        manifest.workspace,
        Some(manifest.name),
    )?;
    state.load_workspace(workspace_root.clone())?;

    Ok(json!({ "id": new_id }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp_server::McpServerState;

    fn temp_project() -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().to_string_lossy().to_string();

        let manifest_content = r#"
version: "1.0"
name: test-project
workspace:
  active_environment: dev
  globals: []
  environments:
    - id: dev
      name: Development
      variables:
        - key: base_url
          value: https://example.com
          enabled: true
  order:
    - type: request
      id: hello
      name: Hello
      method: GET
"#;

        std::fs::write(dir.path().join("firv.yaml"), manifest_content).expect("write manifest");
        std::fs::create_dir(dir.path().join("requests")).expect("create requests dir");

        let request_content = r#"
id: hello
name: Hello
method: GET
url: "{{base_url}}/hello"
body:
  mode: none
"#;
        std::fs::write(dir.path().join("requests").join("hello.yaml"), request_content).expect("write request");

        (dir, root)
    }

    fn loaded_state(root: &str) -> McpServerState {
        let mut state = McpServerState::new().expect("state");
        state.load_workspace(root.to_string()).expect("load workspace");
        state
    }

    #[test]
    fn handle_tool_call_rejects_unknown_tool_names() {
        let mut state = McpServerState::new().expect("state");
        let result = handle_tool_call("not_a_real_tool", json!({}), &mut state);
        assert_eq!(result.unwrap_err(), "Unknown tool: not_a_real_tool");
    }

    #[test]
    fn handle_tool_call_reports_invalid_arguments_with_the_underlying_parse_error() {
        let mut state = McpServerState::new().expect("state");
        // `request_id` is required by ExecuteRequestArgs but omitted here.
        let result = handle_tool_call("get_request", json!({}), &mut state);
        let err = result.unwrap_err();
        assert!(err.starts_with("Invalid arguments:"), "unexpected error: {}", err);
    }

    #[test]
    fn create_request_rejects_a_duplicate_id() {
        let (_dir, root) = temp_project();
        let mut state = loaded_state(&root);

        let result = handle_tool_call(
            "create_request",
            json!({
                "id": "hello",
                "name": "Duplicate",
                "method": "GET",
                "url": "https://example.com/dup"
            }),
            &mut state,
        );

        assert_eq!(result.unwrap_err(), "Request hello already exists");
    }

    #[test]
    fn create_request_inserts_into_a_nested_folder_when_parent_path_is_given() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().to_string_lossy().to_string();
        let manifest_content = r#"
version: "1.0"
name: test-project
workspace:
  active_environment: null
  globals: []
  environments: []
  order:
    - type: folder
      name: Folder
      items: []
"#;
        std::fs::write(dir.path().join("firv.yaml"), manifest_content).expect("write manifest");
        std::fs::create_dir(dir.path().join("requests")).expect("create requests dir");
        let mut state = loaded_state(&root);

        let create_result = handle_tool_call(
            "create_request",
            json!({
                "id": "nested",
                "name": "Nested",
                "method": "GET",
                "url": "https://example.com/nested",
                "parent_path": ["Folder"]
            }),
            &mut state,
        )
        .expect("create should succeed");
        assert_eq!(create_result["id"], "nested");

        let list_result = handle_tool_call("list_requests", json!({}), &mut state).expect("list should succeed");
        let requests = list_result["requests"].as_array().expect("requests array");
        assert!(requests.iter().any(|r| r["id"] == "nested"));
    }

    #[test]
    fn create_request_fails_when_the_parent_folder_does_not_exist() {
        let (_dir, root) = temp_project();
        let mut state = loaded_state(&root);

        let result = handle_tool_call(
            "create_request",
            json!({
                "id": "orphan",
                "name": "Orphan",
                "method": "GET",
                "url": "https://example.com/orphan",
                "parent_path": ["Missing Folder"]
            }),
            &mut state,
        );

        assert_eq!(result.unwrap_err(), "Folder 'Missing Folder' not found");
    }

    #[test]
    fn delete_request_removes_it_from_the_manifest_order_and_storage() {
        let (_dir, root) = temp_project();
        let mut state = loaded_state(&root);

        handle_tool_call("delete_request", json!({ "request_id": "hello" }), &mut state)
            .expect("delete should succeed");

        let list_result = handle_tool_call("list_requests", json!({}), &mut state).expect("list should succeed");
        let requests = list_result["requests"].as_array().expect("requests array");
        assert!(requests.is_empty());

        let get_result = handle_tool_call("get_request", json!({ "request_id": "hello" }), &mut state);
        assert!(get_result.is_err());
    }

    #[test]
    fn duplicate_request_creates_a_copy_with_a_generated_id_and_copy_suffix() {
        let (_dir, root) = temp_project();
        let mut state = loaded_state(&root);

        let result = handle_tool_call("duplicate_request", json!({ "request_id": "hello" }), &mut state)
            .expect("duplicate should succeed");
        let new_id = result["id"].as_str().expect("id string").to_string();
        assert_ne!(new_id, "hello");

        let get_result = handle_tool_call("get_request", json!({ "request_id": new_id }), &mut state)
            .expect("get should succeed");
        assert_eq!(get_result["request"]["name"], "Hello (copy)");
    }

    #[test]
    fn duplicate_request_honors_an_explicit_new_id_and_rejects_a_collision() {
        let (_dir, root) = temp_project();
        let mut state = loaded_state(&root);

        let result = handle_tool_call(
            "duplicate_request",
            json!({ "request_id": "hello", "new_id": "hello-2" }),
            &mut state,
        )
        .expect("duplicate should succeed");
        assert_eq!(result["id"], "hello-2");

        let collision = handle_tool_call(
            "duplicate_request",
            json!({ "request_id": "hello", "new_id": "hello-2" }),
            &mut state,
        );
        assert_eq!(collision.unwrap_err(), "Request hello-2 already exists");
    }

    #[test]
    fn promote_scratchpad_request_moves_it_into_the_workspace_tree_and_removes_it_from_the_scratchpad() {
        let (_dir, root) = temp_project();
        let mut state = loaded_state(&root);

        handle_tool_call(
            "create_scratchpad_request",
            json!({ "name": "Scratch", "method": "GET", "url": "https://example.com/scratch" }),
            &mut state,
        )
        .expect("create scratchpad request should succeed");

        let scratchpad_list = handle_tool_call("list_scratchpad_requests", json!({}), &mut state)
            .expect("list should succeed");
        let scratch_id = scratchpad_list["requests"][0]["id"].as_str().expect("id").to_string();

        handle_tool_call(
            "promote_scratchpad_request",
            json!({ "request_id": scratch_id }),
            &mut state,
        )
        .expect("promote should succeed");

        let scratchpad_after = handle_tool_call("list_scratchpad_requests", json!({}), &mut state)
            .expect("list should succeed");
        assert!(scratchpad_after["requests"].as_array().unwrap().is_empty());

        let workspace_list = handle_tool_call("list_requests", json!({}), &mut state).expect("list should succeed");
        let requests = workspace_list["requests"].as_array().expect("requests array");
        assert!(requests.iter().any(|r| r["id"] == scratch_id));
    }

    #[test]
    fn tools_requiring_a_workspace_fail_clearly_when_none_is_loaded() {
        let mut state = McpServerState::new().expect("state");

        let result = handle_tool_call("create_request", json!({
            "id": "x",
            "name": "X",
            "method": "GET",
            "url": "https://example.com"
        }), &mut state);

        assert_eq!(result.unwrap_err(), "No workspace loaded");
    }
}
