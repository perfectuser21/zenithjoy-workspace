/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../db/connection', () => ({ default: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../worker-shots', () => ({
  saveShot: vi.fn(async () => 'tenant-a/task-1/3.jpg'),
  shotPath: vi.fn((ref: string) => `/tmp/shots/${ref}`),
}));
import pool from '../../db/connection';
import { validateStepReport, sweepExpiredLeases, LEASE_MS, startTask, completeTask, WorkerTaskError } from '../worker-tasks-service';
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
