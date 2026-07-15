/**
 * Seg3 方案 B′ — 派单必须把【抖音号】发给 Android 设备（TDD Red 先行）。
 *
 * 真 bug（2026-07-15）：dispatchDue 把 `l.profile_url` 塞进 dm payload 的 profile_url 字段，
 * 而 Android 端 AgentService.kt:555 读 payload["profile_url"] → 交给
 * DouyinDmOutreachService.startOutreach()，后者 :151-153 明确把该字段【当抖音号搜索】：
 *     val targetDouyinId = profileUrl
 * 于是设备拿 "https://www.douyin.com/user/MS4wLj..." 去抖音搜索框搜 → matchProfileByDouyinId
 * 零匹配 → NO_MATCH → 私信段 0 送达。
 *
 * 注意 Windows 通道（douyin-dm-outreach.cjs:80 `page.goto(profileUrl)`）需要的是【真 URL】，
 * 与 Android 要的【裸抖音号】语义相反。所以 payload 必须同时带两个字段，各取所需：
 *   - profile_url : 真主页 URL（Windows 用）
 *   - douyin_id   : 裸抖音号（Android 用）
 * 派单闸也必须按通道分别判定，否则会把注定 NO_MATCH 的任务派给 Android。
 */
import { describe, it, expect, vi } from 'vitest';
import { dispatchDue, isDmDispatchable, QueryablePool } from './acquisition-dispatch';

// ── isDmDispatchable 纯判定 ────────────────────────────────────────────────

describe('isDmDispatchable — 按执行通道判定 lead 是否可派', () => {
  it('android 通道：有抖音号 + 有 agent → 可派', () => {
    expect(
      isDmDispatchable('android', { profileUrl: null, douyinId: '1689210742' }, 'agent-1')
    ).toBe(true);
  });

  it('android 通道：没抖音号（只有 profile_url）→ 不可派', () => {
    // 这正是本次要修的 bug：派出去设备只会拿 URL 当抖音号搜 → 必然 NO_MATCH。
    // 与其派出去必挂，不如标 limited 等 Seg3 回填到号再派。
    expect(
      isDmDispatchable(
        'android',
        { profileUrl: 'https://www.douyin.com/user/MS4wLjABAAAA', douyinId: null },
        'agent-1'
      )
    ).toBe(false);
  });

  it('android 通道：抖音号是空白串 → 不可派（空白不算号）', () => {
    expect(isDmDispatchable('android', { profileUrl: null, douyinId: '   ' }, 'agent-1')).toBe(false);
  });

  it('windows 通道：有 profile_url + 有 agent → 可派（cjs 要的就是真 URL）', () => {
    expect(
      isDmDispatchable(
        'windows',
        { profileUrl: 'https://www.douyin.com/user/MS4wLjABAAAA', douyinId: null },
        'agent-1'
      )
    ).toBe(true);
  });

  it('windows 通道：只有抖音号没 URL → 不可派（page.goto 裸 id 会炸）', () => {
    expect(isDmDispatchable('windows', { profileUrl: null, douyinId: '1689210742' }, 'agent-1')).toBe(
      false
    );
  });

  it('无 agent → 两个通道都不可派', () => {
    expect(
      isDmDispatchable('android', { profileUrl: 'u', douyinId: '1689210742' }, null)
    ).toBe(false);
    expect(isDmDispatchable('windows', { profileUrl: 'u', douyinId: '1' }, null)).toBe(false);
  });
});

// ── dispatchDue 真派单 payload ─────────────────────────────────────────────

type Row = Record<string, unknown>;

/** 按 SQL 片段路由的假 pool；记录所有 query 供断言。 */
function makePool(opts: {
  lead: Row;
  captured: { sql: string; params: unknown[] }[];
}): QueryablePool {
  const { lead, captured } = opts;
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      captured.push({ sql, params: params ?? [] });
      // 配置：走 defaultConfig（返回空行）
      if (/FROM zenithjoy\.acquisition_config/i.test(sql)) return { rows: [] };
      // 到期 assignment
      if (/FROM zenithjoy\.dm_assignments\s+WHERE tenant_id = \$1 AND status = 'queued'/i.test(sql)) {
        return { rows: [{ id: 'assign-1', lead_id: 'lead-1', account_label: 'burner-a' }] };
      }
      // 频控计数
      if (/dm_outreach_log\s+WHERE tenant_id/i.test(sql)) return { rows: [{ hour: 0, day: 0 }] };
      // lead + agent 联查
      if (/FROM zenithjoy\.acquisition_leads l/i.test(sql)) return { rows: [lead] };
      return { rows: [] };
    }),
  };
}

/** defaultConfig 的 dm_active 时段内的一个时刻（避免时段闸把用例挡掉）。 */
const NOON = new Date('2026-07-15T04:00:00Z'); // 12:00 Asia/Shanghai

function findPublishTaskPayload(captured: { sql: string; params: unknown[] }[]) {
  const insert = captured.find((c) => /INSERT INTO zenithjoy\.publish_tasks/i.test(c.sql));
  if (!insert) return null;
  return JSON.parse(insert.params[1] as string) as Record<string, unknown>;
}

describe('dispatchDue — Android 派单 payload 必须带真实抖音号', () => {
  it('lead 有 douyin_id → payload.douyin_id = 抖音号（设备据此搜索定位）', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const pool = makePool({
      captured,
      lead: {
        profile_url: 'https://www.douyin.com/user/MS4wLjABAAAA',
        douyin_id: '1689210742',
        agent_id: 'agent-1',
        capabilities: ['android'],
      },
    });

    const res = await dispatchDue(pool, 'tenant-1', NOON);
    expect(res.dispatched).toBe(1);

    const payload = findPublishTaskPayload(captured);
    expect(payload, '必须真写了 publish_tasks').not.toBeNull();
    expect(payload!.device_platform).toBe('android');
    // 核心断言：设备拿到的是裸抖音号，不是 URL
    expect(payload!.douyin_id).toBe('1689210742');
    expect(String(payload!.douyin_id)).not.toMatch(/^https?:\/\//);
  });

  it('lead 查询必须真的把 douyin_id 选出来（不 SELECT 就永远是 undefined）', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const pool = makePool({
      captured,
      lead: {
        profile_url: 'https://www.douyin.com/user/MS4wLjABAAAA',
        douyin_id: '1689210742',
        agent_id: 'agent-1',
        capabilities: ['android'],
      },
    });
    await dispatchDue(pool, 'tenant-1', NOON);

    const leadQuery = captured.find((c) => /FROM zenithjoy\.acquisition_leads l/i.test(c.sql));
    expect(leadQuery, '必须查 lead').toBeDefined();
    expect(/l\.douyin_id/i.test(leadQuery!.sql), 'SELECT 列表必须含 l.douyin_id').toBe(true);
  });

  it('Android lead 没 douyin_id → 不派，标 limited（派出去必然 NO_MATCH）', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const pool = makePool({
      captured,
      lead: {
        profile_url: 'https://www.douyin.com/user/MS4wLjABAAAA',
        douyin_id: null,
        agent_id: 'agent-1',
        capabilities: ['android'],
      },
    });

    const res = await dispatchDue(pool, 'tenant-1', NOON);
    expect(res.dispatched).toBe(0);
    expect(res.skipped_limit).toBe(1);
    expect(findPublishTaskPayload(captured), '绝不能派出注定 NO_MATCH 的任务').toBeNull();
  });

  it('Windows 通道不受影响：仍拿真 URL（cjs page.goto 要 URL）', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const pool = makePool({
      captured,
      lead: {
        profile_url: 'https://www.douyin.com/user/MS4wLjABAAAA',
        douyin_id: null,
        agent_id: 'agent-1',
        capabilities: [], // → windows
      },
    });

    const res = await dispatchDue(pool, 'tenant-1', NOON);
    expect(res.dispatched).toBe(1);

    const payload = findPublishTaskPayload(captured);
    expect(payload!.device_platform).toBe('windows');
    expect(payload!.profile_url).toBe('https://www.douyin.com/user/MS4wLjABAAAA');
  });
});
