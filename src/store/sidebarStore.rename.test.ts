import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSidebarStore } from './sidebarStore';

const invoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: any[]) => invoke(...args) }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => Promise.resolve()),
}));

describe('useSidebarStore renameRequest', () => {
  beforeEach(() => {
    invoke.mockReset();
    useSidebarStore.setState({
      tree: [],
      scratchpadTree: [],
      pendingNames: {},
      projectPath: '/workspace',
      workspaceName: 'workspace',
    } as any);

    invoke.mockImplementation((name: string) => {
      if (name === 'check_workspace_exists') return Promise.resolve(true);
      if (name === 'get_manifest') {
        return Promise.resolve({
          workspace: {
            globals: [],
            order: [],
          },
        });
      }
      if (name === 'update_manifest_structure') return Promise.resolve({});
      return Promise.resolve({});
    });
  });

  it('renames a request in the workspace tree and syncs the manifest', async () => {
    useSidebarStore.setState({
      tree: [
        {
          id: 'item-1',
          kind: {
            type: 'request',
            id: 'req-1',
            name: 'Old Name',
            method: 'GET',
          },
        },
      ],
    } as any);

    await useSidebarStore.getState().renameRequest('req-1', 'New Name');

    const state = useSidebarStore.getState();
    expect(state.tree[0].kind.type).toBe('request');
    expect(state.tree[0].kind.name).toBe('New Name');
    expect(state.pendingNames['req-1']).toBeUndefined();
    expect(invoke).toHaveBeenCalledWith(
      'update_manifest_structure',
      expect.objectContaining({
        projectRoot: '/workspace',
        workspace: expect.objectContaining({
          order: [
            expect.objectContaining({
              type: 'request',
              id: 'req-1',
              name: 'New Name',
              method: 'GET',
            }),
          ],
        }),
      }),
    );
  });
});
