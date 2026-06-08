import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchModuleHealth } from '../moduleHealth.api';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchModuleHealth', () => {
  it('GET /api/agent/module-health 并返回解析后的 JSON', async () => {
    const payload = {
      ok: true,
      data: [
        {
          agent_id: 'agent-001',
          hostname: '客户机器A',
          module_status: { 'line04-wechat-cs': { ok: false, reason: 'wechat_4.2.0_unsupported' } },
          updated_at: '2026-06-08T10:00:00Z',
        },
      ],
    };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const res = await fetchModuleHealth();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/agent/module-health');
    expect(res.ok).toBe(true);
    expect(res.data[0].agent_id).toBe('agent-001');
    expect(res.data[0].module_status['line04-wechat-cs'].ok).toBe(false);
  });

  it('响应非 2xx 时抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    await expect(fetchModuleHealth()).rejects.toThrow();
  });
});
