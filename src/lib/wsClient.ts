import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface WsMessage {
  direction: 'in' | 'out';
  data: string;
  timestamp_ms: number;
}

export interface WsClosedPayload {
  reason: string | null;
}

export interface WsErrorPayload {
  message: string;
}

export type WsConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface KeyValueHeader {
  key: string;
  value: string;
  enabled: boolean;
}

export const wsClient = {
  connect(id: string, url: string, headers: KeyValueHeader[]): Promise<void> {
    return invoke('ws_connect', { id, url, headers });
  },

  send(id: string, message: string): Promise<void> {
    return invoke('ws_send', { id, message });
  },

  disconnect(id: string): Promise<void> {
    return invoke('ws_disconnect', { id });
  },

  onMessage(id: string, cb: (msg: WsMessage) => void): Promise<UnlistenFn> {
    return listen<WsMessage>(`ws_message_${id}`, (event) => cb(event.payload));
  },

  onClosed(id: string, cb: (payload: WsClosedPayload) => void): Promise<UnlistenFn> {
    return listen<WsClosedPayload>(`ws_closed_${id}`, (event) => cb(event.payload));
  },

  onError(id: string, cb: (payload: WsErrorPayload) => void): Promise<UnlistenFn> {
    return listen<WsErrorPayload>(`ws_error_${id}`, (event) => cb(event.payload));
  },
};
