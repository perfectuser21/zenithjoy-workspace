import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('extractClip', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    process.env.CONTENT_SERVICE_PROXY_URL = 'http://test-proxy:7786';
    process.env.API_PUBLIC_URL = 'http://test-api:5200';
  });

  it('should POST to content-service with url and callback_url', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const { extractClip } = await import('./clips-extractor.service');
    await extractClip('clip-123', 'https://v.douyin.com/abc');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/transcribe'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('clip-123'),
      })
    );
  });

  it('should not throw if content-service fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const { extractClip } = await import('./clips-extractor.service');
    await expect(extractClip('id', 'url')).resolves.not.toThrow();
  });

  it('should skip silently if env vars not configured', async () => {
    delete process.env.CONTENT_SERVICE_PROXY_URL;
    delete process.env.API_PUBLIC_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { extractClip } = await import('./clips-extractor.service');
    await extractClip('id', 'url');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
