import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from '../api';

// Mock import.meta.env
vi.stubEnv('VITE_API_URL', 'http://localhost:3000');

function mockFetchResponse(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Bad Request',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

describe('ApiClient', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('request sends credentials for cookie-based auth', async () => {
    const fetchMock = mockFetchResponse({ focus_points: [] });
    globalThis.fetch = fetchMock;

    const client = new ApiClient();
    await client.getFocusPoints('vid-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArgs = fetchMock.mock.calls[0];
    expect(callArgs[1].credentials).toBe('include');
    expect(callArgs[1].headers['Authorization']).toBeUndefined();
  });

  it('request throws on non-200 response', async () => {
    globalThis.fetch = mockFetchResponse({ error: 'Not found' }, 404);

    const client = new ApiClient();
    await expect(client.getFocusPoints('vid-1')).rejects.toThrow('Request failed');
  });

  it('getFocusPoints calls correct endpoint', async () => {
    const fetchMock = mockFetchResponse({ focus_points: [{ id: 'fp-1' }] });
    globalThis.fetch = fetchMock;

    const client = new ApiClient();
    const result = await client.getFocusPoints('vid-abc');

    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toContain('/videos/vid-abc/focus-points');
    expect(result).toEqual([{ id: 'fp-1' }]);
  });

  it('createFocusPoints sends correct body', async () => {
    const fetchMock = mockFetchResponse({ focus_points: [] });
    globalThis.fetch = fetchMock;

    const points = [
      { time_start: 0, time_end: 5, x: 10, y: 10, width: 20, height: 20, description: 'test', source: 'manual' as const },
    ];

    const client = new ApiClient();
    await client.createFocusPoints('vid-abc', points);

    const callArgs = fetchMock.mock.calls[0];
    expect(callArgs[1].method).toBe('POST');
    expect(JSON.parse(callArgs[1].body)).toEqual({ focus_points: points });
  });

  it('startScan calls correct endpoint with options', async () => {
    const fetchMock = mockFetchResponse({ scan_id: 'scan-1' });
    globalThis.fetch = fetchMock;

    const client = new ApiClient();
    const scanOptions = { mode: 'fast' };
    const result = await client.startScan('vid-abc', scanOptions);

    const callArgs = fetchMock.mock.calls[0];
    expect(callArgs[0]).toContain('/videos/vid-abc/scan');
    expect(callArgs[1].method).toBe('POST');
    expect(JSON.parse(callArgs[1].body)).toEqual(scanOptions);
    expect(result).toEqual({ scan_id: 'scan-1' });
  });

  it('processVideo sends correct options', async () => {
    const fetchMock = mockFetchResponse({ job_id: 'job-1' });
    globalThis.fetch = fetchMock;

    const client = new ApiClient();
    const options = { platforms: ['tiktok', 'youtube-main'], letterbox: true, quality: 'high' as const };
    const result = await client.processVideo('vid-abc', options);

    const callArgs = fetchMock.mock.calls[0];
    expect(callArgs[0]).toContain('/videos/vid-abc/process');
    expect(callArgs[1].method).toBe('POST');
    expect(JSON.parse(callArgs[1].body)).toEqual(options);
    expect(result).toEqual({ job_id: 'job-1' });
  });
});
