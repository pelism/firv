import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { twMerge } from 'tailwind-merge';
import { FolderOpen, Trash2 } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useSidebarStore } from '../store/sidebarStore';
import { grpcClient } from '../lib/grpcClient';
import type { GrpcStreamingMode } from '../types/grpcRequest';
import { RequestEditorCommandBar, type EditorProtocol } from './RequestEditorCommandBar';
import { KVEditor, type KeyValue } from './editors/KVEditor';

interface ServiceMethod {
  service: string;
  method: string;
}

function parseServicesFromProto(proto: string): ServiceMethod[] {
  const results: ServiceMethod[] = [];
  const serviceRegex = /service\s+(\w+)\s*\{([^}]*)\}/gs;
  const rpcRegex = /rpc\s+(\w+)\s*\(/g;
  let sm: RegExpExecArray | null;
  while ((sm = serviceRegex.exec(proto)) !== null) {
    const serviceName = sm[1];
    const body = sm[2];
    let rm: RegExpExecArray | null;
    while ((rm = rpcRegex.exec(body)) !== null) {
      results.push({ service: serviceName, method: rm[1] });
    }
  }
  return results;
}

interface GrpcEditorProps {
  requestId: string;
  initialUrl?: string;
  onProtocolChange?: (p: EditorProtocol) => void;
}

export function GrpcEditor({ requestId, initialUrl, onProtocolChange }: GrpcEditorProps) {
  const [url, setUrl] = useState(initialUrl || '');
  const [protoSource, setProtoSource] = useState('');
  const [service, setService] = useState('');
  const [method, setMethod] = useState('');
  const [streamingMode, setStreamingMode] = useState<GrpcStreamingMode>('Unary');
  const [metadata, setMetadata] = useState<KeyValue[]>([]);
  const [message, setMessage] = useState('{}');
  const [activeTab, setActiveTab] = useState<'message' | 'metadata'>('message');
  const [parsedMethods, setParsedMethods] = useState<ServiceMethod[]>([]);

  const savedStateRef = useRef<any>(null);
  const hasHydratedRef = useRef(false);
  const isHydratingRef = useRef(false);

  const { projectPath, syncTreeToBackend, ensureWorkspace, getRequestName, clearPendingName, pendingNames } = useSidebarStore();
  const { setDirty, dirtyRequests, setGrpcStatus, appendGrpcMessage, clearGrpcMessages, grpcConnections } = useAppStore();
  const isDirty = dirtyRequests.has(requestId);
  const grpcConn = grpcConnections[requestId];
  const isStreaming = grpcConn?.status === 'connected' || grpcConn?.status === 'connecting';
  const isRunning = isStreaming || grpcConn?.status === 'connecting';

  const streamingModes: GrpcStreamingMode[] = ['Unary', 'ServerStreaming', 'ClientStreaming', 'Bidirectional'];

  useEffect(() => {
    const methods = parseServicesFromProto(protoSource);
    setParsedMethods(methods);
  }, [protoSource]);

  useEffect(() => {
    async function load() {
      if (!projectPath) return;
      try {
        isHydratingRef.current = true;
        const req: any = await invoke('get_grpc_request', { projectRoot: projectPath, id: requestId });
        setUrl(req.url || '');
        setProtoSource(req.proto_source || '');
        setService(req.service || '');
        setMethod(req.method || '');
        setStreamingMode(req.streaming_mode || 'Unary');
        setMetadata((req.metadata || []).map((h: any) => ({ id: Math.random().toString(36).substring(2, 9), ...h })));
        setMessage(req.message || '{}');
        savedStateRef.current = {
          url: req.url || '',
          proto_source: req.proto_source || '',
          service: req.service || '',
          method: req.method || '',
          streaming_mode: req.streaming_mode || 'Unary',
          metadata: (req.metadata || []).map((h: any) => ({ key: h.key, value: h.value, enabled: h.enabled })),
          message: req.message || '{}',
        };
        hasHydratedRef.current = true;
        setDirty(requestId, false);
      } catch {
        hasHydratedRef.current = true;
        setDirty(requestId, false);
      } finally {
        isHydratingRef.current = false;
      }
    }
    load();
  }, [requestId, projectPath]);

  useEffect(() => {
    if (!hasHydratedRef.current || isHydratingRef.current) return;
    if (!savedStateRef.current) {
      setDirty(requestId, true);
      return;
    }
    const current = {
      url,
      proto_source: protoSource,
      service,
      method,
      streaming_mode: streamingMode,
      metadata: metadata.map(h => ({ key: h.key, value: h.value, enabled: h.enabled })),
      message,
    };
    setDirty(requestId, JSON.stringify(current) !== JSON.stringify(savedStateRef.current));
  }, [url, protoSource, service, method, streamingMode, metadata, message, requestId]);

  const handleSave = useCallback(async () => {
    const ok = await ensureWorkspace();
    if (!ok) return;
    const { projectPath: currentPath, tree: currentTree } = useSidebarStore.getState();
    const requestName = pendingNames[requestId] || getRequestName(requestId) || 'New gRPC Request';

    try {
      const findItem = (items: any[]): any | null => {
        for (const item of items) {
          if ((item.kind.type === 'request' || item.kind.type === 'ws' || item.kind.type === 'grpc') && item.kind.id === requestId) return item;
          if (item.kind.type === 'folder') { const f = findItem(item.kind.items); if (f) return f; }
        }
        return null;
      };

      const existingItem = findItem(currentTree);
      let updatedTree = currentTree;

      if (!existingItem) {
        const newItem = { id: crypto.randomUUID(), kind: { type: 'grpc' as const, id: requestId, name: requestName } };
        updatedTree = [...currentTree, newItem];
        useSidebarStore.getState().updateTreeOptimistic(updatedTree);
        await syncTreeToBackend(updatedTree);
      } else if (existingItem.kind.type !== 'grpc' || pendingNames[requestId]) {
        const updateItems = (items: any[]): any[] => items.map(item => {
          if ((item.kind.type === 'request' || item.kind.type === 'ws' || item.kind.type === 'grpc') && item.kind.id === requestId) {
            return { ...item, kind: { type: 'grpc' as const, id: requestId, name: pendingNames[requestId] || item.kind.name } };
          }
          if (item.kind.type === 'folder') return { ...item, kind: { ...item.kind, items: updateItems(item.kind.items) } };
          return item;
        });
        updatedTree = updateItems(currentTree);
        useSidebarStore.getState().updateTreeOptimistic(updatedTree);
        await syncTreeToBackend(updatedTree);
        clearPendingName(requestId);
      }

      await invoke('update_grpc_request', {
        projectRoot: currentPath || '.',
        request: {
          id: requestId,
          name: requestName,
          url,
          proto_source: protoSource,
          service,
          method,
          streaming_mode: streamingMode,
          metadata: metadata.map(h => ({ key: h.key, value: h.value, enabled: h.enabled })),
          message,
        },
      });

      savedStateRef.current = {
        url, proto_source: protoSource, service, method,
        streaming_mode: streamingMode,
        metadata: metadata.map(h => ({ key: h.key, value: h.value, enabled: h.enabled })),
        message,
      };
      setDirty(requestId, false);
    } catch (err) {
      console.error('Failed to save gRPC request', err);
    }
  }, [requestId, url, protoSource, service, method, streamingMode, metadata, message, pendingNames, getRequestName, ensureWorkspace, syncTreeToBackend, clearPendingName, setDirty]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void handleSave(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  const handleLoadFromFile = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const selected = await open({ multiple: false, filters: [{ name: 'Proto Files', extensions: ['proto'] }], title: 'Select .proto file' });
      if (!selected || Array.isArray(selected)) return;
      const content = await readTextFile(selected);
      setProtoSource(content);
    } catch (err) {
      console.error('Failed to load proto file', err);
    }
  };

  const handleInvoke = async () => {
    clearGrpcMessages(requestId);
    const request = { id: requestId, name: getRequestName(requestId), url, proto_source: protoSource, service, method, streaming_mode: streamingMode, metadata: metadata.map(h => ({ key: h.key, value: h.value, enabled: h.enabled })), message };

    if (streamingMode === 'Unary') {
      setGrpcStatus(requestId, 'connecting');
      try {
        const result = await grpcClient.call(requestId, request);
        appendGrpcMessage(requestId, { direction: 'in', data: result, timestamp_ms: Date.now() });
        setGrpcStatus(requestId, 'disconnected');
      } catch (err: any) {
        appendGrpcMessage(requestId, { direction: 'in', data: String(err), timestamp_ms: Date.now() });
        setGrpcStatus(requestId, 'error');
      }
    } else {
      if (isStreaming) {
        await grpcClient.disconnect(requestId);
        setGrpcStatus(requestId, 'disconnected');
      } else {
        setGrpcStatus(requestId, 'connecting');
        const unlisten = [
          await grpcClient.onMessage(requestId, (data) => {
            appendGrpcMessage(requestId, { direction: 'in', data, timestamp_ms: Date.now() });
            setGrpcStatus(requestId, 'connected');
          }),
          await grpcClient.onClosed(requestId, () => setGrpcStatus(requestId, 'disconnected')),
          await grpcClient.onError(requestId, (msg) => {
            appendGrpcMessage(requestId, { direction: 'in', data: `Error: ${msg}`, timestamp_ms: Date.now() });
            setGrpcStatus(requestId, 'error');
          }),
        ];
        try {
          await grpcClient.connect(requestId, request);
          setGrpcStatus(requestId, 'connected');
        } catch (err: any) {
          for (const u of unlisten) u();
          appendGrpcMessage(requestId, { direction: 'in', data: String(err), timestamp_ms: Date.now() });
          setGrpcStatus(requestId, 'error');
        }
      }
    }
  };

  const handleSendMessage = async () => {
    if (!isStreaming) return;
    appendGrpcMessage(requestId, { direction: 'out', data: message, timestamp_ms: Date.now() });
    await grpcClient.send(requestId, message);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-background w-full">
      <RequestEditorCommandBar
        protocol="grpc"
        onProtocolChange={onProtocolChange || (() => {})}
        method=""
        url={url}
        onMethodChange={() => {}}
        onUrlChange={setUrl}
        onSave={handleSave}
        onRun={handleInvoke}
        isRunning={isRunning}
        isDirty={isDirty}
        projectPath={projectPath}
        isWsConnected={isStreaming}
        isScratchpadRequest={false}
        workspaceGlobals={{}}
        validationError={null}
      />

      {/* Split body: proto top, message+metadata bottom */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Top pane: proto source */}
        <div className="flex flex-col border-b border-border" style={{ height: '40%', minHeight: 120 }}>
          <div className="flex items-center justify-between px-4 py-1.5 bg-muted/30 border-b border-border">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Proto Definition</span>
            <button
              onClick={handleLoadFromFile}
              className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
              title="Load from .proto file"
            >
              <FolderOpen size={12} />
              Load from File
            </button>
          </div>
          <textarea
            className="flex-1 font-mono text-xs p-3 bg-background text-foreground resize-none outline-none custom-scrollbar"
            placeholder={'syntax = "proto3";\n\nservice MyService {\n  rpc SayHello (HelloRequest) returns (HelloReply);\n}'}
            value={protoSource}
            onChange={e => setProtoSource(e.target.value)}
            spellCheck={false}
          />
        </div>

        {/* Bottom pane: service/method/mode selectors + tabs */}
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-muted/30 flex-wrap">
            {/* Service selector */}
            <select
              value={service}
              onChange={e => { setService(e.target.value); setMethod(''); }}
              className="h-8 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground outline-none transition-all focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Service…</option>
              {[...new Set(parsedMethods.map(m => m.service))].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            {/* Method selector */}
            <select
              value={method}
              onChange={e => setMethod(e.target.value)}
              className="h-8 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground outline-none transition-all focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Method…</option>
              {parsedMethods.filter(m => m.service === service).map(m => (
                <option key={m.method} value={m.method}>{m.method}</option>
              ))}
            </select>

            {/* Streaming mode */}
            <select
              value={streamingMode}
              onChange={e => setStreamingMode(e.target.value as GrpcStreamingMode)}
              className="h-8 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground outline-none transition-all focus:ring-2 focus:ring-primary/20"
            >
              {streamingModes.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>

            {/* Tabs */}
            <div className="ml-auto flex">
              {(['message', 'metadata'] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={twMerge('px-3 py-1 text-xs font-semibold uppercase tracking-tight border-b-2 transition-all',
                    activeTab === tab ? 'text-foreground border-primary' : 'text-muted-foreground hover:text-foreground border-transparent'
                  )}>
                  {tab}
                </button>
              ))}
            </div>
          </div>

          {/* Tab content */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {activeTab === 'message' ? (
              <div className="flex-1 flex flex-col min-h-0">
                <textarea
                  className="flex-1 font-mono text-xs p-3 bg-background text-foreground resize-none outline-none custom-scrollbar"
                  placeholder='{"field": "value"}'
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  spellCheck={false}
                />
                {(streamingMode === 'ClientStreaming' || streamingMode === 'Bidirectional') && isStreaming && (
                  <div className="border-t border-border p-2 flex justify-end">
                    <button onClick={handleSendMessage}
                      className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg font-bold hover:bg-primary/90 transition-colors">
                      Send Frame
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 overflow-auto p-3 custom-scrollbar">
                <KVEditor
                  data={metadata}
                  onChange={setMetadata}
                  placeholderKey="metadata-key"
                  placeholderValue="value"
                />
              </div>
            )}
          </div>

          {/* Response / streaming log */}
          {grpcConn && grpcConn.messages.length > 0 && (
            <div className="border-t border-border flex flex-col" style={{ height: '35%', minHeight: 100 }}>
              <div className="flex items-center justify-between px-4 py-1.5 bg-muted/30 border-b border-border">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Response {grpcConn.status !== 'disconnected' && <span className={twMerge('ml-2 text-[10px]', grpcConn.status === 'connected' ? 'text-green-500' : grpcConn.status === 'error' ? 'text-red-500' : 'text-yellow-500')}>{grpcConn.status}</span>}
                </span>
                <button onClick={() => clearGrpcMessages(requestId)} className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors" title="Clear">
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-3 font-mono text-xs custom-scrollbar space-y-1">
                {grpcConn.messages.map((msg, i) => (
                  <div key={i} className={twMerge('flex gap-2', msg.direction === 'out' ? 'text-blue-400' : 'text-foreground')}>
                    <span className="text-muted-foreground shrink-0">{new Date(msg.timestamp_ms).toLocaleTimeString()}</span>
                    <span className={twMerge('shrink-0 font-bold', msg.direction === 'out' ? 'text-blue-400' : 'text-green-400')}>{msg.direction === 'out' ? '→' : '←'}</span>
                    <pre className="whitespace-pre-wrap break-all">{msg.data}</pre>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
