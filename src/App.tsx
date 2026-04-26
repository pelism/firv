import { useState, useRef, useEffect } from "react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { Sidebar } from "./components/Sidebar";
import { RequestEditor } from "./components/RequestEditor";
import { ResponseViewer } from "./components/ResponseViewer";
import { useAppStore } from "./store/appStore";
import { useSidebarStore } from "./store/sidebarStore";
import { LogDrawer } from "./components/LogDrawer";
import { X } from "lucide-react";
import "./App.css";

function App() {
  const activeRequestId = useAppStore(state => state.activeRequestId);
  const setActiveRequestId = useAppStore(state => state.setActiveRequestId);
  const openTabs = useAppStore(state => state.openTabs);
  const closeTab = useAppStore(state => state.closeTab);
  const response = useAppStore(state => state.response);
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

  // Helper to find name of a request from sidebar tree
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

  // Helper to find full path of a request from sidebar tree
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
    <div className="flex flex-col h-full overflow-hidden bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <div className="flex-1 overflow-hidden relative">
        <PanelGroup orientation="horizontal">
          <Panel defaultSize={75} minSize={15} maxSize={500} className="border-r border-gray-200 dark:border-gray-800">
            <Sidebar />
          </Panel>
          
          <PanelResizeHandle className="w-1 bg-gray-200 hover:bg-blue-500 cursor-col-resize dark:bg-gray-800" />
          
          <Panel defaultSize={80} minSize={60} className="flex flex-col">
            <div className="flex-1 overflow-hidden relative z-0" style={{ isolation: 'isolate' }}>
              <PanelGroup orientation="vertical">
                <Panel defaultSize={60} minSize={30} className="flex flex-col">
                  {openTabs.length > 0 && (
                    <div className="flex overflow-x-auto border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
                      {openTabs.map(tabId => {
                        const name = getRequestName(tabId);
                        const path = getRequestPath(tabId);
                        const isEditing = editingTabId === tabId;

                        return (
                          <div
                            key={tabId}
                            title={path || ""}
                            className={`flex items-center group px-3 py-2 text-sm border-r border-gray-200 dark:border-gray-800 cursor-pointer min-w-32 max-w-48 ${
                              activeRequestId === tabId
                                ? "bg-white dark:bg-gray-800 border-t-2 border-t-blue-500 text-blue-600 dark:text-blue-400 font-medium"
                                : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 border-t-2 border-t-transparent"
                            }`}
                            onClick={() => setActiveRequestId(tabId)}
                            onDoubleClick={() => handleStartEdit(tabId, name)}
                          >
                            {isEditing ? (
                              <input
                                ref={editInputRef}
                                type="text"
                                className="flex-1 bg-transparent border-none outline-none text-gray-900 dark:text-white"
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                onBlur={handleFinishEdit}
                                onKeyDown={handleKeyDown}
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <span className="truncate flex-1 pr-2">{name}</span>
                            )}
                            {!isEditing && (
                              <button
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 transition-opacity"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  closeTab(tabId);
                                }}
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex-1 overflow-hidden min-h-0 min-w-0 flex flex-col">
                    {activeRequestId ? (
                      openTabs.map(tabId => (
                        <div key={tabId} className={`flex-1 min-h-0 min-w-0 w-full flex flex-col ${activeRequestId === tabId ? 'flex' : 'hidden'}`}>
                          <RequestEditor requestId={tabId} />
                        </div>
                      ))
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center h-full text-gray-500">
                        <h1 className="text-2xl font-bold mb-2">Firv</h1>
                        <p>Select a request from the sidebar to get started.</p>
                      </div>
                    )}
                  </div>
                </Panel>
                
                <PanelResizeHandle className="h-1 bg-gray-200 hover:bg-blue-500 cursor-row-resize dark:bg-gray-800" />
                
                <Panel defaultSize={40} minSize={20} className="border-t border-gray-200 dark:border-gray-800 flex flex-col relative">
                  <ResponseViewer response={response} />
                </Panel>
              </PanelGroup>
            </div>
            <footer className="h-8 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 flex items-center px-2 text-xs relative z-[99999]">
              <LogDrawer />
            </footer>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}

export default App;

