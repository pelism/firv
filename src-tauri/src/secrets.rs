use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use crate::storage::save_atomic;

/// A single secret's editable fields. Referenced by other data (e.g.
/// `KeyValue.secret_ref`) via its stable id, never its name, so renaming a
/// secret never breaks existing references.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretEntry {
    pub name: String,
    pub value: String,
}

/// Metadata about a secret, without its value, safe to send to the frontend.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SecretMeta {
    pub id: String,
    pub name: String,
}

/// id → entry map of secrets belonging to a single workspace.
pub type WorkspaceSecrets = HashMap<String, SecretEntry>;
/// workspace_id → (secret id → entry)
pub type SecretsFile = HashMap<String, WorkspaceSecrets>;

/// Resolves `~/.firv/secrets.yaml`, creating the `.firv` directory if needed.
///
/// Honors the `FIRV_HOME` environment variable as an override for the base
/// directory (used by tests to avoid touching the real user home directory,
/// since `dirs::home_dir()` ignores `HOME`/`USERPROFILE` on Windows).
pub fn secrets_file_path() -> Result<PathBuf, String> {
    let base = if let Ok(override_dir) = std::env::var("FIRV_HOME") {
        PathBuf::from(override_dir)
    } else {
        dirs::home_dir().ok_or("Failed to resolve the user's home directory")?
    };
    let dir = base.join(".firv");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create {}: {}", dir.display(), e))?;
    }
    Ok(dir.join("secrets.yaml"))
}

pub fn load_all() -> Result<SecretsFile, String> {
    let path = secrets_file_path()?;
    if !path.exists() {
        return Ok(SecretsFile::new());
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    if content.trim().is_empty() {
        return Ok(SecretsFile::new());
    }
    serde_yaml::from_str(&content).map_err(|e| format!("Failed to parse {}: {}", path.display(), e))
}

pub fn save_all(store: &SecretsFile) -> Result<(), String> {
    let path = secrets_file_path()?;
    save_atomic(path, store)
}

/// Returns all secrets (id → entry) defined for the given workspace, or an
/// empty map if none exist.
pub fn get_workspace_secrets_raw(workspace_id: &str) -> Result<WorkspaceSecrets, String> {
    let store = load_all()?;
    Ok(store.get(workspace_id).cloned().unwrap_or_default())
}

/// Returns the id → value map for the given workspace, used by the variable
/// resolver to look up `KeyValue.secret_ref` (which stores a secret's id).
///
/// A secret's value can be overridden at runtime via an environment variable
/// named `FIRV_SECRET_<NAME>`, where `<NAME>` is the secret's name uppercased
/// with any non-alphanumeric characters replaced by `_`. This lets an MCP
/// client (e.g. an agent's `mcpServers` config `env` block) supply secret
/// values without writing them to `secrets.yaml`.
pub fn get_workspace_secrets(workspace_id: &str) -> Result<HashMap<String, String>, String> {
    Ok(get_workspace_secrets_raw(workspace_id)?
        .into_iter()
        .map(|(id, entry)| {
            let value = env_override_for_name(&entry.name).unwrap_or(entry.value);
            (id, value)
        })
        .collect())
}

/// Looks up `FIRV_SECRET_<NAME>` in the environment for the given secret name.
fn env_override_for_name(name: &str) -> Option<String> {
    let key: String = format!("FIRV_SECRET_{}", name.to_ascii_uppercase())
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' })
        .collect();
    std::env::var(key).ok()
}

/// Returns the list of secrets (id + name, no values) defined for the given
/// workspace, sorted by name.
pub fn list_secret_metas(workspace_id: &str) -> Result<Vec<SecretMeta>, String> {
    let mut metas: Vec<SecretMeta> = get_workspace_secrets_raw(workspace_id)?
        .into_iter()
        .map(|(id, entry)| SecretMeta { id, name: entry.name })
        .collect();
    metas.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(metas)
}

fn name_taken(workspace_secrets: &WorkspaceSecrets, name: &str, exclude_id: Option<&str>) -> bool {
    workspace_secrets
        .iter()
        .any(|(id, entry)| entry.name == name && exclude_id != Some(id.as_str()))
}

/// Creates a new secret for a workspace and returns its generated id.
pub fn create_secret(workspace_id: &str, name: &str, value: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Secret name must not be empty".to_string());
    }

    let mut store = load_all()?;
    let workspace_secrets = store.entry(workspace_id.to_string()).or_default();
    if name_taken(workspace_secrets, name, None) {
        return Err(format!("A secret named '{}' already exists", name));
    }

    let id = uuid::Uuid::new_v4().to_string();
    workspace_secrets.insert(
        id.clone(),
        SecretEntry { name: name.to_string(), value: value.to_string() },
    );
    save_all(&store)?;
    Ok(id)
}

/// Returns the plaintext value of a single secret by id, or an error if it doesn't exist.
pub fn get_secret(workspace_id: &str, id: &str) -> Result<String, String> {
    get_workspace_secrets_raw(workspace_id)?
        .get(id)
        .map(|entry| entry.value.clone())
        .ok_or_else(|| format!("Secret '{}' was not found", id))
}

/// Overwrites an existing secret's value by id. Errors if the id doesn't exist.
pub fn update_secret_value(workspace_id: &str, id: &str, value: &str) -> Result<(), String> {
    let mut store = load_all()?;
    let workspace_secrets = store.entry(workspace_id.to_string()).or_default();
    match workspace_secrets.get_mut(id) {
        Some(entry) => entry.value = value.to_string(),
        None => return Err(format!("Secret '{}' was not found", id)),
    }
    save_all(&store)
}

/// Renames an existing secret by id. Errors if the id doesn't exist or the new
/// name is already used by another secret in the same workspace.
pub fn rename_secret(workspace_id: &str, id: &str, new_name: &str) -> Result<(), String> {
    let new_name = new_name.trim();
    if new_name.is_empty() {
        return Err("Secret name must not be empty".to_string());
    }

    let mut store = load_all()?;
    let workspace_secrets = store.entry(workspace_id.to_string()).or_default();
    if name_taken(workspace_secrets, new_name, Some(id)) {
        return Err(format!("A secret named '{}' already exists", new_name));
    }
    match workspace_secrets.get_mut(id) {
        Some(entry) => entry.name = new_name.to_string(),
        None => return Err(format!("Secret '{}' was not found", id)),
    }
    save_all(&store)
}

/// Removes a secret by id from a workspace. No-op if it doesn't exist.
pub fn delete_secret(workspace_id: &str, id: &str) -> Result<(), String> {
    let mut store = load_all()?;
    if let Some(workspace_secrets) = store.get_mut(workspace_id) {
        workspace_secrets.remove(id);
    }
    save_all(&store)
}

/// Merges the provided id→entry pairs into a workspace's secrets, used when
/// importing an exported workspace that opted in to including secret values.
/// Ids are preserved as-is so `secret_ref`s in the imported manifest/requests
/// keep resolving correctly.
pub fn import_secrets(workspace_id: &str, secrets: &WorkspaceSecrets) -> Result<(), String> {
    if secrets.is_empty() {
        return Ok(());
    }

    let mut store = load_all()?;
    let entry = store.entry(workspace_id.to_string()).or_default();
    for (id, secret_entry) in secrets {
        entry.insert(id.clone(), secret_entry.clone());
    }
    save_all(&store)
}

/// Returns only the requested secret ids (e.g. those actually referenced by a
/// manifest/request set), used when exporting a workspace with secrets included.
pub fn export_secrets(workspace_id: &str, ids: &[String]) -> Result<WorkspaceSecrets, String> {
    let all = get_workspace_secrets_raw(workspace_id)?;
    Ok(ids
        .iter()
        .filter_map(|id| all.get(id).map(|entry| (id.clone(), entry.clone())))
        .collect())
}

#[tauri::command]
pub fn list_secrets(workspace_id: String) -> Result<Vec<SecretMeta>, String> {
    list_secret_metas(&workspace_id)
}

#[tauri::command]
pub fn create_secret_value(workspace_id: String, name: String, value: String) -> Result<String, String> {
    create_secret(&workspace_id, &name, &value)
}

#[tauri::command]
pub fn get_secret_value(workspace_id: String, id: String) -> Result<String, String> {
    get_secret(&workspace_id, &id)
}

#[tauri::command]
pub fn set_secret_value(workspace_id: String, id: String, value: String) -> Result<(), String> {
    update_secret_value(&workspace_id, &id, &value)
}

#[tauri::command]
pub fn rename_secret_value(workspace_id: String, id: String, name: String) -> Result<(), String> {
    rename_secret(&workspace_id, &id, &name)
}

#[tauri::command]
pub fn delete_secret_value(workspace_id: String, id: String) -> Result<(), String> {
    delete_secret(&workspace_id, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // Serialize tests that touch the real HOME-derived secrets file to avoid cross-test interference.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn with_temp_home<F: FnOnce()>(f: F) {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let temp = tempfile::tempdir().unwrap();
        let previous = std::env::var("FIRV_HOME").ok();
        std::env::set_var("FIRV_HOME", temp.path());

        f();

        match previous {
            Some(val) => std::env::set_var("FIRV_HOME", val),
            None => std::env::remove_var("FIRV_HOME"),
        }
    }

    #[test]
    fn create_and_get_secret_round_trips() {
        with_temp_home(|| {
            let id = create_secret("ws-1", "db_password", "hunter2").unwrap();
            assert_eq!(get_secret("ws-1", &id).unwrap(), "hunter2");
        });
    }

    #[test]
    fn secrets_are_namespaced_per_workspace() {
        with_temp_home(|| {
            let id1 = create_secret("ws-1", "shared_name", "value-1").unwrap();
            let id2 = create_secret("ws-2", "shared_name", "value-2").unwrap();

            assert_eq!(get_secret("ws-1", &id1).unwrap(), "value-1");
            assert_eq!(get_secret("ws-2", &id2).unwrap(), "value-2");
        });
    }

    #[test]
    fn create_secret_rejects_duplicate_name_in_same_workspace() {
        with_temp_home(|| {
            create_secret("ws-1", "token", "abc").unwrap();
            assert!(create_secret("ws-1", "token", "xyz").is_err());
        });
    }

    #[test]
    fn get_secret_errors_when_missing() {
        with_temp_home(|| {
            assert!(get_secret("ws-1", "missing-id").is_err());
        });
    }

    #[test]
    fn update_secret_value_changes_value_but_keeps_id_and_name() {
        with_temp_home(|| {
            let id = create_secret("ws-1", "token", "abc").unwrap();
            update_secret_value("ws-1", &id, "xyz").unwrap();

            assert_eq!(get_secret("ws-1", &id).unwrap(), "xyz");
            let metas = list_secret_metas("ws-1").unwrap();
            assert_eq!(metas, vec![SecretMeta { id, name: "token".to_string() }]);
        });
    }

    #[test]
    fn rename_secret_updates_name_and_keeps_references_valid() {
        with_temp_home(|| {
            let id = create_secret("ws-1", "old_name", "abc").unwrap();
            rename_secret("ws-1", &id, "new_name").unwrap();

            let metas = list_secret_metas("ws-1").unwrap();
            assert_eq!(metas, vec![SecretMeta { id: id.clone(), name: "new_name".to_string() }]);
            // The value is still resolvable by the same id after renaming.
            assert_eq!(get_secret("ws-1", &id).unwrap(), "abc");
        });
    }

    #[test]
    fn rename_secret_rejects_duplicate_name() {
        with_temp_home(|| {
            create_secret("ws-1", "taken", "1").unwrap();
            let id = create_secret("ws-1", "other", "2").unwrap();
            assert!(rename_secret("ws-1", &id, "taken").is_err());
        });
    }

    #[test]
    fn delete_secret_removes_entry() {
        with_temp_home(|| {
            let id = create_secret("ws-1", "token", "abc").unwrap();
            delete_secret("ws-1", &id).unwrap();
            assert!(get_secret("ws-1", &id).is_err());
        });
    }

    #[test]
    fn list_secret_metas_is_sorted_by_name() {
        with_temp_home(|| {
            create_secret("ws-1", "zeta", "1").unwrap();
            create_secret("ws-1", "alpha", "2").unwrap();
            let names: Vec<String> = list_secret_metas("ws-1").unwrap().into_iter().map(|m| m.name).collect();
            assert_eq!(names, vec!["alpha".to_string(), "zeta".to_string()]);
        });
    }

    #[test]
    fn import_secrets_merges_without_dropping_existing() {
        with_temp_home(|| {
            let existing_id = create_secret("ws-1", "existing", "keep-me").unwrap();

            let mut incoming = WorkspaceSecrets::new();
            incoming.insert("imported-id".to_string(), SecretEntry { name: "imported".to_string(), value: "new-value".to_string() });
            import_secrets("ws-1", &incoming).unwrap();

            assert_eq!(get_secret("ws-1", &existing_id).unwrap(), "keep-me");
            assert_eq!(get_secret("ws-1", "imported-id").unwrap(), "new-value");
        });
    }

    #[test]
    fn export_secrets_returns_only_requested_ids() {
        with_temp_home(|| {
            let id_a = create_secret("ws-1", "a", "1").unwrap();
            create_secret("ws-1", "b", "2").unwrap();

            let exported = export_secrets("ws-1", &[id_a.clone(), "missing".to_string()]).unwrap();
            assert_eq!(exported.len(), 1);
            assert_eq!(exported.get(&id_a).unwrap().value, "1");
        });
    }

    #[test]
    fn missing_secrets_file_returns_empty_list() {
        with_temp_home(|| {
            assert!(list_secret_metas("never-created").unwrap().is_empty());
        });
    }
}
