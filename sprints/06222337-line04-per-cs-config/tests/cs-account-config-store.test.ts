import { describe, it, expect, vi, beforeEach } from 'vitest';

// TDD Red：目标模块尚未实现 —— 每客服配置存取层（按 wechat_id 物理分行）。
// Generator 须新建 apps/api/src/services/wechat/cs-account-config-store.ts，
// 导出 getCSConfig / saveCSConfig（upsert 某 wechat_id 那一行，不影响其他行）。
import {
  getCSConfig,
  saveCSConfig,
  type CSAccountConfig,
} from '../../../apps/api/src/services/wechat/cs-account-config-store';

// mock 连接池：按 wechat_id 隔离存取的内存表
vi.mock('../../../apps/api/src/db/connection', () => {
  const rows = new Map<string, any>();
  return {
    default: {
      query: vi.fn(async (sql: string, params: any[]) => {
        if (/INSERT INTO/i.test(sql) || /ON CONFLICT/i.test(sql)) {
          const [wechatId, value] = params;
          rows.set(wechatId, typeof value === 'string' ? JSON.parse(value) : value);
          return { rows: [] };
        }
        if (/SELECT/i.test(sql)) {
          const wechatId = params?.[0];
          const r = rows.get(wechatId);
          return { rows: r ? [{ ...r, wechat_id: wechatId }] : [] };
        }
        return { rows: [] };
      }),
    },
  };
});

const personaOf = (name: string) => ({
  self_name: name,
  address_style: '',
  tone: '',
  sentence_style: '',
  use_emoji: '',
  banned_phrases: [] as string[],
  few_shot: [] as { customer: string; me: string }[],
});

describe('每客服配置存取层 — 按 wechat_id 物理分行 [BEHAVIOR]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saveCSConfig 写某客服那一行后 getCSConfig 读回一致', async () => {
    await saveCSConfig('wxid_csa', { persona: personaOf('萌萌') });
    const a = await getCSConfig('wxid_csa');
    expect(a?.persona.self_name).toBe('萌萌');
  });

  it('写一行不覆盖另一行（钉死 Issue defe1a42 串台）', async () => {
    await saveCSConfig('wxid_csa', { persona: personaOf('萌萌') });
    await saveCSConfig('wxid_csb', { persona: personaOf('天下第一') });
    const a = await getCSConfig('wxid_csa');
    const b = await getCSConfig('wxid_csb');
    expect(a?.persona.self_name).toBe('萌萌');
    expect(b?.persona.self_name).toBe('天下第一');
    expect(a?.persona.self_name).not.toBe(b?.persona.self_name);
  });

  it('未注册微信号 getCSConfig 返回 null（不返回任意一份配置）', async () => {
    const r = await getCSConfig('wxid_never_registered_zzz');
    expect(r).toBeNull();
  });

  it('新客服默认 auto_agent_enabled=false（dryrun）', async () => {
    await saveCSConfig('wxid_csc', { persona: personaOf('小助手') });
    const c: CSAccountConfig | null = await getCSConfig('wxid_csc');
    expect(c?.auto_agent_enabled).toBe(false);
  });
});
