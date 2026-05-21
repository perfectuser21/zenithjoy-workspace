import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('extractClip', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
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
});
