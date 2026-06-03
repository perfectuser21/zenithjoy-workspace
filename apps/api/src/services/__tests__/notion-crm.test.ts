import { describe, it, expect, vi } from 'vitest';

vi.mock('axios', () => ({
  default: {
    post: vi.fn().mockResolvedValue({ data: {} }),
    get: vi.fn().mockResolvedValue({ data: { results: [] } }),
  },
}));

describe('notion-crm — Path 4 Step 2', () => {
  it('无 NOTION_INTEGRATION_TOKEN 时返回 mock table_id', async () => {
    delete process.env.NOTION_INTEGRATION_TOKEN;
    const { detectOrCreateNotionTable } = await import('../notion-crm');
    const result = await detectOrCreateNotionTable('tenant_001');
    expect(result).toHaveProperty('table_id');
    expect(typeof result.table_id).toBe('string');
    expect(result.table_id.length).toBeGreaterThan(0);
  });

  it('返回 created 布尔字段', async () => {
    const { detectOrCreateNotionTable } = await import('../notion-crm');
    const result = await detectOrCreateNotionTable('tenant_002');
    expect(typeof result.created).toBe('boolean');
  });
});
