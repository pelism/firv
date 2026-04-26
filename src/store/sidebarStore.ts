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
  activeMenu: string;
  setActiveMenu: (menu: string) => void;
  setProjectPath: (path: string) => void;
  fetchSidebar: () => Promise<void>;
  updateTreeOptimistic: (newTree: HydratedSidebarItem[]) => void;
  syncTreeToBackend: (newTree: HydratedSidebarItem[]) => Promise<void>;
  updateRequestName: (id: string, newName: string) => Promise<void>;
  addItem: (item: HydratedSidebarItem, parentPath?: string[]) => Promise<void>;
  ensureWorkspace: () => Promise<boolean>;
  openWorkspace: () => Promise<void>;
  loadOrphans: () => Promise<void>;
  getRequestName: (id: string) => string;
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
  projectPath: '', // Default or replace with dynamic project path
  activeMenu: 'workspace',
  setActiveMenu: (activeMenu) => set({ activeMenu }),
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
    
    // Check if manifest exists before trying to sync
    try {
      const exists = await invoke<boolean>('check_workspace_exists', { projectRoot: projectPath });
      if (!exists) return;
    } catch (e) {
      return;
    }

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
  },
  ensureWorkspace: async () => {
    const { projectPath, fetchSidebar } = get();
    
    try {
      const exists = await invoke<boolean>('check_workspace_exists', { projectRoot: projectPath });
      if (exists) return true;

      const name = prompt("Enter workspace name:");
      if (!name) return false;

      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Workspace Location'
      });

      if (!selected || Array.isArray(selected)) return false;

      await invoke('create_workspace', { projectRoot: selected, name });
      set({ projectPath: selected });
      await fetchSidebar();
      return true;
    } catch (e) {
      console.error("Failed to ensure workspace:", e);
      return false;
    }
  },
  openWorkspace: async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: false,
        multiple: false,
        filters: [{
          name: 'Firv Manifest',
          extensions: ['yaml', 'yml']
        }],
        title: 'Open Workspace Manifest'
      });

      if (!selected || Array.isArray(selected)) return;

      const pathParts = selected.split(/[/\\]/);
      pathParts.pop();
      const projectPath = pathParts.join('/');

      set({ projectPath });
      await get().fetchSidebar();
      await get().loadOrphans();
    } catch (e) {
      console.error("Failed to open workspace:", e);
    }
  },
  loadOrphans: async () => {
    const { projectPath, tree, addItem } = get();
    if (!projectPath) return;

    try {
      const result: HydratedTree = await invoke('get_hydrated_sidebar', { projectPath });
      if (result.orphans && result.orphans.length > 0) {
        for (const orphanId of result.orphans) {
          // Check if already in tree to be safe
          const exists = (items: HydratedSidebarItem[]): boolean => {
            return items.some(item => 
              (item.kind.type === 'request' && item.kind.id === orphanId) ||
              (item.kind.type === 'folder' && exists(item.kind.items))
            );
          };

          if (!exists(tree)) {
            // Get the request details to have a better name if possible
            const request: any = await invoke('get_request', { projectRoot: projectPath, id: orphanId });
            await addItem({
              name: request.name || orphanId,
              kind: { type: 'request', id: orphanId, method: request.method || 'GET' }
            });
          }
        }
      }
    } catch (e) {
      console.error('Failed to load orphans:', e);
    }
  },
  getRequestName: (id) => {
    const { tree } = get();
    const findName = (items: HydratedSidebarItem[]): string | null => {
      for (const item of items) {
        if (item.kind.type === 'request' && item.kind.id === id) {
          return item.name;
        }
        if (item.kind.type === 'folder') {
          const found = findName(item.kind.items);
          if (found) return found;
        }
      }
      return null;
    };
    return findName(tree) || 'Unknown Request';
  }
}));

// Set up file watcher
listen('firv://file-changed', (event) => {
  console.log('File changed:', event.payload);
  useSidebarStore.getState().fetchSidebar();
});
