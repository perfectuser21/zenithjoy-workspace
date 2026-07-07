/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Line02 warmup 下发单测 —— enqueueWarmupTasks
 * 覆盖：在线 android burner agent 无 pending/24h warmup → INSERT 一条 task_type='warmup'；
 *      已有 pending/24h → 跳过（24h 去重）。
 * Mock pool。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../db/connection', () => ({ default: { query: vi.fn() } }));
import pool from '../db/connection';
import { enqueueWarmupTasks } from './warmup-dispatch';
const q = pool.query as any;
beforeEach(() => q.mockReset());

describe('enqueueWarmupTasks', () => {
  it('在线 android burner agent 无 pending warmup → INSERT 一条 warmup（payload 带传入的 operator_nickname）', async () => {
    q.mockResolvedValueOnce({ rows: [{ agent_id: 'a1', tenant_id: 't1' }] }); // 候选（不再含 operator_nickname）
    q.mockResolvedValueOnce({ rows: [{ n: 0 }] }); // 去重检查 = 0
    q.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT
    const r = await enqueueWarmupTasks('t1', '秦军'); // operator_nickname 由调用方传入（非候选子查询）
    expect(r.enqueued).toBe(1);
    const insertCall = q.mock.calls.find((c: any) => /INSERT INTO zenithjoy\.publish_tasks/.test(String(c[0])));
    expect(insertCall).toBeDefined();
    expect(String(insertCall[0])).toMatch(/'warmup'/);
    // payload 带 task_type=warmup + 传入的 operator_nickname
    expect(String(insertCall[1])).toMatch(/秦军/);
    expect(String(insertCall[1])).toMatch(/warmup/);
  });

  it('不传 operator_nickname → payload operator_nickname 为空串', async () => {
    q.mockResolvedValueOnce({ rows: [{ agent_id: 'a1', tenant_id: 't1' }] });
    q.mockResolvedValueOnce({ rows: [{ n: 0 }] });
    q.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await enqueueWarmupTasks('t1');
    const insertCall = q.mock.calls.find((c: any) => /INSERT INTO zenithjoy\.publish_tasks/.test(String(c[0])));
    expect(String(insertCall[1])).toMatch(/"operator_nickname":""/);
  });

  it('已有 pending/24h warmup → 跳过（去重）', async () => {
    q.mockResolvedValueOnce({ rows: [{ agent_id: 'a1', tenant_id: 't1' }] });
    q.mockResolvedValueOnce({ rows: [{ n: 1 }] }); // 已有
    const r = await enqueueWarmupTasks();
    expect(r.enqueued).toBe(0);
    const sqls = q.mock.calls.map((c: any) => String(c[0]));
    expect(sqls.some((s: string) => /INSERT INTO zenithjoy\.publish_tasks/.test(s))).toBe(false);
  });

  it('无候选 agent → enqueued=0', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    const r = await enqueueWarmupTasks();
    expect(r.enqueued).toBe(0);
  });

  it('传 tenantId → 候选 SQL 带 tenant 过滤参数', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    await enqueueWarmupTasks('t-abc');
    const candCall = q.mock.calls[0];
    expect(String(candCall[1] ?? '')).toMatch(/t-abc/);
  });
});
