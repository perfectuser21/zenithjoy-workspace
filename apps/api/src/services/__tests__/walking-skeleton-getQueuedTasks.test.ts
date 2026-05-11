/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * H-2 Bug 9 layer 4 — heartbeat polling 必须接受 'queued' status
 *
 * Root cause: getQueuedTasks 老 `WHERE status='pending'` 漏 'queued'
 * (Sprint B-1 burner endpoint INSERT 用 'queued', H-1 canonical) →
 * Agent heartbeat 拉不到 burner task → chrome 没弹。
 *
 * Fix: 接受 H-1 canonical pre-execution 三态 (pending / queued / dispatched)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn() },
}));

import pool from '../../db/connection';
import { getQueuedTasks } from '../walking-skeleton.service';

describe('getQueuedTasks heartbeat polling [Bug 9 layer 4]', () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it('SQL WHERE 接受 pending/queued/dispatched (不只 pending)', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    await getQueuedTasks('agent-uuid-1');
    const calls = vi.mocked(pool.query).mock.calls;
    expect(calls.length).toBe(1);
    const sql = calls[0][0] as string;
    // 旧合同 status='pending' (RED)
    // 新合同 status IN ('pending', 'queued', 'dispatched')
    expect(sql).toMatch(/status\s+IN\s*\(/i);
    expect(sql).toMatch(/'pending'/);
    expect(sql).toMatch(/'queued'/);
    expect(sql).toMatch(/'dispatched'/);
    // 不再单 status='pending'
    expect(sql).not.toMatch(/AND\s+status\s*=\s*'pending'\s+ORDER/i);
  });

  it('返 mock 行 (验 rows 真直传)', async () => {
    const fake = [{ id: 't1', agent_id: 'a1', platform: 'x', status: 'queued', type: 'image', folder_path: null, result: null, receipt_at: null, created_at: '2026-05-11T00:00:00Z' }] as any[];
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: fake } as any);
    const r = await getQueuedTasks('agent-uuid-2');
    expect(r).toEqual(fake);
  });
});
