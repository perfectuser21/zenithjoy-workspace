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
