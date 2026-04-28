import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn() },
}));

import pool from '../../db/connection';
import { createTask, getTask, listTasks, startTask, finishTask, failTask } from '../task-db';

const mockQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

const fakeRow = {
  id: 'task-uuid', tenant_id: 'tid', agent_id: null, agent_text: null,
  skill: 'wechat_draft', params: { title: 'hi' }, status: 'pending',
  result: null, error: null, created_at: new Date(), started_at: null, finished_at: null,
};

describe('task-db', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createTask inserts and returns mapped task', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });
    const task = await createTask({ tenantId: 'tid', skill: 'wechat_draft', params: { title: 'hi' } });
    expect(task.id).toBe('task-uuid');
    expect(task.status).toBe('pending');
    expect(task.tenantId).toBe('tid');
  });

  it('getTask returns null when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const task = await getTask('no-id');
    expect(task).toBeNull();
  });

  it('listTasks returns mapped array', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow, fakeRow] });
    const tasks = await listTasks('tid');
    expect(tasks).toHaveLength(2);
    expect(tasks[0].tenantId).toBe('tid');
  });

  it('startTask updates to running status', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await startTask('task-uuid', 'my-agent-text');
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/running/);
  });

  it('finishTask updates to done status', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await finishTask('task-uuid', { ok: true });
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/done/);
  });

  it('failTask updates to failed status with error', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await failTask('task-uuid', 'something went wrong');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/failed/);
    expect(params).toContain('something went wrong');
  });
});
