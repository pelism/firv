use crate::models::{
    manifest::{FirvManifest, SidebarItem},
    request::FirvRequest,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tokio::fs;

#[derive(Debug, Serialize, Deserialize)]
pub struct HydratedSidebarItem {
    pub name: String,
    pub kind: SidebarKind,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum SidebarKind {
    Folder { items: Vec<HydratedSidebarItem> },
    Request { id: String, method: String },
    Error { id: String, message: String },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HydratedTree {
    pub items: Vec<HydratedSidebarItem>,
    pub orphans: Vec<String>, // List of file names/paths that are orphans
}

pub async fn hydrate_manifest(project_path: &Path) -> Result<HydratedTree, String> {
    let manifest_path = project_path.join("firv.yaml");
    let content = fs::read_to_string(&manifest_path)
        .await
        .map_err(|e| format!("Failed to read firv.yaml: {}", e))?;

    let manifest: FirvManifest =
        serde_yaml::from_str(&content).map_err(|e| format!("Failed to parse firv.yaml: {}", e))?;

    let requests_dir = project_path.join("requests");

    // Pass a mutable HashSet to collect found IDs during traversal
    let mut found_ids = HashSet::new();

    let mut hydrated_items = Vec::new();
    for item in manifest.workspace.order {
        hydrated_items.push(hydrate_item(item, &requests_dir, &mut found_ids).await);
    }

    // Scan for orphans
    let mut orphans = Vec::new();
    if requests_dir.exists() && requests_dir.is_dir() {
        if let Ok(mut entries) = fs::read_dir(&requests_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("yaml") {
                    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                        if !found_ids.contains(stem) {
                            orphans.push(stem.to_string());
                        }
                    }
                }
            }
        }
    }

    Ok(HydratedTree {
        items: hydrated_items,
        orphans,
    })
}

#[async_recursion::async_recursion]
async fn hydrate_item(
    item: SidebarItem,
    requests_dir: &PathBuf,
    found_ids: &mut HashSet<String>,
) -> HydratedSidebarItem {
    match item {
        SidebarItem::Folder {
            name,
            items,
            scripts: _,
        } => {
            let mut hydrated_children = Vec::new();
            for child in items {
                hydrated_children.push(hydrate_item(child, requests_dir, found_ids).await);
            }
            HydratedSidebarItem {
                name,
                kind: SidebarKind::Folder {
                    items: hydrated_children,
                },
            }
        }
        SidebarItem::Request { id, name } => {
            found_ids.insert(id.clone());
            let request_file = requests_dir.join(format!("{}.yaml", id));

            if !request_file.exists() {
                return HydratedSidebarItem {
                    name,
                    kind: SidebarKind::Error {
                        id,
                        message: "File missing".to_string(),
                    },
                };
            }

            match fs::read_to_string(&request_file).await {
                Ok(content) => {
                    match serde_yaml::from_str::<FirvRequest>(&content) {
                        Ok(req) => {
                            let method_str = format!("{:?}", req.method); // Will be "GET", "POST", etc.
                            HydratedSidebarItem {
                                name, // Using the name from manifest or from file? Spec says: "Extract the Method and Display Name. The engine must replace request IDs with their actual metadata".
                                // Actually, spec says: `pub name: String` and `id: String, method: String`.
                                // We can use the name from manifest or override it. Manifest has `name`. Let's stick with manifest name if available, or request name.
                                // The spec: "Take the id from the manifest. Deserialize the request file to extract the Method and Display Name."
                                kind: SidebarKind::Request {
                                    id,
                                    method: method_str,
                                },
                            }
                        }
                        Err(e) => HydratedSidebarItem {
                            name,
                            kind: SidebarKind::Error {
                                id,
                                message: format!("Parse error: {}", e),
                            },
                        },
                    }
                }
                Err(e) => HydratedSidebarItem {
                    name,
                    kind: SidebarKind::Error {
                        id,
                        message: format!("Read error: {}", e),
                    },
                },
            }
        }
    }
}
