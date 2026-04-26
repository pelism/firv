import React, { useEffect, useState } from 'react';
import { useSidebarStore, HydratedSidebarItem } from '../store/sidebarStore';
import { useAppStore } from '../store/appStore';
import { ChevronRight, ChevronDown, Folder as FolderIcon, AlertCircle, Plus, FolderPlus, Search } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

const getMethodColor = (method: string) => {
  switch (method.toUpperCase()) {
    case 'GET': return 'bg-method-get';
    case 'POST': return 'bg-method-post';
    case 'PUT': return 'bg-method-put';
    case 'PATCH': return 'bg-method-patch';
    case 'DELETE': return 'bg-method-delete';
    case 'OPTIONS': return 'bg-method-options';
    default: return 'bg-method-default';
  }
};

const SidebarNode: React.FC<{ item: HydratedSidebarItem; depth: number; searchQuery: string }> = React.memo(({ item, depth, searchQuery }) => {
  const [isOpen, setIsOpen] = useState(true);
  const activeRequestId = useAppStore(state => state.activeRequestId);
  const openTab = useAppStore(state => state.openTab);

  const paddingLeft = depth * 12 + 8;

  // Simple search filter: if we have a search query, only show matching nodes (and expand folders)
  const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
  
  if (item.kind.type === 'folder') {
    const hasMatchingChildren = item.kind.items.some(child => 
      child.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      (child.kind.type === 'folder' && child.kind.items.some(c => c.name.toLowerCase().includes(searchQuery.toLowerCase())))
    );

    if (searchQuery && !matchesSearch && !hasMatchingChildren) {
      return null; // hide if it doesn't match and has no matching children
    }

    return (
      <div>
        <div 
          className="flex items-center py-1 hover:bg-gray-200 dark:hover:bg-gray-800 cursor-pointer text-sm text-gray-700 dark:text-gray-300"
          style={{ paddingLeft }}
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen || searchQuery ? <ChevronDown size={14} className="mr-1" /> : <ChevronRight size={14} className="mr-1" />}
          <FolderIcon size={14} className="mr-2 text-yellow-600" />
          <span className="truncate">{item.name}</span>
        </div>
        {(isOpen || searchQuery) && (
          <div>
            {item.kind.items.length === 0 ? (
              <div style={{ paddingLeft: paddingLeft + 24 }} className="text-xs text-gray-400 py-1 italic">
                Empty Folder
              </div>
            ) : (
              item.kind.items.map((child, idx) => (
                <SidebarNode key={idx} item={child} depth={depth + 1} searchQuery={searchQuery} />
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
          "flex items-center py-1.5 hover:bg-gray-200 dark:hover:bg-gray-800 cursor-pointer text-sm group",
          isActive ? "bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100" : "text-gray-700 dark:text-gray-300"
        )}
        style={{ paddingLeft: paddingLeft + 18 }} // offset for lack of chevron
        onClick={() => {
          if (item.kind.type === 'request') {
            openTab(item.kind.id);
          }
        }}
      >
        <span className={twMerge(clsx("text-[10px] font-bold px-1 rounded mr-2 text-white", getMethodColor(item.kind.method)))}>
          {item.kind.method.substring(0, 3)}
        </span>
        <span className="truncate">{item.name}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center py-1 text-sm text-red-500" style={{ paddingLeft: paddingLeft + 18 }}>
      <AlertCircle size={14} className="mr-2" />
      <span>{item.name} (Error)</span>
    </div>
  );
});

export const Sidebar: React.FC = () => {
  const { tree, fetchSidebar, updateTreeOptimistic } = useSidebarStore();
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
      
      updateTreeOptimistic([...tree, newItem]);
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
      
      updateTreeOptimistic([...tree, newItem]);
    } catch (err) {
      console.error("Failed to add folder", err);
    }
  };

  return (
    <div className="h-full bg-gray-50 dark:bg-gray-900 flex flex-col overflow-hidden">
      {/* Sidebar Header Actions */}
      <div className="p-2 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider pl-2">
          Workspace
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleAddRequest} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded text-gray-500 transition-colors" title="New Request">
            <Plus size={16} />
          </button>
          <button onClick={handleAddFolder} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded text-gray-500 transition-colors" title="New Folder">
            <FolderPlus size={16} />
          </button>
        </div>
      </div>
      
      {/* Search Input */}
      <div className="p-2 border-b border-gray-200 dark:border-gray-800">
        <div className="relative">
          <Search size={14} className="absolute left-2 top-2 text-gray-400" />
          <input 
            type="text" 
            placeholder="Filter requests..." 
            className="w-full pl-7 pr-2 py-1 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 py-2 overflow-y-auto">
        {tree.map((item, idx) => (
          <SidebarNode key={idx} item={item} depth={0} searchQuery={searchQuery} />
        ))}
        {tree.length === 0 && (
          <div className="p-4 text-sm text-gray-500 text-center">No items found</div>
        )}
      </div>
    </div>
  );
};
