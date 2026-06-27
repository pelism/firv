use crate::models::{
    manifest::{FirvManifest, SidebarItem},
    request::{HttpMethod},
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tokio::fs;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "hydratedSidebarItem.ts")]
pub struct HydratedSidebarItem {
    pub id: String,
    pub kind: SidebarKind,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "lowercase")]
#[ts(export, export_to = "sidebarKind.ts")]
pub enum SidebarKind {
    Folder {
        name: String,
        items: Vec<HydratedSidebarItem>,
    },
    Request {
        id: String,
        name: String,
        method: HttpMethod,
    },
    Ws {
        id: String,
        name: String,
    },
    Error {
        id: String,
        name: String,
        message: String,
    },
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "hydratedTree.ts")]
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
    let internal_id = Uuid::new_v4().to_string();
    match item {
        SidebarItem::Folder {
            name,
            items,
        } => {
            let mut hydrated_children = Vec::new();
            for child in items {
                hydrated_children.push(hydrate_item(child, requests_dir, found_ids).await);
            }
            HydratedSidebarItem {
                id: internal_id,
                kind: SidebarKind::Folder {
                    name,
                    items: hydrated_children,
                },
            }
        }
        SidebarItem::Request { id, name, method } => {
            found_ids.insert(id.clone());
            
            HydratedSidebarItem {
                id: internal_id,
                kind: SidebarKind::Request {
                    id,
                    name,
                    method,
                },
            }
        }
        SidebarItem::Ws { id, name } => {
            found_ids.insert(id.clone());

            HydratedSidebarItem {
                id: internal_id,
                kind: SidebarKind::Ws { id, name },
            }
        }
    }
}
