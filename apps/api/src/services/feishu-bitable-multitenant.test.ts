import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({
  default: { query: vi.fn() },
}));

vi.mock('axios');

vi.mock('./feishu-token', () => ({
  getValidToken: vi.fn().mockResolvedValue('fake-token'),
}));

import pool from '../db/connection';
import axios from 'axios';
import { pushWechatTaskToFeishu } from './feishu-bitable-multitenant';

describe('pushWechatTaskToFeishu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tenant 不存在时静默返回 undefined（不抛出）', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });
    await expect(pushWechatTaskToFeishu('no-task', 'no-tenant')).resolves.toBeUndefined();
  });

  it('DB 报错时静默返回 undefined（吞异常保护主流程）', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB_DOWN'));
    await expect(pushWechatTaskToFeishu('t1', 'tenant1')).resolves.toBeUndefined();
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

    await pushWechatTaskToFeishu('task-uuid', 'tenant-uuid');

    const postCall = (axios.post as ReturnType<typeof vi.fn>).mock.calls[0];
    const fields = postCall[1].fields as Record<string, string>;
    expect(fields['任务ID']).toBe('task-uuid');
    expect(fields['审批状态']).toBe('待审批');
  });
});
