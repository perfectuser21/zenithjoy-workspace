import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: {
    post: vi.fn().mockResolvedValue({ data: { results: [] } }),
    get: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

describe('notion-crm — Path 4 Step 2', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.NOTION_INTEGRATION_TOKEN;
    delete process.env.FEISHU_NOTIFY_WEBHOOK;
  });

  it('无 NOTION_INTEGRATION_TOKEN 时抛出 token_expired 错误', async () => {
    const { detectOrCreateNotionTable } = await import('../notion-crm');
    await expect(detectOrCreateNotionTable('tenant_001')).rejects.toMatchObject({
      code: 'token_expired',
    });
  });

  it('有 token 时查 Notion Search API（axios.post 被调用）', async () => {
    process.env.NOTION_INTEGRATION_TOKEN = 'test-token-abc';
    const axiosMock = await import('axios');
    const postSpy = vi.spyOn(axiosMock.default, 'post').mockResolvedValue({
      data: { results: [{ id: 'db-123' }] },
    });
    const { detectOrCreateNotionTable } = await import('../notion-crm');
    const result = await detectOrCreateNotionTable('tenant_002');
    expect(postSpy).toHaveBeenCalled();
    expect(result.table_id).toBe('db-123');
    expect(result.created).toBe(false);
  });
});
