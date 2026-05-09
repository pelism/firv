use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::LazyLock;
use liquid::ParserBuilder;
use liquid::model::{Object, Value};

use crate::models::request::{ExtractionSource, RequestExtractionRule};

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
    LazyLock::new(|| Regex::new(r"\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}").unwrap());

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct VariableResolver {
    pub globals: HashMap<String, String>,
    pub environment: HashMap<String, String>,
    pub folder_stack: Vec<HashMap<String, String>>,
    pub request_vars: HashMap<String, String>,
}

impl VariableResolver {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn merge(&self) -> HashMap<String, String> {
        let mut final_map = HashMap::new();

        final_map.extend(self.globals.clone());

        for (k, v) in &self.environment {
            final_map.insert(k.clone(), v.clone());
        }

        for folder_vars in &self.folder_stack {
            for (k, v) in folder_vars {
                final_map.insert(k.clone(), v.clone());
            }
        }

        for (k, v) in &self.request_vars {
            final_map.insert(k.clone(), v.clone());
        }

        final_map
    }

    pub fn trace(&self) -> Vec<VariableTraceEntry> {
        let mut entries = Vec::new();

        for (key, value) in &self.globals {
            entries.push(VariableTraceEntry {
                key: key.clone(),
                value: value.clone(),
                scope: "workspace".to_string(),
                source: "manifest.globals".to_string(),
            });
        }
        for (key, value) in &self.environment {
            entries.push(VariableTraceEntry {
                key: key.clone(),
                value: value.clone(),
                scope: "environment".to_string(),
                source: "runtime.environment".to_string(),
            });
        }
        for (index, folder_vars) in self.folder_stack.iter().enumerate() {
            for (key, value) in folder_vars {
                entries.push(VariableTraceEntry {
                    key: key.clone(),
                    value: value.clone(),
                    scope: format!("folder[{}]", index),
                    source: "folder.variables".to_string(),
                });
            }
        }
        for (key, value) in &self.request_vars {
            entries.push(VariableTraceEntry {
                key: key.clone(),
                value: value.clone(),
                scope: "request".to_string(),
                source: "request.extraction".to_string(),
            });
        }

        entries
    }

    pub fn resolve_string(&self, input: &str) -> String {
        let merged_vars = self.merge();
        self.resolve_string_with_depth(input, &merged_vars, 0)
    }

    pub fn render_liquid(&self, input: &str) -> Result<String, String> {
        let parser = ParserBuilder::with_stdlib()
            .build()
            .map_err(|e| e.to_string())?;
        let template = parser.parse(input).map_err(|e| e.to_string())?;
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
        &self,
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
                let var_name = &caps[1];
                if let Some(val) = variables.get(var_name) {
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
