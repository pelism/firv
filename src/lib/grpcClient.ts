import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { GrpcRequest } from '../types/grpcRequest';

export type GrpcConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface GrpcMessage {
  direction: 'in' | 'out';
  data: string;
  timestamp_ms: number;
}

export const grpcClient = {
  call(id: string, request: GrpcRequest): Promise<string> {
    return invoke('grpc_call', { id, request });
  },

  connect(id: string, request: GrpcRequest): Promise<void> {
    return invoke('grpc_connect', { id, request });
  },

  send(id: string, message: string): Promise<void> {
    return invoke('grpc_send', { id, message });
  },

  finish(id: string): Promise<void> {
    return invoke('grpc_finish_stream', { id });
  },

  disconnect(id: string): Promise<void> {
    return invoke('grpc_disconnect', { id });
  },

  onMessage(id: string, cb: (data: string) => void): Promise<UnlistenFn> {
    return listen<string>(`grpc_message_${id}`, (event) => cb(event.payload));
  },

  onClosed(id: string, cb: () => void): Promise<UnlistenFn> {
    return listen<void>(`grpc_closed_${id}`, () => cb());
  },

  onError(id: string, cb: (message: string) => void): Promise<UnlistenFn> {
    return listen<string>(`grpc_error_${id}`, (event) => cb(event.payload));
  },
};
