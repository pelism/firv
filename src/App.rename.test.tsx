import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { useAppStore } from './store/appStore';
import { useSidebarStore } from './store/sidebarStore';

vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: ReactNode }) => <div data-testid="panel-group">{children}</div>,
  Panel: ({ children }: { children: ReactNode }) => <div data-testid="panel">{children}</div>,
  Separator: () => <div data-testid="panel-separator" />,
  useDefaultLayout: () => ({
    defaultLayout: undefined,
    onLayoutChanged: vi.fn(),
  }),
}));

vi.mock('./components/Sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));
vi.mock('./components/MenuSidebar', () => ({
  MenuSidebar: () => <div data-testid="menu-sidebar" />,
}));
vi.mock('./components/RequestEditor', () => ({
  RequestEditor: ({ requestId }: { requestId: string }) => <div data-testid={`request-editor-${requestId}`} />,
}));
vi.mock('./components/ResponseViewer', () => ({
  ResponseViewer: () => <div data-testid="response-viewer" />,
}));
vi.mock('./components/WorkspaceSettings', () => ({
  WorkspaceSettings: () => <div data-testid="workspace-settings" />,
}));
vi.mock('./components/AppSettings', () => ({
  AppSettings: () => <div data-testid="app-settings" />,
}));
vi.mock('./components/InputModal', () => ({
  InputModal: () => <div data-testid="input-modal" />,
}));
vi.mock('./components/WindowControls', () => ({
  WindowControls: () => <div data-testid="window-controls" />,
}));
vi.mock('./assets/icons/firv-logo.png', () => ({ default: 'logo.png' }));

const renameRequest = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  useAppStore.getState().reset();
  useAppStore.setState({ activeRequestId: 'req-1', openTabs: ['req-1'] } as any);
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
    scratchpadTree: [],
    pendingNames: {},
    projectPath: '/workspace',
    workspaceName: 'workspace',
    renameRequest,
  } as any);
  renameRequest.mockClear();
});

describe('App tab rename UI', () => {
  it('updates the visible tab label when a tab rename is committed', async () => {
    render(<App />);

    const tab = screen.getByText('Old Name');
    fireEvent.doubleClick(tab);

    const input = screen.getByDisplayValue('Old Name');
    fireEvent.change(input, { target: { value: 'New Name' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => expect(renameRequest).toHaveBeenCalledWith('req-1', 'New Name'));
    expect(await screen.findByText('New Name')).toBeInTheDocument();
  });

  it('keeps scratchpad tabs marked as scratchpad when focused', async () => {
    useAppStore.setState({ requestOrigins: { 'req-1': 'scratchpad' } } as any);

    render(<App />);

    fireEvent.click(screen.getByText('Old Name'));

    expect(useAppStore.getState().requestOrigins['req-1']).toBe('scratchpad');
    expect(useAppStore.getState().activeRequestId).toBe('req-1');
  });
});
