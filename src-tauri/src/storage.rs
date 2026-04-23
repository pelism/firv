use crate::models::{manifest::Workspace, FirvManifest, FirvRequest};
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
pub fn update_manifest_structure(project_root: String, workspace: Workspace) -> Result<(), String> {
    let manifest_path = Path::new(&project_root).join("firv.yaml");

    let content = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read existing manifest: {}", e))?;

    let mut manifest: FirvManifest = serde_yaml::from_str(&content)
        .map_err(|e| format!("Failed to parse existing manifest: {}", e))?;

    manifest.workspace = workspace;

    save_atomic(manifest_path, &manifest)
}
