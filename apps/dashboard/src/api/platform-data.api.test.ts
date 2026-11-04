import { afterEach, expect, it, vi } from 'vitest';
import { fetchPlatformData, fetchAllPlatformData } from './platform-data.api';
afterEach(() => vi.restoreAllMocks());
it('current platform page uses mounted snapshots API and returns its data', async () => {
  const data = { success: true, platform: 'douyin', count: 1, data: [{ title: 'fixture' }] };
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(data)));
  expect(await fetchPlatformData('douyin')).toEqual(data);
  expect(fetch).toHaveBeenCalledWith('/api/snapshots/douyin');
});
it('all seven current platform requests use snapshots and preserve per-platform results', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async url => new Response(JSON.stringify({ success: true, platform: String(url).split('/').at(-1), count: 0, data: [] })));
  const results = await fetchAllPlatformData();
  expect(Object.keys(results)).toHaveLength(7);
  expect(fetch).toHaveBeenCalledTimes(7);
  for (const platform of Object.keys(results)) expect(fetch).toHaveBeenCalledWith(`/api/snapshots/${platform}`);
});
it('HTTP failure becomes a visible failed result, without fabricated rows', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }));
  expect(await fetchPlatformData('douyin')).toEqual({ success: false, platform: 'douyin', count: 0, data: [], error: 'HTTP 503' });
});
