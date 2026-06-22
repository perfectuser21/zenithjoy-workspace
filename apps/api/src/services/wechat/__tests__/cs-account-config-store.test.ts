/**
 * cs-account-config-store 单测（无 DB / 无网络）——按 wechat_id 隔离存取 + 身份异常读写。
 * mock db/connection：按 wechat_id 的内存表 + 身份异常内存数组。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rows, alerts } = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  alerts: [] as Array<{ wechat_id: string; reason: string; created_at: Date }>,
}));

vi.mock('../../../db/connection', () => ({
  default: {
    query: vi.fn(async (sql: string, params: unknown[]) => {
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
        return { rows: r ? [{ ...r, wechat_id: wechatId }] : [] };
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
