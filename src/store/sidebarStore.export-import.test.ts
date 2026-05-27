import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSidebarStore } from './sidebarStore';

const invoke = vi.fn();
const dialogMock = {
  save: vi.fn(),
  open: vi.fn(),
};

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: any[]) => invoke(...args) }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => Promise.resolve()),
}));
vi.mock('@tauri-apps/plugin-dialog', () => dialogMock);
vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(),
}));

describe('useSidebarStore export/import flows', () => {
  beforeEach(() => {
    invoke.mockReset();
    dialogMock.save.mockReset();
    dialogMock.open.mockReset();

    useSidebarStore.setState({
      tree: [],
      scratchpadTree: [],
      pendingNames: {},
      projectPath: '/workspace',
      workspaceName: 'My Workspace',
      fetchSidebar: vi.fn(),
      loadOrphans: vi.fn(),
    } as any);

    invoke.mockImplementation((name: string) => {
      if (name === 'export_workspace') return Promise.resolve({});
      if (name === 'import_firv_export') return Promise.resolve({});
      return Promise.resolve({});
    });
  });

  it('exports the current workspace to the selected file path', async () => {
    dialogMock.save.mockResolvedValue('/tmp/exported-workspace.yaml');

    await useSidebarStore.getState().exportWorkspace();

    expect(dialogMock.save).toHaveBeenCalledWith({
      title: 'Export FIRV Workspace',
      defaultPath: 'My Workspace.yaml',
      filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }],
    });
    expect(invoke).toHaveBeenCalledWith('export_workspace', {
      projectRoot: '/workspace',
      outputPath: '/tmp/exported-workspace.yaml',
    });
  });

  it('imports a FIRV export and refreshes sidebar state', async () => {
    dialogMock.open.mockResolvedValue('/tmp/imported-workspace.yaml');

    const fetchSidebar = vi.fn().mockResolvedValue(undefined);
    const loadOrphans = vi.fn().mockResolvedValue(undefined);
    useSidebarStore.setState({
      fetchSidebar,
      loadOrphans,
    } as any);

    await useSidebarStore.getState().importFirvExport();

    expect(dialogMock.open).toHaveBeenCalledWith({
      multiple: false,
      filters: [{ name: 'FIRV Export', extensions: ['yaml', 'yml'] }],
      title: 'Select FIRV Export YAML',
    });
    expect(invoke).toHaveBeenCalledWith('import_firv_export', {
      projectRoot: '/workspace',
      inputPath: '/tmp/imported-workspace.yaml',
    });
    expect(fetchSidebar).toHaveBeenCalledTimes(1);
    expect(loadOrphans).toHaveBeenCalledTimes(1);
  });
});
