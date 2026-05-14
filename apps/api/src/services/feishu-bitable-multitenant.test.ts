import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

vi.mock('../db/connection', () => ({
  default: { query: vi.fn() },
}));

vi.mock('axios');

vi.mock('./feishu-token', () => ({
  getValidToken: vi.fn().mockResolvedValue('fake-token'),
}));

import pool from '../db/connection';
import axios from 'axios';

describe('feishu-bitable-multitenant placeholder', () => {
  it('exists — full coverage lives in sprints/path-2-sprint-a-feishu/tests/ws*/', () => {
    expect(true).toBe(true);
  });
});

describe('pushWechatTaskToFeishu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('pushWechatTaskToFeishu 是异步函数', async () => {
    const mod = await import('./feishu-bitable-multitenant');
    expect(mod.pushWechatTaskToFeishu).toBeInstanceOf(Function);
    const result = mod.pushWechatTaskToFeishu('task-id', 'tenant-id');
    expect(result).toBeInstanceOf(Promise);
    await result.catch(() => {});
  });

  it('失败时不抛出（吞异常保护主流程）', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB_DOWN'));
    const mod = await import('./feishu-bitable-multitenant');
    await expect(mod.pushWechatTaskToFeishu('t1', 'tenant1')).resolves.toBeUndefined();
  });

  it('调飞书 create_record 时 fields 含 任务ID 和 审批状态', async () => {
    (pool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        rows: [{
          id: 'task-uuid', content: 'hello world', task_type: 'moments',
          target_friend_alias: null, created_at: new Date('2026-05-14'),
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ app_token: 'apptkn', table_id_wechat_approval: 'tblWx' }],
      })
      .mockResolvedValueOnce({ rows: [] });

    (axios.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { code: 0, data: { record: { record_id: 'rec123' } } },
    });

    const mod = await import('./feishu-bitable-multitenant');
    await mod.pushWechatTaskToFeishu('task-uuid', 'tenant-uuid');

    const postCall = (axios.post as ReturnType<typeof vi.fn>).mock.calls[0];
    const fields = postCall[1].fields as Record<string, string>;
    expect(fields['任务ID']).toBe('task-uuid');
    expect(fields['审批状态']).toBe('待审批');
  });
});
