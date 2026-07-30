use crate::models::manifest::FirvManifest;
use crate::models::request::KeyValue;
use crate::secrets;
use crate::storage::save_atomic;
use std::collections::HashMap;
use std::path::Path;

/// Shared project state used by both the GUI Tauri commands and the MCP server.
///
/// This centralizes manifest loading and variable extraction so both entry points
/// behave identically when reading `firv.yaml`, globals, and active environment variables.
pub struct Project {
    project_root: String,
    manifest: FirvManifest,
    /// Optional session-level override for the active environment (e.g. MCP `set_active_environment`).
    active_environment_id: Option<String>,
}

impl Project {
    /// Load a project from disk by its root directory (the directory containing `firv.yaml`).
    pub fn load(project_root: String) -> Result<Self, String> {
        let manifest_path = Path::new(&project_root).join("firv.yaml");
        let content = std::fs::read_to_string(&manifest_path)
            .map_err(|e| format!("Failed to read manifest at {}: {}", manifest_path.display(), e))?;
        let mut manifest: FirvManifest = serde_yaml::from_str(&content)
            .map_err(|e| format!("Failed to parse manifest at {}: {}", manifest_path.display(), e))?;

        // Backfill a stable workspace id for manifests created before secrets support
        // existed, so the workspace can immediately be used to namespace secrets.
        if manifest.ensure_workspace_id() {
            let _ = save_atomic(manifest_path, &manifest);
        }

        Ok(Self {
            project_root,
            manifest,
            active_environment_id: None,
        })
    }

    pub fn project_root(&self) -> &str {
        &self.project_root
    }

    pub fn manifest(&self) -> &FirvManifest {
        &self.manifest
    }

    pub fn workspace_id(&self) -> &str {
        &self.manifest.workspace_id
    }

    /// Returns all secrets defined for this workspace (id -> value), loaded from
    /// `~/.firv/secrets.yaml`. Returns an empty map if the store can't be read.
    pub fn secrets(&self) -> HashMap<String, String> {
        secrets::get_workspace_secrets(&self.manifest.workspace_id).unwrap_or_default()
    }

    /// Returns the active environment id, using the session override if one is set,
    /// otherwise falling back to the value stored in the manifest.
    pub fn active_environment_id(&self) -> Option<&str> {
        self.active_environment_id
            .as_deref()
            .or(self.manifest.workspace.active_environment.as_deref())
    }

    /// Override the active environment for the current session. This does not persist
    /// back to `firv.yaml`.
    pub fn set_active_environment(&mut self, id: Option<String>) {
        self.active_environment_id = id;
    }

    /// Returns workspace-level global variables.
    pub fn workspace_vars(&self) -> Vec<KeyValue> {
        self.manifest.workspace.globals.clone()
    }

    /// Returns variables for the currently active environment, if any.
    pub fn environment_vars(&self) -> Vec<KeyValue> {
        let active_id = self.active_environment_id();
        let manifest = &self.manifest;

        if let Some(id) = active_id {
            if let Some(env) = manifest.workspace.environments.iter().find(|e| e.id == id) {
                return env.variables.clone();
            }
        }

        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::manifest::{Workspace, WorkspaceEnvironment};
    use crate::models::request::KeyValue;

    fn sample_manifest() -> FirvManifest {
        FirvManifest {
            version: "1.0".to_string(),
            name: "test".to_string(),
            workspace: Workspace {
                order: vec![],
                globals: vec![KeyValue {
                    key: "global_key".to_string(),
                    value: "global_value".to_string(),
                    enabled: true,
                    secret_ref: None,
                }],
                environments: vec![WorkspaceEnvironment {
                    id: "dev".to_string(),
                    name: "Development".to_string(),
                    variables: vec![KeyValue {
                        key: "env_key".to_string(),
                        value: "env_value".to_string(),
                        enabled: true,
                        secret_ref: None,
                    }],
                }],
                active_environment: Some("dev".to_string()),
            },
            workspace_id: "workspace-1".to_string(),
        }
    }

    #[test]
    fn workspace_vars_returns_globals() {
        let project = Project {
            project_root: "/tmp".to_string(),
            manifest: sample_manifest(),
            active_environment_id: None,
        };
        let vars = project.workspace_vars();
        assert_eq!(vars.len(), 1);
        assert_eq!(vars[0].key, "global_key");
    }

    #[test]
    fn environment_vars_uses_manifest_active_environment() {
        let project = Project {
            project_root: "/tmp".to_string(),
            manifest: sample_manifest(),
            active_environment_id: None,
        };
        let vars = project.environment_vars();
        assert_eq!(vars.len(), 1);
        assert_eq!(vars[0].key, "env_key");
    }

    #[test]
    fn environment_vars_respects_session_override() {
        let mut project = Project {
            project_root: "/tmp".to_string(),
            manifest: sample_manifest(),
            active_environment_id: None,
        };
        project.set_active_environment(Some("missing".to_string()));
        let vars = project.environment_vars();
        assert!(vars.is_empty());
    }
}
