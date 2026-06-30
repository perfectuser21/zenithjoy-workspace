/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Line04 账号身份层 — 内部人员字段 + 1 email↔1 微信 1:1 绑定（防串台）
 *
 * 用户拍板（Line04 第二刀地基）：
 *  1. 每个绑定的客服微信号要记录「这个号背后真正的内部人员是谁」（人名/标识），可在中台编辑、可查。
 *  2. 一个 email/license 账号（= 一个租户）只能绑一个微信号；尝试给同租户绑第二台机器（= 第二个微信）
 *     必须被拒绝，给明确告警（防止将来接 CRM 串台）。
 *
 * 钉死：
 *  - setupCSByMachine 收到 internal_operator → 写进 service_agents.internal_operator（COALESCE 幂等补填）。
 *  - listAllMachines 返回每台机器的 internal_operator 供中台展示/对账。
 *  - 同租户已绑一台机器后，给「另一台」机器 setup → 抛错（TENANT_ALREADY_BOUND），绝不静默建第二行。
 *  - 同一台机器 re-setup（machine_id 相同）→ 放行（幂等改配置，不算串台）。
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

describe('setupCSByMachine — 内部人员字段落库', () => {
  it('运营填 internal_operator → 写进 service_agents.internal_operator；合成 wechat_id 不变', async () => {
    // 1) license join 解析租户
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-1', agent_id: 'a-1' }] } as any);
    // 2) 同租户现有绑定检查 → 无行（首次绑定）
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    // 3) INSERT service_agents
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    // 4) saveCSConfig 的 INSERT wechat_cs_account_config
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    const res = await setupCSByMachine('07c37bd4cf1cb6909488e926ee8fafd3', {
      persona: personaOf('小苏'),
      internal_operator: '苏彦卿',
    } as any);

    expect(res.wechat_id).toBe('cs-07c37bd4');

    // INSERT service_agents（第 3 条 SQL）必须带 internal_operator 列 + 真实值
    const saSql = String(mockQuery.mock.calls[2][0]);
    const saParams = mockQuery.mock.calls[2][1] as unknown[];
    expect(saSql).toContain('service_agents');
    expect(saSql).toContain('internal_operator');
    expect(saParams).toContain('苏彦卿');
  });

  it('不填 internal_operator → 该列写 NULL，不报错（存量/未填兼容，COALESCE 不抹旧值）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-1', agent_id: null }] } as any);
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // 现有绑定检查
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // saveCSConfig

    const res = await setupCSByMachine('abcd1234ffff', { persona: personaOf('x') } as any);
    expect(res.wechat_id).toBe('cs-abcd1234');
    const saSql = String(mockQuery.mock.calls[2][0]);
    expect(saSql).toContain('internal_operator');
  });
});

describe('setupCSByMachine — 1 email↔1 微信 1:1 绑定（防串台）', () => {
  it('同租户已绑「另一台」机器 → setup 第二台被拒（TENANT_ALREADY_BOUND）', async () => {
    // 1) license join → 同一个 tenant-1
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-1', agent_id: 'a-2' }] } as any);
    // 2) 现有绑定检查 → 已有一台「别的」机器绑在 tenant-1（machine_id 不同）
    mockQuery.mockResolvedValueOnce({
      rows: [{ machine_id: 'OLD_MACHINE', wechat_id: 'cs-old111', real_wechat_id: 'perfect-old' }],
    } as any);

    await expect(
      setupCSByMachine('NEW_MACHINE_2222', { persona: personaOf('y'), internal_operator: '张三' } as any),
    ).rejects.toThrow(/TENANT_ALREADY_BOUND|已绑定|串台/);

    // 绝不能走到 INSERT（只查了 2 条就抛）
    expect(mockQuery.mock.calls.length).toBe(2);
  });

  it('同一台机器 re-setup（machine_id 相同）→ 放行（幂等改配置，不算串台）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-1', agent_id: 'a-1' }] } as any);
    // 现有绑定 = 同一台机器（machine_id 相同）→ 不拦
    mockQuery.mockResolvedValueOnce({
      rows: [{ machine_id: 'SAME_MACHINE_01', wechat_id: 'cs-same011', real_wechat_id: null }],
    } as any);
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] } as any); // saveCSConfig

    const res = await setupCSByMachine('SAME_MACHINE_01', { internal_operator: '李四' } as any);
    expect(res.wechat_id).toBe('cs-SAME_MAC');
    // 走到 INSERT 了（4 条 SQL）
    expect(mockQuery.mock.calls.length).toBe(4);
  });
});

describe('listAllMachines — 返回 internal_operator 供中台对账', () => {
  it('每台机器带 internal_operator', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          machine_id: 'm1',
          hostname: 'PC-1',
          last_seen: null,
          wechat_id: 'cs-07c37bd4',
          real_wechat_id: 'suxiaoyao121',
          wechat_display_name: '苏小妖',
          internal_operator: '苏彦卿',
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
    expect(machines[0].internal_operator).toBe('苏彦卿');
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain('internal_operator');
  });
});
