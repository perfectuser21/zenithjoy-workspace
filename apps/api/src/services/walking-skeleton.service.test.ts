/* eslint-disable @typescript-eslint/no-explicit-any -- vitest mock types require any cast */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// pool 是模块顶层 import，必须在导入 service 之前 mock
vi.mock('../db/connection', () => {
  const query = vi.fn();
  return {
    default: { query },
  };
});

import {
  validateLicense,
  upsertAgentByHeartbeat,
  bindFolder,
  createPublishTask,
  submitPublishReceipt,
  getPublishTask,
  getQueuedTasks,
  findAgentById,
} from './walking-skeleton.service';
import pool from '../db/connection';

describe('walking-skeleton service (export sanity)', () => {
  it('exports the 8 required public async functions', () => {
    expect(typeof validateLicense).toBe('function');
    expect(typeof upsertAgentByHeartbeat).toBe('function');
    expect(typeof bindFolder).toBe('function');
    expect(typeof createPublishTask).toBe('function');
    expect(typeof submitPublishReceipt).toBe('function');
    expect(typeof getPublishTask).toBe('function');
    expect(typeof getQueuedTasks).toBe('function');
    expect(typeof findAgentById).toBe('function');
  });
});

describe('getQueuedTasks (WS2 Sprint 2.1a transport patch)', () => {
  beforeEach(() => {
    (pool.query as any).mockReset();
  });

  it('returns rows with type field selected from publish_tasks', async () => {
    (pool.query as any).mockResolvedValueOnce({
      rows: [
        {
          id: 'task-1',
          agent_id: 'agent-1',
          platform: 'douyin',
          status: 'pending',
          type: 'video',
          folder_path: '/tmp/x',
          result: null,
          receipt_at: null,
          created_at: '2026-05-08T00:00:00Z',
        },
      ],
    });

    const rows = await getQueuedTasks('agent-1');

    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('video');
  });

  it('SELECT statement includes type column', async () => {
    (pool.query as any).mockResolvedValueOnce({ rows: [] });

    await getQueuedTasks('agent-1');

    expect((pool.query as any)).toHaveBeenCalledTimes(1);
    const sql = (pool.query as any).mock.calls[0][0] as string;
    expect(sql).toMatch(/SELECT[\s\S]*\btype\b/);
    expect(sql).toMatch(/FROM zenithjoy\.publish_tasks/);
  });
});
