import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useModalStore } from './modalStore';
import { useAppStore } from './appStore';
import { HydratedSidebarItem } from "../types/hydratedSidebarItem.ts";
import { HydratedTree } from "../types/hydratedTree.ts";

/*export type SidebarKind =
  | { type: 'folder'; items: HydratedSidebarItem[] }
  | { type: 'request'; id: string; method: HttpMethod }
  | { type: 'error'; id: string; message: string };*/
/*
export interface HydratedSidebarItem {
  id: string; // Unique ID for dnd-kit
  name: string;
  kind: SidebarKind;
}
*/
/*
export interface HydratedTree {
  items: HydratedSidebarItem[];
  orphans: string[];
}
*/

interface SidebarState {
  tree: HydratedSidebarItem[];
  projectPath: string;
  workspaceName: string;
  activeMenu: string;
  setActiveMenu: (menu: string) => void;
  setProjectPath: (path: string) => void;
  setWorkspaceName: (name: string) => void;
  isWorkspaceSettingsOpen: boolean;
  setWorkspaceSettingsOpen: (open: boolean) => void;
  fetchSidebar: () => Promise<void>;
  updateTreeOptimistic: (newTree: HydratedSidebarItem[]) => void;
  syncTreeToBackend: (newTree: HydratedSidebarItem[]) => Promise<void>;
  moveItem: (activeId: string, overId: string, overPosition?: 'before' | 'after' | 'inside') => void;
  pendingNames: Record<string, string>;
  updateRequestName: (id: string, newName: string) => void;
  addItem: (item: HydratedSidebarItem, parentPath?: string[]) => Promise<void>;
  addItemOptimistic: (item: HydratedSidebarItem, parentPath?: string[]) => void;
  deleteItem: (path: string[]) => Promise<void>;
  ensureWorkspace: () => Promise<boolean>;
  openWorkspace: () => Promise<void>;
  createWorkspace: () => Promise<void>;
  loadOrphans: () => Promise<void>;
  getRequestName: (id: string) => string;
  clearPendingName: (id: string) => void;
  closeWorkspace: () => Promise<void>;
}

const transformToManifestItem = (item: HydratedSidebarItem): any => {
  if (item.kind.type === 'folder') {
    return {
      type: 'folder',
      name: item.kind.name,
      items: item.kind.items.map(transformToManifestItem),
    };
  } else if (item.kind.type === 'request') {
    return {
      type: 'request',
      id: item.kind.id,
      name: item.kind.name,
      method: item.kind.method,
    };
  }
  return null;
};

export const useSidebarStore = create<SidebarState>((set, get) => ({
  tree: [],
  pendingNames: {},
  projectPath: '', // Default or replace with dynamic project path
  workspaceName: '',
  activeMenu: 'workspace',
  isWorkspaceSettingsOpen: false,
  setWorkspaceSettingsOpen: (open) => set({ isWorkspaceSettingsOpen: open }),
  setActiveMenu: (activeMenu) => set({ activeMenu }),
  setProjectPath: (path) => {
    set({ projectPath: path });
    get().fetchSidebar();
  },
  setWorkspaceName: (workspaceName) => set({ workspaceName }),
  fetchSidebar: async () => {
    const { projectPath } = get();
    if (!projectPath) return;
    try {
      const tree: HydratedTree = await invoke('get_hydrated_sidebar', { projectPath });
      
      // Also fetch manifest to get the workspace name
      try {
        const manifest: any = await invoke('get_manifest', { projectPath });
        if (manifest && manifest.name) {
          set({ workspaceName: manifest.name });
        } else {
          // Fallback to directory name if name is missing in manifest
          const dirName = projectPath.split(/[/\\]/).filter(Boolean).pop() || '';
          set({ workspaceName: dirName });
        }
      } catch (me) {
        console.error('Failed to fetch manifest for name:', me);
        // Fallback to directory name if manifest fetch fails
        const dirName = projectPath.split(/[/\\]/).filter(Boolean).pop() || '';
        set({ workspaceName: dirName });
      }
      
      set({ tree: tree.items });
    } catch (e) {
      console.error('Failed to fetch sidebar:', e);
    }
  },
  updateTreeOptimistic: (newTree) => {
    set({ tree: newTree });
  },
  moveItem: (activeId, overId, overPosition = 'inside') => {
    const { tree, syncTreeToBackend } = get();
    
    // Find and remove the active item
    let draggedItem: HydratedSidebarItem | null = null;
    const removeItem = (items: HydratedSidebarItem[]): HydratedSidebarItem[] => {
      const result: HydratedSidebarItem[] = [];
      for (const item of items) {
        if (item.id === activeId) {
          draggedItem = item;
          continue;
        }
        if (item.kind.type === 'folder') {
          result.push({
            ...item,
            kind: {
              ...item.kind,
              items: removeItem(item.kind.items)
            }
          });
        } else {
          result.push(item);
        }
      }
      return result;
    };

    const treeWithoutItem = removeItem(tree);
    if (!draggedItem) return;

    // Insert the item into the new position
    const insertItem = (items: HydratedSidebarItem[]): HydratedSidebarItem[] => {
      const result: HydratedSidebarItem[] = [];
      for (const item of items) {
        if (item.id === overId) {
          if (overPosition === 'before') {
            result.push(draggedItem!);
            result.push(item);
          } else if (overPosition === 'after') {
            result.push(item);
            result.push(draggedItem!);
          } else if (overPosition === 'inside' && item.kind.type === 'folder') {
            result.push({
              ...item,
              kind: {
                ...item.kind,
                items: [...item.kind.items, draggedItem!]
              }
            });
          } else {
            result.push(item);
          }
        } else if (item.kind.type === 'folder') {
          result.push({
            ...item,
            kind: {
              ...item.kind,
              items: insertItem(item.kind.items)
            }
          });
        } else {
          result.push(item);
        }
      }
      return result;
    };

    // If overId is null or not found (e.g. drop at root level), append to root
    let newTree: HydratedSidebarItem[];
    if (!overId) {
      newTree = [...treeWithoutItem, draggedItem];
    } else {
      newTree = insertItem(treeWithoutItem);
      
      // Check if the item was actually inserted
      const wasInserted = (items: HydratedSidebarItem[]): boolean => {
        for (const item of items) {
          if (item.id === activeId) return true;
          if (item.kind.type === 'folder' && wasInserted(item.kind.items)) return true;
        }
        return false;
      };

      if (!wasInserted(newTree)) {
        newTree = [...treeWithoutItem, draggedItem];
      }
    }

    set({ tree: newTree });
    syncTreeToBackend(newTree);
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
      // Get existing manifest to preserve globals/scripts
      const manifest: any = await invoke('get_manifest', { projectPath });
      console.log("[sidebarStore] Syncing tree. Current manifest globals:", manifest.workspace.globals);
      
      await invoke('update_manifest_structure', {
        projectRoot: projectPath,
        workspace: { 
          ...manifest.workspace,
          order 
        }
      });
      console.log("[sidebarStore] Successfully synced tree to backend");
      // Optionally refetch here if needed
    } catch (e) {
      console.error('Failed to sync tree:', e);
      get().fetchSidebar(); // Rollback on fail
    }
  },
  updateRequestName: (id, newName) => {
    set((state) => ({
      pendingNames: { ...state.pendingNames, [id]: newName }
    }));
  },
  clearPendingName: (id) => {
    set((state) => {
      const newPending = { ...state.pendingNames };
      delete newPending[id];
      return { pendingNames: newPending };
    });
  },
  addItemOptimistic: (newItem, parentPath) => {
    const { tree } = get();
    const itemWithId = {
      ...newItem,
      id: newItem.id || crypto.randomUUID()
    };

    if (!parentPath || parentPath.length === 0) {
      set({ tree: [...tree, itemWithId] });
      return;
    }

    const addItemToItems = (items: HydratedSidebarItem[], path: string[]): HydratedSidebarItem[] => {
      const [currentName, ...rest] = path;
      return items.map(item => {
        if (item.kind.type === 'folder' && item.kind.name === currentName) {
          if (rest.length === 0) {
            return {
              ...item,
              kind: {
                ...item.kind,
                items: [...item.kind.items, itemWithId]
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

    set({ tree: addItemToItems(tree, parentPath) });
  },
  addItem: async (newItem, parentPath) => {
    const { tree, syncTreeToBackend } = get();
    const itemWithId = {
      ...newItem,
      id: newItem.id || crypto.randomUUID()
    };

    if (!parentPath || parentPath.length === 0) {
      const newTree = [...tree, itemWithId];
      set({ tree: newTree });
      await syncTreeToBackend(newTree);
      return;
    }

    const addItemToItems = (items: HydratedSidebarItem[], path: string[]): HydratedSidebarItem[] => {
      const [currentName, ...rest] = path;
      return items.map(item => {
        if (item.kind.type === 'folder' && item.kind.name === currentName) {
          if (rest.length === 0) {
            return {
              ...item,
              kind: {
                ...item.kind,
                items: [...item.kind.items, itemWithId]
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
  deleteItem: async (path) => {
    const { tree, projectPath, syncTreeToBackend } = get();

    const findItemByPath = (items: HydratedSidebarItem[], currentPath: string[]): HydratedSidebarItem | null => {
      const [targetName, ...remainingPath] = currentPath;
      const item = items.find(i => i.kind.type !== 'error' && i.kind.name === targetName);
      if (!item) return null;
      if (remainingPath.length === 0) return item;
      if (item.kind.type === 'folder') {
        return findItemByPath(item.kind.items, remainingPath);
      }
      return null;
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

    const itemToDelete = findItemByPath(tree, path);
    if (itemToDelete) {
      const idsToDelete = getRequestIds(itemToDelete);
      for (const id of idsToDelete) {
        try {
          await invoke('delete_request', { projectRoot: projectPath, id });
        } catch (e) {
          console.error(`Failed to delete request file ${id}:`, e);
        }
      }
    }

    const deleteFromItems = (items: HydratedSidebarItem[], currentPath: string[]): HydratedSidebarItem[] => {
      const [targetName, ...remainingPath] = currentPath;
      
      if (remainingPath.length === 0) {
        return items.filter(item => item.kind.type !== 'error' && item.kind.name !== targetName);
      }

      return items.map(item => {
        if (item.kind.type === 'folder' && item.kind.name === targetName) {
          return {
            ...item,
            kind: {
              ...item.kind,
              items: deleteFromItems(item.kind.items, remainingPath)
            }
          };
        }
        return item;
      });
    };

    const newTree = deleteFromItems(tree, path);
    set({ tree: newTree });
    await syncTreeToBackend(newTree);
  },
  ensureWorkspace: async () => {
    const { projectPath, fetchSidebar } = get();
    
    try {
      const exists = await invoke<boolean>('check_workspace_exists', { projectRoot: projectPath });
      if (exists) return true;

      const name = await useModalStore.getState().openModal({
        title: "Create Workspace",
        description: "Your project does not have a workspace yet. Enter a name to create one.",
        placeholder: "Workspace Name"
      });
      if (!name) return false;

      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Workspace Location'
      });

      if (!selected || Array.isArray(selected)) return false;

      await invoke('create_workspace', { projectRoot: selected, name });
      set({ projectPath: selected, workspaceName: name });
      await fetchSidebar();
      return true;
    } catch (e) {
      console.error("Failed to ensure workspace:", e);
      return false;
    }
  },
  createWorkspace: async () => {
    try {
      const name = await useModalStore.getState().openModal({
        title: "Create Workspace",
        placeholder: "Workspace Name"
      });
      if (!name) return;

      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Workspace Location'
      });

      if (!selected || Array.isArray(selected)) return;

      await invoke('create_workspace', { projectRoot: selected, name });
      set({ projectPath: selected, workspaceName: name });
      await get().fetchSidebar();
      await get().loadOrphans();
    } catch (e) {
      console.error("Failed to create workspace:", e);
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
              id: crypto.randomUUID(),
              kind: { 
                type: 'request', 
                id: orphanId, 
                name: request.name || orphanId, 
                method: request.method || 'GET' 
              }
            } as any);
          }
        }
      }
    } catch (e) {
      console.error('Failed to load orphans:', e);
    }
  },
  getRequestName: (id) => {
    const { tree, pendingNames } = get();
    if (pendingNames[id]) return pendingNames[id];

    const findName = (items: HydratedSidebarItem[]): string | null => {
      for (const item of items) {
        if (item.kind.type === 'request' && item.kind.id === id) {
          return item.kind.name;
        }
        if (item.kind.type === 'folder') {
          const found = findName(item.kind.items);
          if (found) return found;
        }
      }
      return null;
    };
    return findName(tree) || 'New Request';
  },
  closeWorkspace: async () => {
    const { dirtyRequests, openTab, reset } = useAppStore.getState();
    const { getRequestName } = get();
    
    if (dirtyRequests.size > 0) {
      const { ask } = await import('@tauri-apps/plugin-dialog');
      const dirtyIds = Array.from(dirtyRequests);
      
      for (const id of dirtyIds) {
        openTab(id);
        const name = getRequestName(id);
        const shouldContinue = await ask(
          `The request "${name}" has unsaved changes. Do you want to continue closing and lose these changes?`,
          { title: 'Unsaved Changes', kind: 'warning', okLabel: 'Discard and Continue', cancelLabel: 'Cancel' }
        );
        
        if (!shouldContinue) return;
      }
    }

    set({ 
      tree: [], 
      projectPath: '', 
      workspaceName: '',
      isWorkspaceSettingsOpen: false 
    });
    reset();
  }
}));

// Set up file watcher
listen('firv://file-changed', (event) => {
  console.log('File changed:', event.payload);
  useSidebarStore.getState().fetchSidebar();
});
