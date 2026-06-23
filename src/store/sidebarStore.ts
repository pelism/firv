import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useModalStore } from './modalStore';
import { useAppStore } from './appStore';
import { HydratedSidebarItem } from "../types/hydratedSidebarItem.ts";
import { HydratedTree } from "../types/hydratedTree.ts";
import {KeyValue} from "../types/keyValue.ts";
import { WorkspaceEnvironment } from "../types/environment.ts";
import { normalizeVariableLookup } from '../lib/variableHover';

export const SCRATCHPAD_WORKSPACE_KEY = '__scratchpad__';

const getWorkspaceKey = (projectPath?: string) => projectPath || SCRATCHPAD_WORKSPACE_KEY;

const buildWorkspaceVariableLookup = (manifest: any): Record<string, string> => {
  const globals = normalizeVariableLookup(manifest?.workspace?.globals);
  const activeEnvironmentId = manifest?.workspace?.active_environment;
  const environments = Array.isArray(manifest?.workspace?.environments) ? manifest.workspace.environments : [];
  const activeEnvironment = environments.find((environment: any) => environment?.id === activeEnvironmentId);

  if (!activeEnvironment) {
    return globals;
  }

  return {
    ...globals,
    ...normalizeVariableLookup(activeEnvironment.variables),
  };
};

const buildWorkspaceEnvironments = (manifest: any): WorkspaceEnvironment[] => {
  if (!manifest?.workspace || !Array.isArray(manifest.workspace.environments)) {
    return [];
  }

  return manifest.workspace.environments
    .filter((environment: any) => environment && typeof environment.id === 'string' && environment.id.trim() !== '')
    .map((environment: any) => ({
      id: environment.id,
      name: typeof environment.name === 'string' && environment.name.trim() !== '' ? environment.name : 'Environment',
      variables: Array.isArray(environment.variables) ? environment.variables : [],
    }));
};

const collectFolderIdsFromTree = (items: HydratedSidebarItem[], acc: Set<string> = new Set()): Set<string> => {
  for (const item of items) {
    if (item.kind.type === 'folder') {
      acc.add(item.id);
      collectFolderIdsFromTree(item.kind.items, acc);
    }
  }
  return acc;
};

const addItemToPath = (items: HydratedSidebarItem[], path: string[], itemToInsert: HydratedSidebarItem): HydratedSidebarItem[] => {
  const [currentName, ...rest] = path;
  return items.map(item => {
    if (item.kind.type === 'folder' && item.kind.name === currentName) {
      if (rest.length === 0) {
        return {
          ...item,
          kind: {
            ...item.kind,
            items: [...item.kind.items, itemToInsert]
          }
        };
      }
      return {
        ...item,
        kind: {
          ...item.kind,
          items: addItemToPath(item.kind.items, rest, itemToInsert)
        }
      };
    }
    return item;
  });
};

interface SidebarState {
  tree: HydratedSidebarItem[];
  scratchpadTree: HydratedSidebarItem[];
  projectPath: string;
  workspaceName: string;
  activeMenu: string;
  setActiveMenu: (menu: string) => void;
  setProjectPath: (path: string) => void;
  setWorkspaceName: (name: string) => void;
  isWorkspaceSettingsOpen: boolean;
  setWorkspaceSettingsOpen: (open: boolean) => void;
  isAppSettingsOpen: boolean;
  setAppSettingsOpen: (open: boolean) => void;
  fetchSidebar: () => Promise<void>;
  updateTreeOptimistic: (newTree: HydratedSidebarItem[]) => void;
  syncTreeToBackend: (newTree: HydratedSidebarItem[]) => Promise<void>;
  moveItem: (activeId: string, overId: string, overPosition?: 'before' | 'after' | 'inside') => void;
  pendingNames: Record<string, string>;
  updateRequestName: (id: string, newName: string) => void;
  renameRequest: (id: string, newName: string) => Promise<void>;
  addItem: (item: HydratedSidebarItem, parentPath?: string[], isScratchpad?: boolean) => Promise<void>;
  addItemOptimistic: (item: HydratedSidebarItem, parentPath?: string[], isScratchpad?: boolean) => void;
  deleteItem: (path: string[], isScratchpad?: boolean) => Promise<void>;
  ensureWorkspace: () => Promise<boolean>;
  openWorkspace: () => Promise<void>;
  createWorkspace: () => Promise<void>;
  exportWorkspace: () => Promise<void>;
  importFirvExport: () => Promise<void>;
  importPostmanCollection: () => Promise<void>;
  loadOrphans: () => Promise<void>;
  getRequestName: (id: string) => string;
  clearPendingName: (id: string) => void;
  closeWorkspace: () => Promise<void>;
  promoteScratchpadRequest: (requestId: string, item: HydratedSidebarItem) => void;
  expandedFolderIdsByWorkspace: Record<string, string[]>;
  toggleFolderExpansion: (workspaceKey: string, folderId: string) => void;
  expandAllFoldersForWorkspace: (workspaceKey: string, tree: HydratedSidebarItem[]) => void;
  collapseAllFoldersForWorkspace: (workspaceKey: string) => void;
  syncExpandedFoldersWithTree: (workspaceKey: string, tree: HydratedSidebarItem[]) => void;
  expandedStateHydrated: boolean;
  workspaceGlobals: Record<string, string>;
  workspaceEnvironments: WorkspaceEnvironment[];
  activeWorkspaceEnvironmentId: string;
  setWorkspaceGlobals: (globals: KeyValue[] | Record<string, string>) => void;
  setWorkspaceActiveEnvironment: (environmentId: string | null) => Promise<void>;
  clearWorkspaceGlobals: () => void;
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

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set, get) => ({
      tree: [],
      scratchpadTree: [],
      pendingNames: {},
      workspaceGlobals: {},
      workspaceEnvironments: [],
      activeWorkspaceEnvironmentId: '',
      projectPath: '', // Default or replace with dynamic project path
      workspaceName: '',
      activeMenu: 'workspace',
      isWorkspaceSettingsOpen: false,
      setWorkspaceSettingsOpen: (open) => set({ isWorkspaceSettingsOpen: open }),
      isAppSettingsOpen: false,
      setAppSettingsOpen: (open) => set({ isAppSettingsOpen: open }),
      setActiveMenu: (activeMenu) => set({ activeMenu }),
      setProjectPath: (path) => {
        set({ projectPath: path, workspaceGlobals: {}, workspaceEnvironments: [], activeWorkspaceEnvironmentId: '' });
        void get().fetchSidebar();
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
            const workspaceEnvironments = buildWorkspaceEnvironments(manifest);
            const activeWorkspaceEnvironmentId = manifest?.workspace?.active_environment || '';
            if (manifest && manifest.name) {
              set({
                workspaceName: manifest.name,
                workspaceGlobals: buildWorkspaceVariableLookup(manifest),
                workspaceEnvironments,
                activeWorkspaceEnvironmentId,
              });
            } else {
              // Fallback to directory name if name is missing in manifest
              const dirName = projectPath.split(/[/\\]/).filter(Boolean).pop() || '';
              set({
                workspaceName: dirName,
                workspaceGlobals: buildWorkspaceVariableLookup(manifest),
                workspaceEnvironments,
                activeWorkspaceEnvironmentId,
              });
            }
          } catch (me) {
            console.error('Failed to fetch manifest for name:', me);
            // Fallback to directory name if manifest fetch fails
            const dirName = projectPath.split(/[/\\]/).filter(Boolean).pop() || '';
            set({ workspaceName: dirName, workspaceGlobals: {}, workspaceEnvironments: [], activeWorkspaceEnvironmentId: '' });
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
        const { tree, scratchpadTree, syncTreeToBackend } = get();
        
        // Find and remove the active item from either tree
        let draggedItem: HydratedSidebarItem | null = null;
        const removeItemFromList = (items: HydratedSidebarItem[]): HydratedSidebarItem[] => {
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
                  items: removeItemFromList(item.kind.items)
                }
              });
            } else {
              result.push(item);
            }
          }
          return result;
        };

        const newTreeWithoutItem = removeItemFromList(tree);
        const newScratchpadTreeWithoutItem = removeItemFromList(scratchpadTree);
        
        if (!draggedItem) return;

        // Insert the item into the new position
        const insertItemToList = (items: HydratedSidebarItem[]): HydratedSidebarItem[] => {
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
                  items: insertItemToList(item.kind.items)
                }
              });
            } else {
              result.push(item);
            }
          }
          return result;
        };

        // Determine which tree we are dropping into
        const isOverInTree = (items: HydratedSidebarItem[]): boolean => {
          for (const item of items) {
            if (item.id === overId) return true;
            if (item.kind.type === 'folder' && isOverInTree(item.kind.items)) return true;
          }
          return false;
        };

        let updatedTree = newTreeWithoutItem;
        let updatedScratchpadTree = newScratchpadTreeWithoutItem;

        if (!overId || isOverInTree(newTreeWithoutItem)) {
          // If overId is null or in tree, drop into tree
          if (!overId) {
            updatedTree = [...newTreeWithoutItem, draggedItem];
          } else {
            updatedTree = insertItemToList(newTreeWithoutItem);
          }
          set({ tree: updatedTree, scratchpadTree: updatedScratchpadTree });
          void syncTreeToBackend(updatedTree);
        } else {
          // Otherwise drop into scratchpadTree
          updatedScratchpadTree = insertItemToList(newScratchpadTreeWithoutItem);
          
          // Verify insertion
          const wasInserted = (items: HydratedSidebarItem[]): boolean => {
            for (const item of items) {
              if (item.id === activeId) return true;
              if (item.kind.type === 'folder' && wasInserted(item.kind.items)) return true;
            }
            return false;
          };

          if (!wasInserted(updatedScratchpadTree)) {
            updatedScratchpadTree = [...newScratchpadTreeWithoutItem, draggedItem];
          }
          set({ tree: updatedTree, scratchpadTree: updatedScratchpadTree });
          void syncTreeToBackend(updatedTree);
        }
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
          
          await invoke('update_manifest_structure', {
            projectRoot: projectPath,
            workspace: { 
              ...manifest.workspace,
              order 
            }
          });
        } catch (e) {
          console.error('Failed to sync tree:', e);
          await get().fetchSidebar(); // Rollback on fail
        }
      },
      updateRequestName: (id, newName) => {
        set((state) => ({
          pendingNames: { ...state.pendingNames, [id]: newName }
        }));
      },
      renameRequest: async (id, newName) => {
        const { tree, scratchpadTree, projectPath, syncTreeToBackend, clearPendingName } = get();

        const renameInItems = (items: HydratedSidebarItem[]): HydratedSidebarItem[] => {
          return items.map(item => {
            if (item.kind.type === 'request' && item.kind.id === id) {
              return {
                ...item,
                kind: {
                  ...item.kind,
                  name: newName,
                }
              };
            }

            if (item.kind.type === 'folder') {
              return {
                ...item,
                kind: {
                  ...item.kind,
                  items: renameInItems(item.kind.items)
                }
              };
            }

            return item;
          });
        };

        set({ tree: renameInItems(tree), scratchpadTree: renameInItems(scratchpadTree) });
        clearPendingName(id);

        if (projectPath) {
          await syncTreeToBackend(renameInItems(tree));
        }
      },
      clearPendingName: (id) => {
        set((state) => {
          const newPending = { ...state.pendingNames };
          delete newPending[id];
          return { pendingNames: newPending };
        });
      },
      promoteScratchpadRequest: (requestId, item) => {
        const removeFromScratchpad = (items: HydratedSidebarItem[]): HydratedSidebarItem[] => {
          return items
            .filter(existing => !(existing.kind.type === 'request' && existing.kind.id === requestId))
            .map(existing => {
              if (existing.kind.type !== 'folder') return existing;
              
              const nextItems = removeFromScratchpad(existing.kind.items);
              if (nextItems.length === 0) {
                return null;
              }

              return {
                ...existing,
                kind: {
                  ...existing.kind,
                  items: nextItems,
                },
              };
            })
            .filter((existing): existing is HydratedSidebarItem => existing !== null);
        };

        const removeFromTree = (items: HydratedSidebarItem[]): HydratedSidebarItem[] => {
          return items
            .filter(existing => !(existing.kind.type === 'request' && existing.kind.id === requestId))
            .map(existing => {
              if (existing.kind.type !== 'folder') return existing;

              const nextItems = removeFromTree(existing.kind.items);
              if (nextItems === existing.kind.items) {
                return existing;
              }

              return {
                ...existing,
                kind: {
                  ...existing.kind,
                  items: nextItems,
                },
              };
            });
        };

        const appendToWorkspaceTree = (items: HydratedSidebarItem[]): HydratedSidebarItem[] => {
          const cleanedItems = removeFromTree(items);
          return [...cleanedItems, item];
        };

        set((state) => ({
          tree: appendToWorkspaceTree(state.tree),
          scratchpadTree: removeFromScratchpad(state.scratchpadTree),
        }));
      },
      expandedFolderIdsByWorkspace: {},
      expandedStateHydrated: false,
      setWorkspaceGlobals: (globals) => set({ workspaceGlobals: normalizeVariableLookup(globals) }),
      setWorkspaceActiveEnvironment: async (environmentId) => {
        const { projectPath } = get();
        if (!projectPath) return;

        try {
          const manifest: any = await invoke('get_manifest', { projectPath });
          const updatedWorkspace = {
            ...manifest.workspace,
            active_environment: environmentId || null,
          };

          set({ activeWorkspaceEnvironmentId: environmentId || '' });

          await invoke('update_manifest_structure', {
            projectRoot: projectPath,
            workspace: updatedWorkspace,
            name: manifest.name || null,
          });

          await get().fetchSidebar();
        } catch (error) {
          console.error('Failed to update active environment:', error);
          await get().fetchSidebar();
        }
      },
      clearWorkspaceGlobals: () => set({ workspaceGlobals: {} }),
      toggleFolderExpansion: (workspaceKey, folderId) => {
        const key = getWorkspaceKey(workspaceKey);
        set((state) => {
          const current = new Set(state.expandedFolderIdsByWorkspace[key] ?? []);
          if (current.has(folderId)) current.delete(folderId);
          else current.add(folderId);

          return {
            expandedFolderIdsByWorkspace: {
              ...state.expandedFolderIdsByWorkspace,
              [key]: Array.from(current)
            }
          };
        });
      },
      expandAllFoldersForWorkspace: (workspaceKey, tree) => {
        const key = getWorkspaceKey(workspaceKey);
        const allFolderIds = Array.from(collectFolderIdsFromTree(tree));
        set((state) => ({
          expandedFolderIdsByWorkspace: {
            ...state.expandedFolderIdsByWorkspace,
            [key]: allFolderIds
          }
        }));
      },
      collapseAllFoldersForWorkspace: (workspaceKey) => {
        const key = getWorkspaceKey(workspaceKey);
        set((state) => ({
          expandedFolderIdsByWorkspace: {
            ...state.expandedFolderIdsByWorkspace,
            [key]: []
          }
        }));
      },
      syncExpandedFoldersWithTree: (workspaceKey, tree) => {
        const key = getWorkspaceKey(workspaceKey);
        const allFolderIds = collectFolderIdsFromTree(tree);
        set((state) => {
          const existing = state.expandedFolderIdsByWorkspace[key];
          let nextSet: Set<string> | null = null;
          let changed = false;

          if (!existing) {
            if (!state.expandedStateHydrated) {
              return {};
            }
            nextSet = new Set(allFolderIds);
            changed = true;
          } else {
            nextSet = new Set(existing);
            for (const id of Array.from(nextSet)) {
              if (!allFolderIds.has(id)) {
                nextSet.delete(id);
                changed = true;
              }
            }
          }

          if (!changed) {
            return {};
          }

          return {
            expandedFolderIdsByWorkspace: {
              ...state.expandedFolderIdsByWorkspace,
              [key]: Array.from(nextSet ?? [])
            }
          };
        });
      },
      addItemOptimistic: (newItem, parentPath, isScratchpad) => {
        const { tree, scratchpadTree, projectPath } = get();
        const itemWithId = {
          ...newItem,
          id: newItem.id || crypto.randomUUID()
        };

        if (isScratchpad || !projectPath) {
          set({ scratchpadTree: [...scratchpadTree, itemWithId] });
          return;
        }

        if (!parentPath || parentPath.length === 0) {
          set({ tree: [...tree, itemWithId] });
          return;
        }

        set({ tree: addItemToPath(tree, parentPath, itemWithId) });
      },
      addItem: async (newItem, parentPath, isScratchpad) => {
        const { tree, scratchpadTree, syncTreeToBackend, projectPath } = get();
        const itemWithId = {
          ...newItem,
          id: newItem.id || crypto.randomUUID()
        };

        if (isScratchpad || !projectPath) {
          set({ scratchpadTree: [...scratchpadTree, itemWithId] });
          return;
        }

        if (!parentPath || parentPath.length === 0) {
          const newTree = [...tree, itemWithId];
          set({ tree: newTree });
          await syncTreeToBackend(newTree);
          return;
        }

        const newTree = addItemToPath(tree, parentPath, itemWithId);
        set({ tree: newTree });
        await syncTreeToBackend(newTree);
      },
      deleteItem: async (path, isScratchpad) => {
        const { tree, scratchpadTree, projectPath, syncTreeToBackend } = get();

        const deleteFromItems = (items: HydratedSidebarItem[], currentPath: string[]): HydratedSidebarItem[] => {
          const [targetName, ...remainingPath] = currentPath;
          if (remainingPath.length === 0) {
            return items.filter(item => item.kind.type !== 'error' && item.kind.name !== targetName);
          }
          return items.map(item => {
            if (item.kind.type === 'folder' && item.kind.name === targetName) {
              return {
                ...item,
                kind: { ...item.kind, items: deleteFromItems(item.kind.items, remainingPath) }
              };
            }
            return item;
          });
        };

        if (isScratchpad || !projectPath) {
          set({ scratchpadTree: deleteFromItems(scratchpadTree, path) });
          return;
        }

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
      exportWorkspace: async () => {
        const { projectPath, workspaceName } = get();
        if (!projectPath) {
          console.error('No workspace open. Please open a workspace first.');
          return;
        }

        try {
          const { save } = await import('@tauri-apps/plugin-dialog');
          const selected = await save({
            title: 'Export FIRV Workspace',
            defaultPath: `${workspaceName || 'workspace'}.yaml`,
            filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }],
          });

          if (!selected) return;

          await invoke('export_workspace', { projectRoot: projectPath, outputPath: selected });
        } catch (e) {
          console.error('Failed to export workspace:', e);
        }
      },
      importFirvExport: async () => {
        const { projectPath } = get();
        if (!projectPath) {
          console.error('No workspace open. Please open a workspace first.');
          return;
        }

        try {
          const { open } = await import('@tauri-apps/plugin-dialog');
          const selected = await open({
            multiple: false,
            filters: [{ name: 'FIRV Export', extensions: ['yaml', 'yml'] }],
            title: 'Select FIRV Export YAML',
          });

          if (!selected || Array.isArray(selected)) return;

          await invoke('import_firv_export', { projectRoot: projectPath, inputPath: selected });
          await get().fetchSidebar();
          await get().loadOrphans();
        } catch (e) {
          console.error('Failed to import FIRV export:', e);
        }
      },
      importPostmanCollection: async () => {
        const { projectPath, workspaceName: currentWorkspaceName } = get();
        if (!projectPath) {
          console.error("No workspace open. Please open a workspace first.");
          return;
        }

        try {
          const { open } = await import('@tauri-apps/plugin-dialog');
          const { readTextFile } = await import('@tauri-apps/plugin-fs');

          const selected = await open({
            multiple: false,
            filters: [{
              name: 'Postman Collection',
              extensions: ['json']
            }],
            title: 'Select Postman Collection'
          });

          if (!selected || Array.isArray(selected)) return;

          const content = await readTextFile(selected);
          const collection = JSON.parse(content);

          const projectRoot = projectPath;
          
          const requestsToSave: any[] = [];

          const processItem = (item: any): any => {
            if (item.item) {
              // Folder
              return {
                type: 'folder',
                name: item.name,
                items: item.item.map((child: any) => processItem(child)).filter(Boolean),
              };
            } else if (item.request) {
              // Request
              const id = crypto.randomUUID();
              const req = item.request;
              
              let body: any = { mode: 'none' };
              if (req.body) {
                if (req.body.mode === 'raw') {
                  const rawLanguage = req.body.options?.raw?.language;
                  body = rawLanguage === 'json'
                    ? { mode: 'json', data: req.body.raw || '' }
                    : { mode: 'raw', data: req.body.raw || '' };
                } else if (req.body.mode === 'formdata') {
                  body = {
                    mode: 'formdata',
                    data: (req.body.formdata || []).map((f: any) => ({
                      key: f.key || '',
                      value: f.value || '',
                      enabled: !f.disabled
                    }))
                  };
                }
              }

              const method = (req.method || 'GET').toUpperCase();
              
              const firvReq = {
                id,
                name: item.name,
                method,
                url: typeof req.url === 'string' ? req.url : (req.url?.raw || ''),
                headers: (req.header || []).map((h: any) => ({
                  key: h.key || '',
                  value: h.value || '',
                  enabled: !h.disabled
                })),
                params: (req.url?.query || []).map((q: any) => ({
                  key: q.key || '',
                  value: q.value || '',
                  enabled: !q.disabled
                })),
                body,
              };

              requestsToSave.push(firvReq);

              return {
                type: 'request',
                id,
                name: item.name,
                method
              };
            }
          };

          const importedItems = (collection.item || []).map((item: any) => processItem(item)).filter(Boolean);

          const importedGlobals: KeyValue[] = [];
          if (collection.variable && Array.isArray(collection.variable)) {
            for (const v of collection.variable) {
              if (v.key) {
                importedGlobals.push({
                  key: v.key,
                  value: v.value || '',
                  enabled: !v.disabled
                });
              }
            }
          }

          // 1. Save all requests
          for (const req of requestsToSave) {
            await invoke('update_request', { projectRoot, request: req });
          }

          // 2. Fetch current manifest to append to it
          const currentManifest: any = await invoke('get_manifest', { projectPath });
          if (!currentManifest || !currentManifest.workspace) {
            console.error("Invalid manifest structure during Postman import");
            return;
          }

          const newOrder = [
            ...(currentManifest.workspace.order || []),
            ...importedItems
          ];

          const mergedGlobals = [
            ...(currentManifest.workspace.globals || []),
            ...importedGlobals
          ];

          // 3. Update manifest with new order and globals

          await invoke('update_manifest_structure', {
            projectRoot,
            workspace: {
              ...currentManifest.workspace,
              order: newOrder,
              globals: mergedGlobals,
            },
            name: currentWorkspaceName || undefined
          });

          await get().fetchSidebar();
          await get().loadOrphans();

        } catch (e) {
          console.error("Failed to import Postman collection:", e);
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
        const { tree, scratchpadTree, pendingNames } = get();
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
        return findName(tree) || findName(scratchpadTree) || 'New Request';
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
          isWorkspaceSettingsOpen: false,
          workspaceGlobals: {},
          workspaceEnvironments: [],
          activeWorkspaceEnvironmentId: '',
        });
        reset();
      }
    }),
    {
      name: 'firv-sidebar-storage',
      partialize: (state) => ({ 
        scratchpadTree: state.scratchpadTree,
        projectPath: state.projectPath,
        workspaceName: state.workspaceName,
        workspaceEnvironments: state.workspaceEnvironments,
        activeWorkspaceEnvironmentId: state.activeWorkspaceEnvironmentId,
        expandedFolderIdsByWorkspace: state.expandedFolderIdsByWorkspace,
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.error('Failed to rehydrate sidebar store:', error);
        }
      }
    }
  )
);

useSidebarStore.persist?.onFinishHydration?.(() => {
  useSidebarStore.setState({ expandedStateHydrated: true });
});

if (useSidebarStore.persist?.hasHydrated?.()) {
  useSidebarStore.setState({ expandedStateHydrated: true });
}

// Set up file watcher
void listen('firv://file-changed', () => {
  void useSidebarStore.getState().fetchSidebar();
});
