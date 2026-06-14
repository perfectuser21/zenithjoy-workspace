/* eslint-disable @typescript-eslint/no-explicit-any -- vitest mock types require any cast */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// pool 是模块顶层 import，必须在导入 service 之前 mock
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockClient = {
  query: mockClientQuery,
  release: mockClientRelease,
};

vi.mock('../db/connection', () => {
  const query = vi.fn();
  const connect = vi.fn();
  return {
    default: { query, connect },
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
  ackPublishTask,
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

describe('ackPublishTask — qr_bind session upsert', () => {
  const TASK_ID = '00000000-0000-0000-0000-000000000001';
  const AGENT_ID = '00000000-0000-0000-0000-000000000002';
  const LICENSE_ID = 'lic-test-001';

  beforeEach(() => {
    (pool.query as any).mockReset();
    (pool.connect as any).mockReset();
    mockClientQuery.mockReset();
    mockClientRelease.mockReset();

    // pool.connect() → mock client
    (pool.connect as any).mockResolvedValue(mockClient);
    // client queries default to success
    mockClientQuery.mockResolvedValue({ rows: [] });
  });

  it('upserts agent_platform_sessions when qr_bind_douyin acked with success', async () => {
    // SELECT publish_tasks → task with platform=qr_bind_douyin
    (pool.query as any)
      .mockResolvedValueOnce({
        rows: [{ id: TASK_ID, agent_id: AGENT_ID, platform: 'qr_bind_douyin', result: null }],
      })
      // SELECT agents
      .mockResolvedValueOnce({
        rows: [{ id: AGENT_ID, license_id: LICENSE_ID }],
      });

    await ackPublishTask({ taskId: TASK_ID, licenseId: LICENSE_ID, result: 'success' });

    // Find the INSERT into agent_platform_sessions call
    const insertCall = mockClientQuery.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('agent_platform_sessions')
    );
    expect(insertCall).toBeDefined();
    const [sql, params] = insertCall as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO zenithjoy\.agent_platform_sessions/);
    expect(sql).toMatch(/ON CONFLICT.*DO UPDATE.*status\s*=\s*'active'/s);
    expect(params).toContain(AGENT_ID);
    expect(params).toContain('douyin');
  });

  it('does NOT upsert agent_platform_sessions when result is not success', async () => {
    (pool.query as any)
      .mockResolvedValueOnce({
        rows: [{ id: TASK_ID, agent_id: AGENT_ID, platform: 'qr_bind_douyin', result: null }],
      })
      .mockResolvedValueOnce({ rows: [{ id: AGENT_ID, license_id: LICENSE_ID }] });

    await ackPublishTask({ taskId: TASK_ID, licenseId: LICENSE_ID, result: 'timeout' });

    const insertCall = mockClientQuery.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('agent_platform_sessions')
    );
    expect(insertCall).toBeUndefined();
  });

  it('does NOT upsert agent_platform_sessions for non-qr_bind platforms', async () => {
    (pool.query as any)
      .mockResolvedValueOnce({
        rows: [{ id: TASK_ID, agent_id: AGENT_ID, platform: 'douyin', result: null }],
      })
      .mockResolvedValueOnce({ rows: [{ id: AGENT_ID, license_id: LICENSE_ID }] });

    await ackPublishTask({ taskId: TASK_ID, licenseId: LICENSE_ID, result: 'success' });

    const insertCall = mockClientQuery.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('agent_platform_sessions')
    );
    expect(insertCall).toBeUndefined();
  });
});

describe('HEARTBEAT_MODULES version gates', () => {
  it('line04-wechat-cs required_version should be 1.0.32 (DWM compositor cloak 彻底消除微信弹前台)', async () => {
    const { HEARTBEAT_MODULES } = await import('./walking-skeleton.service');
    expect(HEARTBEAT_MODULES['line04-wechat-cs'].required_version).toBe('1.0.32');
  });
});
