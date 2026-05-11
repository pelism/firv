use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::models::request::{KeyValue};

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "firvManifest.ts")]
pub struct FirvManifest {
    pub version: String, // e.g., "1.0"
    pub name: String,    // Project Name
    pub workspace: Workspace,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "workspace.ts")]
pub struct Workspace {
    pub order: Vec<SidebarItem>,
    #[serde(default)]
    pub globals: Vec<KeyValue>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "lowercase")]
#[ts(export, export_to = "sidebarItem.ts")]
pub enum SidebarItem {
    Folder {
        name: String,
        items: Vec<SidebarItem>, // Allows nested folders
    },
    Request {
        id: String, // Links to requests/id.yaml
        name: String,
        method: crate::models::request::HttpMethod,
    },
}
