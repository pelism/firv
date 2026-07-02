import type { KeyValue } from "./keyValue";

export type GrpcStreamingMode = "Unary" | "ServerStreaming" | "ClientStreaming" | "Bidirectional";

export type GrpcRequest = {
  id: string;
  name: string;
  url: string;
  proto_source: string;
  service: string;
  method: string;
  streaming_mode: GrpcStreamingMode;
  metadata: Array<KeyValue>;
  message: string;
};
