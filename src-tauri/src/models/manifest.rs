use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::models::request::KeyValue;

#[derive(Debug, Serialize, Deserialize, TS, Clone)]
#[ts(export, export_to = "firvManifest.ts")]
pub struct FirvManifest {
    pub version: String, // e.g., "1.0"
    pub name: String,    // Workspace Name
    pub workspace: Workspace,
    /// Stable identifier for this workspace, used to namespace entries in the
    /// global secret store (`~/.firv/secrets.yaml`) independent of the
    /// workspace's filesystem path (which can be moved/renamed).
    #[serde(default)]
    pub workspace_id: String,
}

#[derive(Debug, Serialize, Deserialize, TS, Clone)]
#[ts(export, export_to = "workspace.ts")]
pub struct Workspace {
    pub order: Vec<SidebarItem>,
    #[serde(default)]
    pub globals: Vec<KeyValue>,
    #[serde(default)]
    pub environments: Vec<WorkspaceEnvironment>,
    #[serde(default)]
    pub active_environment: Option<String>,
}

impl FirvManifest {
    /// Ensures `workspace_id` is populated, generating a new UUID if it is missing
    /// (e.g. when loading a manifest created before workspace ids existed).
    /// Returns `true` if a new id was generated so callers can decide to persist it.
    pub fn ensure_workspace_id(&mut self) -> bool {
        if self.workspace_id.trim().is_empty() {
            self.workspace_id = uuid::Uuid::new_v4().to_string();
            true
        } else {
            false
        }
    }
}

#[derive(Debug, Serialize, Deserialize, TS, Clone)]
#[ts(export, export_to = "environment.ts")]
pub struct WorkspaceEnvironment {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub variables: Vec<KeyValue>,
}

#[derive(Debug, Serialize, Deserialize, TS, Clone)]
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
    Ws {
        id: String, // Links to requests/id.yaml
        name: String,
    },
    Flow {
        id: String, // Links to flows/id.yaml
        name: String,
    },
    Grpc {
        id: String, // Links to requests/id.yaml
        name: String,
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
        assert!(manifest.workspace.environments.is_empty());
        assert!(manifest.workspace.active_environment.is_none());
    }

    #[test]
    fn ws_variant_round_trips_and_existing_request_unaffected() {
        let yaml = r#"
version: "1.0"
name: Example
workspace:
  order:
    - type: request
      id: req_1
      name: Get Items
      method: GET
    - type: ws
      id: ws_1
      name: My Socket
"#;
        let manifest: FirvManifest = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(manifest.workspace.order.len(), 2);
        match &manifest.workspace.order[1] {
            SidebarItem::Ws { id, name } => {
                assert_eq!(id, "ws_1");
                assert_eq!(name, "My Socket");
            }
            _ => panic!("expected ws item"),
        }
        match &manifest.workspace.order[0] {
            SidebarItem::Request { method, .. } => {
                assert_eq!(*method, crate::models::request::HttpMethod::GET);
            }
            _ => panic!("expected request item"),
        }
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
                environments: vec![WorkspaceEnvironment {
                    id: "dev".to_string(),
                    name: "Development".to_string(),
                    variables: vec![],
                }],
                active_environment: Some("dev".to_string()),
            },
            workspace_id: "workspace-1".to_string(),
        };

        let yaml = serde_yaml::to_string(&manifest).unwrap();
        let decoded: FirvManifest = serde_yaml::from_str(&yaml).unwrap();

        assert_eq!(decoded.name, manifest.name);
        assert_eq!(decoded.workspace.order.len(), 1);
        assert_eq!(decoded.workspace.environments.len(), 1);
        assert_eq!(decoded.workspace.active_environment.as_deref(), Some("dev"));
    }
}
