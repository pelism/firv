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

const folderItem = (id: string, name: string, items: HydratedSidebarItem[]): HydratedSidebarItem => ({
  id,
  kind: { type: 'folder', name, items },
});

describe('useSidebarStore moveItem', () => {
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

  it('reorders a top-level item before its sibling', () => {
    useSidebarStore.setState({
      tree: [requestItem('a', 'A'), requestItem('b', 'B')],
    } as any);

    useSidebarStore.getState().moveItem('b', 'a', 'before');

    const tree = useSidebarStore.getState().tree;
    expect(tree.map(i => i.id)).toEqual(['b', 'a']);
  });

  it('reorders a top-level item after its sibling', () => {
    useSidebarStore.setState({
      tree: [requestItem('a', 'A'), requestItem('b', 'B')],
    } as any);

    useSidebarStore.getState().moveItem('a', 'b', 'after');

    const tree = useSidebarStore.getState().tree;
    expect(tree.map(i => i.id)).toEqual(['b', 'a']);
  });

  it('moves an item into a folder when dropped inside it', () => {
    useSidebarStore.setState({
      tree: [requestItem('a', 'A'), folderItem('f1', 'Folder', [])],
    } as any);

    useSidebarStore.getState().moveItem('a', 'f1', 'inside');

    const tree = useSidebarStore.getState().tree;
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('f1');
    expect((tree[0].kind as any).items.map((i: HydratedSidebarItem) => i.id)).toEqual(['a']);
  });

  it('moves an item out of a nested folder to the top level of the tree', () => {
    useSidebarStore.setState({
      tree: [folderItem('f1', 'Folder', [requestItem('a', 'A')]), requestItem('b', 'B')],
    } as any);

    useSidebarStore.getState().moveItem('a', 'b', 'after');

    const tree = useSidebarStore.getState().tree;
    expect(tree.map(i => i.id)).toEqual(['f1', 'b', 'a']);
    expect((tree.find(i => i.id === 'f1')?.kind as any)?.items).toEqual([]);
  });

  it('moves an item between the scratchpad tree and the workspace tree', () => {
    useSidebarStore.setState({
      tree: [requestItem('a', 'A')],
      scratchpadTree: [requestItem('scratch-1', 'Scratch')],
    } as any);

    useSidebarStore.getState().moveItem('scratch-1', 'a', 'after');

    const state = useSidebarStore.getState();
    expect(state.scratchpadTree.map(i => i.id)).toEqual([]);
    expect(state.tree.map(i => i.id)).toEqual(['a', 'scratch-1']);
  });

  it('does nothing when the dragged item cannot be found', () => {
    useSidebarStore.setState({
      tree: [requestItem('a', 'A')],
    } as any);

    useSidebarStore.getState().moveItem('missing', 'a', 'before');

    expect(useSidebarStore.getState().tree.map(i => i.id)).toEqual(['a']);
  });

  it('syncs the updated tree to the backend after moving within the workspace tree', async () => {
    useSidebarStore.setState({
      tree: [requestItem('a', 'A'), requestItem('b', 'B')],
    } as any);

    useSidebarStore.getState().moveItem('b', 'a', 'before');

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('update_manifest_structure', expect.anything());
    });
  });
});
