import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ResponseViewer, type FirvResponse } from './ResponseViewer';

const writeText = vi.fn();

class MockWorker {
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  postMessage = vi.fn();
  terminate = vi.fn();
}

Object.assign(globalThis, {
  Worker: MockWorker,
});

Object.assign(navigator, {
  clipboard: {
    writeText,
  },
});

const response: FirvResponse = {
  status: 200,
  status_text: 'OK',
  headers: {
    'content-type': 'application/json',
  },
  body: '{"hello":"world"}',
  time_ms: 12,
  size_bytes: 18,
};

describe('ResponseViewer copy response', () => {
  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
  });

  it('copies only the raw response body', async () => {
    render(<ResponseViewer response={response} />);

    fireEvent.click(screen.getByRole('button', { name: /copy response/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(response.body));
  });
});
