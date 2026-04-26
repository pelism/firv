use serde::{Deserialize, Serialize};

use crate::models::manifest::ScriptConfig;

#[derive(Debug, Serialize, Deserialize)]
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
    pub scripts: ScriptConfig,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum HttpMethod {
    GET,
    POST,
    PUT,
    DELETE,
    PATCH,
    HEAD,
    OPTIONS,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KeyValue {
    pub key: String,
    pub value: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "mode", content = "data", rename_all = "lowercase")]
pub enum RequestBody {
    None,
    Json(String),
    Raw(String),
    Formdata(Vec<KeyValue>),
}


fn default_true() -> bool {
    true
}
