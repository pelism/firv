import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RequestEditor } from './RequestEditor';
import { useAppStore } from '../store/appStore';
import { useSidebarStore } from '../store/sidebarStore';

const invoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: any[]) => invoke(...args) }));

const request = {
  method: 'POST',
  url: 'https://example.test/api',
  body: { mode: 'json', data: '{"hello":"world"}' },
  headers: [{ key: 'X-Test', value: '1', enabled: true }],
  params: [{ key: 'q', value: 'abc', enabled: true }],
  transforms: { pre_request_template: '', response_extractions: [], before_run: [], chain_steps: [] },
};

describe('RequestEditor integration', () => {
  beforeEach(() => {
    invoke.mockReset();
    useAppStore.getState().reset();
    useSidebarStore.setState({
      projectPath: '/workspace',
      tree: [],
      pendingNames: {},
      workspaceName: 'workspace',
      ensureWorkspace: vi.fn().mockResolvedValue(true),
    } as any);
    invoke.mockImplementation((name: string) => {
      if (name === 'get_request') return Promise.resolve(request);
      if (name === 'get_manifest') return Promise.resolve({ workspace: { globals: [] } });
      if (name === 'update_request') return Promise.resolve({});
      if (name === 'run_firv_request') return Promise.resolve({ response: { ok: true }, execution_time_ms: 12 });
      return Promise.resolve({});
    });
  });

  it('hydrates, marks dirty, saves, and runs', async () => {
    render(<RequestEditor requestId="req-1" />);
    await screen.findByDisplayValue('POST');

    fireEvent.change(screen.getByDisplayValue('https://example.test/api'), { target: { value: 'https://example.test/api/v2' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('update_request', expect.any(Object)));

    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('run_firv_request', expect.any(Object)));
  });
});
