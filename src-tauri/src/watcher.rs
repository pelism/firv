use notify::{
    event::{CreateKind, ModifyKind, RemoveKind},
    EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

pub struct WatcherHandle(pub Mutex<Option<RecommendedWatcher>>);

#[derive(Clone, Serialize, Deserialize)]
pub struct FileChangedPayload {
    pub path: String,
    pub event_type: String,
}

pub fn start_watching(app_handle: AppHandle, base_path: PathBuf) -> Result<(), String> {
    let base_path_clone = base_path.clone();
    let app_handle_clone = app_handle.clone();

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        match res {
            Ok(event) => {
                let event_type =
                    match event.kind {
                        EventKind::Create(CreateKind::File)
                        | EventKind::Create(CreateKind::Any) => "create",
                        EventKind::Modify(ModifyKind::Data(_))
                        | EventKind::Modify(ModifyKind::Name(_))
                        | EventKind::Modify(ModifyKind::Any) => "modify",
                        EventKind::Remove(RemoveKind::File)
                        | EventKind::Remove(RemoveKind::Any) => "remove",
                        _ => return,
                    };

                for path in event.paths {
                    if is_valid_file(&path) {
                        let rel_path = path
                            .strip_prefix(&base_path_clone)
                            .unwrap_or(&path)
                            .to_string_lossy()
                            .to_string();

                        // Use standard separator
                        let rel_path = rel_path.replace("\\", "/");

                        let payload = FileChangedPayload {
                            path: rel_path,
                            event_type: event_type.to_string(),
                        };

                        let _ = app_handle_clone.emit("firv://file-changed", payload);
                    }
                }
            }
            Err(e) => println!("Watch error: {:?}", e),
        }
    })
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    watcher
        .watch(&base_path, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch directory: {}", e))?;

    let state = app_handle.state::<WatcherHandle>();
    let mut watcher_state = state.0.lock().map_err(|_| "Failed to lock watcher state")?;
    *watcher_state = Some(watcher);

    Ok(())
}

fn is_valid_file(path: &Path) -> bool {
    let components: Vec<_> = path.components().collect();
    for comp in components {
        let s = comp.as_os_str().to_string_lossy();
        if s.starts_with('.') || s == "node_modules" {
            return false;
        }
    }

    if let Some(ext) = path.extension() {
        let ext_str = ext.to_string_lossy().to_lowercase();
        if ext_str == "yaml" || ext_str == "yml" {
            return true;
        }
    }

    false
}
