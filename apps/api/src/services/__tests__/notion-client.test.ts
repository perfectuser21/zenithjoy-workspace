/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Notion 轻客户端契约。最重要的一条：错误里绝不能带 token——
 * AxiosError.config.headers 有 Authorization: Bearer <token>，
 * 谁把整个 err 打进日志谁就泄漏了 workspace 全部数据的钥匙。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('axios', () => ({ default: { request: vi.fn() } }));
import axios from 'axios';
import { notionRequest, NOTION_API_BASE, NOTION_VERSION } from '../notion-client';

const FAKE_TOKEN = `ntn_test_${Math.floor(Math.random() * 90000) + 10000}`;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTION_INTEGRATION_TOKEN = FAKE_TOKEN;
});
afterEach(() => {
  delete process.env.NOTION_INTEGRATION_TOKEN;
});

describe('notionRequest', () => {
  it('拼装 base/version/鉴权头并返回 data', async () => {
    (axios.request as any).mockResolvedValue({ data: { ok: 1 } });
    const r = await notionRequest('post', '/pages', { a: 1 });
    expect(r).toEqual({ ok: 1 });
    const cfg = (axios.request as any).mock.calls[0][0];
    expect(cfg.url).toBe(`${NOTION_API_BASE}/pages`);
    expect(cfg.headers['Notion-Version']).toBe(NOTION_VERSION);
    expect(cfg.headers.Authorization).toContain(FAKE_TOKEN);
  });

  it('token 未配置 → 抛错且不发请求', async () => {
    delete process.env.NOTION_INTEGRATION_TOKEN;
    await expect(notionRequest('get', '/users/me')).rejects.toThrow('NOTION_INTEGRATION_TOKEN');
    expect(axios.request).not.toHaveBeenCalled();
  });

  it('上游报错 → 错误消息含 status 与 response.data，绝不含 token', async () => {
    (axios.request as any).mockRejectedValue({
      message: 'Request failed',
      response: { status: 400, data: { code: 'validation_error' } },
      config: { headers: { Authorization: `Bearer ${FAKE_TOKEN}` } },
    });
    const err = await notionRequest('patch', '/pages/x', {}).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('400');
    expect(err.message).toContain('validation_error');
    expect(err.message).not.toContain(FAKE_TOKEN);
  });
});
