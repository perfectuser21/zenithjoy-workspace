/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Line04 per-operator — service_agents 真实微信号(SSOT)落库 + /cs/machines 返回显示名
 *
 * 用户拍板：SSOT = 微信号(perfect-xx，用户视角"微信ID 就是微信号")，不暴露内部 wxid。
 * 核实：wxauto 只能读内部 wxid + 昵称，读不到微信号 → real_wechat_id 由运营一键配置手填一次。
 *
 * 钉死：
 *  1. setupCSByMachine 收到 real_wechat_id(+可选 wxid_internal/wechat_display_name) → 写进 service_agents 新列；
 *     合成 wechat_id(cs-前缀)仍照旧派生、仍是配置主 key(不动 PK)。
 *  2. listAllMachines(tenantId) 返回每台机器的 real_wechat_id + wechat_display_name(前端 display)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../../../db/connection', () => ({
  default: { query: mockQuery, connect: vi.fn() },
}));

import { setupCSByMachine, listAllMachines } from '../cs-account-config-store';

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
  mockQuery.mockReset();
});

describe('setupCSByMachine — 真实微信号(SSOT)落库', () => {
  it('运营手填 real_wechat_id → 写进 service_agents；合成 wechat_id 仍派生 cs-<前缀>', async () => {
    // 1) license join 解析租户
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-1', agent_id: 'a-1' }] } as any);
    // 2) 同租户现有绑定检查（1:1 防串台）→ 无行（首次绑定）
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    // 3) INSERT service_agents（断言带新列）
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    // 4) saveCSConfig 的 INSERT wechat_cs_account_config
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    const res = await setupCSByMachine('07c37bd4cf1cb6909488e926ee8fafd3', {
      persona: personaOf('小苏'),
      real_wechat_id: 'suxiaoyao121',
      wechat_display_name: '苏小妖',
      wxid_internal: 'wxid_abc123',
    } as any);

    // 合成 wechat_id 不变（仍是配置主 key）
    expect(res.wechat_id).toBe('cs-07c37bd4');

    // 第 3 条 SQL = INSERT service_agents，必须带上三个新列 + 真实值
    const saSql = String(mockQuery.mock.calls[2][0]);
    const saParams = mockQuery.mock.calls[2][1] as unknown[];
    expect(saSql).toContain('service_agents');
    expect(saSql).toContain('real_wechat_id');
    expect(saSql).toContain('wechat_display_name');
    expect(saSql).toContain('wxid_internal');
    expect(saParams).toContain('suxiaoyao121');
    expect(saParams).toContain('苏小妖');
    expect(saParams).toContain('wxid_abc123');
  });

  it('不填 real_wechat_id → 新列写 NULL，不报错（存量/未填兼容）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-1', agent_id: null }] } as any);
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // 现有绑定检查（1:1）
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // saveCSConfig

    const res = await setupCSByMachine('abcd1234 effff', { persona: personaOf('x') } as any);
    expect(res.wechat_id).toBe('cs-abcd1234');
    const saParams = mockQuery.mock.calls[2][1] as unknown[];
    // real_wechat_id 位置应为 null（不是 undefined / 不抛）
    expect(saParams).toContain(null);
  });
});

describe('listAllMachines — 返回 real_wechat_id + wechat_display_name 供前端 display', () => {
  it('scoped 列表每台带真实微信号 + 昵称', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          machine_id: 'm1',
          hostname: 'PC-1',
          last_seen: null,
          wechat_id: 'cs-07c37bd4',
          real_wechat_id: 'suxiaoyao121',
          wechat_display_name: '苏小妖',
          self_name: '小苏',
          whitelist: null,
          auto_agent_enabled: true,
          configured: true,
          wechat_ok: null,
          wechat_reason: null,
          found_window: null,
          login_present: null,
          online: true,
        },
      ],
    } as any);

    const machines = await listAllMachines('tenant-1');
    expect(machines).toHaveLength(1);
    expect(machines[0].real_wechat_id).toBe('suxiaoyao121');
    expect(machines[0].wechat_display_name).toBe('苏小妖');
    // SQL 必须 SELECT 这两列
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain('real_wechat_id');
    expect(sql).toContain('wechat_display_name');
  });
});
