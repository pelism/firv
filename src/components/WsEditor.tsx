import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { twMerge } from 'tailwind-merge';
import { useAppStore } from '../store/appStore';
import { useSidebarStore } from '../store/sidebarStore';
import { RequestEditorCommandBar, type EditorProtocol } from './RequestEditorCommandBar';
import { wsClient, type WsMessage } from '../lib/wsClient';
import { WsConsole } from './WsConsole';
import { KVEditor, type KeyValue } from './editors/KVEditor';

interface WsEditorProps {
  requestId: string;
  initialUrl?: string;
  onProtocolChange?: (p: EditorProtocol) => void;
}

export function WsEditor({ requestId, initialUrl, onProtocolChange }: WsEditorProps) {
  const [url, setUrl] = useState(initialUrl ?? '');
  const [headers, setHeaders] = useState<KeyValue[]>([]);
  const [activeTab, setActiveTab] = useState<'headers'>('headers');
  const savedStateRef = useRef<{ url: string; headers: string } | null>(null);
  const unlistenRefs = useRef<Array<() => void>>([]);

  const { setWsStatus, appendWsMessage, wsConnections, setDirty } = useAppStore();
  const isDirty = useAppStore(state => state.dirtyRequests.has(requestId));
  const connection = wsConnections[requestId] ?? { status: 'disconnected' as const, messages: [] };
  const { projectPath, getRequestName, pendingNames } = useSidebarStore();

  useEffect(() => {
    async function load() {
      if (!projectPath) return;
      try {
        const req: any = await invoke('get_ws_request', { projectRoot: projectPath, id: requestId });
        const loadedUrl = req.url || '';
        const loadedHeaders = (req.headers || []).map((h: any) => ({ id: Math.random().toString(36).slice(2), ...h }));
        setUrl(loadedUrl);
        setHeaders(loadedHeaders);
        savedStateRef.current = {
          url: loadedUrl,
          headers: JSON.stringify(loadedHeaders.map((h: KeyValue) => ({ key: h.key, value: h.value, enabled: h.enabled }))),
        };
        setDirty(requestId, false);
      } catch {
        savedStateRef.current = null;
        setDirty(requestId, true);
      }
    }
    load();
  }, [requestId, projectPath]);

  useEffect(() => {
    if (!savedStateRef.current) {
      setDirty(requestId, true);
      return;
    }
    const headersSnapshot = JSON.stringify(headers.map(h => ({ key: h.key, value: h.value, enabled: h.enabled })));
    setDirty(requestId, url !== savedStateRef.current.url || headersSnapshot !== savedStateRef.current.headers);
  }, [url, headers, requestId, setDirty]);

  const setupListeners = useCallback(async () => {
    const unlistenMsg = await wsClient.onMessage(requestId, (msg: WsMessage) => {
      appendWsMessage(requestId, msg);
    });
    const unlistenClosed = await wsClient.onClosed(requestId, () => {
      setWsStatus(requestId, 'disconnected');
    });
    const unlistenError = await wsClient.onError(requestId, () => {
      setWsStatus(requestId, 'error');
    });
    unlistenRefs.current = [unlistenMsg, unlistenClosed, unlistenError];
  }, [requestId, appendWsMessage, setWsStatus]);

  useEffect(() => {
    return () => {
      unlistenRefs.current.forEach(fn => fn());
      unlistenRefs.current = [];
    };
  }, [requestId]);

  const handleConnect = async () => {
    setWsStatus(requestId, 'connecting');
    await setupListeners();
    try {
      await wsClient.connect(
        requestId,
        url,
        headers.filter(h => h.enabled).map(h => ({ key: h.key, value: h.value, enabled: h.enabled }))
      );
      setWsStatus(requestId, 'connected');
    } catch (e: any) {
      setWsStatus(requestId, 'error');
      appendWsMessage(requestId, {
        direction: 'in',
        data: `Connection error: ${e?.message ?? String(e)}`,
        timestamp_ms: Date.now(),
      });
    }
  };

  const handleDisconnect = async () => {
    await wsClient.disconnect(requestId);
    setWsStatus(requestId, 'disconnected');
    unlistenRefs.current.forEach(fn => fn());
    unlistenRefs.current = [];
  };

  const handleSend = async (message: string) => {
    try {
      await wsClient.send(requestId, message);
      appendWsMessage(requestId, { direction: 'out', data: message, timestamp_ms: Date.now() });
    } catch (e: any) {
      appendWsMessage(requestId, {
        direction: 'in',
        data: `Send error: ${e?.message ?? String(e)}`,
        timestamp_ms: Date.now(),
      });
    }
  };

  const handleSave = async () => {
    if (!projectPath) return;
    try {
      const name = pendingNames[requestId] || getRequestName(requestId) || 'New WS Request';
      await invoke('update_ws_request', {
        projectRoot: projectPath,
        request: {
          id: requestId,
          name,
          url,
          headers: headers.map(h => ({ key: h.key, value: h.value, enabled: h.enabled })),
        },
      });
      savedStateRef.current = {
        url,
        headers: JSON.stringify(headers.map(h => ({ key: h.key, value: h.value, enabled: h.enabled }))),
      };
      setDirty(requestId, false);
    } catch (e) {
      console.error('Failed to save WS request', e);
    }
  };

  const isConnected = connection.status === 'connected';
  const isConnecting = connection.status === 'connecting';

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-background w-full">
      <RequestEditorCommandBar
        protocol="ws"
        onProtocolChange={p => onProtocolChange?.(p)}
        method="WS"
        onMethodChange={() => {}}
        url={url}
        onUrlChange={setUrl}
        onSave={handleSave}
        onRun={isConnected ? handleDisconnect : handleConnect}
        isRunning={isConnecting}
        isWsConnected={isConnected}
        isDirty={isDirty}
        projectPath={projectPath ?? ''}
        validationError={null}
        isScratchpadRequest={false}
        workspaceGlobals={{}}
      />

      {/* Tab bar */}
      <div className="px-4 py-2 border-b border-border bg-muted/30">
        <div className="flex bg-muted p-1 rounded-lg w-fit">
          {(['headers'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={twMerge(
                'px-4 py-1.5 text-xs font-semibold rounded-md transition-all uppercase tracking-tight',
                activeTab === tab ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Headers panel */}
      <div className="border-b border-border overflow-auto" style={{ maxHeight: '180px' }}>
        <div className="p-4">
          <KVEditor
            data={headers}
            onChange={setHeaders}
            placeholderKey="Header"
            placeholderValue="Value"
          />
        </div>
      </div>

      {/* WS Console */}
      <WsConsole
        requestId={requestId}
        messages={connection.messages}
        status={connection.status}
        onSend={handleSend}
      />
    </div>
  );
}
