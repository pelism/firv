use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ts_rs::TS;

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/bindings/FirvManifest.ts")]
pub struct FirvManifest {
    pub version: String, // e.g., "1.0"
    pub name: String,    // Project Name
    pub workspace: Workspace,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../src/bindings/Workspace.ts")]
pub struct Workspace {
    pub order: Vec<SidebarItem>,
    #[serde(default)]
    pub globals: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "lowercase")]
#[ts(export, export_to = "../src/bindings/SidebarItem.ts")]
pub enum SidebarItem {
    Folder {
        name: String,
        items: Vec<SidebarItem>, // Allows nested folders
        #[serde(default)]
        scripts: FolderScripts,
    },
    Request {
        id: String, // Links to requests/id.yaml
        name: String,
    },
}

#[derive(Debug, Serialize, Deserialize, Default, TS)]
#[ts(export, export_to = "../src/bindings/FolderScripts.ts")]
pub struct FolderScripts {
    pub pre_folder: Option<String>,
}
