use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Serialize, Deserialize, TS, Clone)]
#[ts(export, export_to = "firvRequest.ts")]
pub struct FirvRequest {
    pub id: String,
    pub name: String,
    pub method: HttpMethod,
    pub url: String,

    #[serde(default)]
    pub headers: Vec<KeyValue>,

    #[serde(default)]
    pub params: Vec<KeyValue>,

    pub body: RequestBody,

    #[serde(default)]
    pub transforms: RequestTransforms,
}

#[derive(Debug, Serialize, Deserialize, TS, Clone, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
#[ts(export, export_to = "httpMethod.ts")]
pub enum HttpMethod {
    GET,
    POST,
    PUT,
    DELETE,
    PATCH,
    HEAD,
    OPTIONS,
}

impl HttpMethod {
    pub fn to_reqwest_method(&self) -> reqwest::Method {
        match self {
            HttpMethod::GET => reqwest::Method::GET,
            HttpMethod::POST => reqwest::Method::POST,
            HttpMethod::PUT => reqwest::Method::PUT,
            HttpMethod::DELETE => reqwest::Method::DELETE,
            HttpMethod::PATCH => reqwest::Method::PATCH,
            HttpMethod::HEAD => reqwest::Method::HEAD,
            HttpMethod::OPTIONS => reqwest::Method::OPTIONS,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::HttpMethod;

    #[test]
    fn converts_http_methods_to_reqwest_methods() {
        assert_eq!(HttpMethod::GET.to_reqwest_method(), reqwest::Method::GET);
        assert_eq!(HttpMethod::POST.to_reqwest_method(), reqwest::Method::POST);
        assert_eq!(HttpMethod::PUT.to_reqwest_method(), reqwest::Method::PUT);
        assert_eq!(HttpMethod::DELETE.to_reqwest_method(), reqwest::Method::DELETE);
        assert_eq!(HttpMethod::PATCH.to_reqwest_method(), reqwest::Method::PATCH);
        assert_eq!(HttpMethod::HEAD.to_reqwest_method(), reqwest::Method::HEAD);
        assert_eq!(HttpMethod::OPTIONS.to_reqwest_method(), reqwest::Method::OPTIONS);
    }
}

#[derive(Debug, Serialize, Deserialize, TS, Clone)]
#[ts(export, export_to = "keyValue.ts")]
pub struct KeyValue {
    pub key: String,
    pub value: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, TS, Default, Clone)]
#[ts(export, export_to = "requestBody.ts")]
#[serde(tag = "mode", content = "data", rename_all = "lowercase")]
pub enum RequestBody {
    #[default]
    None,
    Json(String),
    Raw(String),
    Formdata(Vec<KeyValue>),
}

#[derive(Debug, Serialize, Deserialize, Default, TS, Clone)]
#[serde(default)]
#[ts(export, export_to = "requestTransforms.ts")]
pub struct RequestTransforms {
    pub pre_request_template: Option<String>,
    pub response_extractions: Vec<RequestExtractionRule>,
    pub before_run: Vec<BeforeRunStep>,
    pub chain_steps: Vec<RequestChainStep>,
}

#[derive(Debug, Serialize, Deserialize, TS, Clone)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "beforeRunStep.ts")]
pub struct BeforeRunStep {
    pub request_id: String,
}

#[derive(Debug, Serialize, Deserialize, TS, Clone)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "requestChainStep.ts")]
pub struct RequestChainStep {
    pub when: ChainCondition,
    pub next_request_id: String,
}

#[derive(Debug, Serialize, Deserialize, TS, Clone)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "chainCondition.ts")]
pub enum ChainCondition {
    OnSuccess,
    OnFailure,
}

#[derive(Debug, Serialize, Deserialize, TS, Clone)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "requestExtractionRule.ts")]
pub struct RequestExtractionRule {
    pub target: String,
    pub source: ExtractionSource,
    pub pattern: String,
}

#[derive(Debug, Serialize, Deserialize, TS, Clone)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "extractionSource.ts")]
pub enum ExtractionSource {
    ResponseBodyJson,
    ResponseBodyRaw,
}

fn default_true() -> bool {
    true
}
