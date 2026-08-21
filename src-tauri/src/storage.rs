use crate::models::request::{KeyValue, RequestVariable};
use crate::models::{
    manifest::{FirvManifest, SidebarItem, Workspace},
    FirvFlow, FirvRequest, GrpcRequest, WsRequest,
};
use crate::secrets;
use serde::Serialize;
use std::path::{Path, PathBuf};

pub fn save_atomic<T: Serialize>(path: PathBuf, data: &T) -> Result<(), String> {
    // 1. Serialize to string
    let mut yaml_string =
        serde_yaml::to_string(data).map_err(|e| format!("Serialization failed: {}", e))?;

    // Enforce LF line endings
    yaml_string = yaml_string.replace("\r\n", "\n");

    // Check permissions before writing
    if path.exists() {
        if let Ok(metadata) = std::fs::metadata(&path) {
            if metadata.permissions().readonly() {
                return Err("File is read-only. Please check Git lock state.".to_string());
            }
        }
    }

    // 2. Create temp file
    let temp_path = path.with_extension("yaml.tmp");

    // 3. Write and sync
    std::fs::write(&temp_path, yaml_string)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    // 4. Atomic Rename
    std::fs::rename(&temp_path, &path).map_err(|e| format!("Atomic swap failed: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn get_request(workspace_root: String, id: String) -> Result<FirvRequest, String> {
    let target_path = Path::new(&workspace_root)
        .join("requests")
        .join(format!("{}.yaml", id));
    let content = std::fs::read_to_string(&target_path)
        .map_err(|e| format!("Failed to read request {}: {}", id, e))?;
    serde_yaml::from_str(&content).map_err(|e| format!("Failed to parse request {}: {}", id, e))
}

#[tauri::command]
pub fn update_request(workspace_root: String, request: FirvRequest) -> Result<(), String> {
    if request.id.is_empty() {
        return Err("Validation failed: Request is missing an ID".to_string());
    }

    let root_path = Path::new(&workspace_root);
    let requests_dir = root_path.join("requests");

    if !requests_dir.exists() {
        std::fs::create_dir_all(&requests_dir)
            .map_err(|e| format!("Failed to create requests directory: {}", e))?;
    }

    let target_path = requests_dir.join(format!("{}.yaml", request.id));
    save_atomic(target_path, &request)
}

#[tauri::command]
pub fn delete_request(workspace_root: String, id: String) -> Result<(), String> {
    let target_path = Path::new(&workspace_root)
        .join("requests")
        .join(format!("{}.yaml", id));

    if target_path.exists() {
        std::fs::remove_file(target_path)
            .map_err(|e| format!("Failed to delete request file {}: {}", id, e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn get_flow(workspace_root: String, id: String) -> Result<FirvFlow, String> {
    let target_path = Path::new(&workspace_root)
        .join("flows")
        .join(format!("{}.yaml", id));
    let content = std::fs::read_to_string(&target_path)
        .map_err(|e| format!("Failed to read flow {}: {}", id, e))?;
    serde_yaml::from_str(&content).map_err(|e| format!("Failed to parse flow {}: {}", id, e))
}

#[tauri::command]
pub fn update_flow(workspace_root: String, flow: FirvFlow) -> Result<(), String> {
    if flow.id.is_empty() {
        return Err("Validation failed: Flow is missing an ID".to_string());
    }

    let root_path = Path::new(&workspace_root);
    let flows_dir = root_path.join("flows");

    if !flows_dir.exists() {
        std::fs::create_dir_all(&flows_dir)
            .map_err(|e| format!("Failed to create flows directory: {}", e))?;
    }

    let target_path = flows_dir.join(format!("{}.yaml", flow.id));
    save_atomic(target_path, &flow)
}

#[tauri::command]
pub fn delete_flow(workspace_root: String, id: String) -> Result<(), String> {
    let target_path = Path::new(&workspace_root)
        .join("flows")
        .join(format!("{}.yaml", id));

    if target_path.exists() {
        std::fs::remove_file(target_path)
            .map_err(|e| format!("Failed to delete flow file {}: {}", id, e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn update_manifest_structure(
    workspace_root: String,
    workspace: Workspace,
    name: Option<String>,
) -> Result<(), String> {
    let manifest_path = Path::new(&workspace_root).join("firv.yaml");

    let content = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read existing manifest: {}", e))?;

    let mut manifest: FirvManifest = serde_yaml::from_str(&content)
        .map_err(|e| format!("Failed to parse existing manifest: {}", e))?;

    manifest.workspace = workspace;
    if let Some(n) = name {
        manifest.name = n;
    }
    manifest.ensure_workspace_id();

    save_atomic(manifest_path, &manifest)
}

/// Collects the distinct secret ids referenced by a set of `KeyValue` rows.
fn collect_secret_refs(variables: &[KeyValue], ids: &mut Vec<String>) {
    for variable in variables {
        if let Some(id) = variable.secret_ref.as_ref().filter(|s| !s.is_empty()) {
            if !ids.contains(id) {
                ids.push(id.clone());
            }
        }
    }
}

/// Collects the distinct secret ids referenced by a set of `RequestVariable` rows.
fn collect_request_variable_secret_refs(variables: &[RequestVariable], ids: &mut Vec<String>) {
    for variable in variables {
        if let Some(id) = variable.secret_ref.as_ref().filter(|s| !s.is_empty()) {
            if !ids.contains(id) {
                ids.push(id.clone());
            }
        }
    }
}

/// Collects every secret id referenced anywhere in a workspace's globals,
/// environment variables, and request headers/formdata/request-variable fields.
fn collect_referenced_secret_ids(workspace: &Workspace, requests: &[FirvRequest]) -> Vec<String> {
    let mut ids = Vec::new();
    collect_secret_refs(&workspace.globals, &mut ids);
    for environment in &workspace.environments {
        collect_secret_refs(&environment.variables, &mut ids);
    }
    for request in requests {
        collect_secret_refs(&request.headers, &mut ids);
        collect_request_variable_secret_refs(&request.transforms.request_variables, &mut ids);
        if let crate::models::request::RequestBody::Formdata(fields) = &request.body {
            collect_secret_refs(fields, &mut ids);
        }
    }
    ids
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ExportedWorkspace {
    version: String,
    name: String,
    workspace: Workspace,
    requests: Vec<FirvRequest>,
    /// Present only when the export was created with `include_secrets: true`.
    /// Contains only the secrets actually referenced by this workspace's
    /// globals/environments/requests, not the entire local secret store.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    secrets: Option<secrets::WorkspaceSecrets>,
}

fn collect_request_ids(items: &[SidebarItem], request_ids: &mut Vec<String>) {
    for item in items {
        match item {
            SidebarItem::Folder { items, .. } => collect_request_ids(items, request_ids),
            SidebarItem::Request { id, .. } => request_ids.push(id.clone()),
            SidebarItem::Ws { .. } => {}
            SidebarItem::Flow { .. } => {}
            SidebarItem::Grpc { .. } => {}
        }
    }
}

#[tauri::command]
pub fn export_workspace(
    workspace_root: String,
    output_path: String,
    include_secrets: Option<bool>,
) -> Result<(), String> {
    let manifest_path = Path::new(&workspace_root).join("firv.yaml");
    let manifest_content = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read manifest: {}", e))?;
    let manifest: FirvManifest = serde_yaml::from_str(&manifest_content)
        .map_err(|e| format!("Failed to parse manifest: {}", e))?;

    let mut request_ids = Vec::new();
    collect_request_ids(&manifest.workspace.order, &mut request_ids);

    let mut requests = Vec::new();
    for id in request_ids {
        let request = get_request(workspace_root.clone(), id)?;
        requests.push(request);
    }

    // Secrets are excluded by default: an export is often shared/committed, and
    // silently embedding plaintext secret values in it would be a data leak.
    let secrets = if include_secrets.unwrap_or(false) {
        let ids = collect_referenced_secret_ids(&manifest.workspace, &requests);
        Some(secrets::export_secrets(&manifest.workspace_id, &ids)?)
    } else {
        None
    };

    let exported = ExportedWorkspace {
        version: manifest.version,
        name: manifest.name,
        workspace: manifest.workspace,
        requests,
        secrets,
    };

    save_atomic(PathBuf::from(output_path), &exported)
}

#[tauri::command]
pub fn import_firv_export(workspace_root: String, input_path: String) -> Result<(), String> {
    let content = std::fs::read_to_string(&input_path)
        .map_err(|e| format!("Failed to read export file: {}", e))?;
    let exported: ExportedWorkspace = serde_yaml::from_str(&content)
        .map_err(|e| format!("Failed to parse export file: {}", e))?;

    for request in exported.requests {
        update_request(workspace_root.clone(), request)?;
    }

    let mut manifest = FirvManifest {
        version: exported.version,
        name: exported.name,
        workspace: exported.workspace,
        workspace_id: String::new(),
    };
    // Always mint a fresh workspace id on import so this workspace's secrets are
    // namespaced independently of wherever the export originally came from.
    manifest.ensure_workspace_id();

    if let Some(secret_values) = exported.secrets {
        secrets::import_secrets(&manifest.workspace_id, &secret_values)?;
    }

    let manifest_path = Path::new(&workspace_root).join("firv.yaml");
    save_atomic(manifest_path, &manifest)
}

#[tauri::command]
pub fn get_ws_request(workspace_root: String, id: String) -> Result<WsRequest, String> {
    let target_path = Path::new(&workspace_root)
        .join("requests")
        .join(format!("{}.yaml", id));
    let content = std::fs::read_to_string(&target_path)
        .map_err(|e| format!("Failed to read ws request {}: {}", id, e))?;
    serde_yaml::from_str(&content).map_err(|e| format!("Failed to parse ws request {}: {}", id, e))
}

#[tauri::command]
pub fn update_ws_request(workspace_root: String, request: WsRequest) -> Result<(), String> {
    if request.id.is_empty() {
        return Err("Validation failed: WsRequest is missing an ID".to_string());
    }

    let root_path = Path::new(&workspace_root);
    let requests_dir = root_path.join("requests");

    if !requests_dir.exists() {
        std::fs::create_dir_all(&requests_dir)
            .map_err(|e| format!("Failed to create requests directory: {}", e))?;
    }

    let target_path = requests_dir.join(format!("{}.yaml", request.id));
    save_atomic(target_path, &request)
}

#[tauri::command]
pub fn get_grpc_request(workspace_root: String, id: String) -> Result<GrpcRequest, String> {
    let target_path = Path::new(&workspace_root)
        .join("requests")
        .join(format!("{}.yaml", id));
    let content = std::fs::read_to_string(&target_path)
        .map_err(|e| format!("Failed to read grpc request {}: {}", id, e))?;
    serde_yaml::from_str(&content)
        .map_err(|e| format!("Failed to parse grpc request {}: {}", id, e))
}

#[tauri::command]
pub fn update_grpc_request(workspace_root: String, request: GrpcRequest) -> Result<(), String> {
    if request.id.is_empty() {
        return Err("Validation failed: GrpcRequest is missing an ID".to_string());
    }

    let root_path = Path::new(&workspace_root);
    let requests_dir = root_path.join("requests");

    if !requests_dir.exists() {
        std::fs::create_dir_all(&requests_dir)
            .map_err(|e| format!("Failed to create requests directory: {}", e))?;
    }

    let target_path = requests_dir.join(format!("{}.yaml", request.id));
    save_atomic(target_path, &request)
}

#[tauri::command]
pub fn check_workspace_exists(workspace_root: String) -> bool {
    Path::new(&workspace_root).join("firv.yaml").exists()
}

#[tauri::command]
pub fn create_workspace(workspace_root: String, name: String) -> Result<(), String> {
    let root_path = Path::new(&workspace_root);
    let manifest_path = root_path.join("firv.yaml");

    if manifest_path.exists() {
        return Err("Workspace already exists in this location".to_string());
    }

    if !root_path.exists() {
        std::fs::create_dir_all(&root_path)
            .map_err(|e| format!("Failed to create workspace directory: {}", e))?;
    }

    let mut manifest = FirvManifest {
        version: "1.0".to_string(),
        name,
        workspace: Workspace {
            order: vec![],
            globals: vec![],
            environments: vec![],
            active_environment: None,
        },
        workspace_id: String::new(),
    };
    manifest.ensure_workspace_id();

    save_atomic(manifest_path, &manifest)
}
