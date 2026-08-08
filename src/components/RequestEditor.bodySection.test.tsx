import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('RequestEditor body section', () => {
  beforeEach(() => {
    invoke.mockReset();
    useAppStore.getState().reset();
    useSidebarStore.setState({ workspacePath: '/workspace', tree: [], pendingNames: {}, workspaceName: 'workspace' } as any);
    invoke.mockImplementation((name: string) => {
      if (name === 'get_request') return Promise.resolve(baseRequest);
      if (name === 'get_manifest') return Promise.resolve({ workspace: { globals: [] } });
      return Promise.resolve({});
    });
  });

  it('switches between body modes', async () => {
    render(<RequestEditor requestId="req-1" />);
    await screen.findByRole('button', { name: 'GET' });

    fireEvent.click(screen.getByRole('button', { name: 'body' }));
    expect(screen.getByText(/JSON Body/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'form' }));
    expect(screen.getByText(/No form fields yet/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'none' }));
    expect(screen.getByText(/No Request Body/i)).toBeInTheDocument();
  });

  it('shows preview for valid JSON', async () => {
    render(<RequestEditor requestId="req-1" />);
    await screen.findByRole('button', { name: 'GET' });

    fireEvent.click(screen.getByRole('button', { name: 'body' }));
    const jsonViewSelect = screen.getByRole('combobox', { name: /json view mode/i });
    expect(jsonViewSelect).toHaveValue('Raw');
    fireEvent.change(jsonViewSelect, { target: { value: 'Preview' } });

    await waitFor(() => expect(screen.getByText(/"hello": "world"/)).toBeInTheDocument());
  });

  it('shows read-only pre-request template preview when JSON body is empty', async () => {
    invoke.mockImplementation((name: string) => {
      if (name === 'get_request') {
        return Promise.resolve({
          ...baseRequest,
          body: { mode: 'json', data: '' },
          transforms: { pre_request_template: '{"id":"{{uuid}}"}', response_extractions: [], before_run: [], chain_steps: [] },
        });
      }
      if (name === 'get_manifest') return Promise.resolve({ workspace: { globals: [] } });
      return Promise.resolve({});
    });

    const { container } = render(<RequestEditor requestId="req-1" />);
    await screen.findByRole('button', { name: 'GET' });

    fireEvent.click(screen.getByRole('button', { name: 'body' }));
    await waitFor(() => expect(screen.getByText(/Pre-request Template Output/i)).toBeInTheDocument());
    expect(screen.getByText(/Read-only/i)).toBeInTheDocument();
    await waitFor(() => {
      const editorContent = container.querySelector('.cm-content');
      expect(editorContent?.textContent).toContain('{"id":"{{uuid}}"}');
    });
  });

  it('does not show template preview when a JSON body is present', async () => {
    invoke.mockImplementation((name: string) => {
      if (name === 'get_request') {
        return Promise.resolve({
          ...baseRequest,
          body: { mode: 'json', data: '{"hello":"world"}' },
          transforms: { pre_request_template: '{"other":"value"}', response_extractions: [], before_run: [], chain_steps: [] },
        });
      }
      if (name === 'get_manifest') return Promise.resolve({ workspace: { globals: [] } });
      return Promise.resolve({});
    });

    render(<RequestEditor requestId="req-1" />);
    await screen.findByRole('button', { name: 'GET' });

    fireEvent.click(screen.getByRole('button', { name: 'body' }));
    await waitFor(() => expect(screen.getByText(/JSON Body/i)).toBeInTheDocument());
    expect(screen.queryByText(/Pre-request Template Output/i)).not.toBeInTheDocument();
  });

  it('shows cancel while a request is running and cancels it', async () => {
    let resolveRun: ((value: any) => void) | undefined;
    invoke.mockImplementation((name: string) => {
      if (name === 'get_request') return Promise.resolve(baseRequest);
      if (name === 'get_manifest') return Promise.resolve({ workspace: { globals: [] } });
      if (name === 'run_firv_request') {
        return new Promise<void>(resolve => {
          resolveRun = resolve;
        });
      }
      if (name === 'cancel_firv_request') return Promise.resolve({});
      return Promise.resolve({});
    });

    render(<RequestEditor requestId="req-1" />);
    await screen.findByRole('button', { name: 'GET' });

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('cancel_firv_request'));

    resolveRun?.({ response: null, variables: {}, final_request: null, script_errors: [], before_run_results: [], variable_trace: [], chained_results: [], execution_time_ms: 0 });
  });
});
