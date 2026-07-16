/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * upsertAgentByHeartbeat — 精确 UPDATE + license_id 兜底 fall-through 测试
 *
 * 加固背景：精确 UPDATE WHERE 子句增加 `AND license_id = $5`，
 * 伪造别租户 agentUuid 时 license_id 不匹配 → UPDATE 命中 0 行 →
 * fall-through 到 (license_id, hostname) 原有隔离路径，合法 agent 行为不变。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn() },
}));

import pool from '../../db/connection';
import { upsertAgentByHeartbeat } from '../walking-skeleton.service';

const AGENT_ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  tenant_id: 'tenant-001',
  agent_id: 'ws1-aabbccddeeff0011',
  hostname: 'my-pc',
  version: '2.0.32',
  license_id: 'lic-001',
  bound_folder_path: null,
  last_heartbeat_at: '2026-06-28T00:00:00Z',
  status: 'online',
  last_seen: '2026-06-28T00:00:00Z',
};

const BASE_ARGS = {
  licenseId: 'lic-001',
  tenantId: 'tenant-001',
  hostname: 'my-pc',
  version: '2.0.32',
  agentUuid: '11111111-1111-1111-1111-111111111111',
};

describe('upsertAgentByHeartbeat — 精确 UPDATE + license_id fall-through', () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it('uuid + license_id 命中 → 直接返回该行，不走 SELECT/INSERT 路径', async () => {
    // call 1: 精确 UPDATE 返回一行（命中）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [AGENT_ROW] } as any);
    // call 2: pinned_agent UPDATE（可忽略结果）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

    const result = await upsertAgentByHeartbeat(BASE_ARGS);

    expect(result.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(result.status).toBe('online');

    const calls = vi.mocked(pool.query).mock.calls;
    // 只有 2 次查询：精确 UPDATE + pinned_agent UPDATE
    expect(calls.length).toBe(2);

    // 第一次调用必须是精确 UPDATE（含 license_id 兜底 AND license_id = $5）
    const firstSql = calls[0][0] as string;
    expect(firstSql).toMatch(/UPDATE zenithjoy\.agents/i);
    expect(firstSql).toMatch(/WHERE id = \$3/);
    expect(firstSql).toMatch(/AND license_id = \$5/);

    // 最后一次调用不能是 INSERT（命中路径不走 INSERT）
    const lastSql = calls[calls.length - 1][0] as string;
    expect(lastSql).not.toMatch(/INSERT INTO zenithjoy\.agents/i);
  });

  it('uuid 未命中（license_id 不匹配 SQL 层已过滤） → fall-through 到 (license_id, hostname) 路径', async () => {
    // call 1: 精确 UPDATE 返回空（uuid 找不到 / license_id 不匹配）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    // call 2: SELECT by (license_id, hostname) → 找到既有 agent
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [AGENT_ROW] } as any);
    // call 3: UPDATE agents by id（原有路径更新心跳）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [AGENT_ROW] } as any);
    // call 4: pinned_agent UPDATE
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

    const result = await upsertAgentByHeartbeat(BASE_ARGS);

    expect(result.id).toBe('11111111-1111-1111-1111-111111111111');

    const calls = vi.mocked(pool.query).mock.calls;
    // fall-through 后至少 3 次（精确 UPDATE + SELECT + UPDATE/INSERT）
    expect(calls.length).toBeGreaterThanOrEqual(3);

    // 第二次调用应为 SELECT（按 tenant_id 隔离——与 DB 唯一约束 uq_agents_tenant_hostname 对齐）
    const secondSql = calls[1][0] as string;
    expect(secondSql).toMatch(/SELECT[\s\S]*FROM zenithjoy\.agents/i);
    expect(secondSql).toMatch(/WHERE tenant_id = \$1/i);

    // 整条调用链中应出现第二次 UPDATE（原有路径更新心跳）
    const hasSecondUpdate = calls.slice(2).some(
      (c: unknown[]) => typeof c[0] === 'string' && /UPDATE zenithjoy\.agents/i.test(c[0] as string),
    );
    expect(hasSecondUpdate).toBe(true);
  });
});

/** 判定某条调用是否为 license_machines 的写入（INSERT）。 */
function isLicenseMachineInsert(c: unknown[]): boolean {
  return typeof c[0] === 'string' && /INSERT INTO zenithjoy\.license_machines/i.test(c[0] as string);
}

/**
 * 回归（handoff 0715 Seg4 根因）：心跳只在首次 INSERT 硬编码
 * capabilities = ARRAY['douyin']，此后所有 UPDATE 分支完全不碰这一列——
 * 真实 Android 设备每次心跳上报 os_type=android，capabilities 却永远不含
 * 'android'。resolveDevicePlatform 因此恒定判 'windows'，私信任务永远
 * 派不到真机。心跳必须按 osType 把 capabilities 也带上，UPDATE 分支同样要写。
 */
describe('upsertAgentByHeartbeat — capabilities 必须随 os_type 心跳同步（Seg4 私信路由）', () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it('精确 UPDATE 命中路径：osType=android 心跳 → capabilities 参数须含 android', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [AGENT_ROW] } as any); // 精确 UPDATE
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any); // pinned_agent UPDATE

    await upsertAgentByHeartbeat({ ...BASE_ARGS, osType: 'android' });

    const calls = vi.mocked(pool.query).mock.calls;
    const firstSql = calls[0][0] as string;
    expect(firstSql).toMatch(/UPDATE zenithjoy\.agents/i);
    expect(firstSql).toMatch(/capabilities/i);
    const firstParams = calls[0][1] as unknown[];
    expect(firstParams).toContainEqual(expect.arrayContaining(['android']));
  });
});

/**
 * 回归（真机验证 2026-07-16，安卓 Path2 golden path 复跑撞到）：Android agent 自
 * 生成的 agent_uuid 是可读 slug（如 "agent-maa-an00-mrmt6yaa"），不是真 UUID。
 * 精确路径 `WHERE id = $3` 若直接把它塞进 uuid 列，Postgres 类型校验层面会拒绝
 * （错误码 22P02 "invalid input syntax for type uuid"），此前这个异常没有被
 * 捕获，直接冒泡到路由层变成裸 500（HEARTBEAT_FAILED），安卓真机永远注册不上。
 * 期望行为：非法格式的 agentUuid 在发起 SQL 前就被识别、视同"未命中"，直接走
 * (license_id, hostname) 原有路径——根本不该拿一个格式错误的自报 ID 去查 uuid 列。
 */
describe('upsertAgentByHeartbeat — agentUuid 非 UUID 格式 → fall-through 而非抛出 500', () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it('非 UUID 格式 agentUuid（安卓 slug）→ 跳过精确 UPDATE，直接走 (license_id, hostname) 路径', async () => {
    // call 1: SELECT by (license_id, hostname) → 找到既有 agent（跳过精确路径直达 fall-through）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [AGENT_ROW] } as any);
    // call 2: UPDATE agents by id（原有路径更新心跳）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [AGENT_ROW] } as any);

    const result = await upsertAgentByHeartbeat({
      ...BASE_ARGS,
      agentUuid: 'agent-maa-an00-mrmt6yaa',
    });

    // 不抛出、返回正常心跳结果——真机心跳必须能成功，而不是收到 HEARTBEAT_FAILED 500
    expect(result.id).toBe('11111111-1111-1111-1111-111111111111');

    const calls = vi.mocked(pool.query).mock.calls;
    // 第一次调用必须直接是 SELECT（证明非法格式的 agentUuid 从未被塞进 `WHERE id = $3` 的 UPDATE）
    const firstSql = calls[0][0] as string;
    expect(firstSql).toMatch(/SELECT[\s\S]*FROM zenithjoy\.agents/i);
    expect(firstSql).toMatch(/WHERE tenant_id = \$1/i);
    expect(calls.some((c) => typeof c[0] === 'string' && /WHERE id = \$3/.test(c[0] as string))).toBe(false);
  });
});

/**
 * 回归（真机验证 2026-07-16，紧接上一条 UUID 修复后同一真机撞到的第二个真根因）：
 * DB 唯一约束 `uq_agents_tenant_hostname` 是 (tenant_id, hostname)，但 fall-through
 * 去重 SELECT 之前按 (license_id, hostname) 查——同一 tenant 下有 2 个 license
 * （常见于测试租户 / 客户先领 free 再买正式）、同一台设备曾经用另一个 license 心跳过，
 * 现在换一个 license 心跳 → SELECT 用新 license_id 查不到旧行 → 误判"新机器" →
 * 走 INSERT → 撞 (tenant_id, hostname) 唯一约束 → 未捕获异常冒泡成路由层裸 500
 * （duplicate key value violates unique constraint "uq_agents_tenant_hostname"）。
 * 期望行为：去重 SELECT 按 tenant_id（DB 约束的真实维度）查，而不是 license_id。
 */
describe('upsertAgentByHeartbeat — 去重 SELECT 必须按 tenant_id（对齐 DB 唯一约束），不能按 license_id', () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it('同一 tenant 换一个 license 心跳同 hostname → 必须命中旧行 UPDATE，不能误判新机器走 INSERT', async () => {
    // call 1: SELECT by tenant_id → 命中旧行（虽然是用另一个 license 建的）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [AGENT_ROW] } as any);
    // call 2: UPDATE agents by id（原有路径更新心跳）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [AGENT_ROW] } as any);
    // call 3: pinned_agent UPDATE
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

    const result = await upsertAgentByHeartbeat({
      ...BASE_ARGS,
      licenseId: 'lic-002-different-license-same-tenant',
      agentUuid: undefined,
    });

    expect(result.id).toBe('11111111-1111-1111-1111-111111111111');

    const calls = vi.mocked(pool.query).mock.calls;
    // 第一次调用必须按 tenant_id 查（不是 license_id），才能跨 license 命中同一台机器
    const firstSql = calls[0][0] as string;
    expect(firstSql).toMatch(/WHERE tenant_id = \$1/i);
    // 全链路不能出现 INSERT（命中旧行就不该走新建，否则撞 DB 唯一约束）
    expect(calls.some((c) => typeof c[0] === 'string' && /INSERT INTO zenithjoy\.agents/i.test(c[0] as string))).toBe(false);
  });
});

describe('upsertAgentByHeartbeat — license_machines 配额门（心跳旁路补齐）', () => {
  const QUOTA_ARGS = { ...BASE_ARGS, machineId: 'mid-xyz' };

  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it('新机器 + 配额已满 → 跳过 license_machines INSERT（agents 心跳照常更新）+ warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // call 1: SELECT 该 (license_id, machine_id) 是否已有行 → 无（新机器）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    // call 2: SELECT max_machines + active count → 已满（1/1）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ max: 1, cnt: 1 }] } as any);
    // call 3: 精确 UPDATE agents（心跳照常）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [AGENT_ROW] } as any);
    // call 4: pinned_agent UPDATE
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

    const result = await upsertAgentByHeartbeat(QUOTA_ARGS);
    expect(result.id).toBe('11111111-1111-1111-1111-111111111111');

    const calls = vi.mocked(pool.query).mock.calls;
    // 全链路不得出现 license_machines INSERT（配额门拦下新机器）
    expect(calls.some(isLicenseMachineInsert)).toBe(false);
    // agents 精确 UPDATE 仍然发生（在线状态展示不受影响）
    expect(calls.some((c) => typeof c[0] === 'string' && /UPDATE zenithjoy\.agents/i.test(c[0] as string))).toBe(true);
    // 有配额已满告警
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls.map((c) => c.join(' ')).join('\n'))).toMatch(/配额已满/);
    warnSpy.mockRestore();
  });

  it('已绑定机器 + 配额已满 → 照旧 upsert（续命不受配额影响）', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // call 1: SELECT 该 (license_id, machine_id) → 已有行（老机器续心跳）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ exists: 1 }] } as any);
    // call 2: license_machines upsert（照旧）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    // call 3: 精确 UPDATE agents
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [AGENT_ROW] } as any);
    // call 4: pinned_agent UPDATE
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

    await upsertAgentByHeartbeat(QUOTA_ARGS);

    const calls = vi.mocked(pool.query).mock.calls;
    // 已绑定机器必须照旧 upsert license_machines（不能把续命也拦了）
    expect(calls.some(isLicenseMachineInsert)).toBe(true);
  });

  it('新机器 + 配额未满 → 照旧 INSERT license_machines', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // call 1: SELECT 该 (license_id, machine_id) → 无（新机器）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    // call 2: SELECT max_machines + active count → 未满（2/5）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ max: 5, cnt: 2 }] } as any);
    // call 3: license_machines INSERT
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    // call 4: 精确 UPDATE agents
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [AGENT_ROW] } as any);
    // call 5: pinned_agent UPDATE
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

    await upsertAgentByHeartbeat(QUOTA_ARGS);

    const calls = vi.mocked(pool.query).mock.calls;
    expect(calls.some(isLicenseMachineInsert)).toBe(true);
  });
});
