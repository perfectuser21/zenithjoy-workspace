import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithTimeout, fireProgress, reportComplete } from '../video-pipeline';

describe('fetchWithTimeout', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('正常响应时返回 Response', async () => {
    const mockRes = new Response(JSON.stringify({ ok: true }), { status: 200 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockRes));
    const res = await fetchWithTimeout('http://test/api', {}, 5000);
    expect(res.status).toBe(200);
  });

  it('超过 timeout 时 reject（AbortError）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(
      (_url: string, opts: RequestInit) =>
        new Promise((_resolve, reject) => {
          (opts.signal as AbortSignal).addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        })
    ));
    await expect(fetchWithTimeout('http://test/api', {}, 50)).rejects.toThrow('Aborted');
  });
});

describe('fireProgress', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('网络失败时不 throw（fire-and-forget）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(
      new Promise<void>((resolve) => {
        fireProgress('http://api', 'job-123', 50);
        setTimeout(resolve, 150);
      })
    ).resolves.toBeUndefined();
  });
});

describe('reportComplete', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('第一次成功时直接返回，只调用一次 fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);
    await reportComplete('http://api', 'job-abc', { output_dir: '/out' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('连续失败 3 次后静默退出（不 throw），fetch 共调用 4 次', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('timeout'));
    vi.stubGlobal('fetch', mockFetch);
    const promise = reportComplete('http://api', 'job-fail', { error_msg: 'failed' });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('第 2 次成功时不再 retry，fetch 共调用 2 次', async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error('first fail'))
      .mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);
    const promise = reportComplete('http://api', 'job-retry', { output_dir: '/out' });
    await vi.runAllTimersAsync();
    await promise;
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
