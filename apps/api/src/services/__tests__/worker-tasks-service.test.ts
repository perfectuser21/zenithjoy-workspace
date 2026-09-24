/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../db/connection', () => ({ default: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../worker-shots', () => ({
  saveShot: vi.fn(async () => 'tenant-a/task-1/3.jpg'),
  shotPath: vi.fn((ref: string) => `/tmp/shots/${ref}`),
}));
import pool from '../../db/connection';
import { validateStepReport, sweepExpiredLeases, LEASE_MS, startTask, completeTask, getActivity, reportStep } from '../worker-tasks-service';
beforeEach(() => vi.clearAllMocks());
describe('validateStepReport', () => {
  it('failed 缺三件套任一 → FAILURE_SCENE_REQUIRED', () => {
    expect(() => validateStepReport({ step_index: 1, status: 'failed', executor_id: 'x' })).toThrow(/FAILURE_SCENE_REQUIRED/);
    expect(() => validateStepReport({ step_index: 1, status: 'failed', executor_id: 'x', foreground_pkg: 'p', diag_line: 'd' })).toThrow(/FAILURE_SCENE_REQUIRED/);
  });
  it('failed 三件套齐 → 通过', () => {
    expect(() => validateStepReport({ step_index: 1, status: 'failed', executor_id: 'x', foreground_pkg: 'p', diag_line: 'd', screenshot_jpeg_b64: 'AAAA' })).not.toThrow();
  });
  it('status 非法 / step_index 非整数 / 缺 executor_id → INVALID_STEP', () => {
    expect(() => validateStepReport({ step_index: 1, status: 'weird' as any, executor_id: 'x' })).toThrow(/INVALID_STEP/);
    expect(() => validateStepReport({ step_index: 1.5, status: 'done', executor_id: 'x' })).toThrow(/INVALID_STEP/);
    expect(() => validateStepReport({ step_index: 1, status: 'done' } as any)).toThrow(/INVALID_STEP/);
  });
  it('截图 base64 超 200KB → SCREENSHOT_TOO_LARGE', () => {
    const big = 'A'.repeat(200 * 1024 * 4 / 3 + 100);
    expect(() => validateStepReport({ step_index: 1, status: 'done', executor_id: 'x', screenshot_jpeg_b64: big })).toThrow(/SCREENSHOT_TOO_LARGE/);
  });
});
describe('sweepExpiredLeases', () => {
  it('把租约过期的 running 任务标 failed/executor_lost，返回条数', async () => {
    (pool.query as any).mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 't1' }, { id: 't2' }] });
    const n = await sweepExpiredLeases();
    expect(n).toBe(2);
    const sql = (pool.query as any).mock.calls[0][0] as string;
    expect(sql).toMatch(/status = 'failed'/); expect(sql).toMatch(/error_code = 'executor_lost'/); expect(sql).toMatch(/lease_until < NOW\(\)/);
    // 必须断言 SQL 本身取了 evidence：pool 是 mock 的，mock 想返回什么就返回什么，
    // 跟真实 SQL 里有没有这一列毫无关系。漏了这条断言，把 RETURNING 改回只取 id
    // 测试照样全绿，而线上拿不到 brain_task_id → Brain 侧永远挂 in_progress。
    expect(sql).toMatch(/RETURNING\s+id,\s*evidence/);
  });
});
describe('startTask', () => {
  it('同 agent 已有 running（唯一索引 23505）→ WORKER_BUSY', async () => {
    const client = { query: vi.fn(), release: vi.fn() };
    (pool.connect as any).mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'agent-uuid', tenant_id: 'tenant-a' }] }) // agent lookup
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(startTask({ agentId: 'agent-uuid', title: 't', steps: ['a'], executorId: 'ex' })).rejects.toMatchObject({ code: 'WORKER_BUSY' });
  });
  it('LEASE_MS 为 10 分钟', () => { expect(LEASE_MS).toBe(10 * 60 * 1000); });
});
describe('completeTask', () => {
  it('evidence 截图超限 → rejects SCREENSHOT_TOO_LARGE', async () => {
    (pool.query as any).mockResolvedValueOnce({
      rows: [{ id: 't1', tenant_id: 'ta', status: 'running', executor_id: 'ex' }],
    });
    const big = 'A'.repeat(200 * 1024 * 4 / 3 + 100);
    await expect(completeTask('t1', {
      outcome: 'completed', executor_id: 'ex', evidence: { screenshot_jpeg_b64: big },
    })).rejects.toMatchObject({ code: 'SCREENSHOT_TOO_LARGE' });
  });
});
describe('getActivity · history', () => {
  it('每条历史带 failed_scene（失败步三件套）/ evidence_screenshot_ref / duration_ms', async () => {
    (pool.query as any)
      .mockResolvedValueOnce({ rows: [{ id: 'agent-1' }] }) // agent 归属
      .mockResolvedValueOnce({ rows: [] }) // 无 running
      .mockResolvedValueOnce({ rows: [
        { id: 'h1', title: '失败的', status: 'failed', steps_total: 5, started_at: 's', finished_at: 'f', failed_step: 3, error_code: 'adb_unreachable',
          evidence_screenshot_ref: null, duration_ms: '65000',
          failed_foreground_pkg: 'com.ss.android.ugc.aweme', failed_diag_line: 'searchBtnFound=false', failed_screenshot_ref: 'ta/h1/3.jpg' },
        { id: 'h2', title: '完成的', status: 'completed', steps_total: 3, started_at: 's', finished_at: 'f', failed_step: null, error_code: null,
          evidence_screenshot_ref: 'ta/h2/9999.jpg', duration_ms: '12000',
          failed_foreground_pkg: null, failed_diag_line: null, failed_screenshot_ref: null },
      ] });
    const a = await getActivity('tenant-a', 'agent-1');
    expect(a).not.toBeNull();
    const [h1, h2] = a!.history;
    expect(h1.failed_scene).toEqual({ foreground_pkg: 'com.ss.android.ugc.aweme', diag_line: 'searchBtnFound=false', screenshot_ref: 'ta/h1/3.jpg' });
    expect(h1.duration_ms).toBe(65000);
    expect(h1.evidence_screenshot_ref).toBeNull();
    expect(h2.failed_scene).toBeNull();
    expect(h2.evidence_screenshot_ref).toBe('ta/h2/9999.jpg');
    expect(h2.duration_ms).toBe(12000);
    // 三件套来自 worker_task_steps 按 task_id + step_index(=failed_step) 关联；截图 ref 从 evidence JSONB 抽
    const sql = (pool.query as any).mock.calls[2][0] as string;
    expect(sql).toMatch(/worker_task_steps/); expect(sql).toMatch(/step_index = t\.failed_step/);
    expect(sql).toMatch(/evidence->>'screenshot_ref'/); expect(sql).toMatch(/finished_at - t\.started_at/);
  });
});
describe('reportStep', () => {
  it('step_index >= steps_total → STEP_OUT_OF_RANGE 400，不写步骤', async () => {
    (pool.query as any).mockResolvedValueOnce({
      rows: [{ id: 't1', tenant_id: 'ta', status: 'running', executor_id: 'ex', steps_total: 3 }],
    });
    await expect(reportStep('t1', { step_index: 3, status: 'done', executor_id: 'ex' }))
      .rejects.toMatchObject({ code: 'STEP_OUT_OF_RANGE', httpStatus: 400 });
    expect((pool.query as any).mock.calls).toHaveLength(1);
    expect((pool.query as any).mock.calls[0][0]).toMatch(/steps_total/);
  });
  it('step_index < steps_total → 正常写步骤与续租', async () => {
    (pool.query as any)
      .mockResolvedValueOnce({ rows: [{ id: 't1', tenant_id: 'ta', status: 'running', executor_id: 'ex', steps_total: 3 }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });
    await expect(reportStep('t1', { step_index: 2, status: 'done', executor_id: 'ex' })).resolves.toEqual({ ok: true, screenshot_ref: null });
    expect((pool.query as any).mock.calls).toHaveLength(3);
  });
});

import { createMirrorJob, attachMirrorJob, completeMirrorJob } from '../brain-device-job-mirror';
vi.mock('../brain-device-job-mirror', () => ({
  createMirrorJob: vi.fn(async () => 'brain-1'),
  attachMirrorJob: vi.fn(async () => undefined),
  completeMirrorJob: vi.fn(async () => undefined),
}));

describe('startTask 桥接 Brain', () => {
  it('cron 自发的活会在 Brain 建单', async () => {
    // pool.connect 返回的 client 依次响应 BEGIN/agents/INSERT/steps/COMMIT
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})                                            // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'a1', tenant_id: 't1' }] })      // agents
        .mockResolvedValueOnce({ rows: [{ id: 'wt-1', lease_until: 'L' }] })   // INSERT worker_tasks
        .mockResolvedValue({}),
      release: vi.fn(),
    };
    (pool as any).connect = vi.fn(async () => client);
    (pool as any).query = vi.fn(async () => ({ rows: [{ agent_id: 'phone-S123' }] }));

    await startTask({ agentId: 'a1', title: '获客采收·X', steps: ['s1'], executorId: 'adb-wall' });
    expect(createMirrorJob).toHaveBeenCalled();
  });

  it('领单器领 Brain 单产生的活走关联，不重复建单（否则每条真派单都镜像一条，页面重复计数）', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ id: 'a1', tenant_id: 't1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'wt-2', lease_until: 'L' }] })
        .mockResolvedValue({}),
      release: vi.fn(),
    };
    (pool as any).connect = vi.fn(async () => client);
    (pool as any).query = vi.fn(async () => ({ rows: [{ agent_id: 'phone-S123' }] }));

    await startTask({ agentId: 'a1', title: '[派活演示] 小蓝', steps: ['s1'], executorId: 'adb-wall', brainJobId: 'brain-existing' });
    expect(createMirrorJob).not.toHaveBeenCalled();
    // 光断言"没建单"是假绿：桥接压根没接进来时它也成立。必须同时证明**真的走了关联分支**，
    // 否则实现里漏写 attachMirrorJob，这条用例照样绿，而线上表现是 worker_task 和
    // Brain 单失联 —— 收尾和 sweep 都找不到 brain_task_id。
    expect(attachMirrorJob).toHaveBeenCalledWith('wt-2', 'brain-existing');
  });

  it('Brain 建单抛错也不能让 startTask 失败 —— 采收是正事', async () => {
    (createMirrorJob as any).mockRejectedValueOnce(new Error('boom'));
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ id: 'a1', tenant_id: 't1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'wt-3', lease_until: 'L' }] })
        .mockResolvedValue({}),
      release: vi.fn(),
    };
    (pool as any).connect = vi.fn(async () => client);
    (pool as any).query = vi.fn(async () => ({ rows: [{ agent_id: 'phone-S123' }] }));

    await expect(startTask({ agentId: 'a1', title: 'X', steps: ['s'], executorId: 'adb-wall' }))
      .resolves.toMatchObject({ task_id: 'wt-3' });
    // 同上：桥接没接进来时"不抛错"天然成立。要先证明它**确实调用了会抛错的那条路**，
    // 这条"抛错也不失败"才有意义。
    expect(createMirrorJob).toHaveBeenCalled();
  });
});

describe('completeTask 回写 Brain', () => {
  it('收尾时按 evidence.brain_task_id 回写 Brain 状态', async () => {
    (pool as any).query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'wt-1', tenant_id: 't1', status: 'running', executor_id: 'adb-wall', steps_total: 3, evidence: { brain_task_id: 'brain-1' } }] })
      .mockResolvedValue({ rows: [] });
    await completeTask('wt-1', { outcome: 'completed', executor_id: 'adb-wall' });
    expect(completeMirrorJob).toHaveBeenCalledWith('brain-1', 'completed', expect.anything());
  });

  it('UPDATE 不能整体覆盖 evidence —— 会把 brain_task_id 抹掉，下次 sweep 就找不到它了', async () => {
    (pool as any).query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'wt-1', tenant_id: 't1', status: 'running', executor_id: 'adb-wall', steps_total: 3, evidence: { brain_task_id: 'brain-1' } }] })
      .mockResolvedValue({ rows: [] });
    await completeTask('wt-1', { outcome: 'completed', executor_id: 'adb-wall', evidence: { leads: 19 } });
    const updateCall = (pool as any).query.mock.calls.find((c: any[]) => /UPDATE zenithjoy\.worker_tasks/.test(c[0]));
    expect(updateCall[0]).toMatch(/evidence\s*=\s*COALESCE\(evidence/i);
    // 同理断言 loadRunning 的 SELECT 真取了 evidence 列。mock 的返回值里带 evidence
    // 不能证明 SQL 里 SELECT 了它 —— 漏掉这列，线上 completeTask 永远拿不到
    // brain_task_id，回写静默不发生，页面永远停在"执行中"。
    const selectCall = (pool as any).query.mock.calls.find((c: any[]) => /SELECT id, tenant_id/.test(c[0]));
    expect(selectCall[0]).toMatch(/evidence/);
  });

  it('没有 brain_task_id 时不报错，静默跳过', async () => {
    (pool as any).query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'wt-9', tenant_id: 't1', status: 'running', executor_id: 'adb-wall', steps_total: 1, evidence: null }] })
      .mockResolvedValue({ rows: [] });
    await expect(completeTask('wt-9', { outcome: 'completed', executor_id: 'adb-wall' })).resolves.toEqual({ ok: true });
    // 光断言"不报错"是假绿：老实现天然满足。必须同时证明它确实判断了没有 brain_task_id 就不去调 Brain。
    expect(completeMirrorJob).not.toHaveBeenCalled();
  });
});

describe('sweepExpiredLeases 同步 Brain', () => {
  // 注：计划原文把这组用例挂在 worker-lease-sweeper.test.ts，但该文件整体
  // vi.mock('../worker-tasks-service')（把 sweepExpiredLeases 换成空壳 mock，专测定时器包装层），
  // 挂在那会让这里断言的"真实现"从未被调用，用例恒假绿/恒失败两难。
  // sweepExpiredLeases 的真实现单测本就在本文件（见上面 describe('sweepExpiredLeases')），
  // 这组新增延续同一处。
  it('执行器丢失时把 Brain 单也置 failed —— 否则 Brain 侧永远 in_progress，还占住 dedup 槽位挡住后续建单', async () => {
    (pool as any).query = vi.fn(async () => ({
      rowCount: 1,
      rows: [{ id: 'wt-1', evidence: { brain_task_id: 'brain-1' } }],
    }));
    await sweepExpiredLeases();
    expect(completeMirrorJob).toHaveBeenCalledWith('brain-1', 'failed', expect.objectContaining({ error_code: 'executor_lost' }));
  });

  it('没关联 Brain 单的行跳过，不报错', async () => {
    (pool as any).query = vi.fn(async () => ({ rowCount: 1, rows: [{ id: 'wt-2', evidence: null }] }));
    await expect(sweepExpiredLeases()).resolves.toBe(1);
    // 同上：光看 resolves.toBe(1) 老实现也满足，必须证明它确实检查过 evidence 且判断为空跳过。
    expect(completeMirrorJob).not.toHaveBeenCalled();
  });
});
