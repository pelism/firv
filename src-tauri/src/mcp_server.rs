use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

use crate::mcp_tools::handle_tool_call;
use crate::models::manifest::{FirvManifest, SidebarItem, WorkspaceEnvironment};
use crate::models::request::KeyValue;
use crate::scratchpad::Scratchpad;
use crate::storage;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub name: String,
    pub version: String,
}

pub struct McpServerState {
    pub project_root: Option<String>,
    pub manifest: Option<FirvManifest>,
    pub active_environment_id: Option<String>,
    pub scratchpad: Scratchpad,
    pub runtime: tokio::runtime::Runtime,
    pub startup_error: Option<String>,
}

impl McpServerState {
    pub fn new() -> Result<Self, String> {
        let runtime = tokio::runtime::Runtime::new()
            .map_err(|e| format!("Failed to create Tokio runtime: {}", e))?;
        Ok(Self {
            project_root: None,
            manifest: None,
            active_environment_id: None,
            scratchpad: Scratchpad::new(),
            runtime,
            startup_error: None,
        })
    }

    pub fn load_project(&mut self, project_root: String) -> Result<(), String> {
        let manifest_path = std::path::Path::new(&project_root).join("firv.yaml");
        let content = std::fs::read_to_string(&manifest_path)
            .map_err(|e| format!("Failed to read manifest at {}: {}", manifest_path.display(), e))?;
        let manifest: FirvManifest = serde_yaml::from_str(&content)
            .map_err(|e| format!("Failed to parse manifest at {}: {}", manifest_path.display(), e))?;
        self.active_environment_id = manifest.workspace.active_environment.clone();
        self.manifest = Some(manifest);
        self.project_root = Some(project_root);
        Ok(())
    }

    pub fn workspace_vars(&self) -> Vec<KeyValue> {
        self.manifest
            .as_ref()
            .map(|m| m.workspace.globals.clone())
            .unwrap_or_default()
    }

    pub fn environment_vars(&self) -> Vec<KeyValue> {
        let active_id = self.active_environment_id.as_deref();
        let manifest = match self.manifest.as_ref() {
            Some(m) => m,
            None => return Vec::new(),
        };

        if let Some(id) = active_id {
            if let Some(env) = manifest.workspace.environments.iter().find(|e| e.id == id) {
                return env.variables.clone();
            }
        }

        Vec::new()
    }

    pub fn list_environments(&self) -> Vec<&WorkspaceEnvironment> {
        self.manifest
            .as_ref()
            .map(|m| m.workspace.environments.iter().collect())
            .unwrap_or_default()
    }

    pub fn list_request_items(&self) -> Vec<(&SidebarItem, Vec<String>)> {
        let manifest = match self.manifest.as_ref() {
            Some(m) => m,
            None => return Vec::new(),
        };
        collect_items(&manifest.workspace.order, Vec::new())
    }

    pub fn list_ws_request_items(&self) -> Vec<(&SidebarItem, Vec<String>)> {
        let all = self.list_request_items();
        all.into_iter()
            .filter(|(item, _)| matches!(item, SidebarItem::Ws { .. }))
            .collect()
    }
}

fn collect_items<'a>(
    items: &'a [SidebarItem],
    path: Vec<String>,
) -> Vec<(&'a SidebarItem, Vec<String>)> {
    let mut result = Vec::new();
    for item in items {
        match item {
            SidebarItem::Folder { name, items } => {
                let mut folder_path = path.clone();
                folder_path.push(name.clone());
                result.extend(collect_items(items, folder_path));
            }
            _ => {
                result.push((item, path.clone()));
            }
        }
    }
    result
}

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i32,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
}

pub fn run_server(project_root: String, debug: bool) -> Result<(), String> {
    if debug {
        eprintln!("[firv-mcp] starting server workspace={}", project_root);
    }

    let mut state = McpServerState::new()?;
    state.project_root = Some(project_root.clone());
    if let Err(e) = state.load_project(project_root) {
        return Err(e);
    } else if debug {
        eprintln!("[firv-mcp] project loaded successfully");
    }

    let stdin = io::stdin();
    let mut reader = io::BufReader::new(stdin.lock());
    let mut stdout = io::stdout();

    loop {
        let body = match read_mcp_message(&mut reader) {
            Ok(Some(b)) => b,
            Ok(None) => break, // EOF
            Err(e) => {
                if debug {
                    eprintln!("[firv-mcp] read error: {}", e);
                }
                break;
            }
        };

        if body.trim().is_empty() {
            continue;
        }

        if debug {
            eprintln!("[firv-mcp] recv: {}", body);
        }

        let response = handle_message(&body, &mut state);
        if let Some(resp) = response {
            let json = serde_json::to_string(&resp)
                .unwrap_or_else(|_| r#"{"jsonrpc":"2.0","error":{"code":-32603,"message":"Internal error"}}"#.to_string());

            if debug {
                eprintln!("[firv-mcp] send: {}", json);
            }

            write_mcp_message(&mut stdout, &json).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

fn read_mcp_message(reader: &mut impl BufRead) -> Result<Option<String>, String> {
    loop {
        let buf = reader.fill_buf().map_err(|e| e.to_string())?;
        if buf.is_empty() {
            return Ok(None); // EOF
        }

        // Skip leading whitespace/newlines between messages
        if buf[0] == b'\n' || buf[0] == b'\r' {
            reader.consume(1);
            continue;
        }

        // Detect format: Content-Length header vs bare JSON
        if buf[0] == b'{' {
            // Newline-delimited JSON
            let mut line = String::new();
            let bytes_read = reader.read_line(&mut line).map_err(|e| e.to_string())?;
            if bytes_read == 0 {
                return Ok(None);
            }
            return Ok(Some(line));
        } else {
            // Content-Length framed
            let mut content_length: Option<usize> = None;
            loop {
                let mut header_line = String::new();
                let bytes_read = reader.read_line(&mut header_line).map_err(|e| e.to_string())?;
                if bytes_read == 0 {
                    return Ok(None);
                }
                let trimmed = header_line.trim();
                if trimmed.is_empty() {
                    break;
                }
                if let Some(value) = trimmed.strip_prefix("Content-Length:") {
                    content_length = Some(
                        value.trim().parse::<usize>().map_err(|e| format!("Invalid Content-Length: {}", e))?,
                    );
                }
            }
            let length = content_length.ok_or_else(|| "Missing Content-Length header".to_string())?;
            let mut body = vec![0u8; length];
            reader.read_exact(&mut body).map_err(|e| e.to_string())?;
            return String::from_utf8(body).map(Some).map_err(|e| e.to_string());
        }
    }
}

fn write_mcp_message(writer: &mut impl Write, json: &str) -> io::Result<()> {
    writeln!(writer, "{}", json)?;
    writer.flush()
}

fn handle_message(line: &str, state: &mut McpServerState) -> Option<JsonRpcResponse> {
    let req: JsonRpcRequest = match serde_json::from_str(line) {
        Ok(r) => r,
        Err(e) => {
            return Some(error_response(None, -32700, format!("Parse error: {}", e)));
        }
    };

    let is_notification = req.id.is_none();

    let result = match req.method.as_str() {
        "initialize" => initialize(&req.params, state),
        "notifications/initialized" => {
            return None;
        }
        "tools/list" => tools_list(),
        "tools/call" => tools_call(&req.params, state),
        "resources/list" => resources_list(state),
        "resources/read" => resources_read(&req.params, state),
        _ => Err(format!("Method not found: {}", req.method)),
    };

    if is_notification {
        return None;
    }

    Some(match result {
        Ok(value) => JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: req.id,
            result: Some(value),
            error: None,
        },
        Err(message) => error_response(req.id, -32602, message),
    })
}

fn error_response(id: Option<Value>, code: i32, message: String) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0".to_string(),
        id,
        result: None,
        error: Some(JsonRpcError { code, message, data: None }),
    }
}

fn initialize(params: &Value, state: &McpServerState) -> Result<Value, String> {
    let protocol_version = params
        .get("protocolVersion")
        .and_then(|v| v.as_str())
        .unwrap_or("2024-11-05");

    let mut result = json!({
        "protocolVersion": protocol_version,
        "capabilities": {
            "tools": {},
            "resources": {}
        },
        "serverInfo": {
            "name": "firv",
            "version": env!("CARGO_PKG_VERSION")
        }
    });

    if let Some(err) = &state.startup_error {
        result["startup_error"] = json!(err);
    }

    Ok(result)
}

fn tools_list() -> Result<Value, String> {
    Ok(crate::mcp_tools::tools_schema())
}

fn tools_call(params: &Value, state: &mut McpServerState) -> Result<Value, String> {
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or("Missing tool name")?;
    let arguments = params.get("arguments").cloned().unwrap_or(Value::Null);
    match handle_tool_call(name, arguments, state) {
        Ok(value) => {
            let text = serde_json::to_string_pretty(&value).unwrap_or_default();
            Ok(json!({
                "content": [
                    { "type": "text", "text": text }
                ]
            }))
        }
        Err(e) => {
            Ok(json!({
                "content": [
                    { "type": "text", "text": e }
                ],
                "isError": true
            }))
        }
    }
}

fn resources_list(state: &McpServerState) -> Result<Value, String> {
    let mut resources = vec![
        json!({
            "uri": "manifest://firv.yaml",
            "name": "Project Manifest",
            "mimeType": "text/yaml"
        }),
        json!({
            "uri": "scratchpad://requests",
            "name": "Scratchpad Requests",
            "mimeType": "application/json"
        }),
    ];

    if let Some(project_root) = state.project_root.as_ref() {
        let requests_dir = std::path::Path::new(project_root).join("requests");
        if let Ok(entries) = std::fs::read_dir(requests_dir) {
            for entry in entries.flatten() {
                if let Some(stem) = entry.path().file_stem().and_then(|s| s.to_str()) {
                    resources.push(json!({
                        "uri": format!("request://{}", stem),
                        "name": format!("Request: {}", stem),
                        "mimeType": "text/yaml"
                    }));
                }
            }
        }
    }

    Ok(json!({ "resources": resources }))
}

fn resources_read(params: &Value, state: &McpServerState) -> Result<Value, String> {
    let uri = params
        .get("uri")
        .and_then(|v| v.as_str())
        .ok_or("Missing uri")?;

    let contents = match uri {
        "manifest://firv.yaml" => {
            let manifest = state.manifest.as_ref().ok_or("No project loaded")?;
            let yaml = serde_yaml::to_string(manifest).map_err(|e| e.to_string())?;
            vec![json!({ "uri": uri, "mimeType": "text/yaml", "text": yaml })]
        }
        "scratchpad://requests" => {
            let requests: Vec<&crate::models::request::FirvRequest> = state.scratchpad.list();
            let text = serde_json::to_string_pretty(&requests).map_err(|e| e.to_string())?;
            vec![json!({ "uri": uri, "mimeType": "application/json", "text": text })]
        }
        _ if uri.starts_with("request://") => {
            let id = uri.trim_start_matches("request://");
            let project_root = state.project_root.as_ref().ok_or("No project loaded")?;
            let content = storage::get_request(project_root.clone(), id.to_string())?;
            let yaml = serde_yaml::to_string(&content).map_err(|e| e.to_string())?;
            vec![json!({ "uri": uri, "mimeType": "text/yaml", "text": yaml })]
        }
        _ => return Err(format!("Unknown resource uri: {}", uri)),
    };

    Ok(json!({ "contents": contents }))
}

#[cfg(test)]
mod tests {
    use super::*;

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
"#;
        std::fs::write(dir.path().join("requests").join("hello.yaml"), request_content).expect("write request");

        (dir, root)
    }

    fn assert_no_error(response: &JsonRpcResponse) {
        if let Some(err) = &response.error {
            panic!("Unexpected error: {}", err.message);
        }
    }

    fn tool_result(response: &JsonRpcResponse) -> Value {
        let result = response.result.as_ref().expect("missing result");
        let text = result["content"][0]["text"].as_str().expect("missing content text");
        serde_json::from_str(text).expect("content text is not valid JSON")
    }

    fn message(method: &str, params: Value) -> String {
        serde_json::to_string(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        }))
        .unwrap()
    }

    #[test]
    fn initialize_returns_server_info() {
        let mut state = McpServerState::new().expect("state");
        let response = handle_message(
            &message("initialize", json!({"protocolVersion": "2024-11-05"})),
            &mut state,
        )
        .expect("response");

        assert_eq!(response.id, Some(json!(1)));
        assert!(response.error.is_none());
        assert_eq!(response.result.as_ref().unwrap()["serverInfo"]["name"], "firv");
    }

    #[test]
    fn initialize_reports_startup_error() {
        let mut state = McpServerState::new().expect("state");
        state.startup_error = Some("missing firv.yaml".to_string());
        let response = handle_message(
            &message("initialize", json!({"protocolVersion": "2024-11-05"})),
            &mut state,
        )
        .expect("response");

        assert_eq!(response.id, Some(json!(1)));
        assert!(response.error.is_none());
        assert_eq!(
            response.result.as_ref().unwrap()["startup_error"],
            "missing firv.yaml"
        );
    }

    #[test]
    fn load_project_and_list_requests() {
        let (_dir, root) = temp_project();
        let mut state = McpServerState::new().expect("state");

        let load_response = handle_message(
            &message(
                "tools/call",
                json!({
                    "name": "load_project",
                    "arguments": {"project_root": root}
                }),
            ),
            &mut state,
        )
        .expect("load response");
        assert_no_error(&load_response);

        let list_response = handle_message(&message("tools/call", json!({"name": "list_requests", "arguments": {}})), &mut state)
            .expect("list response");
        assert_no_error(&list_response);

        let inner = tool_result(&list_response);
        let requests = inner["requests"].as_array().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0]["id"], "hello");
    }

    #[test]
    fn scratchpad_create_and_list() {
        let mut state = McpServerState::new().expect("state");

        let create_response = handle_message(
            &message(
                "tools/call",
                json!({
                    "name": "create_scratchpad_request",
                    "arguments": {
                        "name": "Ping",
                        "method": "GET",
                        "url": "https://example.com/ping"
                    }
                }),
            ),
            &mut state,
        )
        .expect("create response");
        assert_no_error(&create_response);

        let inner = tool_result(&create_response);
        let id = inner["id"].as_str().unwrap();
        assert!(!id.is_empty());

        let list_response = handle_message(
            &message(
                "tools/call",
                json!({"name": "list_scratchpad_requests", "arguments": {}}),
            ),
            &mut state,
        )
        .expect("list response");
        assert_no_error(&list_response);
        let inner = tool_result(&list_response);
        let requests = inner["requests"].as_array().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0]["name"], "Ping");
    }

    #[test]
    fn resources_list_includes_manifest_and_scratchpad() {
        let mut state = McpServerState::new().expect("state");
        let response = handle_message(&message("resources/list", json!({})), &mut state)
            .expect("resources response");
        assert!(response.error.is_none());

        let resources = response.result.as_ref().unwrap()["resources"].as_array().unwrap();
        let uris: Vec<&str> = resources
            .iter()
            .map(|r| r["uri"].as_str().unwrap())
            .collect();
        assert!(uris.contains(&"manifest://firv.yaml"));
        assert!(uris.contains(&"scratchpad://requests"));
    }
}
