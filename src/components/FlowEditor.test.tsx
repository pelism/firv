import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FlowEditor } from './FlowEditor';
import { useAppStore } from '../store/appStore';
import { useSidebarStore } from '../store/sidebarStore';

const invoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: any[]) => invoke(...args) }));

const existingFlow = {
  id: 'flow-1',
  name: 'Existing Flow',
  steps: [
    {
      request_id: 'req-1',
      input_variables: [{ key: 'name', value: 'world', enabled: true }],
      export_variables: [{ target: '{{token}}', source: 'response_body_json', pattern: 'token', enabled: true }],
      skip_before_chain: true,
      skip_on_success_chain: false,
      skip_on_failure_chain: false,
    },
  ],
};

const sidebarTree = [
  { id: 'item-1', kind: { type: 'request', id: 'req-1', name: 'Request One', method: 'GET' } },
  { id: 'item-2', kind: { type: 'request', id: 'req-2', name: 'Request Two', method: 'POST' } },
];

describe('FlowEditor', () => {
  beforeEach(() => {
    invoke.mockReset();
    useAppStore.getState().reset();
    useSidebarStore.setState({
      workspacePath: '/workspace',
      tree: sidebarTree,
      pendingNames: {},
      workspaceName: 'workspace',
      workspaceGlobals: {},
      getRequestName: (id: string) => sidebarTree.find(i => (i.kind as any).id === id)?.kind && (sidebarTree.find(i => (i.kind as any).id === id)!.kind as any).name,
      setRequestName: vi.fn(),
      syncTreeToBackend: vi.fn().mockResolvedValue(undefined),
    } as any);
    invoke.mockImplementation((name: string) => {
      if (name === 'get_flow') return Promise.resolve(existingFlow);
      if (name === 'update_flow') return Promise.resolve({});
      if (name === 'run_firv_flow') return Promise.resolve({ steps: [], stopped_early: false });
      return Promise.resolve({});
    });
  });

  it('hydrates existing flow steps, including skip flags and export rules, from get_flow', async () => {
    render(<FlowEditor requestId="flow-1" />);

    await screen.findByDisplayValue('Existing Flow');
    expect(screen.getByRole('checkbox', { name: /skip 'before' chain/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /skip 'on success' chain/i })).not.toBeChecked();
    // Hydration displays the persisted target as-is; normalization only happens on save.
    await waitFor(() => expect(screen.getByPlaceholderText('token')).toHaveValue('{{token}}'));
    expect(screen.getAllByPlaceholderText('local name')[0]).toHaveValue('name');
  });

  it('saves a new step with a trimmed input variable key and a normalized export target', async () => {
    invoke.mockImplementation((name: string) => {
      if (name === 'get_flow') return Promise.reject(new Error('not found'));
      if (name === 'update_flow') return Promise.resolve({});
      return Promise.resolve({});
    });

    render(<FlowEditor requestId="flow-new" />);
    await screen.findByText('No steps yet. Add requests to run them in order.');

    fireEvent.click(screen.getByRole('button', { name: /add step/i }));

    fireEvent.change(screen.getByPlaceholderText('local name'), { target: { value: '  greeting  ' } });
    fireEvent.change(screen.getAllByPlaceholderText('value or {{var}}')[0], { target: { value: 'hello' } });

    fireEvent.click(screen.getByRole('button', { name: /add export/i }));
    fireEvent.change(screen.getByPlaceholderText('token'), { target: { value: '{{ result }}' } });
    fireEvent.change(screen.getByPlaceholderText('$.access_token or literal substring'), { target: { value: 'result' } });

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('update_flow', expect.objectContaining({
      workspaceRoot: '/workspace',
      flow: expect.objectContaining({
        id: 'flow-new',
        steps: [
          expect.objectContaining({
            input_variables: [{ key: 'greeting', value: 'hello', enabled: true }],
            export_variables: [expect.objectContaining({ target: 'result', pattern: 'result', enabled: true })],
          }),
        ],
      }),
    })));
  });

  it('omits disabled or empty-key input variables when saving', async () => {
    invoke.mockImplementation((name: string) => {
      if (name === 'get_flow') return Promise.reject(new Error('not found'));
      if (name === 'update_flow') return Promise.resolve({});
      return Promise.resolve({});
    });

    render(<FlowEditor requestId="flow-new" />);
    await screen.findByText('No steps yet. Add requests to run them in order.');

    fireEvent.click(screen.getByRole('button', { name: /add step/i }));
    fireEvent.change(screen.getByPlaceholderText('value or {{var}}'), { target: { value: 'orphan value' } });

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('update_flow', expect.objectContaining({
      flow: expect.objectContaining({
        steps: [expect.objectContaining({ input_variables: [] })],
      }),
    })));
  });

  it('runs the flow and displays per-step results', async () => {
    invoke.mockImplementation((name: string) => {
      if (name === 'get_flow') return Promise.resolve(existingFlow);
      if (name === 'run_firv_flow') return Promise.resolve({
        steps: [{ request_id: 'req-1', success: true, status: 200, execution_time_ms: 42, error: null }],
        stopped_early: false,
      });
      return Promise.resolve({});
    });

    render(<FlowEditor requestId="flow-1" />);
    await screen.findByDisplayValue('Existing Flow');

    fireEvent.click(screen.getByRole('button', { name: /^run$/i }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('run_firv_flow', expect.objectContaining({ workspaceRoot: '/workspace' })));
    await screen.findByText(/Status 200/);
  });
});
