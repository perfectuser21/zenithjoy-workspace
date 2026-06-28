/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Bug C (issue 205799b8) — 车队/选机器看板 found_window 恒空：listAllMachines 读
 *   agents.module_status->'line04-wechat-cs'（Channel A = agent core preflight 合成，生产恒空），
 *   而 listen_chat.py 心跳 diag.main_window_found 才是「微信窗口找到没」的真值（Channel B，内存 Map）。
 *   钉死：listAllMachines 用 listen_chat 心跳覆盖空的 preflight found_window，按 agent_uuid / agent_id
 *   匹配；main_window_found=true → found_window 真、wechat_ok 真、清掉「微信主窗口未找到」假告警。
 *
 * Bug D — 「选机器」列表里登录上线但还没配的机器不出现：scoped(运营) 原以 service_agents 为驱动表
 *   (INNER) → 未绑定机器漏掉。钉死：scoped 改以 license_machines 为驱动 + 经 licenses.tenant_id scope，
 *   LEFT JOIN service_agents（含未绑定 → configured=false → 前台「待配置」可点）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../../../db/connection', () => ({
  default: { query: mockQuery, connect: vi.fn() },
}));

import { listAllMachines } from '../cs-account-config-store';
import { recordHeartbeat, _resetHeartbeats } from '../../wechat-heartbeat';

/** 构造一行 listAllMachines 的原始 DB row（默认值，可覆写）。 */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    machine_id: 'm1',
    hostname: 'PC-1',
    last_seen: null,
    wechat_id: 'cs-aaa',
    real_wechat_id: null,
    wechat_display_name: null,
    self_name: '小苏',
    whitelist: null,
    auto_agent_enabled: true,
    configured: true,
    agent_id: 'env-1',
    agent_uuid: 'uuid-agent-1',
    wechat_ok: null,
    wechat_reason: null,
    found_window: null,
    login_present: null,
    online: false,
    ...over,
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  _resetHeartbeats();
});

describe('Bug C — listAllMachines 用 listen_chat 心跳 diag 覆盖恒空 preflight found_window', () => {
  it('preflight found_window 空 + 心跳 main_window_found=true → found_window 真、wechat_ok 真、清假 reason、判在线', async () => {
    recordHeartbeat({
      agent_id: 'uuid-agent-1',
      diag: { main_window_found: true, login_present: false, sessions_seen: 4 },
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        row({
          wechat_ok: null, // preflight 没结论
          wechat_reason: '微信主窗口未找到（未登录或 UIA 未就绪）', // 假告警
          found_window: null, // 恒空
          online: false, // Channel A 判离线
        }),
      ],
    } as any);

    const machines = await listAllMachines('tenant-1');
    expect(machines[0].found_window).toBe(true);
    expect(machines[0].wechat_ok).toBe(true);
    expect(machines[0].wechat_reason).toBeUndefined();
    expect(machines[0].online).toBe(true); // 心跳新鲜 → 在线
    // SQL 必须 SELECT agent_id（匹配心跳所需）
    expect(String(mockQuery.mock.calls[0][0])).toContain('agent_id');
  });

  it('按 agent_uuid 匹配（listener 传的是 UUID）也能命中', async () => {
    recordHeartbeat({ agent_id: 'uuid-agent-1', diag: { main_window_found: true } });
    mockQuery.mockResolvedValueOnce({
      rows: [row({ agent_id: 'env-1', agent_uuid: 'uuid-agent-1', found_window: null })],
    } as any);
    const machines = await listAllMachines('tenant-1');
    expect(machines[0].found_window).toBe(true);
  });

  it('心跳 main_window_found=false → found_window 假、wechat_ok 假、给出原因', async () => {
    recordHeartbeat({
      agent_id: 'uuid-agent-2',
      diag: { main_window_found: false, login_present: true },
    });
    mockQuery.mockResolvedValueOnce({
      rows: [row({ agent_uuid: 'uuid-agent-2', agent_id: 'env-2', wechat_ok: 'true' })],
    } as any);
    const machines = await listAllMachines('tenant-1');
    expect(machines[0].found_window).toBe(false);
    expect(machines[0].wechat_ok).toBe(false);
    expect(machines[0].wechat_reason).toBeTruthy();
  });

  it('无匹配心跳 → 保留 preflight 原值（不乱改）', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        row({
          agent_uuid: 'uuid-no-hb',
          wechat_ok: 'true',
          found_window: 'true',
          login_present: 'false',
          online: true,
        }),
      ],
    } as any);
    const machines = await listAllMachines('tenant-1');
    expect(machines[0].found_window).toBe(true);
    expect(machines[0].wechat_ok).toBe(true);
    expect(machines[0].online).toBe(true);
  });

  it('过期心跳（超 5 分钟）→ 不判在线、不覆盖（避免拿陈旧状态谎报）', async () => {
    recordHeartbeat(
      { agent_id: 'uuid-agent-1', diag: { main_window_found: true } },
      Date.now() - 6 * 60 * 1000,
    );
    mockQuery.mockResolvedValueOnce({
      rows: [row({ found_window: null, online: false })],
    } as any);
    const machines = await listAllMachines('tenant-1');
    // 过期心跳仍可校正 found_window 数据，但不得把离线机器谎报为在线
    expect(machines[0].online).toBe(false);
  });
});

describe('Bug D — scoped 列表以 license_machines 为驱动，未绑定(待配)机器也出现', () => {
  it('scoped SQL 以 license_machines 驱动 + 经 licenses.tenant_id scope（LEFT JOIN service_agents 含未绑定）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    await listAllMachines('tenant-1');
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain('FROM zenithjoy.license_machines');
    expect(sql).toContain('LEFT JOIN zenithjoy.service_agents');
    expect(sql).toContain('l.tenant_id');
    // 不再以 service_agents 为驱动表（FROM service_agents）
    expect(sql).not.toContain('FROM zenithjoy.service_agents sa');
  });

  it('未绑定机器（service_agents 列为空）仍返回，configured=false（待配）', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        row({
          machine_id: 'm-unbound',
          hostname: 'NEW-PC',
          wechat_id: null,
          self_name: null,
          auto_agent_enabled: null,
          configured: false,
          agent_uuid: null,
          online: true,
        }),
      ],
    } as any);
    const machines = await listAllMachines('tenant-1');
    expect(machines).toHaveLength(1);
    expect(machines[0].configured).toBe(false);
    expect(machines[0].machine_id).toBe('m-unbound');
  });
});
