use std::collections::HashMap;
use tokio::sync::Mutex;

use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::MaybeTlsStream;
use tokio::net::TcpStream;
use futures_util::{SinkExt, StreamExt};
use tauri::Emitter;
use serde::Serialize;
use tauri::AppHandle;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{HeaderName, HeaderValue};

use crate::models::request::KeyValue;

#[derive(Debug, Clone, Serialize)]
pub struct WsMessagePayload {
    pub direction: String,
    pub data: String,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct WsClosedPayload {
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WsErrorPayload {
    pub message: String,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

type WsSink = futures_util::stream::SplitSink<
    WebSocketStream<MaybeTlsStream<TcpStream>>,
    Message,
>;

pub struct WsConnectionRegistry(pub Mutex<HashMap<String, WsSink>>);

impl WsConnectionRegistry {
    pub fn new() -> Self {
        WsConnectionRegistry(Mutex::new(HashMap::new()))
    }
}

#[tauri::command]
pub async fn ws_connect(
    app: AppHandle,
    id: String,
    url: String,
    headers: Vec<KeyValue>,
    registry: tauri::State<'_, WsConnectionRegistry>,
) -> Result<(), String> {
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|e| format!("Invalid WebSocket URL: {}", e))?;

    request.headers_mut().insert(
        HeaderName::from_static("user-agent"),
        HeaderValue::from_static("firv/1.0"),
    );

    for kv in &headers {
        if kv.enabled {
            let name = HeaderName::from_bytes(kv.key.as_bytes())
                .map_err(|e| format!("Invalid header name '{}': {}", kv.key, e))?;
            let value = HeaderValue::from_str(&kv.value)
                .map_err(|e| format!("Invalid header value '{}': {}", kv.value, e))?;
            request.headers_mut().insert(name, value);
        }
    }

    let (ws_stream, _) = connect_async(request)
        .await
        .map_err(|e| format!("WebSocket connection failed: {}", e))?;

    let (sink, mut stream) = ws_stream.split();

    {
        let mut guard = registry.0.lock().await;
        guard.insert(id.clone(), sink);
    }

    let app_clone = app.clone();
    let id_clone = id.clone();
    tokio::spawn(async move {
        while let Some(msg_result) = stream.next().await {
            match msg_result {
                Ok(Message::Text(text)) => {
                    let payload = WsMessagePayload {
                        direction: "in".to_string(),
                        data: text.to_string(),
                        timestamp_ms: now_ms(),
                    };
                    let _ = app_clone.emit(&format!("ws_message_{}", id_clone), payload);
                }
                Ok(Message::Binary(bytes)) => {
                    let payload = WsMessagePayload {
                        direction: "in".to_string(),
                        data: format!("<binary {} bytes>", bytes.len()),
                        timestamp_ms: now_ms(),
                    };
                    let _ = app_clone.emit(&format!("ws_message_{}", id_clone), payload);
                }
                Ok(Message::Close(frame)) => {
                    let reason = frame.map(|f| f.reason.to_string());
                    let _ = app_clone.emit(
                        &format!("ws_closed_{}", id_clone),
                        WsClosedPayload { reason },
                    );
                    break;
                }
                Ok(_) => {}
                Err(e) => {
                    let _ = app_clone.emit(
                        &format!("ws_error_{}", id_clone),
                        WsErrorPayload {
                            message: e.to_string(),
                        },
                    );
                    break;
                }
            }
        }
        let _ = app_clone.emit(
            &format!("ws_closed_{}", id_clone),
            WsClosedPayload { reason: None },
        );
    });

    Ok(())
}

#[tauri::command]
pub async fn ws_send(
    id: String,
    message: String,
    registry: tauri::State<'_, WsConnectionRegistry>,
) -> Result<(), String> {
    let mut guard = registry.0.lock().await;
    let sink = guard
        .get_mut(&id)
        .ok_or_else(|| format!("No active WS connection for id: {}", id))?;
    sink.send(Message::Text(message.into()))
        .await
        .map_err(|e| format!("Failed to send WS message: {}", e))
}

#[tauri::command]
pub async fn ws_disconnect(
    id: String,
    registry: tauri::State<'_, WsConnectionRegistry>,
) -> Result<(), String> {
    let mut guard = registry.0.lock().await;
    if let Some(mut sink) = guard.remove(&id) {
        let _ = sink.send(Message::Close(None)).await;
    }
    Ok(())
}
