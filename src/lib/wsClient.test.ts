import { beforeEach, describe, expect, it, vi } from 'vitest';
import { wsClient } from './wsClient';

const invoke = vi.fn();
const listen = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: any[]) => invoke(...args) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: (...args: any[]) => listen(...args) }));

describe('wsClient', () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
    invoke.mockResolvedValue(undefined);
    listen.mockResolvedValue(() => {});
  });

  it('connect calls ws_connect with correct args', async () => {
    const headers = [{ key: 'Authorization', value: 'Bearer token', enabled: true }];
    await wsClient.connect('req-1', 'wss://example.com/ws', headers);
    expect(invoke).toHaveBeenCalledWith('ws_connect', {
      id: 'req-1',
      url: 'wss://example.com/ws',
      headers,
    });
  });

  it('send calls ws_send with correct args', async () => {
    await wsClient.send('req-1', 'hello');
    expect(invoke).toHaveBeenCalledWith('ws_send', { id: 'req-1', message: 'hello' });
  });

  it('disconnect calls ws_disconnect with correct args', async () => {
    await wsClient.disconnect('req-1');
    expect(invoke).toHaveBeenCalledWith('ws_disconnect', { id: 'req-1' });
  });

  it('onMessage listens on the per-id event and forwards payload', async () => {
    const cb = vi.fn();
    await wsClient.onMessage('req-2', cb);
    expect(listen).toHaveBeenCalledWith('ws_message_req-2', expect.any(Function));
    const handler = listen.mock.calls[0][1];
    handler({ payload: { direction: 'in', data: 'ping', timestamp_ms: 1000 } });
    expect(cb).toHaveBeenCalledWith({ direction: 'in', data: 'ping', timestamp_ms: 1000 });
  });

  it('onClosed listens on the per-id closed event', async () => {
    const cb = vi.fn();
    await wsClient.onClosed('req-3', cb);
    expect(listen).toHaveBeenCalledWith('ws_closed_req-3', expect.any(Function));
    const handler = listen.mock.calls[0][1];
    handler({ payload: { reason: 'done' } });
    expect(cb).toHaveBeenCalledWith({ reason: 'done' });
  });

  it('onError listens on the per-id error event', async () => {
    const cb = vi.fn();
    await wsClient.onError('req-4', cb);
    expect(listen).toHaveBeenCalledWith('ws_error_req-4', expect.any(Function));
    const handler = listen.mock.calls[0][1];
    handler({ payload: { message: 'oops' } });
    expect(cb).toHaveBeenCalledWith({ message: 'oops' });
  });
});
