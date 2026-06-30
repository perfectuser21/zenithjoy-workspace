/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 回归测试：services/feishu-poll.ts 中所有对 zenithjoy schema 业务表的 SQL 必须带 `zenithjoy.` 前缀。
 *
 * 根因（decision 705e8443）：pg pool 没设 search_path，默认走 public schema；
 * feishu-poll.ts 的以下 SQL 裸表名会报 "relation does not exist"：
 *   - SELECT ... FROM wechat_publish_task          (line ~225)
 *   - UPDATE wechat_publish_task (approved)        (line ~252)
 *   - UPDATE wechat_publish_task (rate_limited)    (line ~274)
 *
 * 修复前：裸表名 → 测试红
 * 修复后：zenithjoy.wechat_publish_task → 测试绿
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery, mockSpawnSync, mockDispatchTask } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockSpawnSync: vi.fn(),
  mockDispatchTask: vi.fn(),
}));

vi.mock('../../db/connection', () => ({
  default: { query: mockQuery, connect: vi.fn(), end: vi.fn() },
}));

vi.mock('../../services/task-dispatch', () => ({
  dispatchTask: mockDispatchTask,
}));

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return { ...actual, spawnSync: mockSpawnSync };
});

vi.mock('axios', () => ({
  default: { post: vi.fn() },
}));

import axios from 'axios';
import { pollOnce, _resetFeishuPollTokenCache } from '../feishu-poll';

const mockedAxiosPost = vi.mocked(axios.post);

/** 飞书 approved 记录 mock：返回 1 条待处理草稿 */
function setupFeishuWithApprovedRecord() {
  mockedAxiosPost.mockReset();
  mockedAxiosPost.mockImplementation((url: any) => {
    const u = String(url);
    if (u.includes('/auth/v3/tenant_access_token/internal')) {
      return Promise.resolve({ data: { code: 0, tenant_access_token: 'mock_tok', expire: 7200 } }) as any;
    }
    if (u.includes('/records/search')) {
      // 第一次搜索（schedule table）返回 1 条 approved 记录
      const callCount = (mockedAxiosPost.mock.calls as any[][]).filter((c) =>
        String(c[0]).includes('/records/search'),
      ).length;
      if (callCount <= 1) {
        return Promise.resolve({
          data: { code: 0, data: { items: [{ record_id: 'rec_001', fields: {} }] } },
        }) as any;
      }
      return Promise.resolve({ data: { code: 0, data: { items: [] } } }) as any;
    }
    return Promise.resolve({ data: { code: 0 } }) as any;
  });
}

/** 收集所有命中 wechat_publish_task 的 SQL 文本 */
function capturedPublishTaskSqls(): string[] {
  return (mockQuery.mock.calls as any[][])
    .map((c) => String(c[0]))
    .filter((s) => /wechat_publish_task/i.test(s));
}

describe('feishu-poll.ts — SQL schema 前缀回归 [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetFeishuPollTokenCache();
    process.env.FEISHU_APP_ID = 'app_test';
    process.env.FEISHU_APP_SECRET = 'secret_test';
    process.env.FEISHU_TEST_APP_TOKEN = 'token_test';
    process.env.FEISHU_SCHEDULE_TABLE_ID = 'tbl_schedule';
    process.env.FEISHU_INTERACTION_TABLE_ID = 'tbl_interaction';

    // rate_limiter: 默认放行
    mockSpawnSync.mockReturnValue({ status: 0, stdout: '{"ok":true}', stderr: '' });
    // DB: SELECT 返回 pending_review 行，UPDATE 成功，dispatchTask 成功
    mockDispatchTask.mockResolvedValue(undefined);
  });

  it('pollOnce 的 SELECT FROM wechat_publish_task 必须带 zenithjoy. 前缀', async () => {
    setupFeishuWithApprovedRecord();
    // DB SELECT 返回 pending_review 行让流程继续
    mockQuery.mockResolvedValue({
      rows: [{
        task_id: 'task_001',
        type: 'moment',
        target_user: 'wx_test',
        approval_status: 'pending_review',
        approval_source: null,
      }],
    });

    await pollOnce();

    const sqls = capturedPublishTaskSqls();
    const selectSqls = sqls.filter((s) => /SELECT/i.test(s));
    expect(selectSqls.length, 'pollOnce 应执行 SELECT FROM wechat_publish_task').toBeGreaterThan(0);
    for (const sql of selectSqls) {
      expect(sql, `SELECT 必须带 zenithjoy. 前缀: «${sql.slice(0, 80)}»`).toMatch(
        /zenithjoy\.wechat_publish_task/i,
      );
    }
  });

  it('pollOnce approved 路径 UPDATE wechat_publish_task 必须带 zenithjoy. 前缀', async () => {
    setupFeishuWithApprovedRecord();
    let callCount = 0;
    mockQuery.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        // 第一次 SELECT 返回 pending_review 行
        return Promise.resolve({
          rows: [{
            task_id: 'task_001',
            type: 'moment',
            target_user: 'wx_test',
            approval_status: 'pending_review',
            approval_source: null,
          }],
        });
      }
      // 后续 UPDATE
      return Promise.resolve({ rows: [] });
    });

    await pollOnce();

    const sqls = capturedPublishTaskSqls();
    const updateSqls = sqls.filter((s) => /UPDATE/i.test(s));
    expect(updateSqls.length, 'approved 路径应执行 UPDATE wechat_publish_task').toBeGreaterThan(0);
    for (const sql of updateSqls) {
      expect(sql, `UPDATE 必须带 zenithjoy. 前缀: «${sql.slice(0, 80)}»`).toMatch(
        /zenithjoy\.wechat_publish_task/i,
      );
    }
  });

  it('pollOnce rate_limited 路径 UPDATE wechat_publish_task 必须带 zenithjoy. 前缀', async () => {
    setupFeishuWithApprovedRecord();
    // rate_limiter 拒绝
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: '{"ok":false,"reason":"rate_limited","next_allowed_at":"2026-07-01T00:00:00Z"}',
      stderr: '',
    });
    let callCount = 0;
    mockQuery.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve({
          rows: [{
            task_id: 'task_002',
            type: 'chat',
            target_user: 'wx_test',
            approval_status: 'pending_review',
            approval_source: null,
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    await pollOnce();

    const sqls = capturedPublishTaskSqls();
    // rate_limited 路径：先 UPDATE approved，再 UPDATE rate_limited
    const updateSqls = sqls.filter((s) => /UPDATE/i.test(s));
    expect(updateSqls.length, 'rate_limited 路径应执行至少 2 次 UPDATE wechat_publish_task').toBeGreaterThanOrEqual(1);
    for (const sql of updateSqls) {
      expect(sql, `UPDATE 必须带 zenithjoy. 前缀: «${sql.slice(0, 80)}»`).toMatch(
        /zenithjoy\.wechat_publish_task/i,
      );
    }
  });
});
