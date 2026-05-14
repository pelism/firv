import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    render(<RequestEditor requestId="req-1" />);
    await screen.findByDisplayValue('GET');

    fireEvent.click(screen.getByRole('button', { name: 'transforms' }));
    fireEvent.click(screen.getByRole('button', { name: /add extraction/i }));
    expect(screen.getByPlaceholderText(/target variable/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /add chain step/i }));
    fireEvent.click(screen.getByRole('button', { name: 'on success' }));
    expect(screen.getByText(/success/i)).toBeInTheDocument();
  });
});
