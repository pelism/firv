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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_manifest_with_nested_items() {
        let yaml = r#"
version: "1.0"
name: Example
workspace:
  order:
    - type: folder
      name: Parent
      items:
        - type: request
          id: req_1
          name: Get Items
          method: GET
  globals:
    - key: base_url
      value: https://example.com
      enabled: true
"#;

        let manifest: FirvManifest = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(manifest.version, "1.0");
        assert_eq!(manifest.name, "Example");
        assert_eq!(manifest.workspace.globals.len(), 1);
        match &manifest.workspace.order[0] {
            SidebarItem::Folder { name, items } => {
                assert_eq!(name, "Parent");
                assert_eq!(items.len(), 1);
            }
            _ => panic!("expected folder item"),
        }
    }

    #[test]
    fn globals_default_when_omitted() {
        let yaml = r#"
version: "1.0"
name: Example
workspace:
  order: []
"#;

        let manifest: FirvManifest = serde_yaml::from_str(yaml).unwrap();
        assert!(manifest.workspace.globals.is_empty());
    }

    #[test]
    fn round_trip_serialization_preserves_structure() {
        let manifest = FirvManifest {
            version: "1.0".to_string(),
            name: "Example".to_string(),
            workspace: Workspace {
                order: vec![SidebarItem::Request {
                    id: "req_1".to_string(),
                    name: "Get Items".to_string(),
                    method: crate::models::request::HttpMethod::GET,
                }],
                globals: vec![],
            },
        };

        let yaml = serde_yaml::to_string(&manifest).unwrap();
        let decoded: FirvManifest = serde_yaml::from_str(&yaml).unwrap();

        assert_eq!(decoded.name, manifest.name);
        assert_eq!(decoded.workspace.order.len(), 1);
    }
}
