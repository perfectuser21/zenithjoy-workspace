/**
 * Path 4 Sprint 1 ws2 — Dashboard 微信 API client 契约
 *
 * postWechatQrBind({platform:'wechat_personal', agent_id}) → POST /api/wechat/qr-bind → {task_id, status}
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { postWechatQrBind } from '../wechat.api';

describe('postWechatQrBind', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ task_id: 'task-uuid-001', status: 'dispatched' }),
    } as unknown as Response);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POST /api/wechat/qr-bind with body {platform, agent_id}', async () => {
    const r = await postWechatQrBind({ platform: 'wechat_personal', agent_id: 'agent-1' });
    expect(r.task_id).toBe('task-uuid-001');
    expect(r.status).toBe('dispatched');
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/wechat/qr-bind');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toEqual({ platform: 'wechat_personal', agent_id: 'agent-1' });
  });

  it('非 200 抛错', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ error: { message: 'boom' } }),
    } as unknown as Response);
    await expect(
      postWechatQrBind({ platform: 'wechat_personal', agent_id: 'agent-1' }),
    ).rejects.toThrow(/HTTP_500|boom/);
  });
});
