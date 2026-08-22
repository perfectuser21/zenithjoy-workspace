/**
 * orgContext API 封装单元测试（mock fetch，jsdom）。
 * 验证：fetchOrgs 打 GET /api/knowledge/org、switchOrg 打 POST /api/knowledge/org/switch 且带 org_id，
 * 都只带 cookie（credentials:include）、不拼任何身份头。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchOrgs, switchOrg } from './orgContext';

function mockFetchOnce(status: number, body: unknown) {
  (globalThis.fetch as any).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('orgContext API', () => {
  it('fetchOrgs → GET /api/knowledge/org，解析 data', async () => {
    mockFetchOnce(200, {
      success: true,
      data: { orgs: [{ org_id: 'A', name: '甲', role: 'member' }], active_org_id: 'A', needs_selection: false },
    });
    const state = await fetchOrgs();
    expect(state.orgs).toHaveLength(1);
    expect(state.active_org_id).toBe('A');
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe('/api/knowledge/org');
    expect(init.credentials).toBe('include');
    // 不拼任何身份头
    const headerStr = JSON.stringify(init.headers ?? {});
    expect(headerStr).not.toMatch(/X-Org-Id|X-Tenant-Id|X-Feishu-User-Id/i);
  });

  it('switchOrg → POST /api/knowledge/org/switch，body 带 org_id，返回 active_org_id', async () => {
    mockFetchOnce(200, { success: true, data: { active_org_id: 'B' } });
    const res = await switchOrg('B');
    expect(res.active_org_id).toBe('B');
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe('/api/knowledge/org/switch');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ org_id: 'B' });
  });

  it('switchOrg 目标不归属 → 抛 KnowledgeRequestError(ORG_FORBIDDEN)', async () => {
    mockFetchOnce(403, { success: false, data: null, error: { code: 'ORG_FORBIDDEN', message: '当前企业不可用' } });
    await expect(switchOrg('Z')).rejects.toMatchObject({ code: 'ORG_FORBIDDEN', status: 403 });
  });
});
