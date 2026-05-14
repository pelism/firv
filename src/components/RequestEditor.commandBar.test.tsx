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

describe('RequestEditor command bar', () => {
  beforeEach(() => {
    invoke.mockReset();
    useAppStore.getState().reset();
    useSidebarStore.setState({
      projectPath: '/workspace',
      tree: [],
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

    expect(await screen.findByDisplayValue('GET')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://example.test')).toBeInTheDocument();
  });

  it('allows changing the method and URL', async () => {
    render(<RequestEditor requestId="req-1" />);

    const methodSelect = await screen.findByDisplayValue('GET');
    fireEvent.change(methodSelect, { target: { value: 'POST' } });
    expect((methodSelect as HTMLSelectElement).value).toBe('POST');

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
    await screen.findByDisplayValue('GET');

    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText(/invalid json body/i)).toBeInTheDocument());
  });
});
