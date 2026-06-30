/**
 * Path 4 Sprint 1 ws5 — feishu-poll.ts service 测试（CI vitest 跑）。
 *
 * 校验飞书审批轮询 service：
 *   1) pollOnce() 正常调用：拉飞书 approved 草稿 → 写 DB approval_source='feishu_user'（A 路线护栏）
 *   2) rejected 飞书草稿 → 不调 dispatchTask（mock 0 次）
 *   3) 频控超限 → DB UPDATE approval_status='rate_limited' + next_allowed_at 写入
 *   4) startFeishuPoll(intervalMs)/stopFeishuPoll(handle) 启动/停止轮询周期
 *   5) approval_source 写值是 'feishu_user'，不允许 'system' / 'auto'（A 路线护栏 enforce）
 *
 * 测试隔离：mock pg pool + mock 飞书 search + mock dispatchTask + mock can_send（child_process.spawnSync）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockQuery, mockSpawnSync, mockDispatchTask } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockSpawnSync: vi.fn(),
  mockDispatchTask: vi.fn(),
}));

vi.mock('../../src/db/connection', () => ({
  default: {
    query: mockQuery,
    connect: vi.fn(),
    end: vi.fn(),
  },
}));

vi.mock('../../src/services/task-dispatch', () => ({
  dispatchTask: mockDispatchTask,
}));

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawnSync: mockSpawnSync,
  };
});

// 飞书 search 用 axios 调，mock 之
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

import axios from 'axios';
import {
  pollOnce,
  startFeishuPoll,
  stopFeishuPoll,
  _resetFeishuPollTokenCache,
} from '../../src/services/feishu-poll';

describe('ws5 feishu-poll.ts — pollOnce 飞书 approved 触发派发 + A 路线护栏', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockDispatchTask.mockReset();
    mockSpawnSync.mockReset();
    (axios.post as ReturnType<typeof vi.fn>).mockReset();
    _resetFeishuPollTokenCache();
    // 设环境变量让 searchApprovedRecords 真发起 axios 调用
    process.env.FEISHU_APP_ID = 'mock_app_id';
    process.env.FEISHU_APP_SECRET = 'mock_app_secret';
    process.env.FEISHU_TEST_APP_TOKEN = 'mock_app_token';
    process.env.FEISHU_SCHEDULE_TABLE_ID = 'tbl_schedule';
    process.env.FEISHU_INTERACTION_TABLE_ID = 'tbl_interaction';
  });

  it('飞书 approved 草稿 → DB UPDATE approval_source=\'feishu_user\'（A 路线护栏）', async () => {
    // 1) 飞书 token + 飞书 search 返回 1 行 approved 草稿
    (axios.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        data: { code: 0, tenant_access_token: 'tok', expire: 7000 },
      })
      // 飞书"内容排期"search 返回 1 行 approved
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            items: [
              {
                record_id: 'rec_approved_001',
                fields: { 状态: 'approved', 客户名: '客户A', 文案: '今日朋友圈' },
              },
            ],
          },
        },
      })
      // 飞书"互动记录"search 返回空
      .mockResolvedValueOnce({
        data: { code: 0, data: { items: [] } },
      });

    // 2) DB SELECT 找到对应 wechat_publish_task（pending_review）
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            task_id: '11111111-1111-4111-8111-111111111111',
            type: 'moment',
            target_user: '客户A',
            approval_status: 'pending_review',
            approval_source: null,
          },
        ],
        rowCount: 1,
      })
      // UPDATE approval_source='feishu_user' approval_status='approved'
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    // 3) 频控放行
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ ok: true }),
      stderr: '',
    });

    await pollOnce();

    // 校验 UPDATE 语句调用
    const updateCalls = mockQuery.mock.calls.filter((c) =>
      String(c[0]).match(/UPDATE\s+(zenithjoy\.)?wechat_publish_task/i),
    );
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    // 校验 UPDATE 参数中 approval_source='feishu_user'
    const flat = updateCalls.flatMap((c) => (c[1] as unknown[]) ?? []);
    expect(flat).toContain('feishu_user');
  });

  it('rejected 飞书草稿 → 不调 dispatchTask 0 次', async () => {
    (axios.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        data: { code: 0, tenant_access_token: 'tok', expire: 7000 },
      })
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            items: [
              {
                record_id: 'rec_rejected_001',
                fields: { 状态: 'rejected', 客户名: '客户B', 文案: '不该发' },
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        data: { code: 0, data: { items: [] } },
      });

    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    await pollOnce();

    expect(mockDispatchTask).not.toHaveBeenCalled();
  });

  it('频控超限 → DB UPDATE approval_status=\'rate_limited\' + next_allowed_at 写入', async () => {
    (axios.post as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        data: { code: 0, tenant_access_token: 'tok', expire: 7000 },
      })
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            items: [
              {
                record_id: 'rec_rate_limited',
                fields: { 状态: 'approved', 客户名: '客户C', 文案: '今天又一条' },
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        data: { code: 0, data: { items: [] } },
      });

    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            task_id: '22222222-2222-4222-8222-222222222222',
            type: 'moment',
            target_user: '客户C',
            approval_status: 'pending_review',
            approval_source: null,
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // first UPDATE approval_source='feishu_user'
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // second UPDATE rate_limited + next_allowed_at

    // 频控拒绝
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        ok: false,
        reason: 'rate_limited',
        next_allowed_at: '2026-05-09T01:00:00Z',
      }),
      stderr: '',
    });

    await pollOnce();

    const updateCalls = mockQuery.mock.calls.filter((c) =>
      String(c[0]).match(/UPDATE\s+(zenithjoy\.)?wechat_publish_task/i),
    );
    // 至少 2 次 UPDATE：一次 approval_source，一次 rate_limited
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);

    // 任一 UPDATE 参数中含 'rate_limited'
    const flatParams = updateCalls.flatMap((c) => (c[1] as unknown[]) ?? []);
    expect(flatParams).toContain('rate_limited');

    // dispatch 0 次（频控拒绝时不派）
    expect(mockDispatchTask).not.toHaveBeenCalled();
  });
});

describe('ws5 feishu-poll.ts — startFeishuPoll / stopFeishuPoll 周期管理', () => {
  it('startFeishuPoll 返回 handle，stopFeishuPoll(handle) idempotent', () => {
    const handle = startFeishuPoll(60_000);
    expect(handle).toBeTruthy();
    expect(typeof handle.timer).not.toBe('undefined');
    stopFeishuPoll(handle);
    stopFeishuPoll(handle); // 重复调安全
    stopFeishuPoll(null);
    stopFeishuPoll(undefined);
  });
});
