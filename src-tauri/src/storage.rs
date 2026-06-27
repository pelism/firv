use crate::models::{manifest::{FirvManifest, SidebarItem, Workspace}, FirvRequest, WsRequest};
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
pub fn get_request(project_root: String, id: String) -> Result<FirvRequest, String> {
    let target_path = Path::new(&project_root).join("requests").join(format!("{}.yaml", id));
    let content = std::fs::read_to_string(&target_path)
        .map_err(|e| format!("Failed to read request {}: {}", id, e))?;
    serde_yaml::from_str(&content)
        .map_err(|e| format!("Failed to parse request {}: {}", id, e))
}

#[tauri::command]
pub fn update_request(project_root: String, request: FirvRequest) -> Result<(), String> {
    if request.id.is_empty() {
        return Err("Validation failed: Request is missing an ID".to_string());
    }

    let root_path = Path::new(&project_root);
    let requests_dir = root_path.join("requests");

    if !requests_dir.exists() {
        std::fs::create_dir_all(&requests_dir)
            .map_err(|e| format!("Failed to create requests directory: {}", e))?;
    }

    let target_path = requests_dir.join(format!("{}.yaml", request.id));
    save_atomic(target_path, &request)
}

#[tauri::command]
pub fn delete_request(project_root: String, id: String) -> Result<(), String> {
    let target_path = Path::new(&project_root)
        .join("requests")
        .join(format!("{}.yaml", id));

    if target_path.exists() {
        std::fs::remove_file(target_path)
            .map_err(|e| format!("Failed to delete request file {}: {}", id, e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn update_manifest_structure(project_root: String, workspace: Workspace, name: Option<String>) -> Result<(), String> {
    let manifest_path = Path::new(&project_root).join("firv.yaml");

    let content = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read existing manifest: {}", e))?;

    let mut manifest: FirvManifest = serde_yaml::from_str(&content)
        .map_err(|e| format!("Failed to parse existing manifest: {}", e))?;

    manifest.workspace = workspace;
    if let Some(n) = name {
        manifest.name = n;
    }

    save_atomic(manifest_path, &manifest)
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ExportedWorkspace {
    version: String,
    name: String,
    workspace: Workspace,
    requests: Vec<FirvRequest>,
}

fn collect_request_ids(items: &[SidebarItem], request_ids: &mut Vec<String>) {
    for item in items {
        match item {
            SidebarItem::Folder { items, .. } => collect_request_ids(items, request_ids),
            SidebarItem::Request { id, .. } => request_ids.push(id.clone()),
            SidebarItem::Ws { .. } => {}
        }
    }
}

#[tauri::command]
pub fn export_workspace(project_root: String, output_path: String) -> Result<(), String> {
    let manifest_path = Path::new(&project_root).join("firv.yaml");
    let manifest_content = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read manifest: {}", e))?;
    let manifest: FirvManifest = serde_yaml::from_str(&manifest_content)
        .map_err(|e| format!("Failed to parse manifest: {}", e))?;

    let mut request_ids = Vec::new();
    collect_request_ids(&manifest.workspace.order, &mut request_ids);

    let mut requests = Vec::new();
    for id in request_ids {
        let request = get_request(project_root.clone(), id)?;
        requests.push(request);
    }

    let exported = ExportedWorkspace {
        version: manifest.version,
        name: manifest.name,
        workspace: manifest.workspace,
        requests,
    };

    save_atomic(PathBuf::from(output_path), &exported)
}

#[tauri::command]
pub fn import_firv_export(project_root: String, input_path: String) -> Result<(), String> {
    let content = std::fs::read_to_string(&input_path)
        .map_err(|e| format!("Failed to read export file: {}", e))?;
    let exported: ExportedWorkspace = serde_yaml::from_str(&content)
        .map_err(|e| format!("Failed to parse export file: {}", e))?;

    for request in exported.requests {
        update_request(project_root.clone(), request)?;
    }

    let manifest = FirvManifest {
        version: exported.version,
        name: exported.name,
        workspace: exported.workspace,
    };

    let manifest_path = Path::new(&project_root).join("firv.yaml");
    save_atomic(manifest_path, &manifest)
}

#[tauri::command]
pub fn get_ws_request(project_root: String, id: String) -> Result<WsRequest, String> {
    let target_path = Path::new(&project_root).join("requests").join(format!("{}.yaml", id));
    let content = std::fs::read_to_string(&target_path)
        .map_err(|e| format!("Failed to read ws request {}: {}", id, e))?;
    serde_yaml::from_str(&content)
        .map_err(|e| format!("Failed to parse ws request {}: {}", id, e))
}

#[tauri::command]
pub fn update_ws_request(project_root: String, request: WsRequest) -> Result<(), String> {
    if request.id.is_empty() {
        return Err("Validation failed: WsRequest is missing an ID".to_string());
    }

    let root_path = Path::new(&project_root);
    let requests_dir = root_path.join("requests");

    if !requests_dir.exists() {
        std::fs::create_dir_all(&requests_dir)
            .map_err(|e| format!("Failed to create requests directory: {}", e))?;
    }

    let target_path = requests_dir.join(format!("{}.yaml", request.id));
    save_atomic(target_path, &request)
}

#[tauri::command]
pub fn check_workspace_exists(project_root: String) -> bool {
    Path::new(&project_root).join("firv.yaml").exists()
}

#[tauri::command]
pub fn create_workspace(project_root: String, name: String) -> Result<(), String> {
    let root_path = Path::new(&project_root);
    let manifest_path = root_path.join("firv.yaml");

    if manifest_path.exists() {
        return Err("Workspace already exists in this location".to_string());
    }

    if !root_path.exists() {
        std::fs::create_dir_all(&root_path)
            .map_err(|e| format!("Failed to create project directory: {}", e))?;
    }

    let manifest = FirvManifest {
        version: "1.0".to_string(),
        name,
        workspace: Workspace {
            order: vec![],
            globals: vec![],
            environments: vec![],
            active_environment: None,
        },
    };

    save_atomic(manifest_path, &manifest)
}
