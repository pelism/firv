use liquid::model::{Object, Value};
use liquid::ParserBuilder;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use crate::models::request::{ExtractionSource, KeyValue, RequestExtractionRule};

mod uuid_filter;

use uuid_filter::UuidFilterParser;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VariableTraceEntry {
    pub key: String,
    pub value: String,
    pub scope: String,
    pub source: String,
}

fn extract_json_path<'a>(value: &'a serde_json::Value, path: &str) -> Option<&'a serde_json::Value> {
    if path.is_empty() {
        return Some(value);
    }

    let mut current = value;
    for segment in path.split('.') {
        if segment.is_empty() {
            continue;
        }

        let mut remaining = segment;
        while let Some(open) = remaining.find('[') {
            let (field, rest) = remaining.split_at(open);
            if !field.is_empty() {
                current = current.get(field)?;
            }

            let close = rest.find(']')?;
            let index_str = &rest[1..close];
            let index: usize = index_str.parse().ok()?;
            current = current.get(index)?;

            remaining = &rest[close + 1..];
            if remaining.is_empty() {
                break;
            }
        }

        if !remaining.is_empty() {
            if let Ok(index) = remaining.parse::<usize>() {
                current = current.get(index)?;
            } else if let Some(array) = current.as_array() {
                match remaining {
                    "first" => current = array.first()?,
                    "last" => current = array.last()?,
                    _ => current = current.get(remaining)?,
                }
            } else {
                current = current.get(remaining)?;
            }
        }
    }

    Some(current)
}

static TEMPLATE_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\{\{\s*([a-zA-Z0-9_-]+)\s*}}").unwrap());

static LIQUID_PARSER: LazyLock<liquid::Parser> = LazyLock::new(|| {
    ParserBuilder::with_stdlib()
        .filter(UuidFilterParser::default())
        .build()
        .expect("Failed to build Liquid parser")
});

pub const REDACTED_SECRET_PLACEHOLDER: &str = "••••••••";

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct VariableResolver {
    pub globals: HashMap<String, String>,
    pub environment: HashMap<String, String>,
    pub folder_stack: Vec<HashMap<String, String>>,
    pub request_vars: HashMap<String, String>,
    /// Secrets available to this workspace (id -> value), loaded from
    /// `~/.firv/secrets.yaml`. Used to resolve `KeyValue.secret_ref` entries,
    /// which store a secret's id rather than its (renameable) name.
    #[serde(skip)]
    pub secrets: HashMap<String, String>,
    /// Normalized variable keys whose effective value came from a secret_ref,
    /// so `trace()` can redact them instead of exposing the resolved value.
    #[serde(skip)]
    secret_keys: HashSet<String>,
    /// Resolved secret values that were actually substituted somewhere (e.g. into
    /// a header via `resolve_key_value`), used to redact them out of any debug
    /// payload (like the hydrated "final request") shown to the frontend.
    #[serde(skip)]
    used_secret_values: HashSet<String>,
    #[serde(skip)]
    used_variable_keys: HashSet<String>,
}

impl VariableResolver {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_scopes(globals: &[KeyValue], environment: &[KeyValue], secrets: &HashMap<String, String>) -> Self {
        let mut resolver = Self::new();
        resolver.secrets = secrets.clone();
        resolver.globals = Self::collect_enabled_variables(globals, secrets, &mut resolver.secret_keys);
        resolver.environment = Self::collect_enabled_variables(environment, secrets, &mut resolver.secret_keys);
        resolver
    }

    fn normalize_key(key: &str) -> String {
        key.to_ascii_lowercase()
    }

    fn collect_enabled_variables(
        variables: &[KeyValue],
        secrets: &HashMap<String, String>,
        secret_keys: &mut HashSet<String>,
    ) -> HashMap<String, String> {
        let mut result = HashMap::new();

        for variable in variables {
            if !variable.enabled {
                continue;
            }

            let key = variable.key.trim();
            if key.is_empty() {
                continue;
            }

            let normalized_key = Self::normalize_key(key);

            match variable.secret_ref.as_deref().filter(|s| !s.trim().is_empty()) {
                Some(secret_id) => {
                    secret_keys.insert(normalized_key.clone());
                    let value = secrets.get(secret_id).cloned().unwrap_or_default();
                    result.insert(normalized_key, value);
                }
                None => {
                    result.insert(normalized_key, variable.value.clone());
                }
            }
        }

        result
    }

    /// Resolves a `KeyValue`'s effective value: a secret_ref is looked up directly
    /// from the loaded secret map (no templating applied), otherwise the literal
    /// `value` is resolved through liquid/template substitution as usual.
    pub fn resolve_key_value(&mut self, kv: &KeyValue) -> String {
        if let Some(secret_name) = kv.secret_ref.as_deref().filter(|s| !s.trim().is_empty()) {
            self.secret_keys.insert(Self::normalize_key(&kv.key));
            let value = self.secrets.get(secret_name).cloned().unwrap_or_default();
            if !value.is_empty() {
                self.used_secret_values.insert(value.clone());
            }
            value
        } else {
            self.render_liquid(&kv.value).unwrap_or_else(|_| self.resolve_string(&kv.value))
        }
    }

    /// Seeds a request-scoped variable (e.g. a persisted request variable default,
    /// or a per-execution override) into `request_vars`, resolving `secret_ref`
    /// from the loaded secret map when set, mirroring `resolve_key_value`.
    pub fn seed_request_variable(&mut self, key: &str, value: &str, secret_ref: Option<&str>) {
        let key = key.trim().to_string();
        if key.is_empty() {
            return;
        }

        match secret_ref.filter(|s| !s.trim().is_empty()) {
            Some(secret_id) => {
                self.secret_keys.insert(Self::normalize_key(&key));
                let resolved = self.secrets.get(secret_id).cloned().unwrap_or_default();
                self.request_vars.insert(key, resolved);
            }
            None => {
                self.request_vars.insert(key, value.to_string());
            }
        }
    }

    /// Returns the set of resolved secret values that were actually used while
    /// preparing this request (via `secret_ref` on headers/form fields, or via
    /// `{{var}}` templating of a secret-backed global/environment variable).
    pub fn secret_redaction_values(&self) -> HashSet<String> {
        let mut values = self.used_secret_values.clone();
        let merged = self.merge();
        for key in &self.secret_keys {
            if self.used_variable_keys.contains(key) {
                if let Some(value) = merged.get(key) {
                    if !value.is_empty() {
                        values.insert(value.clone());
                    }
                }
            }
        }
        values
    }

    /// Replaces any occurrence of a used secret value in `text` with a redaction
    /// placeholder. Intended for debug/preview payloads (e.g. the hydrated "final
    /// request") that are surfaced to the frontend, never for the outgoing request itself.
    pub fn redact_secrets(&self, text: &str) -> String {
        let mut redacted = text.to_string();
        for value in self.secret_redaction_values() {
            redacted = redacted.replace(&value, REDACTED_SECRET_PLACEHOLDER);
        }
        redacted
    }

    fn record_used_keys_from_input(&mut self, input: &str) {
        for caps in TEMPLATE_REGEX.captures_iter(input) {
            self.used_variable_keys.insert(Self::normalize_key(&caps[1]));
        }
    }

    pub fn merge(&self) -> HashMap<String, String> {
        let mut final_map = HashMap::new();

        for (k, v) in &self.globals {
            final_map.insert(Self::normalize_key(k), v.clone());
        }

        for (k, v) in &self.environment {
            final_map.insert(Self::normalize_key(k), v.clone());
        }

        for folder_vars in &self.folder_stack {
            for (k, v) in folder_vars {
                final_map.insert(Self::normalize_key(k), v.clone());
            }
        }

        for (k, v) in &self.request_vars {
            final_map.insert(Self::normalize_key(k), v.clone());
        }

        final_map
    }

    pub fn trace(&self) -> Vec<VariableTraceEntry> {
        let mut entries = Vec::new();
        let mut entry_indexes: HashMap<String, usize> = HashMap::new();
        let should_include = |key: &str| self.used_variable_keys.contains(&Self::normalize_key(key));
        let redact = |key: &str, value: &str| -> String {
            if self.secret_keys.contains(&Self::normalize_key(key)) {
                REDACTED_SECRET_PLACEHOLDER.to_string()
            } else {
                value.to_string()
            }
        };
        let mut push_or_replace = |entry: VariableTraceEntry| {
            let normalized_key = Self::normalize_key(&entry.key);
            if let Some(index) = entry_indexes.get(&normalized_key).copied() {
                entries[index] = entry;
            } else {
                entry_indexes.insert(normalized_key, entries.len());
                entries.push(entry);
            }
        };

        for (key, value) in &self.globals {
            if !should_include(key) {
                continue;
            }
            push_or_replace(VariableTraceEntry {
                key: key.clone(),
                value: redact(key, value),
                scope: "workspace".to_string(),
                source: "manifest.globals".to_string(),
            });
        }
        for (key, value) in &self.environment {
            if !should_include(key) {
                continue;
            }
            push_or_replace(VariableTraceEntry {
                key: key.clone(),
                value: redact(key, value),
                scope: "environment".to_string(),
                source: "runtime.environment".to_string(),
            });
        }
        for (index, folder_vars) in self.folder_stack.iter().enumerate() {
            for (key, value) in folder_vars {
                if !should_include(key) {
                    continue;
                }
                push_or_replace(VariableTraceEntry {
                    key: key.clone(),
                    value: redact(key, value),
                    scope: format!("folder[{}]", index),
                    source: "folder.variables".to_string(),
                });
            }
        }
        for (key, value) in &self.request_vars {
            if !should_include(key) {
                continue;
            }
            push_or_replace(VariableTraceEntry {
                key: key.clone(),
                value: redact(key, value),
                scope: "request".to_string(),
                source: "request.extraction".to_string(),
            });
        }

        entries
    }

    pub fn resolve_string(&mut self, input: &str) -> String {
        self.record_used_keys_from_input(input);
        let merged_vars = self.merge();
        self.resolve_string_with_depth(input, &merged_vars, 0)
    }

    pub fn render_liquid(&mut self, input: &str) -> Result<String, String> {
        self.record_used_keys_from_input(input);
        let template = LIQUID_PARSER
            .parse(input)
            .map_err(|e| e.to_string())?;
        let mut globals = Object::new();
        for (key, value) in self.merge() {
            globals.insert(key.into(), Value::scalar(value));
        }
        template.render(&globals).map_err(|e| e.to_string())
    }

    pub fn apply_extraction_rule(&mut self, rule: &RequestExtractionRule, response_body: &str) -> Result<Option<String>, String> {
        match rule.source {
            ExtractionSource::ResponseBodyRaw => {
                if rule.pattern.is_empty() {
                    return Err(format!("Extraction rule '{}' has an empty raw pattern", rule.target));
                }
                if let Some(start) = response_body.find(&rule.pattern) {
                    return Ok(Some(response_body[start..start + rule.pattern.len()].to_string()));
                }
                Err(format!("Raw extraction '{}' did not match any substring", rule.target))
            }
            ExtractionSource::ResponseBodyJson => {
                let parsed: serde_json::Value = serde_json::from_str(response_body)
                    .map_err(|e| format!("JSON extraction '{}' could not parse response body: {}", rule.target, e))?;
                let path = rule.pattern.trim_start_matches("$").trim_start_matches('.');
                let value = extract_json_path(&parsed, path)
                    .ok_or_else(|| format!("JSON extraction '{}' could not resolve path '{}'", rule.target, rule.pattern))?;
                Ok(Some(match value {
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string(),
                }))
            }
        }
    }

    fn resolve_string_with_depth(
        &mut self,
        input: &str,
        variables: &HashMap<String, String>,
        depth: usize,
    ) -> String {
        if depth >= 3 {
            return input.to_string();
        }

        let mut changed = false;

        let resolved = TEMPLATE_REGEX
            .replace_all(input, |caps: &regex::Captures| {
                let var_name = Self::normalize_key(&caps[1]);
                if let Some(val) = variables.get(&var_name) {
                    self.used_variable_keys.insert(var_name.to_string());
                    changed = true;
                    val.to_string()
                } else {
                    caps[0].to_string()
                }
            })
            .to_string();

        if changed {
            self.resolve_string_with_depth(&resolved, variables, depth + 1)
        } else {
            resolved
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resolver_with_values() -> VariableResolver {
        let mut resolver = VariableResolver::new();
        resolver.globals.insert("global".to_string(), "g".to_string());
        resolver.environment.insert("env".to_string(), "e".to_string());
        resolver.folder_stack.push(HashMap::from([("folder".to_string(), "f".to_string())]));
        resolver.request_vars.insert("request".to_string(), "r".to_string());
        resolver
    }

    #[test]
    fn merge_applies_scope_precedence() {
        let resolver = resolver_with_values();
        let merged = resolver.merge();

        assert_eq!(merged.get("global").unwrap(), "g");
        assert_eq!(merged.get("env").unwrap(), "e");
        assert_eq!(merged.get("folder").unwrap(), "f");
        assert_eq!(merged.get("request").unwrap(), "r");
    }

    #[test]
    fn environment_values_override_globals() {
        let resolver = VariableResolver::from_scopes(
            &[KeyValue {
                key: "base_url".to_string(),
                value: "https://global.example".to_string(),
                enabled: true,
                secret_ref: None,
            }],
            &[KeyValue {
                key: "base_url".to_string(),
                value: "https://dev.example".to_string(),
                enabled: true,
                secret_ref: None,
            }],
            &HashMap::new(),
        );

        let merged = resolver.merge();
        assert_eq!(merged.get("base_url").unwrap(), "https://dev.example");
    }

    #[test]
    fn trace_keeps_only_effective_scope_for_duplicate_keys() {
        let mut resolver = VariableResolver::from_scopes(
            &[KeyValue {
                key: "base_url".to_string(),
                value: "https://global.example".to_string(),
                enabled: true,
                secret_ref: None,
            }],
            &[KeyValue {
                key: "base_url".to_string(),
                value: "https://dev.example".to_string(),
                enabled: true,
                secret_ref: None,
            }],
            &HashMap::new(),
        );

        let rendered = resolver.resolve_string("{{base_url}}/items");
        assert_eq!(rendered, "https://dev.example/items");

        let trace = resolver.trace();
        assert_eq!(trace.len(), 1);
        assert_eq!(trace[0].scope, "environment");
        assert_eq!(trace[0].value, "https://dev.example");
    }

    #[test]
    fn resolve_string_replaces_nested_variables() {
        let mut resolver = VariableResolver::new();
        resolver.globals.insert("name".to_string(), "Firv".to_string());
        resolver.globals.insert("greeting".to_string(), "Hello {{name}}".to_string());

        assert_eq!(resolver.resolve_string("{{greeting}}!"), "Hello Firv!");
    }

    #[test]
    fn resolve_string_leaves_unknown_placeholders_unchanged() {
        let mut resolver = VariableResolver::new();

        assert_eq!(resolver.resolve_string("{{missing}}"), "{{missing}}");
    }

    #[test]
    fn render_liquid_uses_merged_variables() {
        let mut resolver = VariableResolver::new();
        resolver.globals.insert("name".to_string(), "Firv".to_string());

        assert_eq!(resolver.render_liquid("Hello {{ name }}").unwrap(), "Hello Firv");
    }

    #[test]
    fn render_liquid_supports_uuid_filter() {
        let mut resolver = VariableResolver::new();
        let rendered = resolver
            .render_liquid("{% assign id = \"\" | uuid %}{{ id }}")
            .unwrap();

        assert_eq!(rendered.len(), 36);
        assert!(rendered.chars().filter(|c| *c == '-').count() == 4);
    }

    #[test]
    fn trace_only_includes_used_variables() {
        let mut resolver = VariableResolver::new();
        resolver.globals.insert("used".to_string(), "1".to_string());
        resolver.globals.insert("unused".to_string(), "2".to_string());

        assert_eq!(resolver.resolve_string("/items/{{used}}"), "/items/1");

        let trace = resolver.trace();
        assert_eq!(trace.len(), 1);
        assert_eq!(trace[0].key, "used");
    }

    #[test]
    fn raw_extraction_returns_matched_substring() {
        let mut resolver = VariableResolver::new();
        let rule = RequestExtractionRule {
            target: "token".to_string(),
            source: ExtractionSource::ResponseBodyRaw,
            pattern: "abc123".to_string(),
        };

        let value = resolver.apply_extraction_rule(&rule, "prefix abc123 suffix").unwrap();
        assert_eq!(value.as_deref(), Some("abc123"));
    }

    #[test]
    fn raw_extraction_rejects_empty_pattern() {
        let mut resolver = VariableResolver::new();
        let rule = RequestExtractionRule {
            target: "token".to_string(),
            source: ExtractionSource::ResponseBodyRaw,
            pattern: "".to_string(),
        };

        assert!(resolver.apply_extraction_rule(&rule, "anything").is_err());
    }

    #[test]
    fn json_extraction_supports_nested_paths_and_arrays() {
        let mut resolver = VariableResolver::new();
        let rule = RequestExtractionRule {
            target: "email".to_string(),
            source: ExtractionSource::ResponseBodyJson,
            pattern: "$.users[0].profile.email".to_string(),
        };

        let body = r#"{"users":[{"profile":{"email":"a@b.com"}}]}"#;
        let value = resolver.apply_extraction_rule(&rule, body).unwrap();
        assert_eq!(value.as_deref(), Some("a@b.com"));
    }

    #[test]
    fn json_extraction_returns_error_for_invalid_json() {
        let mut resolver = VariableResolver::new();
        let rule = RequestExtractionRule {
            target: "email".to_string(),
            source: ExtractionSource::ResponseBodyJson,
            pattern: "$.value".to_string(),
        };

        assert!(resolver.apply_extraction_rule(&rule, "not json").is_err());
    }

    #[test]
    fn extracted_variables_can_be_interpolated_in_headers() {
        let mut resolver = VariableResolver::new();
        let rule = RequestExtractionRule {
            target: "token".to_string(),
            source: ExtractionSource::ResponseBodyJson,
            pattern: "$.token".to_string(),
        };

        let value = resolver.apply_extraction_rule(&rule, r#"{"token":"abc123"}"#).unwrap();
        resolver.request_vars.insert(rule.target.clone(), value.unwrap());

        assert_eq!(resolver.resolve_string("Bearer {{token}}"), "Bearer abc123");
    }

    #[test]
    fn secret_ref_resolves_from_secrets_map() {
        let secrets = HashMap::from([("db_password".to_string(), "hunter2".to_string())]);
        let resolver = VariableResolver::from_scopes(
            &[KeyValue {
                key: "password".to_string(),
                value: String::new(),
                enabled: true,
                secret_ref: Some("db_password".to_string()),
            }],
            &[],
            &secrets,
        );

        assert_eq!(resolver.merge().get("password").unwrap(), "hunter2");
    }

    #[test]
    fn trace_redacts_secret_ref_values() {
        let secrets = HashMap::from([("db_password".to_string(), "hunter2".to_string())]);
        let mut resolver = VariableResolver::from_scopes(
            &[KeyValue {
                key: "password".to_string(),
                value: String::new(),
                enabled: true,
                secret_ref: Some("db_password".to_string()),
            }],
            &[],
            &secrets,
        );

        let rendered = resolver.resolve_string("{{password}}");
        assert_eq!(rendered, "hunter2");

        let trace = resolver.trace();
        assert_eq!(trace.len(), 1);
        assert_eq!(trace[0].value, REDACTED_SECRET_PLACEHOLDER);
    }

    #[test]
    fn resolve_key_value_looks_up_secret_ref_without_templating() {
        let secrets = HashMap::from([("api_key".to_string(), "{{literal}}".to_string())]);
        let mut resolver = VariableResolver::new();
        resolver.secrets = secrets;

        let kv = KeyValue {
            key: "Authorization".to_string(),
            value: String::new(),
            enabled: true,
            secret_ref: Some("api_key".to_string()),
        };

        assert_eq!(resolver.resolve_key_value(&kv), "{{literal}}");
    }

    #[test]
    fn resolve_key_value_falls_back_to_literal_value_when_no_secret_ref() {
        let mut resolver = VariableResolver::new();
        resolver.globals.insert("name".to_string(), "Firv".to_string());

        let kv = KeyValue {
            key: "X-App".to_string(),
            value: "{{name}}".to_string(),
            enabled: true,
            secret_ref: None,
        };

        assert_eq!(resolver.resolve_key_value(&kv), "Firv");
    }
}
