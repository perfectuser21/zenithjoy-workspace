/**
 * knowledgeFetch 组织态错误哨兵单元测试（mock fetch，jsdom）。
 * 数据端点撞 409 ORG_SELECTION_REQUIRED / 403 ORG_FORBIDDEN 时，解析层集中上报给注册的哨兵，
 * 供 AuthContext 一处逼选/重选；其余错误码不误触发哨兵。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { knowledgeJson, setOrgErrorListener, KnowledgeRequestError } from './knowledgeFetch';

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
afterEach(() => {
  setOrgErrorListener(null);
});

describe('knowledgeJson org 态哨兵', () => {
  it('成功 → 返回 data，不触发哨兵', async () => {
    const spy = vi.fn();
    setOrgErrorListener(spy);
    mockFetchOnce(200, { success: true, data: { x: 1 } });
    await expect(knowledgeJson('/api/knowledge/org')).resolves.toEqual({ x: 1 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('409 ORG_SELECTION_REQUIRED → 抛错且上报哨兵（逼选）', async () => {
    const spy = vi.fn();
    setOrgErrorListener(spy);
    mockFetchOnce(409, { success: false, data: null, error: { code: 'ORG_SELECTION_REQUIRED', message: '请先选择当前企业' } });
    await expect(knowledgeJson('/api/knowledge/db/tables')).rejects.toBeInstanceOf(KnowledgeRequestError);
    expect(spy).toHaveBeenCalledWith('ORG_SELECTION_REQUIRED');
  });

  it('403 ORG_FORBIDDEN → 抛错且上报哨兵（刷新归属重选）', async () => {
    const spy = vi.fn();
    setOrgErrorListener(spy);
    mockFetchOnce(403, { success: false, data: null, error: { code: 'ORG_FORBIDDEN', message: '当前企业不可用' } });
    await expect(knowledgeJson('/api/knowledge/db/tables')).rejects.toBeInstanceOf(KnowledgeRequestError);
    expect(spy).toHaveBeenCalledWith('ORG_FORBIDDEN');
  });

  it('其它错误码（如 SESSION_REQUIRED）→ 抛错但不误触发 org 哨兵', async () => {
    const spy = vi.fn();
    setOrgErrorListener(spy);
    mockFetchOnce(401, { success: false, data: null, error: { code: 'SESSION_REQUIRED', message: '登录已失效' } });
    await expect(knowledgeJson('/api/knowledge/db/tables')).rejects.toMatchObject({ code: 'SESSION_REQUIRED' });
    expect(spy).not.toHaveBeenCalled();
  });
});
