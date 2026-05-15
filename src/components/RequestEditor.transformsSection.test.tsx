import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
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

describe('RequestEditor transforms section', () => {
  beforeEach(() => {
    invoke.mockReset();
    useAppStore.getState().reset();
    useSidebarStore.setState({
      projectPath: '/workspace',
      tree: [{ kind: { type: 'request', id: 'req-2', name: 'Other', method: 'GET' } } as any],
      pendingNames: {},
      workspaceName: 'workspace',
    } as any);
    invoke.mockImplementation((name: string) => {
      if (name === 'get_request') return Promise.resolve(baseRequest);
      if (name === 'get_manifest') return Promise.resolve({ workspace: { globals: [] } });
      return Promise.resolve({});
    });
  });

  it('adds an extraction rule and a chain step', async () => {
    await act(async () => {
      render(<RequestEditor requestId="req-1" />);
    });
    await screen.findByDisplayValue('GET');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'transforms' }));
    });
    await screen.findByTestId('request-editor-transforms-section');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /add extraction/i }));
    });
    const transformsSection = await screen.findByTestId('request-editor-transforms-section');
    await screen.findByPlaceholderText('token');

    expect(within(transformsSection).getByPlaceholderText('token')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /add chain step/i }));
    });
    await screen.findByRole('button', { name: 'on success' });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'on success' }));
    });
    await screen.findByText(/success/i);

    expect(screen.getByText(/success/i)).toBeInTheDocument();
  });
});
