import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSidebarStore } from './sidebarStore';
import type { HydratedSidebarItem } from '../types/hydratedSidebarItem';

const invoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: any[]) => invoke(...args) }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => Promise.resolve()),
}));

const requestItem = (id: string, name: string): HydratedSidebarItem => ({
  id,
  kind: { type: 'request', id, name, method: 'GET' },
});

const wsItem = (id: string, name: string): HydratedSidebarItem => ({
  id,
  kind: { type: 'ws', id, name },
});

const flowItem = (id: string, name: string): HydratedSidebarItem => ({
  id,
  kind: { type: 'flow', id, name },
});

const folderItem = (id: string, name: string, items: HydratedSidebarItem[]): HydratedSidebarItem => ({
  id,
  kind: { type: 'folder', name, items },
});

describe('useSidebarStore deleteItem', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({});
    useSidebarStore.setState({
      tree: [],
      scratchpadTree: [],
      pendingNames: {},
      workspacePath: '/workspace',
      workspaceName: 'workspace',
    } as any);
  });

  it('removes a top-level request from the scratchpad tree without calling the backend', async () => {
    useSidebarStore.setState({
      scratchpadTree: [requestItem('r1', 'Req One'), requestItem('r2', 'Req Two')],
    } as any);

    await useSidebarStore.getState().deleteItem(['Req One'], true);

    const state = useSidebarStore.getState();
    expect(state.scratchpadTree.map(i => i.id)).toEqual(['r2']);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('removes a nested request from the workspace tree and deletes its backing file', async () => {
    useSidebarStore.setState({
      tree: [folderItem('f1', 'Folder', [requestItem('r1', 'Req One')])],
    } as any);

    await useSidebarStore.getState().deleteItem(['Folder', 'Req One'], false);

    const state = useSidebarStore.getState();
    expect((state.tree[0].kind as any).items).toEqual([]);
    expect(invoke).toHaveBeenCalledWith('delete_request', { workspaceRoot: '/workspace', id: 'r1' });
  });

  it('deletes every request nested inside a deleted folder', async () => {
    useSidebarStore.setState({
      tree: [folderItem('f1', 'Folder', [requestItem('r1', 'Req One'), requestItem('r2', 'Req Two')])],
    } as any);

    await useSidebarStore.getState().deleteItem(['Folder'], false);

    expect(useSidebarStore.getState().tree).toEqual([]);
    expect(invoke).toHaveBeenCalledWith('delete_request', { workspaceRoot: '/workspace', id: 'r1' });
    expect(invoke).toHaveBeenCalledWith('delete_request', { workspaceRoot: '/workspace', id: 'r2' });
  });

  it('deletes a ws item backing file using delete_request', async () => {
    useSidebarStore.setState({
      tree: [wsItem('ws1', 'Socket')],
    } as any);

    await useSidebarStore.getState().deleteItem(['Socket'], false);

    expect(useSidebarStore.getState().tree).toEqual([]);
    expect(invoke).toHaveBeenCalledWith('delete_request', { workspaceRoot: '/workspace', id: 'ws1' });
  });

  it('deletes a flow item backing file using delete_flow instead of delete_request', async () => {
    useSidebarStore.setState({
      tree: [flowItem('flow1', 'My Flow')],
    } as any);

    await useSidebarStore.getState().deleteItem(['My Flow'], false);

    expect(useSidebarStore.getState().tree).toEqual([]);
    expect(invoke).toHaveBeenCalledWith('delete_flow', { workspaceRoot: '/workspace', id: 'flow1' });
    expect(invoke).not.toHaveBeenCalledWith('delete_request', expect.anything());
  });

  it('continues removing the item from the tree even if the backend delete call fails', async () => {
    invoke.mockImplementation((name: string) => {
      if (name === 'delete_request') return Promise.reject(new Error('boom'));
      return Promise.resolve({});
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    useSidebarStore.setState({
      tree: [requestItem('r1', 'Req One')],
    } as any);

    await useSidebarStore.getState().deleteItem(['Req One'], false);

    expect(useSidebarStore.getState().tree).toEqual([]);
    consoleErrorSpy.mockRestore();
  });
});
