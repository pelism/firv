use serde::{Deserialize, Serialize};
use crate::models::request::KeyValue;
use ts_rs::TS;

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "firvManifest.ts")]
pub struct FirvManifest {
    pub version: String, // e.g., "1.0"
    pub name: String,    // Project Name
    pub workspace: Workspace,
}

#[derive(Debug, Serialize, Deserialize, Default, TS, Clone)]
#[ts(export, export_to = "scriptConfig.ts")]
pub struct ScriptConfig {
    pub pre: Option<String>,
    pub post: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "workspace.ts")]
pub struct Workspace {
    pub order: Vec<SidebarItem>,
    #[serde(default)]
    pub globals: Vec<KeyValue>,
    #[serde(default)]
    pub scripts: ScriptConfig,
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
