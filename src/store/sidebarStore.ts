import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type SidebarKind = 
  | { type: 'folder'; items: HydratedSidebarItem[] }
  | { type: 'request'; id: string; method: string }
  | { type: 'error'; id: string; message: string };

export interface HydratedSidebarItem {
  name: string;
  kind: SidebarKind;
}

export interface HydratedTree {
  items: HydratedSidebarItem[];
  orphans: string[];
}

interface SidebarState {
  tree: HydratedSidebarItem[];
  projectPath: string;
  setProjectPath: (path: string) => void;
  fetchSidebar: () => Promise<void>;
  updateTreeOptimistic: (newTree: HydratedSidebarItem[]) => void;
  syncTreeToBackend: (newTree: HydratedSidebarItem[]) => Promise<void>;
  updateRequestName: (id: string, newName: string) => Promise<void>;
  addItem: (item: HydratedSidebarItem, parentPath?: string[]) => Promise<void>;
}

const transformToManifestItem = (item: HydratedSidebarItem): any => {
  if (item.kind.type === 'folder') {
    return {
      type: 'folder',
      name: item.name,
      items: item.kind.items.map(transformToManifestItem),
    };
  } else if (item.kind.type === 'request') {
    return {
      type: 'request',
      id: item.kind.id,
      name: item.name,
    };
  }
  return null;
};

export const useSidebarStore = create<SidebarState>((set, get) => ({
  tree: [],
  projectPath: 'C:\\Repos\\firv', // Default or replace with dynamic project path
  setProjectPath: (path) => {
    set({ projectPath: path });
    get().fetchSidebar();
  },
  fetchSidebar: async () => {
    const { projectPath } = get();
    if (!projectPath) return;
    try {
      const tree: HydratedTree = await invoke('get_hydrated_sidebar', { projectPath });
      set({ tree: tree.items });
    } catch (e) {
      console.error('Failed to fetch sidebar:', e);
    }
  },
  updateTreeOptimistic: (newTree) => {
    set({ tree: newTree });
  },
  syncTreeToBackend: async (newTree) => {
    const { projectPath } = get();
    if (!projectPath) return;
    
    // Convert current hydrated tree to manifest format
    const order = newTree.map(transformToManifestItem).filter(Boolean);
    
    try {
      await invoke('update_manifest_structure', {
        projectRoot: projectPath,
        workspace: { order, globals: {} }
      });
      // Optionally refetch here if needed
    } catch (e) {
      console.error('Failed to sync tree:', e);
      get().fetchSidebar(); // Rollback on fail
    }
  },
  updateRequestName: async (id, newName) => {
    const { tree, syncTreeToBackend } = get();
    
    const updateNameInItems = (items: HydratedSidebarItem[]): HydratedSidebarItem[] => {
      return items.map(item => {
        if (item.kind.type === 'request' && item.kind.id === id) {
          return { ...item, name: newName };
        }
        if (item.kind.type === 'folder' && item.kind.items) {
          return {
            ...item,
            kind: {
              ...item.kind,
              items: updateNameInItems(item.kind.items)
            }
          };
        }
        return item;
      });
    };

    const newTree = updateNameInItems(tree);
    set({ tree: newTree });
    await syncTreeToBackend(newTree);
  },
  addItem: async (newItem, parentPath) => {
    const { tree, syncTreeToBackend } = get();

    if (!parentPath || parentPath.length === 0) {
      const newTree = [...tree, newItem];
      set({ tree: newTree });
      await syncTreeToBackend(newTree);
      return;
    }

    const addItemToItems = (items: HydratedSidebarItem[], path: string[]): HydratedSidebarItem[] => {
      const [currentName, ...rest] = path;
      return items.map(item => {
        if (item.name === currentName && item.kind.type === 'folder') {
          if (rest.length === 0) {
            return {
              ...item,
              kind: {
                ...item.kind,
                items: [...item.kind.items, newItem]
              }
            };
          }
          return {
            ...item,
            kind: {
              ...item.kind,
              items: addItemToItems(item.kind.items, rest)
            }
          };
        }
        return item;
      });
    };

    const newTree = addItemToItems(tree, parentPath);
    set({ tree: newTree });
    await syncTreeToBackend(newTree);
  }
}));

// Set up file watcher
listen('firv://file-changed', (event) => {
  console.log('File changed:', event.payload);
  useSidebarStore.getState().fetchSidebar();
});
