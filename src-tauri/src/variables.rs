use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::LazyLock;
use liquid::ParserBuilder;
use liquid::model::{Object, Value};

static TEMPLATE_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}").unwrap());

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct VariableResolver {
    pub globals: HashMap<String, String>,
    pub environment: HashMap<String, String>,
    pub folder_stack: Vec<HashMap<String, String>>,
    pub request_vars: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExtractionRule {
    pub target: String,
    pub source: ExtractionSource,
    pub pattern: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtractionSource {
    ResponseBodyJson,
    ResponseBodyRaw,
}

impl Default for ExtractionSource {
    fn default() -> Self {
        Self::ResponseBodyJson
    }
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

    pub fn apply_extraction_rule(&mut self, rule: &ExtractionRule, response_body: &str) -> Option<String> {
        match rule.source {
            ExtractionSource::ResponseBodyRaw => {
                if rule.pattern.is_empty() {
                    return None;
                }
                if let Some(start) = response_body.find(&rule.pattern) {
                    return Some(response_body[start..start + rule.pattern.len()].to_string());
                }
                None
            }
            ExtractionSource::ResponseBodyJson => {
                let parsed: serde_json::Value = serde_json::from_str(response_body).ok()?;
                let key = rule.pattern.trim_start_matches("$.");
                let value = parsed.pointer(&format!("/{}", key.replace('.', "/")))?;
                Some(match value {
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string(),
                })
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
