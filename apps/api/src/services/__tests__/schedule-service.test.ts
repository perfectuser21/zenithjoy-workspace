/**
 * schedule-service.test.ts — 排程看板第一刀·下半截（task 3abb7f8c）
 *
 * 守四件要害，每件都对应一个真实会出事的场景：
 *   ① 租户隔离 —— Brain tasks 表**没有租户维度**（tenant_id 只躺在 payload 里），
 *      直出就是悦升租户能看见金诺机的活。必须先用中台本库 agents 取白名单再过滤。
 *   ② 窗口语义 —— 铁律 27bb6d1a：固定周期整点对外发送＝风控自首。对外动作的窗口
 *      不得小于 30 分钟；对内动作（渲染/剪辑）不碰平台，允许精确到分。
 *   ③ 额度不跨部门求和 —— 一台机服务两条业务线时，"还能加 N"按线各算；加总会让
 *      主理人把同一份余量派两遍。
 *   ④ 读不到 ≠ 没活 —— 跨境读 Brain 失败时必须 stale=true，页面才能说"读取失败"，
 *      而不是渲染成"今天没活"。
 */

import { describe, it, expect } from 'vitest';
import {
  filterByTenantAgents,
  toScheduleSlot,
  quotaHeadroomByDept,
  validateWindow,
  isStale,
  buildCasUpdate,
  toDeviceSerial,
  type BrainDeviceJob,
} from '../schedule-service';

const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '22222222-2222-4222-8222-222222222222';
const FOREIGN = '99999999-9999-4999-8999-999999999999';

function job(over: Partial<BrainDeviceJob> = {}): BrainDeviceJob {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title: '触达 · 金诺机 · 0921 · R1',
    task_type: 'device_job',
    status: 'queued',
    dept: '智能获客',
    assigned_to: A1,
    due_at: '2026-09-21T14:00:00.000Z',
    row_version: 0,
    payload: { serial: 'ANGYVB4227006983', est_minutes: 20, source: 'oneoff' },
    ...over,
  };
}

describe('① 租户隔离：Brain 无租户维度，必须按本租户 agents 白名单过滤', () => {
  it('只保留 assigned_to 命中白名单的活', () => {
    const rows = [job({ assigned_to: A1 }), job({ assigned_to: A2 }), job({ assigned_to: FOREIGN })];
    const kept = filterByTenantAgents(rows, [A1, A2]);
    expect(kept.map((r) => r.assigned_to)).toEqual([A1, A2]);
  });

  it('白名单为空时一条都不给（没有设备就没有活，不是"全给"）', () => {
    expect(filterByTenantAgents([job()], [])).toEqual([]);
  });

  it('assigned_to 为空的活不算任何租户的（孤儿单不能泄漏给所有人）', () => {
    expect(filterByTenantAgents([job({ assigned_to: null })], [A1])).toEqual([]);
  });

  it('白名单比对区分大小写以外的精确匹配，不做前缀/包含匹配', () => {
    const prefixAttack = A1.slice(0, 8);
    expect(filterByTenantAgents([job({ assigned_to: A1 })], [prefixAttack])).toEqual([]);
  });
});

describe('② 窗口语义：对外动作不得固定到分（铁律 27bb6d1a）', () => {
  const MIN = 60_000;

  it('对外动作窗口 < 30 分钟被拒', () => {
    const r = validateWindow({ kind: 'outbound', windowMs: 29 * MIN });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/30/);
  });

  it('对外动作窗口 >= 30 分钟通过', () => {
    expect(validateWindow({ kind: 'outbound', windowMs: 30 * MIN }).ok).toBe(true);
  });

  it('对外动作窗口为 0（即精确到分）被拒——这正是风控自首的形态', () => {
    expect(validateWindow({ kind: 'outbound', windowMs: 0 }).ok).toBe(false);
  });

  it('对内动作（渲染/剪辑）允许精确到分', () => {
    expect(validateWindow({ kind: 'internal', windowMs: 0 }).ok).toBe(true);
  });

  it('窗口结束早于开始被拒', () => {
    expect(validateWindow({ kind: 'internal', windowMs: -1 }).ok).toBe(false);
  });
});

describe('③ 额度按部门各算，禁止跨部门求和', () => {
  it('同机两条业务线的余量分别给出，不合并', () => {
    const h = quotaHeadroomByDept([
      { dept: '智能获客', used: 6, cap: 55, unit: '单' },
      { dept: '新媒体部', used: 2, cap: 10, unit: '条' },
    ]);
    expect(h).toEqual({ 智能获客: 49, 新媒体部: 8 });
  });

  it('已用超过上限时余量为 0，不出负数', () => {
    expect(quotaHeadroomByDept([{ dept: '智能获客', used: 60, cap: 55, unit: '单' }])).toEqual({
      智能获客: 0,
    });
  });
});

describe('④ 读不到 ≠ 没活', () => {
  const now = Date.parse('2026-09-21T10:15:00.000Z');

  it('数据超过阈值未更新 → stale', () => {
    expect(isStale('2026-09-21T09:59:00.000Z', now, 15 * 60_000)).toBe(true);
  });

  it('数据新鲜 → 不 stale', () => {
    expect(isStale('2026-09-21T10:05:00.000Z', now, 15 * 60_000)).toBe(false);
  });

  it('as_of 缺失（根本没读到）一律按 stale 处理', () => {
    expect(isStale(null, now, 15 * 60_000)).toBe(true);
  });
});

describe('Brain 任务 → 页面 slot 的映射', () => {
  it('状态按页面枚举映射，而不是把 Brain 的枚举直接抛给前端', () => {
    expect(toScheduleSlot(job({ status: 'queued' })).status).toBe('queued');
    expect(toScheduleSlot(job({ status: 'in_progress' })).status).toBe('running');
    expect(toScheduleSlot(job({ status: 'completed' })).status).toBe('done');
    expect(toScheduleSlot(job({ status: 'failed' })).status).toBe('failed');
    expect(toScheduleSlot(job({ status: 'blocked' })).status).toBe('blocked');
  });

  it('未知状态落到 blocked 并带原因，不静默变成"待跑"', () => {
    const s = toScheduleSlot(job({ status: 'paused' }));
    expect(s.status).toBe('blocked');
    expect(s.blocked_reason).toContain('paused');
  });

  it('planned_at 输出带时区偏移的 ISO（全链只认一个时间基准）', () => {
    const s = toScheduleSlot(job({ due_at: '2026-09-21T14:00:00.000Z' }));
    expect(s.planned_at).toMatch(/(Z|[+-]\d{2}:\d{2})$/);
    expect(Date.parse(s.planned_at)).toBe(Date.parse('2026-09-21T14:00:00.000Z'));
  });

  it('带上 row_version 供前端回传做 CAS', () => {
    expect(toScheduleSlot(job({ row_version: 7 })).row_version).toBe(7);
  });

  it('source 从 payload 取，缺省按一次性单处理', () => {
    expect(toScheduleSlot(job()).source).toBe('oneoff');
    expect(toScheduleSlot(job({ payload: {} })).source).toBe('oneoff');
  });

  it('read_only 必须透到读面 —— 否则前端无从判断，镜像行和真派单长得一样', () => {
    const slot = toScheduleSlot({
      id: 'b1', title: 'X', task_type: 'device_job', status: 'in_progress', dept: '智能获客',
      assigned_to: 'a1', due_at: '2026-09-24T14:30:00Z', row_version: 1,
      payload: { read_only: true, source: 'cron' },
    } as any);
    expect(slot.read_only).toBe(true);
  });

  it('真派单不带 read_only，默认 false 而不是 undefined（前端好判断）', () => {
    const slot = toScheduleSlot({
      id: 'b2', title: 'Y', task_type: 'device_job', status: 'queued', dept: '智能获客',
      assigned_to: 'a1', due_at: '2026-09-24T14:30:00Z', row_version: 1,
      payload: { source: 'oneoff' },
    } as any);
    expect(slot.read_only).toBe(false);
  });
});

describe('改时间走乐观锁 CAS（updated_at 被 tick 定时 touch，不能当锁）', () => {
  it('SQL 带 row_version 判态并自增', () => {
    const { sql, params } = buildCasUpdate({
      taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      rowVersion: 3,
      dueAt: '2026-09-21T13:00:00.000Z',
    });
    expect(sql).toMatch(/row_version\s*=\s*row_version\s*\+\s*1/i);
    expect(sql).toMatch(/WHERE[\s\S]*row_version\s*=/i);
    expect(params).toContain(3);
  });

  it('只改未开跑的活：谓词里必须带 status 判态（已在跑/已完成不许改时间）', () => {
    const { sql } = buildCasUpdate({
      taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      rowVersion: 0,
      dueAt: '2026-09-21T13:00:00.000Z',
    });
    expect(sql).toMatch(/status\s*=\s*'queued'/i);
  });
});

describe('派单与真机之间唯一的握手：机身序列号', () => {
  it('中台的 phone-<序列号> 要还原成 adb 看得到的裸序列号', () => {
    expect(toDeviceSerial('phone-ANGYVB4402004137')).toBe('ANGYVB4402004137');
  });

  it('本来就是裸序列号的原样返回', () => {
    expect(toDeviceSerial('ANGYVB4402004137')).toBe('ANGYVB4402004137');
  });

  it('不认识的形态原样返回 —— 宁可留原值让人能查，也不猜', () => {
    expect(toDeviceSerial('ws1-6bb220cdd01fc82a')).toBe('ws1-6bb220cdd01fc82a');
  });

  it('只剥开头的前缀，不误伤中间含 phone- 的值', () => {
    expect(toDeviceSerial('SER-phone-1')).toBe('SER-phone-1');
  });
});
