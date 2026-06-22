import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * cs-auto-agent-config.test.ts — 自动代理 5 配置键存取 oracle（Contract Round 1, TDD red）。
 *
 * generator 须在 apps/api/src/services/wechat/cs-config-store.ts 新增：
 *   getAutoAgentConfig(): Promise<AutoAgentConfig>
 *   saveAutoAgentConfig(cfg: Partial<AutoAgentConfig>): Promise<void>
 * 5 键：auto_agent_enabled(默认 false) / business_hours_start("06:00") /
 *       business_hours_end("24:00") / key_contact_wechat("") / daily_limit(0)
 *
 * 用内存 fake 模拟 wechat_cs_config 的 upsert/select，验「保存即生效 + 默认关」。
 */

// 内存版 zenithjoy.wechat_cs_config（key-value JSONB）
const store = new Map<string, unknown>();

vi.mock('../../../apps/api/src/db/connection', () => ({
  default: {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      if (/INSERT INTO/i.test(sql) || /ON CONFLICT/i.test(sql)) {
        const [key, value] = params as [string, string];
        store.set(key, typeof value === 'string' ? JSON.parse(value) : value);
        return { rows: [] };
      }
      if (/SELECT value/i.test(sql)) {
        const [key] = params as [string];
        return store.has(key) ? { rows: [{ value: store.get(key) }] } : { rows: [] };
      }
      return { rows: [] };
    }),
  },
}));

// 动态 import 让 mock 先生效
async function loadStore() {
  return import('../../../apps/api/src/services/wechat/cs-config-store');
}

describe('自动代理配置键 [BEHAVIOR]', () => {
  beforeEach(() => store.clear());

  it('默认关：未配置时 auto_agent_enabled 读回 false', async () => {
    const mod: any = await loadStore();
    const cfg = await mod.getAutoAgentConfig();
    expect(cfg.auto_agent_enabled).toBe(false);
  });

  it('保存即生效：upsert 5 键后读回一致', async () => {
    const mod: any = await loadStore();
    await mod.saveAutoAgentConfig({
      auto_agent_enabled: true,
      business_hours_start: '06:00',
      business_hours_end: '24:00',
      key_contact_wechat: 'ks_wx',
      daily_limit: 50,
    });
    const cfg = await mod.getAutoAgentConfig();
    expect(cfg.auto_agent_enabled).toBe(true);
    expect(cfg.business_hours_start).toBe('06:00');
    expect(cfg.business_hours_end).toBe('24:00');
    expect(cfg.key_contact_wechat).toBe('ks_wx');
    expect(cfg.daily_limit).toBe(50);
  });

  it('daily_limit 默认 0（不限）', async () => {
    const mod: any = await loadStore();
    const cfg = await mod.getAutoAgentConfig();
    expect(cfg.daily_limit).toBe(0);
  });
});
