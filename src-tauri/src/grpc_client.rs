use std::collections::HashMap;
use std::sync::Mutex;

use futures_util::StreamExt;
use prost::bytes::Buf;
use prost::Message as ProstMessage;
use prost_reflect::{DescriptorPool, DynamicMessage, MessageDescriptor};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};
use tonic::transport::Channel;
use tonic::{Code, Request, Status};

use crate::models::grpc_request::{GrpcRequest, GrpcStreamingMode};

// ---------- Registry ----------

pub struct GrpcStreamHandle {
    pub cancel_tx: tokio::sync::oneshot::Sender<()>,
    pub send_tx: Option<mpsc::Sender<String>>,
}

pub struct GrpcConnectionRegistry(pub Mutex<HashMap<String, GrpcStreamHandle>>);

impl GrpcConnectionRegistry {
    pub fn new() -> Self {
        GrpcConnectionRegistry(Mutex::new(HashMap::new()))
    }
}

// ---------- Dynamic codec ----------

#[derive(Clone)]
struct DynamicCodec {
    request_desc: MessageDescriptor,
    response_desc: MessageDescriptor,
}

impl Codec for DynamicCodec {
    type Encode = DynamicMessage;
    type Decode = DynamicMessage;
    type Encoder = DynamicEncoder;
    type Decoder = DynamicDecoder;

    fn encoder(&mut self) -> Self::Encoder {
        DynamicEncoder {
            desc: self.request_desc.clone(),
        }
    }

    fn decoder(&mut self) -> Self::Decoder {
        DynamicDecoder {
            desc: self.response_desc.clone(),
        }
    }
}

struct DynamicEncoder {
    desc: MessageDescriptor,
}

impl Encoder for DynamicEncoder {
    type Item = DynamicMessage;
    type Error = Status;

    fn encode(&mut self, item: Self::Item, dst: &mut EncodeBuf<'_>) -> Result<(), Self::Error> {
        let _ = self.desc.clone();
        item.encode(dst)
            .map_err(|e| Status::new(Code::Internal, format!("Encode error: {}", e)))
    }
}

struct DynamicDecoder {
    desc: MessageDescriptor,
}

impl Decoder for DynamicDecoder {
    type Item = DynamicMessage;
    type Error = Status;

    fn decode(&mut self, src: &mut DecodeBuf<'_>) -> Result<Option<Self::Item>, Self::Error> {
        let buf = src.chunk().to_vec();
        if buf.is_empty() {
            return Ok(None);
        }
        let msg = DynamicMessage::decode(self.desc.clone(), buf.as_slice())
            .map_err(|e| Status::new(Code::Internal, format!("Decode error: {}", e)))?;
        src.advance(buf.len());
        Ok(Some(msg))
    }
}

// ---------- Helpers ----------

fn parse_pool(proto_source: &str) -> Result<DescriptorPool, String> {
    let tmp_dir = std::env::temp_dir();
    let filename = format!("firv_proto_{}.proto", uuid::Uuid::new_v4());
    let tmp_path = tmp_dir.join(&filename);
    std::fs::write(&tmp_path, proto_source)
        .map_err(|e| format!("Failed to write temp proto file: {}", e))?;
    let result = (|| {
        let mut compiler = protox::Compiler::new([&tmp_dir])
            .map_err(|e| format!("Failed to create protox compiler: {}", e))?;
        compiler.include_imports(true);
        compiler.open_file(&tmp_path)
            .map_err(|e| format!("Failed to compile proto: {}", e))?;
        let file_descriptor_set = compiler.file_descriptor_set();
        DescriptorPool::from_file_descriptor_set(file_descriptor_set)
            .map_err(|e| format!("Failed to build descriptor pool: {}", e))
    })();
    let _ = std::fs::remove_file(&tmp_path);
    result
}

fn find_method_descriptors(
    pool: &DescriptorPool,
    service_name: &str,
    method_name: &str,
) -> Result<(MessageDescriptor, MessageDescriptor, String), String> {
    let service = pool
        .services()
        .find(|s| s.name() == service_name || s.full_name() == service_name)
        .ok_or_else(|| format!("Service '{}' not found in proto", service_name))?;

    let method = service
        .methods()
        .find(|m| m.name() == method_name)
        .ok_or_else(|| format!("Method '{}' not found in service '{}'", method_name, service_name))?;

    let grpc_path = format!("/{}/{}", service.full_name(), method.name());
    Ok((method.input(), method.output(), grpc_path))
}

fn json_to_dynamic(msg_desc: &MessageDescriptor, json: &str) -> Result<DynamicMessage, String> {
    let mut deserializer = serde_json::Deserializer::from_str(json);
    DynamicMessage::deserialize(msg_desc.clone(), &mut deserializer)
        .map_err(|e| format!("Failed to map JSON to proto message: {}", e))
}

fn dynamic_to_json(msg: &DynamicMessage) -> Result<String, String> {
    let json_val = serde_json::to_value(msg)
        .map_err(|e| format!("Failed to serialize response to JSON: {}", e))?;
    serde_json::to_string_pretty(&json_val).map_err(|e| format!("JSON stringify failed: {}", e))
}

async fn build_channel(url: &str) -> Result<Channel, String> {
    let is_plaintext = url.starts_with("http://");
    let endpoint = if url.starts_with("http://") || url.starts_with("https://") {
        url.to_string()
    } else {
        format!("https://{}", url)
    };

    let mut builder = Channel::from_shared(endpoint)
        .map_err(|e| format!("Invalid gRPC endpoint: {}", e))?;

    if !is_plaintext {
        let tls = tonic::transport::ClientTlsConfig::new()
            .with_native_roots();
        builder = builder
            .tls_config(tls)
            .map_err(|e| format!("TLS config error: {}", e))?;
    }

    builder
        .connect()
        .await
        .map_err(|e| format!("Failed to connect to gRPC server: {}", e))
}

fn build_request<T>(message: T, metadata: &[crate::models::request::KeyValue]) -> Request<T> {
    let mut req = Request::new(message);
    for kv in metadata {
        if kv.enabled && !kv.key.is_empty() {
            if let (Ok(k), Ok(v)) = (
                kv.key.parse::<tonic::metadata::MetadataKey<tonic::metadata::Ascii>>(),
                kv.value.parse::<tonic::metadata::AsciiMetadataValue>(),
            ) {
                req.metadata_mut().insert(k, v);
            }
        }
    }
    req
}

// ---------- Tauri commands ----------

#[tauri::command]
pub async fn grpc_call(
    app: AppHandle,
    id: String,
    request: GrpcRequest,
) -> Result<String, String> {
    let pool = parse_pool(&request.proto_source)?;
    let (input_desc, output_desc, grpc_path) =
        find_method_descriptors(&pool, &request.service, &request.method)?;

    let channel = build_channel(&request.url).await?;
    let msg = json_to_dynamic(&input_desc, &request.message)?;
    let tonic_req = build_request(msg, &request.metadata);

    let codec = DynamicCodec {
        request_desc: input_desc,
        response_desc: output_desc,
    };

    let mut client = tonic::client::Grpc::new(channel);
    client.ready().await.map_err(|e| format!("gRPC channel not ready: {}", e))?;

    let path: tonic::codegen::http::uri::PathAndQuery = grpc_path
        .parse()
        .map_err(|e| format!("Invalid gRPC path '{}': {}", grpc_path, e))?;

    match request.streaming_mode {
        GrpcStreamingMode::Unary => {
            let response = client
                .unary(tonic_req, path, codec)
                .await
                .map_err(|e| format!("gRPC call failed: {}", e))?;
            let json = dynamic_to_json(&response.into_inner())?;
            let _ = app.emit(&format!("grpc_message_{}", id), &json);
            Ok(json)
        }
        GrpcStreamingMode::ServerStreaming => {
            let mut stream = client
                .server_streaming(tonic_req, path, codec)
                .await
                .map_err(|e| format!("gRPC server-streaming call failed: {}", e))?
                .into_inner();
            let id_clone = id.clone();
            let app_clone = app.clone();
            tokio::spawn(async move {
                while let Some(result) = stream.next().await {
                    match result {
                        Ok(msg) => {
                            if let Ok(json) = dynamic_to_json(&msg) {
                                let _ = app_clone.emit(&format!("grpc_message_{}", id_clone), &json);
                            }
                        }
                        Err(e) => {
                            let _ = app_clone.emit(
                                &format!("grpc_error_{}", id_clone),
                                format!("Stream error: {}", e),
                            );
                            break;
                        }
                    }
                }
                let _ = app_clone.emit(&format!("grpc_closed_{}", id_clone), ());
            });
            Ok("streaming".to_string())
        }
        _ => Err("Client-streaming and bidirectional streaming require grpc_connect".to_string()),
    }
}

#[tauri::command]
pub async fn grpc_connect(
    app: AppHandle,
    id: String,
    request: GrpcRequest,
    registry: tauri::State<'_, GrpcConnectionRegistry>,
) -> Result<(), String> {
    let pool = parse_pool(&request.proto_source)?;
    let (input_desc, output_desc, grpc_path) =
        find_method_descriptors(&pool, &request.service, &request.method)?;

    let channel = build_channel(&request.url).await?;
    let codec = DynamicCodec {
        request_desc: input_desc.clone(),
        response_desc: output_desc,
    };

    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();
    let (send_tx, mut send_rx) = mpsc::channel::<String>(64);

    let path: tonic::codegen::http::uri::PathAndQuery = grpc_path
        .parse()
        .map_err(|e| format!("Invalid gRPC path '{}': {}", grpc_path, e))?;

    {
        let mut map = registry.0.lock().map_err(|e| format!("Lock error: {}", e))?;
        map.insert(
            id.clone(),
            GrpcStreamHandle {
                cancel_tx,
                send_tx: Some(send_tx),
            },
        );
    }

    let app_clone = app.clone();
    let id_clone = id.clone();

    tokio::spawn(async move {
        let outbound = async_stream::stream! {
            while let Some(json) = send_rx.recv().await {
                if let Ok(msg) = json_to_dynamic(&input_desc, &json) {
                    yield msg;
                }
            }
        };

        let tonic_req = Request::new(outbound);

        let mut client = tonic::client::Grpc::new(channel);
        if client.ready().await.is_err() {
            let _ = app_clone.emit(&format!("grpc_error_{}", id_clone), "Channel not ready");
            return;
        }

        match request.streaming_mode {
            GrpcStreamingMode::ClientStreaming => {
                tokio::select! {
                    result = client.client_streaming(tonic_req, path, codec) => {
                        match result {
                            Ok(response) => {
                                let inner = response.into_inner();
                                if let Ok(json) = dynamic_to_json(&inner) {
                                    let _ = app_clone.emit(&format!("grpc_message_{}", id_clone), &json);
                                }
                            }
                            Err(e) => {
                                let _ = app_clone.emit(&format!("grpc_error_{}", id_clone), format!("Error: {}", e));
                            }
                        }
                    }
                    _ = &mut cancel_rx => {}
                }
            }
            GrpcStreamingMode::Bidirectional => {
                tokio::select! {
                    result = client.streaming(tonic_req, path, codec) => {
                        match result {
                            Ok(response) => {
                                let mut stream = response.into_inner();
                                loop {
                                    tokio::select! {
                                        msg = stream.next() => {
                                            match msg {
                                                Some(Ok(m)) => {
                                                    if let Ok(json) = dynamic_to_json(&m) {
                                                        let _ = app_clone.emit(&format!("grpc_message_{}", id_clone), &json);
                                                    }
                                                }
                                                Some(Err(e)) => {
                                                    let _ = app_clone.emit(&format!("grpc_error_{}", id_clone), format!("Stream error: {}", e));
                                                    break;
                                                }
                                                None => break,
                                            }
                                        }
                                        _ = &mut cancel_rx => break,
                                    }
                                }
                            }
                            Err(e) => {
                                let _ = app_clone.emit(&format!("grpc_error_{}", id_clone), format!("Error: {}", e));
                            }
                        }
                    }
                    _ = &mut cancel_rx => {}
                }
            }
            _ => {}
        }

        let _ = app_clone.emit(&format!("grpc_closed_{}", id_clone), ());
    });

    Ok(())
}

#[tauri::command]
pub async fn grpc_send(
    id: String,
    message: String,
    registry: tauri::State<'_, GrpcConnectionRegistry>,
) -> Result<(), String> {
    let tx = {
        let map = registry.0.lock().map_err(|e| format!("Lock error: {}", e))?;
        map.get(&id)
            .and_then(|h| h.send_tx.as_ref())
            .map(|tx| tx.clone())
    };
    match tx {
        Some(tx) => tx
            .send(message)
            .await
            .map_err(|e| format!("Failed to send message: {}", e)),
        None => Err(format!("No active gRPC stream for id '{}'", id)),
    }
}

#[tauri::command]
pub async fn grpc_disconnect(
    id: String,
    registry: tauri::State<'_, GrpcConnectionRegistry>,
) -> Result<(), String> {
    let handle = {
        let mut map = registry.0.lock().map_err(|e| format!("Lock error: {}", e))?;
        map.remove(&id)
    };
    if let Some(h) = handle {
        let _ = h.cancel_tx.send(());
    }
    Ok(())
}
