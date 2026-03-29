import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock node:fs and node:path before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>();
  return { ...actual, join: actual.join };
});

import * as fs from 'node:fs';
import handler from '../../src/adapters/openclaw/hooks/handler.js';

// ---------------------------------------------------------------------------
// Global fetch mock
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  vi.mocked(fs.readFileSync).mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hook handler', () => {
  it('reads port file and POSTs to /api/ingest on message event', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('4000');
    mockFetch.mockResolvedValue({ ok: true });

    await handler({ type: 'message' });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:4000/api/ingest');
    expect(init?.method).toBe('POST');
  });

  it('falls back to port 3456 when port file does not exist', async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    mockFetch.mockResolvedValue({ ok: true });

    await handler({ type: 'message' });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3456/api/ingest');
  });

  it('swallows fetch errors silently without throwing', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('3456');
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    // Should not throw
    await expect(handler({ type: 'message' })).resolves.toBeUndefined();
  });

  it('does not call fetch for non-message event types', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('3456');
    mockFetch.mockResolvedValue({ ok: true });

    await handler({ type: 'file:created' });
    await handler({ type: 'reaction' });
    await handler({ type: '' });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('applies the 3-second AbortSignal timeout', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('3456');

    // Capture the init argument so we can inspect the signal
    let capturedSignal: AbortSignal | undefined;
    mockFetch.mockImplementation((_url: string, init: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return Promise.resolve({ ok: true });
    });

    await handler({ type: 'message' });

    // The signal should be an AbortSignal (from AbortSignal.timeout(3000))
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
  });
});
