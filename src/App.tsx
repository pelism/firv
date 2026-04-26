import { useState, useRef, useEffect } from "react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { Sidebar } from "./components/Sidebar";
import { RequestEditor } from "./components/RequestEditor";
import { ResponseViewer } from "./components/ResponseViewer";
import { useAppStore } from "./store/appStore";
import { useSidebarStore } from "./store/sidebarStore";
import { LogDrawer } from "./components/LogDrawer";
import { X, Layout, Settings, Layers, Box } from "lucide-react";
import { twMerge } from "tailwind-merge";
import "./App.css";

function App() {
  const activeRequestId = useAppStore(state => state.activeRequestId);
  const setActiveRequestId = useAppStore(state => state.setActiveRequestId);
  const openTabs = useAppStore(state => state.openTabs);
  const closeTab = useAppStore(state => state.closeTab);
  const responses = useAppStore(state => state.responses);
  const tree = useSidebarStore(state => state.tree);
  const updateRequestName = useSidebarStore(state => state.updateRequestName);

  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTabId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTabId]);

  const getRequestName = (id: string, items: any[] = tree): string => {
    for (const item of items) {
      if (item.kind.type === 'request' && item.kind.id === id) {
        return item.name;
      }
      if (item.kind.type === 'folder' && item.kind.items) {
        const found = getRequestName(id, item.kind.items);
        if (found !== 'Unknown') return found;
      }
    }
    return 'Unknown';
  };

  const getRequestPath = (id: string, items: any[] = tree, currentPath: string = ""): string | null => {
    for (const item of items) {
      const path = currentPath ? `${currentPath} / ${item.name}` : item.name;
      if (item.kind.type === 'request' && item.kind.id === id) {
        return path;
      }
      if (item.kind.type === 'folder' && item.kind.items) {
        const found = getRequestPath(id, item.kind.items, path);
        if (found) return found;
      }
    }
    return null;
  };

  const handleStartEdit = (id: string, name: string) => {
    setEditingTabId(id);
    setEditingName(name);
  };

  const handleFinishEdit = async () => {
    if (editingTabId && editingName.trim()) {
      await updateRequestName(editingTabId, editingName.trim());
    }
    setEditingTabId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleFinishEdit();
    } else if (e.key === 'Escape') {
      setEditingTabId(null);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans selection:bg-indigo-500/30">
      {/* Unified Global Header */}
      <header className="h-12 flex items-center justify-between px-4 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md z-50 sticky top-0">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-indigo-600 shadow-lg shadow-indigo-600/30">
            <Box size={18} className="text-white" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold tracking-tight">Firv <span className="text-[10px] font-semibold text-indigo-500 ml-1 uppercase">Cloud</span></span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-900 p-1 rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800">
            <button className="p-1.5 rounded-md hover:bg-white dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-all">
              <Layout size={16} />
            </button>
            <button className="p-1.5 rounded-md hover:bg-white dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-all">
              <Layers size={16} />
            </button>
            <div className="w-[1px] h-4 bg-zinc-200 dark:bg-zinc-800 mx-1" />
            <button className="p-1.5 rounded-md hover:bg-white dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-all">
              <Settings size={16} />
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden relative">
        <PanelGroup orientation="horizontal">
          <Panel defaultSize={200} minSize={150} maxSize={500} className="border-r border-zinc-200 dark:border-zinc-800">
            <Sidebar />
          </Panel>
          
          <PanelResizeHandle className="w-1 group flex items-center justify-center bg-zinc-100 hover:bg-indigo-500/50 cursor-col-resize transition-all dark:bg-zinc-900">
            <div className="w-[1px] h-8 bg-zinc-300 dark:bg-zinc-700 group-hover:bg-white/50 rounded-full" />
          </PanelResizeHandle>
          
          <Panel defaultSize={80} minSize={60} className="flex flex-col bg-zinc-50 dark:bg-zinc-950/50">
            <div className="flex-1 overflow-hidden relative z-0 flex flex-col" style={{ isolation: 'isolate' }}>
              {/* Capsule Tabs */}
              {openTabs.length > 0 && (
                <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto bg-white/50 dark:bg-zinc-950/50 border-b border-zinc-200 dark:border-zinc-800 custom-scrollbar no-scrollbar">
                  {openTabs.map(tabId => {
                    const name = getRequestName(tabId);
                    const path = getRequestPath(tabId);
                    const isEditing = editingTabId === tabId;
                    const isActive = activeRequestId === tabId;

                    return (
                      <div
                        key={tabId}
                        title={path || ""}
                        className={twMerge(
                          "flex items-center gap-2 group px-3 py-1.5 text-xs rounded-full cursor-pointer transition-all border whitespace-nowrap",
                          isActive
                            ? "bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm font-semibold"
                            : "bg-zinc-100/50 dark:bg-zinc-900/50 border-transparent text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                        )}
                        onClick={() => setActiveRequestId(tabId)}
                        onDoubleClick={() => handleStartEdit(tabId, name)}
                      >
                        {isEditing ? (
                          <input
                            ref={editInputRef}
                            type="text"
                            className="bg-transparent border-none outline-none text-zinc-900 dark:text-zinc-100 w-24"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onBlur={handleFinishEdit}
                            onKeyDown={handleKeyDown}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span className="max-w-[120px] truncate">{name}</span>
                        )}
                        <button
                          className={twMerge(
                            "p-0.5 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all",
                            isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            closeTab(tabId);
                          }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <PanelGroup orientation="vertical">
                <Panel defaultSize={60} minSize={30} className="flex flex-col">
                  <div className="flex-1 overflow-hidden min-h-0 min-w-0 flex flex-col bg-white dark:bg-zinc-950">
                    {activeRequestId ? (
                      openTabs.map(tabId => (
                        <div key={tabId} className={twMerge("flex-1 min-h-0 min-w-0 w-full flex flex-col", activeRequestId === tabId ? 'flex' : 'hidden')}>
                          <RequestEditor requestId={tabId} />
                        </div>
                      ))
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center space-y-6 text-center p-8">
                        <div className="relative">
                          <div className="absolute inset-0 bg-indigo-500/20 blur-3xl rounded-full" />
                          <div className="relative p-8 rounded-3xl bg-white dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800 shadow-2xl">
                            <Box size={64} className="text-indigo-500" />
                          </div>
                        </div>
                        <div className="max-w-xs space-y-2">
                          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Welcome to Firv</h1>
                          <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                            Create your first API request or select an existing one from the sidebar to start testing.
                          </p>
                        </div>
                        <button 
                          onClick={() => {/* Trigger new request logic from sidebar store maybe? */}}
                          className="px-6 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-500/20 active:scale-95 transition-all"
                        >
                          Create New Request
                        </button>
                      </div>
                    )}
                  </div>
                </Panel>
                
                <PanelResizeHandle className="h-1 group flex items-center justify-center bg-zinc-100 hover:bg-indigo-500/50 cursor-row-resize transition-all dark:bg-zinc-900">
                  <div className="h-[1px] w-8 bg-zinc-300 dark:bg-zinc-700 group-hover:bg-white/50 rounded-full" />
                </PanelResizeHandle>
                
                <Panel defaultSize={40} minSize={20} className="flex flex-col bg-white dark:bg-zinc-950">
                  <ResponseViewer key={activeRequestId || 'none'} response={activeRequestId ? responses[activeRequestId] : null} />
                </Panel>
              </PanelGroup>
            </div>
            
            <footer className="h-10 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 flex items-center px-4 text-[11px] font-medium text-zinc-500">
              <div className="flex items-center gap-4 flex-1">
                <LogDrawer />
              </div>
              <div className="flex items-center gap-4 italic opacity-60">
                <span>v1.0.0-beta</span>
              </div>
            </footer>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}

export default App;

