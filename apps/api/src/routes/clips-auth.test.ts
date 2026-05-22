import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/clips-auth.service', () => ({
  buildFeishuOAuthUrl: vi.fn(() => 'https://mock-feishu.com'),
  exchangeFeishuCode: vi.fn(),
  parseFeishuState: vi.fn(),
}));
vi.mock('../services/clips.service', () => ({
  upsertFeishuBinding: vi.fn(),
}));
vi.mock('../auth', () => ({ auth: { api: { getSession: vi.fn() } } }));

describe('clips-auth router', () => {
  it('导出 express Router', async () => {
    const { default: router } = await import('./clips-auth');
    expect(router).toBeDefined();
    expect(typeof router).toBe('function');
  });
});
