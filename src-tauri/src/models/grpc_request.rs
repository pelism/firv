use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::models::request::KeyValue;

#[derive(Debug, Serialize, Deserialize, TS, Clone, PartialEq)]
#[ts(export, export_to = "grpcStreamingMode.ts")]
pub enum GrpcStreamingMode {
    Unary,
    ServerStreaming,
    ClientStreaming,
    Bidirectional,
}

impl Default for GrpcStreamingMode {
    fn default() -> Self {
        GrpcStreamingMode::Unary
    }
}

#[derive(Debug, Serialize, Deserialize, TS, Clone)]
#[ts(export, export_to = "grpcRequest.ts")]
pub struct GrpcRequest {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub proto_source: String,
    #[serde(default)]
    pub service: String,
    #[serde(default)]
    pub method: String,
    #[serde(default)]
    pub streaming_mode: GrpcStreamingMode,
    #[serde(default)]
    pub metadata: Vec<KeyValue>,
    #[serde(default)]
    pub message: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_grpc_request_yaml() {
        let request = GrpcRequest {
            id: "grpc-1".to_string(),
            name: "My gRPC Request".to_string(),
            url: "localhost:50051".to_string(),
            proto_source: "syntax = \"proto3\";".to_string(),
            service: "MyService".to_string(),
            method: "SayHello".to_string(),
            streaming_mode: GrpcStreamingMode::Unary,
            metadata: vec![KeyValue {
                key: "authorization".to_string(),
                value: "Bearer token".to_string(),
                enabled: true,
                secret_ref: None,
            }],
            message: r#"{"name": "world"}"#.to_string(),
        };

        let yaml = serde_yaml::to_string(&request).unwrap();
        let decoded: GrpcRequest = serde_yaml::from_str(&yaml).unwrap();

        assert_eq!(decoded.id, request.id);
        assert_eq!(decoded.name, request.name);
        assert_eq!(decoded.url, request.url);
        assert_eq!(decoded.service, request.service);
        assert_eq!(decoded.method, request.method);
        assert_eq!(decoded.streaming_mode, GrpcStreamingMode::Unary);
        assert_eq!(decoded.metadata.len(), 1);
    }

    #[test]
    fn defaults_when_fields_omitted() {
        let yaml = "id: grpc-2\nname: Simple\nurl: localhost:50051\n";
        let decoded: GrpcRequest = serde_yaml::from_str(yaml).unwrap();
        assert!(decoded.proto_source.is_empty());
        assert!(decoded.metadata.is_empty());
        assert!(decoded.message.is_empty());
        assert_eq!(decoded.streaming_mode, GrpcStreamingMode::Unary);
    }
}
