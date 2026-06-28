import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RequestEditor } from './RequestEditor';
import { useAppStore } from '../store/appStore';
import { useSidebarStore } from '../store/sidebarStore';

const invoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: any[]) => invoke(...args) }));

const baseRequest = {
  method: 'GET',
  url: 'https://example.test',
  body: { mode: 'json', data: '{"hello":"world"}' },
  headers: [],
  params: [],
  transforms: { pre_request_template: '', response_extractions: [], before_run: [], chain_steps: [] },
};

const createScratchpadSidebarState = () => ({
  projectPath: '',
  tree: [],
  scratchpadTree: [
    {
      id: 'scratch-folder-1',
      kind: {
        type: 'folder',
        name: 'Scratch Folder',
        items: [
          {
            id: 'scratch-item-1',
            kind: {
              type: 'request',
              id: 'req-1',
              name: 'Scratch Request',
              method: 'POST',
            },
          },
        ],
      },
    },
  ],
  pendingNames: {},
  workspaceName: '',
  ensureWorkspace: vi.fn().mockResolvedValue(true),
  addItemOptimistic: vi.fn(),
});

describe('RequestEditor command bar', () => {
  beforeEach(() => {
    invoke.mockReset();
    useAppStore.getState().reset();
    useSidebarStore.setState({
      projectPath: '/workspace',
      tree: [],
      scratchpadTree: [],
      pendingNames: {},
      workspaceName: 'workspace',
    } as any);
    invoke.mockImplementation((name: string) => {
      if (name === 'get_request') return Promise.resolve(baseRequest);
      if (name === 'get_manifest') return Promise.resolve({ workspace: { globals: [] } });
      if (name === 'update_request') return Promise.resolve({});
      if (name === 'run_firv_request') return Promise.resolve({ response: null, execution_time_ms: 1 });
      return Promise.resolve({});
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders method selector and url input', async () => {
    render(<RequestEditor requestId="req-1" />);

    expect(await screen.findByRole('button', { name: 'GET' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://example.test')).toBeInTheDocument();
  });

  it('allows changing the method and URL', async () => {
    render(<RequestEditor requestId="req-1" />);

    const methodButton = await screen.findByRole('button', { name: 'GET' });
    fireEvent.click(methodButton);
    const postOption = await screen.findByRole('button', { name: 'POST' });
    fireEvent.click(postOption);
    expect(await screen.findByRole('button', { name: 'POST' })).toBeInTheDocument();

    const urlInput = screen.getByDisplayValue('https://example.test');
    fireEvent.change(urlInput, { target: { value: 'https://changed.test' } });
    expect((urlInput as HTMLInputElement).value).toBe('https://changed.test');
  });

  it('shows validation banner when run fails validation', async () => {
    invoke.mockImplementation((name: string) => {
      if (name === 'get_request') return Promise.resolve({ ...baseRequest, body: { mode: 'json', data: '{' } });
      if (name === 'get_manifest') return Promise.resolve({ workspace: { globals: [] } });
      return Promise.resolve({});
    });

    render(<RequestEditor requestId="req-1" />);
    await screen.findByRole('button', { name: 'GET' });

    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText(/invalid json body/i)).toBeInTheDocument());
  });

  it('keeps the move to workspace button visible for scratchpad requests and clears scratchpad state after save', async () => {
    useSidebarStore.setState(createScratchpadSidebarState() as any);

    useAppStore.getState().setScratchpadRequestData('req-1', {
      method: 'POST',
      url: 'https://scratchpad.test',
      headers: [],
      params: [],
      body: { mode: 'json', data: '{}' },
      transforms: { pre_request_template: '', response_extractions: [], before_run: [], chain_steps: [] },
    });

    invoke.mockImplementation((name: string) => {
      if (name === 'update_request') return Promise.resolve({});
      if (name === 'get_manifest') return Promise.resolve({ workspace: { globals: [] } });
      return Promise.resolve({});
    });

    render(<RequestEditor requestId="req-1" />);

    expect(await screen.findByRole('button', { name: /move to workspace/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /move to workspace/i }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('update_request', expect.any(Object)));
    await waitFor(() => expect(useSidebarStore.getState().tree).toHaveLength(1));
    const savedItem = useSidebarStore.getState().tree[0];
    expect(savedItem.kind.type).toBe('request');
    if (savedItem.kind.type === 'request') {
      expect(savedItem.kind.id).toBe('req-1');
    }
    expect(useSidebarStore.getState().scratchpadTree).toHaveLength(0);
    expect(useSidebarStore.getState().tree.some(item => item.kind.type === 'request' && item.kind.id === 'req-1')).toBe(true);
    expect(useSidebarStore.getState().scratchpadTree.some(item => item.kind.type === 'request' && item.kind.id === 'req-1')).toBe(false);
    expect(useAppStore.getState().dirtyRequests.has('req-1')).toBe(false);
    await waitFor(() => expect(useAppStore.getState().scratchpadRequestData['req-1']).toBeUndefined());
    await waitFor(() => expect(screen.getByRole('button', { name: /move to workspace/i })).toBeInTheDocument());
  });

  it('promotes a scratchpad-origin request even without scratchpadRequestData', async () => {
    useAppStore.getState().setRequestOrigin('req-1', 'scratchpad');
    useSidebarStore.setState(createScratchpadSidebarState() as any);

    invoke.mockImplementation((name: string) => {
      if (name === 'update_request') return Promise.resolve({});
      if (name === 'get_manifest') return Promise.resolve({ workspace: { globals: [] } });
      return Promise.resolve({});
    });

    render(<RequestEditor requestId="req-1" />);

    expect(await screen.findByRole('button', { name: /move to workspace/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /move to workspace/i }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('update_request', expect.any(Object)));
    await waitFor(() => expect(useSidebarStore.getState().tree).toHaveLength(1));
    expect(useSidebarStore.getState().scratchpadTree).toHaveLength(0);
    expect(useAppStore.getState().requestOrigins['req-1']).toBe('workspace');
    await waitFor(() => expect(screen.getByRole('button', { name: /move to workspace/i })).toBeInTheDocument());
  });

  it('does not mark a scratchpad request dirty when the URL changes', async () => {
    useAppStore.getState().setRequestOrigin('req-1', 'scratchpad');
    useAppStore.getState().setScratchpadRequestData('req-1', {
      method: 'POST',
      url: 'https://scratchpad.test',
      headers: [],
      params: [],
      body: { mode: 'json', data: '{}' },
      transforms: { pre_request_template: '', response_extractions: [], before_run: [], chain_steps: [] },
    });
    useSidebarStore.setState({
      projectPath: '',
      tree: [],
      scratchpadTree: [],
      pendingNames: {},
      workspaceName: '',
    } as any);

    render(<RequestEditor requestId="req-1" />);

    const urlInput = await screen.findByDisplayValue('https://scratchpad.test');
    fireEvent.change(urlInput, { target: { value: 'https://changed-scratchpad.test' } });

    expect(useAppStore.getState().dirtyRequests.has('req-1')).toBe(false);
    expect(screen.getByRole('button', { name: /move to workspace/i })).toBeInTheDocument();
  });

  it('keeps running state isolated to the request tab that started it', async () => {
    let resolveRun!: () => void;
    const runPromise = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });

    invoke.mockImplementation((name: string, args: any) => {
      if (name === 'get_request') {
        return Promise.resolve({
          ...baseRequest,
          url: `https://${args.id}.test`,
        });
      }
      if (name === 'get_manifest') return Promise.resolve({ workspace: { globals: [] } });
      if (name === 'run_firv_request') {
        return runPromise.then(() => ({
          response: {
            status: 200,
            statusText: 'OK',
            headers: [],
            body: 'done',
          },
          execution_time_ms: 12,
          variables: {},
          final_request: null,
          script_errors: [],
          before_run_results: [],
          variable_trace: [],
          chained_results: [],
        }));
      }
      return Promise.resolve({});
    });

    const { rerender } = render(
      <>
        <RequestEditor requestId="req-1" />
        <RequestEditor requestId="req-2" />
      </>
    );

    await screen.findByDisplayValue('https://req-1.test');
    await screen.findByDisplayValue('https://req-2.test');

    fireEvent.click(screen.getAllByRole('button', { name: /send/i })[0]);

    await waitFor(() => expect(screen.getAllByRole('button', { name: /cancel/i })).toHaveLength(1));
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();

    resolveRun();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /send/i })).toHaveLength(2));

    rerender(
      <>
        <RequestEditor requestId="req-1" />
        <RequestEditor requestId="req-2" />
      </>
    );
  });
});
