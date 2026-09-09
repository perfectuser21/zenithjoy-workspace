/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * publish-receipts helper 契约：latest-wins 聚合 + 终态判定单一来源。
 * 刀5a 终审 P2-2/P2-3 债：notion syncReceipts 与 publish-dispatch 列表端点各自
 * 手写了一份回执聚合 SQL，历史 failed 行会污染"是否成功"判定——本 helper
 * 收敛成唯一实现，SQL 层 DISTINCT ON + JS 层防御性 latest-wins 双保险。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/connection', () => ({ default: { query: vi.fn() } }));

import pool from '../../db/connection';
import {
  aggregateLatestReceipts,
  isTerminal,
  SUCCESS_STATUSES,
} from '../publish-receipts';

const TENANT = 'b0058fb7-645d-4d2b-ab25-8d9d4a764b29';
const CID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SUCCESS_STATUSES / isTerminal', () => {
  it('SUCCESS_STATUSES 覆盖 done/completed/success', () => {
    expect(SUCCESS_STATUSES).toEqual(['done', 'completed', 'success']);
  });

  it('isTerminal：非终态集合(pending/queued/dispatched/in_progress/running)判 false，其余判 true', () => {
    expect(isTerminal('pending')).toBe(false);
    expect(isTerminal('queued')).toBe(false);
    expect(isTerminal('dispatched')).toBe(false);
    expect(isTerminal('in_progress')).toBe(false);
    expect(isTerminal('running')).toBe(false);
    expect(isTerminal('done')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
  });
});

describe('aggregateLatestReceipts', () => {
  it('contentIds 为空 → 直接返回空 Map，不查库', async () => {
    const result = await aggregateLatestReceipts(TENANT, []);
    expect(result.size).toBe(0);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('latest-wins：同一 (content_id, platform) 历史 failed + 最新 done → 只剩 done（带 result 列）', async () => {
    (pool.query as any).mockResolvedValue({
      rows: [
        { cid: CID_A, platform: 'douyin', status: 'failed', result: { error: '旧的' }, created_at: '2026-09-01T00:00:00Z' },
        { cid: CID_A, platform: 'douyin', status: 'done', result: { url: '新的' }, created_at: '2026-09-05T00:00:00Z' },
      ],
    });
    const result = await aggregateLatestReceipts(TENANT, [CID_A]);
    const list = result.get(CID_A);
    expect(list).toHaveLength(1);
    expect(list![0]).toEqual({ platform: 'douyin', status: 'done', result: { url: '新的' } });
  });

  it('行到达顺序颠倒也不影响 latest-wins（防御性判定按 created_at 而非行序）', async () => {
    (pool.query as any).mockResolvedValue({
      rows: [
        { cid: CID_A, platform: 'douyin', status: 'done', result: null, created_at: '2026-09-05T00:00:00Z' },
        { cid: CID_A, platform: 'douyin', status: 'failed', result: { error: '旧的' }, created_at: '2026-09-01T00:00:00Z' },
      ],
    });
    const result = await aggregateLatestReceipts(TENANT, [CID_A]);
    expect(result.get(CID_A)).toEqual([{ platform: 'douyin', status: 'done', result: null }]);
  });

  it('多平台多作品：按 content_id 分组，各自平台数组齐全', async () => {
    (pool.query as any).mockResolvedValue({
      rows: [
        { cid: CID_A, platform: 'douyin', status: 'done', result: null, created_at: '2026-09-05T00:00:00Z' },
        { cid: CID_A, platform: 'weibo', status: 'failed', result: null, created_at: '2026-09-05T00:00:00Z' },
        { cid: CID_B, platform: 'kuaishou', status: 'dispatched', result: null, created_at: '2026-09-05T00:00:00Z' },
      ],
    });
    const result = await aggregateLatestReceipts(TENANT, [CID_A, CID_B]);
    expect(result.get(CID_A)).toHaveLength(2);
    expect(result.get(CID_B)).toEqual([{ platform: 'kuaishou', status: 'dispatched', result: null }]);
  });

  it('某作品无任务行 → Map 中不存在该 key（调用方需用 ?? [] 兜底）', async () => {
    (pool.query as any).mockResolvedValue({ rows: [] });
    const result = await aggregateLatestReceipts(TENANT, [CID_A]);
    expect(result.has(CID_A)).toBe(false);
  });

  it('SQL 形状：DISTINCT ON (payload->>\'content_id\', platform) + ORDER BY ... created_at DESC（守卫 publish-dispatch.test.ts:485 同款正则）+ WHERE 带 ANY 过滤', async () => {
    (pool.query as any).mockResolvedValue({ rows: [] });
    await aggregateLatestReceipts(TENANT, [CID_A]);
    const [sql, params] = (pool.query as any).mock.calls[0];
    expect(sql).toMatch(/DISTINCT ON\s*\(\s*payload->>'content_id'\s*,\s*platform\s*\)/i);
    expect(sql).toMatch(/ORDER BY\s+payload->>'content_id'\s*,\s*platform\s*,\s*created_at DESC/i);
    expect(sql).toMatch(/payload->>'content_id'\s*=\s*ANY/i);
    expect(params[0]).toBe(TENANT);
    expect(params[1]).toEqual([CID_A]);
  });
});
