import React, { useState, useRef, useEffect } from "react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { Sidebar } from "./components/Sidebar";
import { MenuSidebar } from "./components/MenuSidebar";
import { RequestEditor } from "./components/RequestEditor";
import { ResponseViewer } from "./components/ResponseViewer";
import { useAppStore } from "./store/appStore";
import { useSidebarStore } from "./store/sidebarStore";
import { HydratedSidebarItem } from "./types/hydratedSidebarItem";
import { WorkspaceSettings } from "./components/WorkspaceSettings";
import { AppSettings } from "./components/AppSettings";
import { X } from "lucide-react";
import logo from "./assets/icons/firv-logo.png";
import { twMerge } from "tailwind-merge";
import { InputModal } from "./components/InputModal";
import { WindowControls } from "./components/WindowControls";
import { useNativeContextMenu } from "./hooks/useNativeContextMenu";
import "./App.css";

function App() {
  const activeRequestId = useAppStore(state => state.activeRequestId);
  const setActiveRequestId = useAppStore(state => state.setActiveRequestId);
  const openTab = useAppStore(state => state.openTab);
  const openTabs = useAppStore(state => state.openTabs);
  const closeTab = useAppStore(state => state.closeTab);
  const dirtyRequests = useAppStore(state => state.dirtyRequests);
  const setRequestOrigin = useAppStore(state => state.setRequestOrigin);
  const requestOrigins = useAppStore(state => state.requestOrigins);
  const responses = useAppStore(state => state.responses);
  const { tree } = useSidebarStore();
  const updateRequestName = useSidebarStore(state => state.updateRequestName);
  const renameRequest = useSidebarStore(state => state.renameRequest);
  const getRequestName = useSidebarStore(state => state.getRequestName);

  const isWorkspaceSettingsOpen = useSidebarStore(state => state.isWorkspaceSettingsOpen);
  const isAppSettingsOpen = useSidebarStore(state => state.isAppSettingsOpen);

  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const triggerNativeContextMenu = useNativeContextMenu();

  useEffect(() => {
    if (editingTabId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTabId]);



  const getRequestPath = (id: string, items: any[] = tree, currentPath: string = ""): string | null => {
    for (const item of items) {
      if (item.kind.type === 'error') continue;
      const path = currentPath ? `${currentPath} / ${item.kind.name}` : item.kind.name;
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
      await renameRequest(editingTabId, editingName.trim());
      updateRequestName(editingTabId, editingName.trim());
    }
    setEditingTabId(null);
  };

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      await handleFinishEdit();
    } else if (e.key === 'Escape') {
      setEditingTabId(null);
    }
  };

  const handleCreateNewRequest = async () => {
    try {
      const id = crypto.randomUUID();
      const newItem: HydratedSidebarItem = {
        id: crypto.randomUUID(),
        kind: { type: 'request', id, name: 'New Request', method: 'GET' }
      };
      
      const { addItemOptimistic } = useSidebarStore.getState();
      addItemOptimistic(newItem);
      openTab(id);
    } catch (err) {
      console.error("Failed to add request", err);
    }
  };

  return (
    <div
      className="flex flex-col h-full overflow-hidden bg-background text-foreground font-sans selection:bg-primary/30"
      onContextMenu={triggerNativeContextMenu}
    >
      {/* Unified Global Header */}
      <header 
        data-tauri-drag-region
        className="h-12 flex items-center justify-between pl-4 border-b border-border bg-background/80 backdrop-blur-md z-50 sticky top-0 select-none drag"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <img src={logo} alt="Firv Logo" className="w-6 h-6 object-contain" />
            <span className="text-sm font-bold tracking-tight">firv</span>
          </div>
        </div>
        <WindowControls />
      </header>

      <div className="flex-1 overflow-hidden relative flex">
        <InputModal />
        {isWorkspaceSettingsOpen && <WorkspaceSettings />}
        {isAppSettingsOpen && <AppSettings />}
        <MenuSidebar />
        <PanelGroup orientation="horizontal">
          <Panel defaultSize={225} minSize={225} maxSize={750} className="relative z-20 border-r border-border">
            <Sidebar />
          </Panel>
          
          <PanelResizeHandle className="w-1 group flex items-center justify-center bg-muted hover:bg-primary/50 cursor-col-resize transition-all dark:bg-zinc-900">
            <div className="w-px h-8 bg-border group-hover:bg-white/50 rounded-full" />
          </PanelResizeHandle>
          
          <Panel defaultSize={80} minSize={60} className="flex flex-col bg-muted/50">
            <div className="flex-1 overflow-hidden relative z-0 flex flex-col" style={{ isolation: 'isolate' }}>
              {/* Capsule Tabs */}
              {openTabs.length > 0 && (
                <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto bg-background/50 border-b border-border custom-scrollbar no-scrollbar">
                  {openTabs.map(tabId => {
                    const name = getRequestName(tabId);
                    const path = getRequestPath(tabId);
                    const isEditing = editingTabId === tabId;
                    const isActive = activeRequestId === tabId;
                    const isDirty = dirtyRequests.has(tabId);

                    return (
                      <div
                        key={tabId}
                        title={path || ""}
                        className={twMerge(
                          "flex items-center gap-2 group px-3 py-1.5 text-xs rounded-full cursor-pointer transition-all border whitespace-nowrap",
                          isActive
                            ? "bg-background border-border text-foreground shadow-sm font-semibold"
                            : "bg-muted/50 border-transparent text-muted-foreground hover:bg-muted"
                        )}
                        onClick={() => {
                          if (requestOrigins[tabId] !== 'scratchpad') {
                            setRequestOrigin(tabId, 'workspace');
                          }
                          setActiveRequestId(tabId);
                        }}
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
                          <div className="flex items-center gap-1.5">
                            <span className="max-w-30 truncate">{name}</span>
                            {isDirty && (
                              <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                            )}
                          </div>
                        )}
                        <button
                          className={twMerge(
                            "p-0.5 rounded-full hover:bg-muted transition-all",
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
                  <div className="flex-1 overflow-hidden min-h-0 min-w-0 flex flex-col bg-background">
                    {activeRequestId ? (
                      openTabs.map(tabId => (
                        <div key={tabId} className={twMerge("flex-1 min-h-0 min-w-0 w-full flex flex-col", activeRequestId === tabId ? 'flex' : 'hidden')}>
                          <RequestEditor requestId={tabId} />
                        </div>
                      ))
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center space-y-6 text-center p-8">
                        <div className="relative">
                          <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full" />
                          <div className="relative p-8 rounded-3xl bg-card ring-1 ring-border shadow-2xl">
                            <img src={logo} alt="Firv Logo" className="w-16 h-16 object-contain" />
                          </div>
                        </div>
                        <div className="max-w-xs space-y-2">
                          <h1 className="text-2xl font-bold tracking-tight text-foreground">Welcome to Firv</h1>
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            Create your first API request or select an existing one from the sidebar to start testing.
                          </p>
                        </div>
                        <button 
                          onClick={handleCreateNewRequest}
                          className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-bold text-sm shadow-lg shadow-primary/20 active:scale-95 transition-all"
                        >
                          Create New Request
                        </button>
                      </div>
                    )}
                  </div>
                </Panel>
                
                <PanelResizeHandle className="h-1 group flex items-center justify-center bg-muted hover:bg-primary/50 cursor-row-resize transition-all dark:bg-zinc-900">
                  <div className="h-px w-8 bg-border group-hover:bg-white/50 rounded-full" />
                </PanelResizeHandle>
                
                <Panel defaultSize={40} minSize={20} className="flex flex-col bg-background">
                  <ResponseViewer key={activeRequestId || 'none'} response={activeRequestId ? responses[activeRequestId] : null} />
                </Panel>
              </PanelGroup>
            </div>
            
            <footer className="h-4 border-t border-border bg-background flex items-center px-4 text-[11px] font-medium text-muted-foreground">
              <div className="flex items-center gap-4 italic opacity-60">
                <span></span>
              </div>
            </footer>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}

export default App;

