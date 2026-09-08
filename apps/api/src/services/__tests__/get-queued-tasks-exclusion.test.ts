/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 旧 agent（Windows/安卓既有版本）经心跳 getQueuedTasks 拉任务；content_publish
 * 是给新执行器（GET /api/publish-tasks 通道）的，旧 agent 不认识——一旦误领会
 * 拿着不认识的 payload 走 work_id 老路径。必须在中台侧排除（旧 agent 已部署，改不了它）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/connection', () => ({ default: { query: vi.fn(), connect: vi.fn() } }));

import pool from '../../db/connection';
import { getQueuedTasks } from '../walking-skeleton.service';

beforeEach(() => vi.clearAllMocks());

describe('getQueuedTasks 排除 content_publish', () => {
  it('SQL 用 IS DISTINCT FROM 排除 content_publish（保住 task_type=NULL 与其他 task_type）', async () => {
    (pool.query as any).mockResolvedValue({ rows: [] });
    await getQueuedTasks('agent-1');
    const sql: string = (pool.query as any).mock.calls[0][0];
    expect(sql).toMatch(/task_type\s+IS\s+DISTINCT\s+FROM\s+'content_publish'/i);
    expect(sql).toMatch(/status IN \('pending', 'queued', 'dispatched'\)/);
  });
});
