import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { GrpcEditor } from './GrpcEditor';
import { useAppStore } from '../store/appStore';
import { useSidebarStore } from '../store/sidebarStore';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const baseGrpcRequest = {
  id: 'grpc-1',
  name: 'Test',
  url: 'localhost:50051',
  proto_source: 'syntax = "proto3"; service S { rpc M (Empty) returns (stream Empty); }',
  service: 'S',
  method: 'M',
  streaming_mode: 'ServerStreaming',
  metadata: [],
  message: '{}',
};

describe('GrpcEditor', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset().mockImplementation((name: string) => {
      if (name === 'get_grpc_request') return Promise.resolve(baseGrpcRequest);
      return Promise.resolve(undefined);
    });
    vi.mocked(listen).mockReset().mockResolvedValue(() => {});
    useAppStore.getState().reset();
    useSidebarStore.setState({ workspacePath: '/workspace' } as any);
  });

  it('disconnects a streaming gRPC request and updates status to disconnected', async () => {
    useAppStore.setState({
      grpcConnections: { 'grpc-1': { status: 'connected', messages: [] } },
    } as any);

    render(<GrpcEditor requestId="grpc-1" />);

    const disconnectButton = await screen.findByRole('button', { name: /disconnect/i });
    fireEvent.click(disconnectButton);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('grpc_disconnect', { id: 'grpc-1' }));
    expect(useAppStore.getState().grpcConnections['grpc-1'].status).toBe('disconnected');
    await waitFor(() => expect(screen.getByRole('button', { name: /invoke/i })).toBeInTheDocument());
  });
});
