// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod hydration;
mod lifecycle;
mod models;
mod runner;
pub mod scripting;
mod storage;
pub mod variables;
mod watcher;

use models::FirvManifest;
use std::sync::Mutex;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn get_hydrated_sidebar(project_path: String) -> Result<hydration::HydratedTree, String> {
    let path = std::path::PathBuf::from(project_path);
    hydration::hydrate_manifest(&path).await
}

#[tauri::command]
fn get_manifest(project_path: String) -> Result<FirvManifest, String> {
    let path = std::path::PathBuf::from(&project_path).join("firv.yaml");
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read manifest at {}: {}", path.display(), e))?;
    serde_yaml::from_str(&content)
        .map_err(|e| format!("Failed to parse manifest at {}: {}", path.display(), e))
}

#[tauri::command]
fn load_project(path: String) -> Result<FirvManifest, String> {
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;

    let manifest: FirvManifest = serde_yaml::from_str(&content).map_err(|e| e.to_string())?;

    Ok(manifest)
}

#[tauri::command]
async fn execute_request(
    request: models::FirvRequest,
    resolver: Option<variables::VariableResolver>,
) -> Result<runner::FirvResponse, String> {
    runner::run_request(request, resolver.unwrap_or_default()).await
}

#[tauri::command]
fn start_project_watcher(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path_buf = std::path::PathBuf::from(path);
    watcher::start_watching(app, path_buf)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(watcher::WatcherHandle(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            greet,
            get_manifest,
            load_project,
            execute_request,
            lifecycle::run_firv_request,
            start_project_watcher,
            get_hydrated_sidebar,
            storage::get_request,
            storage::update_request,
            storage::delete_request,
            storage::update_manifest_structure,
            storage::create_workspace,
            storage::check_workspace_exists
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
