import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './appStore';

const invoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: any[]) => invoke(...args) }));

describe('useAppStore closeTab', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    useAppStore.getState().reset();
  });

  it('removes the closed tab and its associated response, running state and dirty flag', () => {
    useAppStore.setState({
      openTabs: ['a', 'b'],
      activeRequestId: 'a',
      responses: { a: { status: 200 }, b: { status: 404 } },
      runningRequests: { a: true },
      requestProtocols: { a: 'http', b: 'ws' },
    } as any);

    useAppStore.getState().closeTab('a');

    const state = useAppStore.getState();
    expect(state.openTabs).toEqual(['b']);
    expect(state.responses).toEqual({ b: { status: 404 } });
    expect(state.runningRequests).toEqual({});
    expect(state.requestProtocols).toEqual({ b: 'ws' });
  });

  it('reassigns the active tab to the last remaining tab when the active tab is closed', () => {
    useAppStore.setState({
      openTabs: ['a', 'b', 'c'],
      activeRequestId: 'b',
    } as any);

    useAppStore.getState().closeTab('b');

    const state = useAppStore.getState();
    expect(state.openTabs).toEqual(['a', 'c']);
    expect(state.activeRequestId).toBe('c');
  });

  it('sets activeRequestId to null when the last remaining tab is closed', () => {
    useAppStore.setState({
      openTabs: ['a'],
      activeRequestId: 'a',
    } as any);

    useAppStore.getState().closeTab('a');

    const state = useAppStore.getState();
    expect(state.openTabs).toEqual([]);
    expect(state.activeRequestId).toBeNull();
  });

  it('does not change the active tab when closing a tab that is not active', () => {
    useAppStore.setState({
      openTabs: ['a', 'b'],
      activeRequestId: 'a',
    } as any);

    useAppStore.getState().closeTab('b');

    const state = useAppStore.getState();
    expect(state.openTabs).toEqual(['a']);
    expect(state.activeRequestId).toBe('a');
  });

  it('disconnects an open websocket connection and clears it when its tab is closed', () => {
    useAppStore.setState({
      openTabs: ['ws-1'],
      activeRequestId: 'ws-1',
      wsConnections: { 'ws-1': { status: 'connected', messages: [] } },
    } as any);

    useAppStore.getState().closeTab('ws-1');

    expect(invoke).toHaveBeenCalledWith('ws_disconnect', { id: 'ws-1' });
    expect(useAppStore.getState().wsConnections).toEqual({});
  });

  it('does not attempt to disconnect a websocket that is already disconnected', () => {
    useAppStore.setState({
      openTabs: ['ws-1'],
      activeRequestId: 'ws-1',
      wsConnections: { 'ws-1': { status: 'disconnected', messages: [] } },
    } as any);

    useAppStore.getState().closeTab('ws-1');

    expect(invoke).not.toHaveBeenCalled();
    expect(useAppStore.getState().wsConnections).toEqual({});
  });
});
