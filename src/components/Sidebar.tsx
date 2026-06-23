import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SCRATCHPAD_WORKSPACE_KEY, useSidebarStore } from '../store/sidebarStore';
import { HydratedSidebarItem } from '../types/hydratedSidebarItem.ts';
import { useAppStore } from '../store/appStore';
import { useModalStore } from '../store/modalStore';
import { ChevronRight, ChevronDown, Folder as FolderIcon, AlertCircle, Plus, FolderPlus, Search, Trash2, Settings2, GripVertical, X, MoreVertical, Download, Upload, ChevronsDown, ChevronsUp } from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { 
  DndContext, 
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const getMethodStyles = (method: string) => {
  switch (method.toUpperCase()) {
    case 'GET': return 'text-method-get bg-method-get/10';
    case 'POST': return 'text-method-post bg-method-post/10';
    case 'PUT': return 'text-method-put bg-method-put/10';
    case 'PATCH': return 'text-method-patch bg-method-patch/10';
    case 'DELETE': return 'text-method-delete bg-method-delete/10';
    default: return 'text-muted-foreground bg-muted';
  }
};

const SidebarNode: React.FC<{ 
  item: HydratedSidebarItem; 
  depth: number; 
  searchQuery: string; 
  path: string[];
  isScratchpad?: boolean;
  expandedFolderIds: Set<string>;
  toggleFolder: (folderId: string) => void;
}> = React.memo(({ item, depth, searchQuery, path, isScratchpad, expandedFolderIds, toggleFolder }) => {
  const activeRequestId = useAppStore(state => state.activeRequestId);
  const openTab = useAppStore(state => state.openTab);
  const { addItem, deleteItem } = useSidebarStore();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ 
    id: item.id,
    data: {
      type: item.kind.type,
      item
    }
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const getRequestIds = (item: HydratedSidebarItem): string[] => {
    if (item.kind.type === 'request') {
      return [item.kind.id];
    }
    if (item.kind.type === 'folder') {
      return item.kind.items.flatMap(getRequestIds);
    }
    return [];
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const idsToClose = getRequestIds(item);
    await deleteItem(path, isScratchpad);
    idsToClose.forEach(id => useAppStore.getState().closeTab(id));
  };

  const paddingLeft = depth * 12 + 12;

  const matchesSearch = (item.kind.type !== 'error' ? item.kind.name : '').toLowerCase().includes(searchQuery.toLowerCase());
  const isOpen = item.kind.type !== 'folder' ? true : expandedFolderIds.has(item.id);
  
  const handleAddRequest = async (e: React.MouseEvent) => {
    e.stopPropagation();

    const requestId = crypto.randomUUID();
    const newItem: HydratedSidebarItem = {
      id: crypto.randomUUID(),
      kind: { type: 'request', id: requestId, name: 'New Request', method: 'GET' as any }
    };
    useSidebarStore.getState().addItemOptimistic(newItem, path);
    openTab(requestId);
  };

  const handleAddFolder = async (e: React.MouseEvent) => {
    e.stopPropagation();

    const name = await useModalStore.getState().openModal({
      title: "New Folder",
      placeholder: "Folder Name"
    });
    if (!name) return;
    
    const newItem: HydratedSidebarItem = {
      id: crypto.randomUUID(),
      kind: { type: 'folder', name, items: [] }
    };
    await addItem(newItem, path);
  };

  if (item.kind.type === 'folder') {
    const hasMatchingChildren = item.kind.items.some(child => 
      (child.kind.type !== 'error' ? child.kind.name : '').toLowerCase().includes(searchQuery.toLowerCase()) || 
      (child.kind.type === 'folder' && child.kind.items.some(c => (c.kind.type !== 'error' ? c.kind.name : '').toLowerCase().includes(searchQuery.toLowerCase())))
    );

    if (searchQuery && !matchesSearch && !hasMatchingChildren) {
      return null;
    }

    return (
      <div style={style}>
        <div 
          ref={setNodeRef}
          className="flex items-center py-2 hover:bg-muted/50 cursor-pointer text-sm text-muted-foreground group transition-colors pr-2"
          style={{ paddingLeft }}
          onClick={() => toggleFolder(item.id)}
        >
          <div className="flex items-center flex-1 min-w-0">
            <div {...attributes} {...listeners} className="p-1 mr-1 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-muted-foreground/60">
              <GripVertical size={12} />
            </div>
            {isOpen || searchQuery ? <ChevronDown size={14} className="mr-2 opacity-60" /> : <ChevronRight size={14} className="mr-2 opacity-60" />}
            <FolderIcon size={14} className="mr-2 text-amber-500/80" />
            <span className="truncate font-medium">{item.kind.name}</span>
          </div>
          <div className="flex items-center gap-0.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
            {!isScratchpad && (
              <>
                <button 
                  onClick={handleAddRequest}
                  className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-opacity"
                  title="Add Request"
                >
                  <Plus size={14} />
                </button>
                <button 
                  onClick={handleAddFolder}
                  className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-opacity"
                  title="Add Subfolder"
                >
                  <FolderPlus size={14} />
                </button>
              </>
            )}
            <button 
              onClick={handleDelete}
              className="p-1 hover:bg-destructive/10 rounded text-muted-foreground/80 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive/40 transition-all"
              title="Delete Folder"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        {(isOpen || searchQuery) && (
          <div className="relative">
            <div className="absolute left-4.5 top-0 bottom-0 w-px bg-border ml-[depth * 12]" style={{ left: paddingLeft + 6 }} />
            {item.kind.items.length === 0 ? (
              <div style={{ paddingLeft: paddingLeft + 28 }} className="text-[11px] text-muted-foreground/60 py-2 italic">
              </div>
            ) : (
              <SortableContext items={item.kind.items.map(i => i.id)} strategy={verticalListSortingStrategy}>
                {item.kind.items.map((child, idx) => (
                  <SidebarNode 
                    key={child.id || idx} 
                    item={child} 
                    depth={depth + 1} 
                    searchQuery={searchQuery} 
                    path={[...path, child.kind.type !== 'error' ? child.kind.name : '']} 
                    isScratchpad={isScratchpad}
                    expandedFolderIds={expandedFolderIds}
                    toggleFolder={toggleFolder}
                  />
                ))}
              </SortableContext>
            )}
          </div>
        )}
      </div>
    );
  }

  if (searchQuery && !matchesSearch) return null;

  if (item.kind.type === 'request') {
    const isActive = activeRequestId === item.kind.id;
    return (
      <div 
        ref={setNodeRef}
        className={twMerge(
          "flex items-center py-2 pl-3 pr-2 my-0.5 rounded-lg cursor-pointer text-sm group transition-all",
          isActive 
            ? "bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20" 
            : "text-muted-foreground hover:bg-muted/50"
        )}
        style={{ ...style, paddingLeft: depth > 0 ? paddingLeft + 20 : 12 }}
        onClick={() => {
          if (item.kind.type === 'request') {
            openTab(item.kind.id);
          }
        }}
      >
        <div className="flex items-center flex-1 min-w-0">
          <div {...attributes} {...listeners} className="p-1 mr-1 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-muted-foreground/60">
            <GripVertical size={12} />
          </div>
          <span className={twMerge("text-[10px] font-bold px-1.5 py-0.5 rounded-md mr-3 min-w-8 text-center", getMethodStyles(item.kind.method))}>
            {item.kind.method}
          </span>
          <span className="truncate flex-1">{item.kind.name}</span>
        </div>
        <div className="flex items-center gap-0.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
          <button 
            onClick={handleDelete}
            className="p-1 hover:bg-destructive/10 rounded text-muted-foreground/80 hover:text-destructive opacity-80 group-hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive/40 transition-all"
            title="Delete Request"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center py-2 text-sm text-destructive opacity-80" style={{ paddingLeft: paddingLeft + 20 }}>
      <AlertCircle size={14} className="mr-2" />
      <span>{item.kind.type === 'error' ? item.kind.name : ''}</span>
    </div>
  );
});

export const Sidebar: React.FC = () => {
  const { 
    fetchSidebar, 
    addItem, 
    addItemOptimistic,
    setWorkspaceSettingsOpen, 
    moveItem, 
    workspaceName, 
    closeWorkspace, 
    exportWorkspace, 
    importPostmanCollection, 
    importFirvExport, 
    projectPath, 
    tree,
    expandedFolderIdsByWorkspace,
    toggleFolderExpansion,
    expandAllFoldersForWorkspace,
    collapseAllFoldersForWorkspace,
    syncExpandedFoldersWithTree,
  } = useSidebarStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isImportFlyoutOpen, setIsImportFlyoutOpen] = useState(false);
  const importTriggerRef = useRef<HTMLDivElement>(null);
  const [importFlyoutPosition, setImportFlyoutPosition] = useState({ top: 0, left: 0 });
  const openTab = useAppStore(state => state.openTab);
  const setRequestOrigin = useAppStore(state => state.setRequestOrigin);

  const [activeItem, setActiveItem] = useState<HydratedSidebarItem | null>(null);
  const [activeTab, setActiveTab] = useState<'workspace' | 'scratchpad'>(() => (projectPath ? 'workspace' : 'scratchpad'));

  const workspaceKey = projectPath || SCRATCHPAD_WORKSPACE_KEY;
  const expandedFolderIds = useMemo(() => new Set(expandedFolderIdsByWorkspace[workspaceKey] ?? []), [expandedFolderIdsByWorkspace, workspaceKey]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    void fetchSidebar();
  }, [fetchSidebar]);

  useEffect(() => {
    syncExpandedFoldersWithTree(workspaceKey, tree);
  }, [syncExpandedFoldersWithTree, workspaceKey, tree]);

  useEffect(() => {
    if (!projectPath) {
      setActiveTab('scratchpad');
    }
  }, [projectPath]);

  useEffect(() => {
    if (projectPath) {
      setActiveTab('workspace');
    }
  }, [projectPath]);

  useLayoutEffect(() => {
    if (!isImportFlyoutOpen) return;

    const updatePosition = () => {
      const rect = importTriggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      setImportFlyoutPosition({
        top: rect.top,
        left: rect.right + 6,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isImportFlyoutOpen]);

  const hasAnyFolders = (items: HydratedSidebarItem[]): boolean => {
    for (const item of items) {
      if (item.kind.type === 'folder') {
        return true;
      }
    }
    return false;
  };

  const workspaceHasFolders = hasAnyFolders(tree);

  const toggleFolder = useCallback((folderId: string) => {
    toggleFolderExpansion(workspaceKey, folderId);
  }, [toggleFolderExpansion, workspaceKey]);

  const expandAllFolders = useCallback(() => {
    expandAllFoldersForWorkspace(workspaceKey, tree);
  }, [expandAllFoldersForWorkspace, workspaceKey, tree]);

  const collapseAllFolders = useCallback(() => {
    collapseAllFoldersForWorkspace(workspaceKey);
  }, [collapseAllFoldersForWorkspace, workspaceKey]);

  const handleDragStart = (event: any) => {
    const { active } = event;
    const item = active.data.current?.item as HydratedSidebarItem;
    setActiveItem(item);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveItem(null);
    
    if (!over || over.id === 'sidebar-root') {
      moveItem(active.id as string, '', 'after');
      return;
    }

    const overItem = over.data.current?.item as HydratedSidebarItem;

    if (active.id !== over.id) {
      if (overItem?.kind.type === 'folder') {
        // If dropping over a folder, move it inside
        moveItem(active.id as string, over.id as string, 'inside');
      } else {
        // Otherwise reorder after
        moveItem(active.id as string, over.id as string, 'after');
      }
    }
  };

  const handleAddRequest = async () => {
    try {
      const requestId = crypto.randomUUID();
      const newItem: HydratedSidebarItem = {
        id: crypto.randomUUID(),
        kind: { type: 'request', id: requestId, name: 'New Request', method: 'GET' }
      };
      addItemOptimistic(newItem);
      openTab(requestId);
    } catch (err) {
      console.error("Failed to add request", err);
    }
  };

  const handleAddFolder = async () => {
    try {
      const name = await useModalStore.getState().openModal({
        title: "New Folder",
        placeholder: "Folder Name"
      });
      if (!name) return;
      
      const newItem: HydratedSidebarItem = {
        id: crypto.randomUUID(),
        kind: { type: 'folder', name, items: [] }
      };
      
      await addItem(newItem);
    } catch (err) {
      console.error("Failed to add folder", err);
    }
  };

  const handleAddScratchpadRequest = useCallback(() => {
    const requestId = crypto.randomUUID();
    const newItem: HydratedSidebarItem = {
      id: crypto.randomUUID(),
      kind: { type: 'request', id: requestId, name: 'New Request', method: 'GET' }
    };
    addItemOptimistic(newItem, undefined, true);
    setRequestOrigin(requestId, 'scratchpad');
    openTab(requestId);
  }, [addItemOptimistic, openTab, setRequestOrigin]);

  const isWorkspaceTab = activeTab === 'workspace';
  const isScratchpadTab = activeTab === 'scratchpad';

  return (
    <DndContext 
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="h-full bg-muted/20 flex flex-col overflow-visible border-r border-border">
        <div className="p-4 flex items-center justify-between">
          <div className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest">
            {isWorkspaceTab ? 'Workspace' : 'Scratchpad'}
          </div>
          <div className="flex items-center gap-1 relative">
            <button
              onClick={() => {
                if (isWorkspaceTab) {
                  if (!projectPath) return;
                  void handleAddRequest();
                } else {
                  handleAddScratchpadRequest();
                }
              }}
              disabled={isWorkspaceTab && !projectPath}
              className={twMerge(
                "p-1.5 rounded-md text-muted-foreground/80 transition-colors",
                isWorkspaceTab && !projectPath
                  ? 'cursor-not-allowed opacity-40 bg-muted/60'
                  : 'hover:bg-muted hover:text-foreground'
              )}
              title={isWorkspaceTab ? (projectPath ? "New Workspace Request" : "Open a workspace to add requests") : "New Scratchpad Request"}
            >
              <Plus size={16} />
            </button>
            {isWorkspaceTab && projectPath && (
              <>
                <button
                  onClick={handleAddFolder}
                  className="p-1.5 hover:bg-muted rounded-md text-muted-foreground/80 hover:text-foreground transition-colors"
                  title="New Workspace Folder"
                >
                  <FolderPlus size={16} />
                </button>
                <button
                  onClick={() => setWorkspaceSettingsOpen(true)}
                  className="p-1.5 hover:bg-muted rounded-md text-muted-foreground/80 hover:text-foreground transition-colors"
                  title="Workspace Settings"
                >
                  <Settings2 size={16} />
                </button>
                <div className="relative">
                  <button 
                    onClick={() => setIsMenuOpen(!isMenuOpen)} 
                    className={twMerge(
                      "p-1.5 hover:bg-muted rounded-md text-muted-foreground transition-colors",
                      isMenuOpen && "bg-muted text-foreground"
                    )}
                    title="Workspace Actions"
                  >
                    <MoreVertical size={16} />
                  </button>
                  
                  {isMenuOpen && (
                    <>
                      <div 
                        className="fixed inset-0 z-40" 
                        onClick={() => setIsMenuOpen(false)}
                      />
                      <div className="absolute right-0 mt-1 w-36 bg-popover border border-border rounded-xl shadow-2xl py-1.5 z-50 animate-in fade-in zoom-in duration-100 origin-top-right">
                        <button
                          onClick={() => {
                            expandAllFolders();
                            setIsMenuOpen(false);
                          }}
                          disabled={!workspaceHasFolders}
                          className={twMerge(
                            "w-full flex items-center gap-2.5 px-3 py-2 text-[10px] font-bold transition-all uppercase tracking-wider",
                            !workspaceHasFolders 
                              ? "text-muted-foreground/40 cursor-not-allowed" 
                              : "text-muted-foreground hover:text-primary hover:bg-primary/10"
                          )}
                        >
                          <ChevronsDown size={14} className="opacity-70" />
                          Expand all
                        </button>
                        <button
                          onClick={() => {
                            collapseAllFolders();
                            setIsMenuOpen(false);
                          }}
                          disabled={!workspaceHasFolders}
                          className={twMerge(
                            "w-full flex items-center gap-2.5 px-3 py-2 text-[10px] font-bold transition-all uppercase tracking-wider",
                            !workspaceHasFolders 
                              ? "text-muted-foreground/40 cursor-not-allowed" 
                              : "text-muted-foreground hover:text-primary hover:bg-primary/10"
                          )}
                        >
                          <ChevronsUp size={14} className="opacity-70" />
                          Collapse all
                        </button>
                        <div className="my-1 h-px bg-border/70" />
                        <div
                          ref={importTriggerRef}
                          className="relative"
                          onMouseEnter={() => setIsImportFlyoutOpen(true)}
                          onMouseLeave={() => setIsImportFlyoutOpen(false)}
                        >
                          <button
                            onClick={() => setIsImportFlyoutOpen(prev => !prev)}
                            className="w-full flex items-center justify-between gap-2.5 px-3 py-2 text-[10px] font-bold transition-all uppercase tracking-wider text-muted-foreground hover:text-primary hover:bg-primary/10"
                          >
                            <span className="flex items-center gap-2.5">
                              <Download size={14} className="opacity-70" />
                              Import
                            </span>
                            <ChevronRight size={12} className="opacity-60" />
                          </button>

                          {isImportFlyoutOpen && createPortal(
                            <div
                              className="fixed w-40 bg-popover border border-border rounded-xl shadow-2xl py-1.5 z-[9999] animate-in fade-in zoom-in duration-100 origin-top-left"
                              style={{ top: importFlyoutPosition.top, left: importFlyoutPosition.left }}
                              onMouseEnter={() => setIsImportFlyoutOpen(true)}
                              onMouseLeave={() => setIsImportFlyoutOpen(false)}
                            >
                              <button
                                onClick={() => {
                                  void importPostmanCollection();
                                  setIsImportFlyoutOpen(false);
                                  setIsMenuOpen(false);
                                }}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-[10px] font-bold transition-all uppercase tracking-wider text-muted-foreground hover:text-primary hover:bg-primary/10"
                              >
                                Postman
                              </button>
                              <button
                                onClick={() => {
                                  void importFirvExport();
                                  setIsImportFlyoutOpen(false);
                                  setIsMenuOpen(false);
                                }}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-[10px] font-bold transition-all uppercase tracking-wider text-muted-foreground hover:text-primary hover:bg-primary/10"
                              >
                                FIRV
                              </button>
                            </div>,
                            document.body
                          )}
                        </div>
                        <button
                          onClick={() => {
                            void exportWorkspace();
                            setIsMenuOpen(false);
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-[10px] font-bold transition-all uppercase tracking-wider text-muted-foreground hover:text-primary hover:bg-primary/10"
                        >
                          <Upload size={14} className="opacity-70" />
                          Export
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        
        <div className="px-3 mb-4">
          <div className="relative group mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 group-focus-within:text-primary transition-colors" />
            <input 
              type="text" 
              placeholder="Search..." 
              className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 text-foreground placeholder:text-muted-foreground/60 transition-all shadow-sm"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-muted-foreground/60 border border-border px-1.5 py-0.5 rounded bg-muted/50 pointer-events-none opacity-0 group-focus-within:opacity-100 transition-opacity">
              ⌘K
            </div>
          </div>

          {isWorkspaceTab && workspaceName && (
            <div className="flex items-center justify-between px-3 py-2 bg-primary/5 border border-primary/20 rounded-xl group/workspace-pill transition-all">
              <div className="flex items-center gap-2 overflow-hidden">
                <span className="text-[11px] font-bold text-primary truncate uppercase tracking-wider">
                  {workspaceName}
                </span>
              </div>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  void closeWorkspace();
                }}
                className="opacity-80 group-hover/workspace-pill:opacity-100 p-1 hover:bg-primary/10 rounded-md text-primary/80 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 transition-all"
                title="Close Workspace"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          <SidebarContent
            searchQuery={searchQuery}
            activeItem={activeItem}
            expandedFolderIds={expandedFolderIds}
            toggleFolder={toggleFolder}
            activeTab={activeTab}
            onAddScratchpadRequest={handleAddScratchpadRequest}
          />
          <div className="mt-auto h-11 border-t border-border bg-background/90 backdrop-blur flex items-center gap-1 px-3">
            <button
              className={twMerge(
                "flex-1 h-full flex items-center justify-center text-[11px] font-semibold uppercase tracking-[0.2em] px-3 transition-colors border-b-2",
                isWorkspaceTab
                  ? 'text-primary border-primary'
                  : 'text-muted-foreground border-transparent hover:text-foreground hover:border-border',
                !projectPath && 'opacity-50 cursor-not-allowed hover:border-transparent'
              )}
              onClick={() => {
                if (!projectPath) return;
                setActiveTab('workspace');
              }}
            >
              Workspace
            </button>
            <button
              className={twMerge(
                "flex-1 h-full flex items-center justify-center text-[11px] font-semibold uppercase tracking-[0.2em] px-3 transition-colors border-b-2",
                isScratchpadTab
                  ? 'text-primary border-primary'
                  : 'text-muted-foreground border-transparent hover:text-foreground hover:border-border'
              )}
              onClick={() => setActiveTab('scratchpad')}
            >
              Scratchpad
            </button>
          </div>
        </div>
      </div>
    </DndContext>
  );
};

const SidebarContent: React.FC<{ 
  searchQuery: string; 
  activeItem: HydratedSidebarItem | null;
  expandedFolderIds: Set<string>;
  toggleFolder: (folderId: string) => void;
  activeTab: 'workspace' | 'scratchpad';
  onAddScratchpadRequest: () => void;
}> = ({ searchQuery, activeItem, expandedFolderIds, toggleFolder, activeTab, onAddScratchpadRequest }) => {
  const { tree, scratchpadTree, projectPath } = useSidebarStore();
  const { setNodeRef } = useDroppable({
    id: 'sidebar-root',
  });

  return (
    <div ref={setNodeRef} className="flex-1 overflow-y-auto pb-4 custom-scrollbar min-h-0">
      {activeTab === 'workspace' ? (
        projectPath ? (
          tree.length > 0 ? (
            <SortableContext items={tree.map(i => i.id)} strategy={verticalListSortingStrategy}>
              {tree.map((item, idx) => (
                <SidebarNode
                  key={item.id || idx}
                  item={item}
                  depth={0}
                  searchQuery={searchQuery}
                  path={[item.kind.type !== 'error' ? item.kind.name : '']}
                  expandedFolderIds={expandedFolderIds}
                  toggleFolder={toggleFolder}
                />
              ))}
            </SortableContext>
          ) : (
            <div className="px-6 py-6 text-center text-sm text-muted-foreground/60">
              No workspace requests yet.
            </div>
          )
        ) : (
          <div className="px-6 py-6 text-center text-sm text-muted-foreground/60">
            Open a workspace to start organizing requests.
          </div>
        )
      ) : (
        <>
          {scratchpadTree.length > 0 ? (
            <SortableContext items={scratchpadTree.map(i => i.id)} strategy={verticalListSortingStrategy}>
              {scratchpadTree.map((item, idx) => (
                <SidebarNode
                  key={item.id || idx}
                  item={item}
                  depth={0}
                  searchQuery={searchQuery}
                  path={[item.kind.type !== 'error' ? item.kind.name : '']}
                  isScratchpad={true}
                  expandedFolderIds={expandedFolderIds}
                  toggleFolder={toggleFolder}
                />
              ))}
            </SortableContext>
          ) : (
            <div className="px-6 py-8 text-center space-y-3 text-sm text-muted-foreground/70">
              <p>No scratchpad requests yet.</p>
              <button
                onClick={onAddScratchpadRequest}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold uppercase tracking-wider hover:bg-primary/20 transition-colors"
              >
                <Plus size={12} />
                New Scratchpad Request
              </button>
            </div>
          )}
        </>
      )}

      <DragOverlay adjustScale={true}>
        {activeItem ? (
          <div className="bg-background border border-border rounded-lg shadow-xl px-3 py-2 text-sm flex items-center gap-2 opacity-90 pointer-events-none">
            {activeItem.kind.type === 'folder' ? (
              <>
                <FolderIcon size={14} className="text-amber-500/80" />
                <span className="font-medium text-muted-foreground">{activeItem.kind.name}</span>
              </>
            ) : (
              <>
                <span className={twMerge("text-[10px] font-bold px-1.5 py-0.5 rounded-md min-w-8 text-center", getMethodStyles(activeItem.kind.type === 'request' ? activeItem.kind.method : ''))}>
                  {activeItem.kind.type === 'request' ? activeItem.kind.method : ''}
                </span>
                <span className="text-muted-foreground">{activeItem.kind.type !== 'error' ? activeItem.kind.name : ''}</span>
              </>
            )}
          </div>
        ) : null}
      </DragOverlay>
    </div>
  );
};
