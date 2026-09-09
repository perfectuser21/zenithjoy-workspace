/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 通用 rollup sweeper 契约（刀5a 终审 P2-2 债）：dashboard 直派、没有编排台锚
 * （notion_page_id / feishu_record_id 均为空）的 queued 作品此前会永锁在 queued——
 * 本 sweeper 全租户扫描这批"无锚"作品，靠共享 helper 的终态聚合把它们收敛成
 * published/failed。
 *
 * 注：feishu_record_id 列已由刀5b Task 2 的 migration 建出，候选 SQL 同时按
 * notion_page_id IS NULL 与 feishu_record_id IS NULL 过滤（Task 3 补齐，还清
 * Task 1 阶段留的 TODO）——只有两边编排台都没锚的作品才算"无锚"。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../db/connection', () => ({ default: { query: vi.fn() } }));

import pool from '../../db/connection';
import { runRollupOnce, startPublishRollup, stopPublishRollup } from '../publish-rollup';

const TENANT_A = 'b0058fb7-645d-4d2b-ab25-8d9d4a764b29';
const TENANT_B = 'c1169fc8-756e-4c3c-bc36-9e0e5b875c3a';
const CID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** 候选查询桩 + 任务表桩 + UPDATE 记录。calls 数组记录每一条 pool.query 调用。 */
function stubRollup(candidates: Array<{ id: string; tenant_id: string }>, tasksById: Record<string, any[]>) {
  const calls: Array<{ sql: string; params: any[] }> = [];
  (pool.query as any).mockImplementation(async (sql: string, params?: any[]) => {
    calls.push({ sql, params: params ?? [] });
    if (/status\s*=\s*'queued'/i.test(sql) && /notion_page_id IS NULL/i.test(sql)) {
      return { rows: candidates };
    }
    if (/FROM zenithjoy\.publish_tasks/i.test(sql)) {
      const ids: string[] = (params?.[1] as string[]) ?? [];
      const rows = ids.flatMap((cid) => (tasksById[cid] ?? []).map((t) => ({ cid, ...t })));
      return { rows };
    }
    return { rows: [] };
  });
  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runRollupOnce：候选查询', () => {
  it('按 status=queued AND notion_page_id IS NULL AND feishu_record_id IS NULL 过滤（两边编排台都无锚才算无锚）', async () => {
    const calls = stubRollup([], {});
    await runRollupOnce();
    const candidateCall = calls.find((c) => /status\s*=\s*'queued'/i.test(c.sql));
    expect(candidateCall).toBeTruthy();
    expect(candidateCall!.sql).toMatch(/notion_page_id IS NULL/i);
    expect(candidateCall!.sql).toMatch(/feishu_record_id IS NULL/i);
  });

  it('候选查询不按 tenant_id 过滤（全租户扫描——dashboard 直派客户作品不分租户）', async () => {
    const calls = stubRollup([], {});
    await runRollupOnce();
    const candidateCall = calls.find((c) => /status\s*=\s*'queued'/i.test(c.sql));
    expect(candidateCall!.sql).not.toMatch(/WHERE[^;]*tenant_id/i);
  });

  it('候选为空 → 不再查 publish_tasks，直接跳过', async () => {
    const calls = stubRollup([], {});
    await runRollupOnce();
    expect(calls.filter((c) => /FROM zenithjoy\.publish_tasks/i.test(c.sql))).toHaveLength(0);
  });
});

describe('runRollupOnce：单作品判定', () => {
  it('tasks.length===0（派发进行中）→ skip，不发 UPDATE', async () => {
    const calls = stubRollup([{ id: CID_A, tenant_id: TENANT_A }], { [CID_A]: [] });
    await runRollupOnce();
    expect(calls.filter((c) => /UPDATE zenithjoy\.contents/i.test(c.sql))).toHaveLength(0);
  });

  it('先 latest-wins 再判 allTerminal：重发后最新为 pending → 等待，不落地', async () => {
    const calls = stubRollup([{ id: CID_A, tenant_id: TENANT_A }], {
      [CID_A]: [
        { platform: 'douyin', status: 'done', result: null, created_at: '2026-09-01T00:00:00Z' },
        { platform: 'douyin', status: 'pending', result: null, created_at: '2026-09-05T00:00:00Z' },
      ],
    });
    await runRollupOnce();
    expect(calls.filter((c) => /UPDATE zenithjoy\.contents/i.test(c.sql))).toHaveLength(0);
  });

  it('全部终态且全部 SUCCESS → UPDATE 置 published', async () => {
    const calls = stubRollup([{ id: CID_A, tenant_id: TENANT_A }], {
      [CID_A]: [
        { platform: 'douyin', status: 'done', result: null, created_at: '2026-09-05T00:00:00Z' },
        { platform: 'weibo', status: 'completed', result: null, created_at: '2026-09-05T00:00:00Z' },
      ],
    });
    await runRollupOnce();
    const upd = calls.find((c) => /UPDATE zenithjoy\.contents/i.test(c.sql));
    expect(upd).toBeTruthy();
    expect(upd!.sql).toMatch(/status = \$1/);
    expect(upd!.params[0]).toBe('published');
    expect(upd!.params).toContain(CID_A);
  });

  it('全部终态但有 failed → UPDATE 置 failed', async () => {
    const calls = stubRollup([{ id: CID_A, tenant_id: TENANT_A }], {
      [CID_A]: [
        { platform: 'douyin', status: 'done', result: null, created_at: '2026-09-05T00:00:00Z' },
        { platform: 'weibo', status: 'failed', result: { error: 'x' }, created_at: '2026-09-05T00:00:00Z' },
      ],
    });
    await runRollupOnce();
    const upd = calls.find((c) => /UPDATE zenithjoy\.contents/i.test(c.sql));
    expect(upd).toBeTruthy();
    expect(upd!.params[0]).toBe('failed');
    expect(upd!.params).toContain(CID_A);
  });

  it('跨租户候选：按各自 tenant_id 分组聚合，互不串号', async () => {
    const calls = stubRollup(
      [
        { id: CID_A, tenant_id: TENANT_A },
        { id: CID_B, tenant_id: TENANT_B },
      ],
      {
        [CID_A]: [{ platform: 'douyin', status: 'done', result: null, created_at: '2026-09-05T00:00:00Z' }],
        [CID_B]: [{ platform: 'kuaishou', status: 'failed', result: null, created_at: '2026-09-05T00:00:00Z' }],
      },
    );
    await runRollupOnce();
    const updates = calls.filter((c) => /UPDATE zenithjoy\.contents/i.test(c.sql));
    expect(updates).toHaveLength(2);
    const forA = updates.find((c) => c.params.includes(CID_A));
    const forB = updates.find((c) => c.params.includes(CID_B));
    expect(forA!.params[0]).toBe('published');
    expect(forA!.params).toContain(TENANT_A);
    expect(forB!.params[0]).toBe('failed');
    expect(forB!.params).toContain(TENANT_B);
  });

  it('单条候选查库/落地异常不拖垮同批其它候选（catch 打日志继续）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let taskQueryCount = 0;
    (pool.query as any).mockImplementation(async (sql: string) => {
      if (/status\s*=\s*'queued'/i.test(sql) && /notion_page_id IS NULL/i.test(sql)) {
        return { rows: [{ id: CID_A, tenant_id: TENANT_A }, { id: CID_B, tenant_id: TENANT_A }] };
      }
      if (/FROM zenithjoy\.publish_tasks/i.test(sql)) {
        taskQueryCount += 1;
        throw new Error('db 抖了一下');
      }
      if (/UPDATE zenithjoy\.contents/i.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    await expect(runRollupOnce()).resolves.not.toThrow();
    expect(taskQueryCount).toBeGreaterThan(0);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('startPublishRollup / stopPublishRollup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('按 intervalMs 定时跑 runRollupOnce（无 env 依赖，永远启动）', async () => {
    stubRollup([], {});
    const t = startPublishRollup(1000);
    expect(t).toBeTruthy();
    await vi.advanceTimersByTimeAsync(1000);
    const calls = (pool.query as any).mock.calls;
    expect(calls.some((c: any[]) => /status\s*=\s*'queued'/i.test(c[0]))).toBe(true);
    stopPublishRollup(t);
  });

  it('running 互斥：上一轮未完（慢查询）时下一个 tick 跳过，不重叠', async () => {
    let resolveSlow: () => void = () => {};
    let callCount = 0;
    (pool.query as any).mockImplementation((sql: string) => {
      if (/status\s*=\s*'queued'/i.test(sql) && /notion_page_id IS NULL/i.test(sql)) {
        callCount += 1;
        return new Promise((resolve) => {
          resolveSlow = () => resolve({ rows: [] });
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const t = startPublishRollup(1000);
    await vi.advanceTimersByTimeAsync(1000); // 第一轮开始，卡在候选查询上未 resolve
    await vi.advanceTimersByTimeAsync(1000); // 第二个 tick 到达，应因 running=true 被跳过
    expect(callCount).toBe(1);
    resolveSlow();
    await Promise.resolve();
    stopPublishRollup(t);
  });

  it('stopPublishRollup 之后不再调用', async () => {
    stubRollup([], {});
    const t = startPublishRollup(1000);
    await vi.advanceTimersByTimeAsync(1000);
    const before = (pool.query as any).mock.calls.length;
    stopPublishRollup(t);
    await vi.advanceTimersByTimeAsync(5000);
    expect((pool.query as any).mock.calls.length).toBe(before);
  });
});
