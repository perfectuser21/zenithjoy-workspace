/**
 * machine-events.api.ts 单元测试 — mock fetch，验 URL/query/credentials/信封解析/容错。
 * 配对 lint-test-pairing：apps/dashboard/src/api/machine-events.api.ts
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchMachineEvents } from './machine-events.api';

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const { ok = true, status = 200 } = init;
  return vi.fn().mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
  } as unknown as Response);
}

describe('machine-events.api', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fetchMachineEvents 调 GET /api/agent/machines/:id/events 并解析 logs+upgrades', async () => {
    const data = {
      logs: [{ id: 'l1', level: 'error', module: 'line02', message: '出错了', created_at: 'x' }],
      upgrades: [{ id: 'u1', module: 'line02', phase: 'download', percent: 42, message: '下载中', created_at: 'x' }],
    };
    const f = mockFetchOnce({ success: true, data });
    vi.stubGlobal('fetch', f);

    const out = await fetchMachineEvents('m1');
    expect(out.logs).toHaveLength(1);
    expect(out.upgrades[0].percent).toBe(42);
    const [url, opts] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/agent/machines/m1/events');
    expect(opts.credentials).toBe('include');
  });

  it('带 limit/kind 拼进 query', async () => {
    const f = mockFetchOnce({ success: true, data: { logs: [], upgrades: [] } });
    vi.stubGlobal('fetch', f);

    await fetchMachineEvents('m1', { limit: 20, kind: 'upgrade' });
    const url = f.mock.calls[0][0] as string;
    expect(url).toContain('limit=20');
    expect(url).toContain('kind=upgrade');
  });

  it('后端字段缺失 → 容错给空数组', async () => {
    const f = mockFetchOnce({ success: true, data: {} });
    vi.stubGlobal('fetch', f);

    const out = await fetchMachineEvents('m1');
    expect(out.logs).toEqual([]);
    expect(out.upgrades).toEqual([]);
  });

  it('success:false → 抛 error.message', async () => {
    const f = mockFetchOnce({ success: false, error: { code: 'MACHINE_NOT_FOUND', message: '机器不存在' } }, { ok: false, status: 404 });
    vi.stubGlobal('fetch', f);

    await expect(fetchMachineEvents('nope')).rejects.toThrow('机器不存在');
  });
});
