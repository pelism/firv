import React, { useEffect, useState } from 'react';
import { useSidebarStore, HydratedSidebarItem } from '../store/sidebarStore';
import { useAppStore } from '../store/appStore';
import { ChevronRight, ChevronDown, Folder as FolderIcon, AlertCircle, Plus, FolderPlus, Search } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

const getMethodStyles = (method: string) => {
  switch (method.toUpperCase()) {
    case 'GET': return 'text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-500/20';
    case 'POST': return 'text-emerald-600 bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-500/20';
    case 'PUT': return 'text-amber-600 bg-amber-100 dark:text-amber-400 dark:bg-amber-500/20';
    case 'PATCH': return 'text-yellow-600 bg-yellow-100 dark:text-yellow-400 dark:bg-yellow-500/20';
    case 'DELETE': return 'text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-500/20';
    default: return 'text-zinc-600 bg-zinc-100 dark:text-zinc-400 dark:bg-zinc-800';
  }
};

const SidebarNode: React.FC<{ item: HydratedSidebarItem; depth: number; searchQuery: string; path: string[] }> = React.memo(({ item, depth, searchQuery, path }) => {
  const [isOpen, setIsOpen] = useState(true);
  const activeRequestId = useAppStore(state => state.activeRequestId);
  const openTab = useAppStore(state => state.openTab);
  const addItem = useSidebarStore(state => state.addItem);

  const paddingLeft = depth * 12 + 12;

  const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
  
  const handleAddRequest = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const id = crypto.randomUUID();
    const newItem: HydratedSidebarItem = {
      name: 'New Request',
      kind: { type: 'request', id, method: 'GET' }
    };
    await addItem(newItem, path);
    openTab(id);
  };

  const handleAddFolder = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const name = prompt("Enter folder name:");
    if (!name) return;
    
    const newItem: HydratedSidebarItem = {
      name,
      kind: { type: 'folder', items: [] }
    };
    await addItem(newItem, path);
  };

  if (item.kind.type === 'folder') {
    const hasMatchingChildren = item.kind.items.some(child => 
      child.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      (child.kind.type === 'folder' && child.kind.items.some(c => c.name.toLowerCase().includes(searchQuery.toLowerCase())))
    );

    if (searchQuery && !matchesSearch && !hasMatchingChildren) {
      return null;
    }

    return (
      <div>
        <div 
          className="flex items-center py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 cursor-pointer text-sm text-zinc-600 dark:text-zinc-400 group transition-colors pr-2"
          style={{ paddingLeft }}
          onClick={() => setIsOpen(!isOpen)}
        >
          <div className="flex items-center flex-1 min-w-0">
            {isOpen || searchQuery ? <ChevronDown size={14} className="mr-2 opacity-60" /> : <ChevronRight size={14} className="mr-2 opacity-60" />}
            <FolderIcon size={14} className="mr-2 text-amber-500/80" />
            <span className="truncate font-medium">{item.name}</span>
          </div>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              onClick={handleAddRequest}
              className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              title="Add Request"
            >
              <Plus size={14} />
            </button>
            <button 
              onClick={handleAddFolder}
              className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              title="Add Subfolder"
            >
              <FolderPlus size={14} />
            </button>
          </div>
        </div>
        {(isOpen || searchQuery) && (
          <div className="relative">
            <div className="absolute left-[18px] top-0 bottom-0 w-[1px] bg-zinc-200 dark:bg-zinc-800 ml-[depth * 12]" style={{ left: paddingLeft + 6 }} />
            {item.kind.items.length === 0 ? (
              <div style={{ paddingLeft: paddingLeft + 28 }} className="text-[11px] text-zinc-400 py-2 italic">
                Empty
              </div>
            ) : (
              item.kind.items.map((child, idx) => (
                <SidebarNode key={idx} item={child} depth={depth + 1} searchQuery={searchQuery} path={[...path, child.name]} />
              ))
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
        className={twMerge(
          "flex items-center py-2 px-3 mx-2 my-0.5 rounded-lg cursor-pointer text-sm group transition-all",
          isActive 
            ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 shadow-sm ring-1 ring-indigo-500/20" 
            : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
        )}
        style={{ paddingLeft: depth > 0 ? paddingLeft + 20 : 12 }}
        onClick={() => {
          if (item.kind.type === 'request') {
            openTab(item.kind.id);
          }
        }}
      >
        <span className={twMerge("text-[10px] font-bold px-1.5 py-0.5 rounded-md mr-3 min-w-[32px] text-center", getMethodStyles(item.kind.method))}>
          {item.kind.method.substring(0, 3)}
        </span>
        <span className="truncate flex-1">{item.name}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center py-2 text-sm text-red-500 opacity-80" style={{ paddingLeft: paddingLeft + 20 }}>
      <AlertCircle size={14} className="mr-2" />
      <span>{item.name}</span>
    </div>
  );
});

export const Sidebar: React.FC = () => {
  const { tree, fetchSidebar, addItem } = useSidebarStore();
  const [searchQuery, setSearchQuery] = useState('');
  const openTab = useAppStore(state => state.openTab);

  useEffect(() => {
    fetchSidebar();
  }, [fetchSidebar]);

  const handleAddRequest = async () => {
    try {
      const id = crypto.randomUUID();
      const newItem: HydratedSidebarItem = {
        name: 'New Request',
        kind: { type: 'request', id, method: 'GET' }
      };
      
      await addItem(newItem);
      openTab(id);
    } catch (err) {
      console.error("Failed to add request", err);
    }
  };

  const handleAddFolder = async () => {
    try {
      const name = prompt("Enter folder name:");
      if (!name) return;
      
      const newItem: HydratedSidebarItem = {
        name,
        kind: { type: 'folder', items: [] }
      };
      
      await addItem(newItem);
    } catch (err) {
      console.error("Failed to add folder", err);
    }
  };

  return (
    <div className="h-full bg-zinc-50 dark:bg-zinc-950 flex flex-col overflow-hidden border-r border-zinc-200 dark:border-zinc-800">
      <div className="p-4 flex items-center justify-between">
        <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">
          Workspace
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleAddRequest} className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-md text-zinc-500 transition-colors" title="New Request">
            <Plus size={16} />
          </button>
          <button onClick={handleAddFolder} className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-md text-zinc-500 transition-colors" title="New Folder">
            <FolderPlus size={16} />
          </button>
        </div>
      </div>
      
      <div className="px-3 mb-4">
        <div className="relative group">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-indigo-500 transition-colors" />
          <input 
            type="text" 
            placeholder="Search..." 
            className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500/50 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 transition-all shadow-sm"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-zinc-400 border border-zinc-200 dark:border-zinc-800 px-1.5 py-0.5 rounded bg-zinc-50 dark:bg-zinc-950 pointer-events-none opacity-0 group-focus-within:opacity-100 transition-opacity">
            ⌘K
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-4 custom-scrollbar">
        {tree.map((item, idx) => (
          <SidebarNode key={idx} item={item} depth={0} searchQuery={searchQuery} path={[item.name]} />
        ))}
        {tree.length === 0 && (
          <div className="p-8 text-center">
            <div className="inline-flex p-3 rounded-full bg-zinc-100 dark:bg-zinc-900 text-zinc-400 mb-3">
              <Search size={20} />
            </div>
            <p className="text-sm text-zinc-500 font-medium">No results found</p>
          </div>
        )}
      </div>
    </div>
  );
};
