use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::models::request::KeyValue;

#[derive(Debug, Serialize, Deserialize, TS, Clone)]
#[ts(export, export_to = "wsRequest.ts")]
pub struct WsRequest {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<KeyValue>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_ws_request_yaml() {
        let request = WsRequest {
            id: "ws-1".to_string(),
            name: "My WS Request".to_string(),
            url: "wss://example.com/socket".to_string(),
            headers: vec![KeyValue {
                key: "Authorization".to_string(),
                value: "Bearer token".to_string(),
                enabled: true,
            }],
        };

        let yaml = serde_yaml::to_string(&request).unwrap();
        let decoded: WsRequest = serde_yaml::from_str(&yaml).unwrap();

        assert_eq!(decoded.id, request.id);
        assert_eq!(decoded.name, request.name);
        assert_eq!(decoded.url, request.url);
        assert_eq!(decoded.headers.len(), 1);
        assert_eq!(decoded.headers[0].key, "Authorization");
    }

    #[test]
    fn headers_default_when_omitted() {
        let yaml = "id: ws-2\nname: Simple\nurl: ws://localhost:8080\n";
        let decoded: WsRequest = serde_yaml::from_str(yaml).unwrap();
        assert!(decoded.headers.is_empty());
    }
}
