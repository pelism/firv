import React, { useEffect, useState } from 'react';
import { useSidebarStore } from '../store/sidebarStore';
import { HydratedSidebarItem } from '../types/hydratedSidebarItem.ts';
import { useAppStore } from '../store/appStore';
import { useModalStore } from '../store/modalStore';
import { ChevronRight, ChevronDown, Folder as FolderIcon, AlertCircle, Plus, FolderPlus, Search, Trash2, Settings2, GripVertical, X, MoreVertical, Download, Upload } from 'lucide-react';
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

const SidebarNode: React.FC<{ item: HydratedSidebarItem; depth: number; searchQuery: string; path: string[] }> = React.memo(({ item, depth, searchQuery, path }) => {
  const [isOpen, setIsOpen] = useState(true);
  const activeRequestId = useAppStore(state => state.activeRequestId);
  const openTab = useAppStore(state => state.openTab);
  const closeTab = useAppStore(state => state.closeTab);
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
    await deleteItem(path);
    idsToClose.forEach(id => closeTab(id));
  };

  const paddingLeft = depth * 12 + 12;

  const matchesSearch = (item.kind.type !== 'error' ? item.kind.name : '').toLowerCase().includes(searchQuery.toLowerCase());
  
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
          onClick={() => setIsOpen(!isOpen)}
        >
          <div className="flex items-center flex-1 min-w-0">
            <div {...attributes} {...listeners} className="p-1 mr-1 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-muted-foreground/60">
              <GripVertical size={12} />
            </div>
            {isOpen || searchQuery ? <ChevronDown size={14} className="mr-2 opacity-60" /> : <ChevronRight size={14} className="mr-2 opacity-60" />}
            <FolderIcon size={14} className="mr-2 text-amber-500/80" />
            <span className="truncate font-medium">{item.kind.name}</span>
          </div>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              onClick={handleAddRequest}
              className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
              title="Add Request"
            >
              <Plus size={14} />
            </button>
            <button 
              onClick={handleAddFolder}
              className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
              title="Add Subfolder"
            >
              <FolderPlus size={14} />
            </button>
            <button 
              onClick={handleDelete}
              className="p-1 hover:bg-destructive/10 rounded text-muted-foreground hover:text-destructive"
              title="Delete Folder"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        {(isOpen || searchQuery) && (
          <div className="relative">
            <div className="absolute left-[18px] top-0 bottom-0 w-[1px] bg-border ml-[depth * 12]" style={{ left: paddingLeft + 6 }} />
            {item.kind.items.length === 0 ? (
              <div style={{ paddingLeft: paddingLeft + 28 }} className="text-[11px] text-muted-foreground/60 py-2 italic">
              </div>
            ) : (
              <SortableContext items={item.kind.items.map(i => i.id)} strategy={verticalListSortingStrategy}>
                {item.kind.items.map((child, idx) => (
                  <SidebarNode key={child.id || idx} item={child} depth={depth + 1} searchQuery={searchQuery} path={[...path, child.kind.type !== 'error' ? child.kind.name : '']} />
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
          "flex items-center py-2 px-3 mx-2 my-0.5 rounded-lg cursor-pointer text-sm group transition-all",
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
        <div {...attributes} {...listeners} className="p-1 mr-1 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-muted-foreground/60">
          <GripVertical size={12} />
        </div>
        <span className={twMerge("text-[10px] font-bold px-1.5 py-0.5 rounded-md mr-3 min-w-[32px] text-center", getMethodStyles(item.kind.method))}>
          {item.kind.method}
        </span>
        <span className="truncate flex-1">{item.kind.name}</span>
        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity ml-2">
          <button 
            onClick={handleDelete}
            className="p-1 hover:bg-destructive/10 rounded text-muted-foreground hover:text-destructive"
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
  const { fetchSidebar, addItem, setWorkspaceSettingsOpen, moveItem, workspaceName, closeWorkspace, importPostmanCollection, projectPath } = useSidebarStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const openTab = useAppStore(state => state.openTab);

  const [activeItem, setActiveItem] = useState<HydratedSidebarItem | null>(null);

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
    fetchSidebar();
  }, [fetchSidebar]);

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
      useSidebarStore.getState().addItemOptimistic(newItem);
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

  return (
    <DndContext 
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="h-full bg-muted/20 flex flex-col overflow-hidden border-r border-border">
        <div className="p-4 flex items-center justify-between">
          <div className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest">
            Workspace
          </div>
          <div className="flex items-center gap-1 relative">
            <button onClick={handleAddRequest} className="p-1.5 hover:bg-muted rounded-md text-muted-foreground transition-colors" title="New Request">
              <Plus size={16} />
            </button>
            <button onClick={handleAddFolder} className="p-1.5 hover:bg-muted rounded-md text-muted-foreground transition-colors" title="New Folder">
              <FolderPlus size={16} />
            </button>
            <button onClick={() => setWorkspaceSettingsOpen(true)} className="p-1.5 hover:bg-muted rounded-md text-muted-foreground transition-colors" title="Workspace Settings">
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
                        importPostmanCollection();
                        setIsMenuOpen(false);
                      }}
                      disabled={!projectPath}
                      className={twMerge(
                        "w-full flex items-center gap-2.5 px-3 py-2 text-[10px] font-bold transition-all uppercase tracking-wider",
                        !projectPath 
                          ? "text-muted-foreground/40 cursor-not-allowed" 
                          : "text-muted-foreground hover:text-primary hover:bg-primary/10"
                      )}
                    >
                      <Download size={14} className={twMerge("opacity-70", !projectPath && "opacity-30")} />
                      Import
                    </button>
                    <button
                      onClick={() => {
                        // Export functionality placeholder
                        setIsMenuOpen(false);
                      }}
                      disabled={!projectPath}
                      className={twMerge(
                        "w-full flex items-center gap-2.5 px-3 py-2 text-[10px] font-bold transition-all uppercase tracking-wider",
                        !projectPath 
                          ? "text-muted-foreground/40 cursor-not-allowed" 
                          : "text-muted-foreground hover:text-primary hover:bg-primary/10"
                      )}
                    >
                      <Upload size={14} className={twMerge("opacity-70", !projectPath && "opacity-30")} />
                      Export
                    </button>
                  </div>
                </>
              )}
            </div>
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

          {workspaceName && (
            <div className="flex items-center justify-between px-3 py-2 bg-primary/5 border border-primary/20 rounded-xl group/workspace-pill transition-all">
              <div className="flex items-center gap-2 overflow-hidden">
                <span className="text-[11px] font-bold text-primary truncate uppercase tracking-wider">
                  {workspaceName}
                </span>
              </div>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  closeWorkspace();
                }}
                className="opacity-0 group-hover/workspace-pill:opacity-100 p-1 hover:bg-primary/10 rounded-md text-primary hover:text-destructive transition-all"
                title="Close Workspace"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </div>

        <SidebarContent searchQuery={searchQuery} activeItem={activeItem} />
      </div>
    </DndContext>
  );
};

const SidebarContent: React.FC<{ searchQuery: string; activeItem: HydratedSidebarItem | null }> = ({ searchQuery, activeItem }) => {
  const { tree } = useSidebarStore();
  const { setNodeRef } = useDroppable({
    id: 'sidebar-root',
  });

  return (
    <div ref={setNodeRef} className="flex-1 overflow-y-auto pb-4 custom-scrollbar min-h-[100px]">
      <SortableContext items={tree.map(i => i.id)} strategy={verticalListSortingStrategy}>
        {tree.map((item, idx) => (
          <SidebarNode key={item.id || idx} item={item} depth={0} searchQuery={searchQuery} path={[item.kind.type !== 'error' ? item.kind.name : '']} />
        ))}
      </SortableContext>
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
                <span className={twMerge("text-[10px] font-bold px-1.5 py-0.5 rounded-md min-w-[32px] text-center", getMethodStyles(activeItem.kind.type === 'request' ? activeItem.kind.method : ''))}>
                  {activeItem.kind.type === 'request' ? activeItem.kind.method : ''}
                </span>
                <span className="text-muted-foreground">{activeItem.kind.type !== 'error' ? activeItem.kind.name : ''}</span>
              </>
            )}
          </div>
        ) : null}
      </DragOverlay>
      {tree.length === 0 && (
        <div className="p-8 text-center">
          <div className="inline-flex p-3 rounded-full bg-muted text-muted-foreground/60 mb-3">
            <Search size={20} />
          </div>
          <p className="text-sm text-muted-foreground font-medium">No results found</p>
        </div>
      )}
    </div>
  );
};
