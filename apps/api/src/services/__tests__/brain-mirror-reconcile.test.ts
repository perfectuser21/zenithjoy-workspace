/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * worker_tasks ↔ Brain device_job 对账（0929 生产实证：10 条 worker_tasks=failed/executor_lost 而 Brain 仍 queued）。
 *
 * 根因：hk-vps 上除 zenithjoy-api-prod 外还有三个 09-21/23 的旧蓝绿容器（green/green2/green3）连着同一个生产库，
 * 各自跑着旧版租约 sweeper——谁先扫到谁把行置 failed；旧版 sweep 不回写 Brain（green/green2 甚至没配 Brain 连接），
 * prod 的 sweep 之后再扫就是 0 行，Brain 那条单永远停在 queued/in_progress。任何"单次回写"的路径都挡不住这类
 * 旁路写入 / 回写失败 / Brain 侧重置，所以需要一个按真身（本地终态）周期性补写 Brain 的对账器。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const brainQuery = vi.fn();
vi.mock('../../db/brain-pool', () => ({ getBrainPool: vi.fn(() => ({ query: brainQuery })) }));
vi.mock('../../db/connection', () => ({ default: { query: vi.fn() } }));

import localPool from '../../db/connection';
import { getBrainPool } from '../../db/brain-pool';
import { reconcileBrainMirrors } from '../brain-device-job-mirror';

const B1 = '9d4f439b-5360-4c12-ab5a-9d54b6929ee0';
const B2 = 'b2d60a20-6d19-44b7-99ef-2fa697089e51';
const B3 = '9a73e06f-1b76-4158-9819-28bbc14bebad';
const B4 = '11111111-2222-4333-8444-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
  (getBrainPool as any).mockImplementation(() => ({ query: brainQuery }));
});

function brainUpdates() {
  return brainQuery.mock.calls.filter((c: any[]) => /UPDATE tasks/.test(c[0]));
}

describe('reconcileBrainMirrors', () => {
  it('本地终态而 Brain 仍 queued/in_progress → 按本地真身补写 Brain（带 error_code 与 reconciled 标记）', async () => {
    (localPool.query as any).mockResolvedValueOnce({ rows: [
      { id: 'wt-1', status: 'failed', error_code: 'executor_lost', evidence: { brain_task_id: B1 } },
      { id: 'wt-2', status: 'completed', error_code: null, evidence: { brain_task_id: B2, leads: 7 } },
      { id: 'wt-3', status: 'failed', error_code: 'executor_lost', evidence: { brain_task_id: B3 } },
    ] });
    brainQuery
      .mockResolvedValueOnce({ rows: [{ id: B1, status: 'queued' }, { id: B2, status: 'in_progress' }, { id: B3, status: 'failed' }] })
      .mockResolvedValue({ rowCount: 1, rows: [] });
    await expect(reconcileBrainMirrors()).resolves.toBe(2);
    const ups = brainUpdates();
    expect(ups).toHaveLength(2);
    const byId = Object.fromEntries(ups.map((c: any[]) => [c[1][0], c[1]]));
    expect(byId[B1][1]).toBe('failed');
    expect(JSON.parse(byId[B1][2])).toMatchObject({ error_code: 'executor_lost', reconciled: true });
    expect(byId[B2][1]).toBe('completed');
    expect(JSON.parse(byId[B2][2])).toMatchObject({ leads: 7, reconciled: true });
    expect(byId[B3]).toBeUndefined(); // 已一致的不动
  });

  it('本地 running 而 Brain 被重置成 queued → 补回 in_progress（领单器只认 queued，留着会被再领一遍）', async () => {
    (localPool.query as any).mockResolvedValueOnce({ rows: [{ id: 'wt-4', status: 'running', error_code: null, evidence: { brain_task_id: B4 } }] });
    brainQuery.mockResolvedValueOnce({ rows: [{ id: B4, status: 'queued' }] }).mockResolvedValue({ rowCount: 1, rows: [] });
    await expect(reconcileBrainMirrors()).resolves.toBe(1);
    expect(brainUpdates()[0][1][1]).toBe('in_progress');
  });

  it('Brain 侧 cancelled 是人为决定，不覆盖', async () => {
    (localPool.query as any).mockResolvedValueOnce({ rows: [{ id: 'wt-5', status: 'failed', error_code: 'x', evidence: { brain_task_id: B1 } }] });
    brainQuery.mockResolvedValueOnce({ rows: [{ id: B1, status: 'cancelled' }] });
    await expect(reconcileBrainMirrors()).resolves.toBe(0);
    expect(brainUpdates()).toHaveLength(0);
  });

  it('brain_task_id 不是 uuid 的行不进 Brain 查询（::uuid[] 转换会让整批对账报错）', async () => {
    (localPool.query as any).mockResolvedValueOnce({ rows: [
      { id: 'wt-6', status: 'failed', error_code: 'x', evidence: { brain_task_id: 'garbage' } },
      { id: 'wt-7', status: 'failed', error_code: 'x', evidence: { brain_task_id: B2 } },
    ] });
    brainQuery.mockResolvedValueOnce({ rows: [{ id: B2, status: 'failed' }] });
    await reconcileBrainMirrors();
    expect(brainQuery.mock.calls[0][1][0]).toEqual([B2]);
  });

  it('本地查询 SQL 必须覆盖近期全部有 brain_task_id 的行（含 running），且按时间窗限量', async () => {
    (localPool.query as any).mockResolvedValueOnce({ rows: [] });
    await reconcileBrainMirrors();
    const sql = (localPool.query as any).mock.calls[0][0] as string;
    expect(sql).toMatch(/brain_task_id/);
    expect(sql).toMatch(/interval/);
    expect(sql).not.toMatch(/status\s*<>\s*'running'/);
    expect(brainQuery).not.toHaveBeenCalled(); // 没有候选就不打 Brain
  });

  it('Brain 未配置 → 返回 0 不抛', async () => {
    (getBrainPool as any).mockImplementation(() => null);
    await expect(reconcileBrainMirrors()).resolves.toBe(0);
  });

  it('Brain 查询失败 → 不抛（对账是兜底，挂了下轮再来）', async () => {
    (localPool.query as any).mockResolvedValueOnce({ rows: [{ id: 'wt-1', status: 'failed', error_code: 'x', evidence: { brain_task_id: B1 } }] });
    brainQuery.mockRejectedValueOnce(new Error('ECONNRESET'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(reconcileBrainMirrors()).resolves.toBe(0);
    err.mockRestore();
  });
});
