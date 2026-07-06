/**
 * cs-account-config-store 单测（无 DB / 无网络）——按 wechat_id 隔离存取 + 身份异常读写。
 * mock db/connection：按 wechat_id 的内存表 + 身份异常内存数组。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rows, alerts, bindings } = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  alerts: [] as Array<{ wechat_id: string; reason: string; created_at: Date }>,
  // machine_id → wechat_id（service_agents 绑定的内存表；值为 null = 已绑 PC 但管理员没填微信号）
  bindings: new Map<string, string | null>(),
}));

vi.mock('../../../db/connection', () => ({
  default: {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      // commit 1 新增：按 machine_id 反查该客服绑定的 wechat_id（service_agents）
      if (/SELECT[\s\S]*wechat_id[\s\S]+FROM zenithjoy\.service_agents/i.test(sql)) {
        const machineId = params?.[0] as string;
        if (!bindings.has(machineId)) return { rows: [] };
        return { rows: [{ wechat_id: bindings.get(machineId) }] };
      }
      if (/INSERT INTO zenithjoy\.wechat_cs_identity_alert/i.test(sql)) {
        alerts.push({
          wechat_id: String(params[0]),
          reason: String(params[1]),
          created_at: new Date('2026-06-22T00:00:00Z'),
        });
        return { rows: [] };
      }
      if (/SELECT[\s\S]+wechat_cs_identity_alert/i.test(sql)) {
        return { rows: [...alerts].reverse() };
      }
      if (/INSERT INTO zenithjoy\.wechat_cs_account_config/i.test(sql)) {
        const [wechatId, value] = params as [string, string];
        rows.set(wechatId, JSON.parse(value));
        return { rows: [] };
      }
      if (/SELECT[\s\S]+wechat_cs_account_config/i.test(sql)) {
        const wechatId = params?.[0] as string;
        const r = rows.get(wechatId);
        if (!r) return { rows: [] };
        // 按 SELECT 列投影返回（issue 3eaa7fe6 教训：mock 整行返回会掩盖
        // "SELECT 漏列"类 bug——getCSConfig 漏查 takeover_mode/blacklist 时
        // 整行 mock 照样带出这两个字段，测试假绿）。
        const colMatch = /SELECT([\s\S]+?)FROM/i.exec(sql);
        const cols = (colMatch?.[1] ?? '')
          .split(',')
          .map((c) => c.trim().split(/\s+AS\s+/i).pop()!.trim())
          .filter(Boolean);
        const full = { ...r, wechat_id: wechatId } as Record<string, unknown>;
        const projected: Record<string, unknown> = {};
        for (const c of cols) if (c in full) projected[c] = full[c];
        return { rows: [projected] };
      }
      return { rows: [] };
    }),
  },
}));

import {
  getCSConfig,
  saveCSConfig,
  recordIdentityAlert,
  listIdentityAlerts,
  getCSConfigByMachine,
} from '../cs-account-config-store';

const personaOf = (name: string) => ({
  self_name: name,
  address_style: '',
  tone: '',
  sentence_style: '',
  use_emoji: '',
  banned_phrases: [] as string[],
  few_shot: [] as { customer: string; me: string }[],
});

beforeEach(() => {
  rows.clear();
  alerts.length = 0;
  bindings.clear();
  vi.clearAllMocks();
});

describe('cs-account-config-store — 按 wechat_id 隔离', () => {
  it('saveCSConfig 后 getCSConfig 读回一致，且补齐默认值', async () => {
    await saveCSConfig('wxid_a', { persona: personaOf('萌萌') });
    const c = await getCSConfig('wxid_a');
    expect(c?.persona.self_name).toBe('萌萌');
    expect(c?.auto_agent_enabled).toBe(false);
    expect(c?.business_hours_start).toBe('06:00');
    expect(c?.whitelist).toEqual([]);
    expect(c?.daily_limit).toBe(0);
  });

  it('写一行不覆盖另一行', async () => {
    await saveCSConfig('wxid_a', { persona: personaOf('萌萌'), whitelist: ['客户甲'] });
    await saveCSConfig('wxid_b', { persona: personaOf('天下第一'), auto_agent_enabled: true });
    const a = await getCSConfig('wxid_a');
    const b = await getCSConfig('wxid_b');
    expect(a?.persona.self_name).toBe('萌萌');
    expect(a?.auto_agent_enabled).toBe(false);
    expect(a?.whitelist).toContain('客户甲');
    expect(b?.persona.self_name).toBe('天下第一');
    expect(b?.auto_agent_enabled).toBe(true);
  });

  it('未注册号 getCSConfig 返回 null', async () => {
    expect(await getCSConfig('wxid_never')).toBeNull();
  });

  // issue 3eaa7fe6（rog 真机实锤）：getCSConfig SELECT 漏查 takeover_mode/blacklist →
  // agent-config 响应永远不含这两字段 → agent 端 should_reply 回退白名单模式 →
  // 库里 blacklist（默认全接管）形同虚设，只回测试遗留白名单里的人。
  it('getCSConfig 透传 takeover_mode 与 blacklist（黑名单主模型字段，permanent regression）', async () => {
    rows.set('cs-rog', {
      persona: personaOf('大魔王'),
      auto_agent_enabled: true,
      whitelist: ['默忆'],
      takeover_mode: 'blacklist',
      blacklist: ['自己小号'],
      daily_limit: 50,
    });
    const cfg = await getCSConfig('cs-rog');
    expect(cfg?.takeover_mode).toBe('blacklist');
    expect(cfg?.blacklist).toEqual(['自己小号']);
  });

  it('存量行未配 takeover_mode/blacklist → 字段缺省不伪造（takeover_mode undefined，agent 端走白名单兼容回退）', async () => {
    rows.set('cs-legacy', {
      persona: personaOf('旧号'),
      auto_agent_enabled: true,
      whitelist: ['某客户'],
      daily_limit: 50,
    });
    const cfg = await getCSConfig('cs-legacy');
    expect(cfg?.takeover_mode).toBeUndefined();
    expect(cfg?.whitelist).toEqual(['某客户']);
  });

  it('getCSConfigByMachine 同样透传 takeover_mode/blacklist（agent-config 真实拉取路径）', async () => {
    bindings.set('machine-rog', 'cs-rog2');
    rows.set('cs-rog2', {
      persona: personaOf('大魔王'),
      auto_agent_enabled: true,
      whitelist: [],
      takeover_mode: 'blacklist',
      blacklist: [],
      daily_limit: 50,
    });
    const cfg = await getCSConfigByMachine('machine-rog');
    expect(cfg?.takeover_mode).toBe('blacklist');
    expect(cfg?.blacklist).toEqual([]);
  });

  it('IA重设计刀1：saveCSConfig 持久化【完整 persona + 每号 business_kb】（每号独立，不再只截 self_name）', async () => {
    // 反转 PR#940：每号现在独立存完整人设 + 知识库（用户拍板「每个号完全不同」）。
    const fullPersona = {
      self_name: '小苏',
      address_style: '亲切',
      tone: '友好专业',
      sentence_style: '简洁',
      use_emoji: '少量',
      banned_phrases: ['呵呵'],
      few_shot: [{ customer: 'a', me: 'b' }],
    };
    const kb = {
      company: { name: '甲号公司', what_we_do: '做A', value_prop: 'V', contact: 'wx-a' },
      products: [{ name: 'P1', selling_points: 'sp' }],
      audience_segments: [{ code: 'A1', label: 'L', desc: 'D' }],
      qa_docs: [{ q: 'q', a: 'a' }],
    };
    await saveCSConfig('wxid_full', { persona: fullPersona, business_kb: kb });
    const stored = rows.get('wxid_full') as {
      persona: Record<string, unknown>;
      business_kb: Record<string, unknown>;
    };
    // 完整 persona 落库（style 字段不再被丢弃）
    expect(stored.persona).toEqual(fullPersona);
    // 每号 business_kb 落库
    expect(stored.business_kb).toEqual(kb);
    // 读回一致
    const c = await getCSConfig('wxid_full');
    expect(c?.persona.tone).toBe('友好专业');
    expect(c?.business_kb.company.name).toBe('甲号公司');
  });

  it('IA重设计刀1：行级 merge —— 分别写 persona 与运营参数互不清空（话术库页 vs 客服机页写同一行）', async () => {
    // 话术库页先写完整 persona + business_kb
    const kb = {
      company: { name: '号X公司', what_we_do: '', value_prop: '', contact: '' },
      products: [],
      audience_segments: [],
      qa_docs: [],
    };
    await saveCSConfig('wxid_merge', { persona: personaOf('小苏'), business_kb: kb });
    // 客服机页随后只改运营参数（不带 persona/business_kb）—— 不应把人设/知识库清空
    await saveCSConfig('wxid_merge', { auto_agent_enabled: true, daily_limit: 50 });
    const c = await getCSConfig('wxid_merge');
    expect(c?.persona.self_name, '人设没被运营参数写入清空').toBe('小苏');
    expect(c?.business_kb.company.name, '知识库没被清空').toBe('号X公司');
    expect(c?.auto_agent_enabled).toBe(true);
    expect(c?.daily_limit).toBe(50);
  });
});

describe('cs-account-config-store — 身份校验异常', () => {
  it('recordIdentityAlert 写入后 listIdentityAlerts 可读到', async () => {
    await recordIdentityAlert('wxid_bad', 'unregistered_wechat');
    const list = await listIdentityAlerts();
    expect(list.length).toBe(1);
    expect(list[0].wechat_id).toBe('wxid_bad');
    expect(list[0].reason).toBe('unregistered_wechat');
  });
});

describe('cs-account-config-store — 按 machine_id 解析该客服配置（客户机按身份拉）', () => {
  it('已绑定 machine_id → 解析到 wechat_id → 返回该客服那一行', async () => {
    await saveCSConfig('wxid_a', { persona: personaOf('萌萌'), whitelist: ['客户甲'] });
    bindings.set('machine-1', 'wxid_a');
    const c = await getCSConfigByMachine('machine-1');
    expect(c?.wechat_id).toBe('wxid_a');
    expect(c?.persona.self_name).toBe('萌萌');
    expect(c?.whitelist).toContain('客户甲');
  });

  it('两台机各绑各号 → 各拉各的，绝不串台（钉死 Issue defe1a42 在客户机侧）', async () => {
    await saveCSConfig('wxid_a', { persona: personaOf('萌萌') });
    await saveCSConfig('wxid_b', { persona: personaOf('天下第一'), auto_agent_enabled: true });
    bindings.set('machine-1', 'wxid_a');
    bindings.set('machine-2', 'wxid_b');
    const a = await getCSConfigByMachine('machine-1');
    const b = await getCSConfigByMachine('machine-2');
    expect(a?.persona.self_name).toBe('萌萌');
    expect(a?.auto_agent_enabled).toBe(false);
    expect(b?.persona.self_name).toBe('天下第一');
    expect(b?.auto_agent_enabled).toBe(true);
  });

  it('未绑定的 machine_id → null（不返回任意一份配置）', async () => {
    await saveCSConfig('wxid_a', { persona: personaOf('萌萌') });
    expect(await getCSConfigByMachine('machine-unbound')).toBeNull();
  });

  it('已绑 PC 但管理员没填微信号（wechat_id 为空）→ null', async () => {
    bindings.set('machine-3', null);
    expect(await getCSConfigByMachine('machine-3')).toBeNull();
  });

  it('绑了微信号但该号还没配过 → null（绑定在、配置无）', async () => {
    bindings.set('machine-4', 'wxid_not_configured');
    expect(await getCSConfigByMachine('machine-4')).toBeNull();
  });
});
