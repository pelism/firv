// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod hydration;
mod lifecycle;
mod models;
mod runner;
mod storage;

pub mod variables;
mod watcher;

use models::FirvManifest;
use serde::{Deserialize, Serialize};
use tauri::{Manager, PhysicalPosition, PhysicalSize, WindowEvent};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WindowState {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    maximized: bool,
}

fn window_state_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let mut path = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to resolve app config directory: {}", e))?;
    path.push("window-state.json");
    Ok(path)
}

fn load_window_state(app: &tauri::AppHandle) -> Option<WindowState> {
    let path = window_state_path(app).ok()?;
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn save_window_state(app: &tauri::AppHandle, state: &WindowState) -> Result<(), String> {
    let path = window_state_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create window state directory: {}", e))?;
    }

    let content = serde_json::to_string(state)
        .map_err(|e| format!("Failed to serialize window state: {}", e))?;
    std::fs::write(path, content)
        .map_err(|e| format!("Failed to write window state: {}", e))
}

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
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                if let Some(state) = load_window_state(app.handle()) {
                    if state.maximized {
                        let _ = window.maximize();
                    } else {
                        let _ = window.set_size(PhysicalSize::new(state.width, state.height));
                        let _ = window.set_position(PhysicalPosition::new(state.x, state.y));
                    }
                }

                let app_handle = app.handle().clone();
                let window_for_events = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { .. } = event {
                        if let Ok(maximized) = window_for_events.is_maximized() {
                            let state = if maximized {
                                let size = window_for_events.inner_size().ok();
                                let position = window_for_events.outer_position().ok();
                                WindowState {
                                    width: size.map(|s| s.width).unwrap_or(800),
                                    height: size.map(|s| s.height).unwrap_or(600),
                                    x: position.map(|p| p.x).unwrap_or(100),
                                    y: position.map(|p| p.y).unwrap_or(100),
                                    maximized: true,
                                }
                            } else {
                                let size = window_for_events.inner_size().ok();
                                let position = window_for_events.outer_position().ok();
                                WindowState {
                                    width: size.map(|s| s.width).unwrap_or(800),
                                    height: size.map(|s| s.height).unwrap_or(600),
                                    x: position.map(|p| p.x).unwrap_or(100),
                                    y: position.map(|p| p.y).unwrap_or(100),
                                    maximized: false,
                                }
                            };

                            if let Err(err) = save_window_state(&app_handle, &state) {
                                eprintln!("{}", err);
                            }
                        }
                    }
                });
            }

            Ok(())
        })
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
