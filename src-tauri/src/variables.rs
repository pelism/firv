use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::LazyLock;

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

    pub fn resolve_string(&self, input: &str) -> String {
        let merged_vars = self.merge();
        self.resolve_string_with_depth(input, &merged_vars, 0)
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
