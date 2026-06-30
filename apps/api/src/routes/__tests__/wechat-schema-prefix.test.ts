/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 回归测试：routes/wechat.ts 中所有对 zenithjoy schema 业务表的 SQL 必须带 `zenithjoy.` 前缀。
 *
 * 根因（decision 705e8443）：pg pool 没设 search_path，默认走 public schema；
 * wechat.ts 的以下 SQL 裸表名会报 "relation does not exist"：
 *   - INSERT INTO wechat_publish_task              (line ~151)
 *   - SELECT ... FROM wechat_publish_task          (line ~197)
 *   - SELECT ... FROM agent_platform_sessions      (line ~272)
 *
 * 已在迁移文件中确认 wechat_publish_task/agent_platform_sessions 均属 zenithjoy schema。
 *
 * 修复前：裸表名 → 测试红
 * 修复后：zenithjoy.表名 → 测试绿
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../../db/connection', () => ({
  default: { query: mockQuery, connect: vi.fn(), end: vi.fn() },
}));

vi.mock('../../services/wechat-draft', () => ({
  generateChatDraft: vi.fn().mockResolvedValue({ task_id: 'mock_task', draft_id: 'mock_draft', status: 'pending' }),
  generateMomentDraft: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('../../services/wechat-heartbeat', () => ({
  recordHeartbeat: vi.fn().mockReturnValue({ ts: Date.now() }),
  listHeartbeats: vi.fn().mockReturnValue([]),
  startStaleListenerMonitor: vi.fn(),
}));

vi.mock('../../services/wechat/cs-outbound', () => ({
  enqueueFailureAlert: vi.fn().mockResolvedValue({ enqueued: true }),
  listPendingOutbound: vi.fn().mockResolvedValue([]),
  markOutboundReceipt: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../services/wechat/cs-work-stats', () => ({
  getCsWorkStats: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../services/wechat/cs-daily-report', () => ({
  runDailyReportSettlement: vi.fn().mockResolvedValue({ settled: 0 }),
  getDailyReports: vi.fn().mockResolvedValue([]),
}));

/** 收集所有被 pool.query 接收到的 SQL 文本 */
function capturedSqls(): string[] {
  return (mockQuery.mock.calls as any[][]).map((c) => String(c[0]));
}

describe('routes/wechat.ts — SQL schema 前缀回归 [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it('POST /api/wechat/qr-bind 的 INSERT 必须用 zenithjoy.wechat_publish_task（不允许裸表名）', async () => {
    await request(app)
      .post('/api/wechat/qr-bind')
      .send({ platform: 'wechat_personal', agent_id: 'agent_test_001' });

    const sqls = capturedSqls();
    const insertSqls = sqls.filter((s) => /INSERT\s+INTO/i.test(s) && /wechat_publish_task/i.test(s));
    expect(insertSqls.length, 'qr-bind 应执行 INSERT INTO wechat_publish_task').toBeGreaterThan(0);
    for (const sql of insertSqls) {
      expect(sql, `INSERT 必须带 zenithjoy. 前缀: «${sql.slice(0, 80)}»`).toMatch(
        /INSERT\s+INTO\s+zenithjoy\.wechat_publish_task/i,
      );
    }
  });

  it('POST /api/wechat/scheduler-tick 的 FROM agent_platform_sessions 必须带 zenithjoy. 前缀', async () => {
    await request(app)
      .post('/api/wechat/scheduler-tick')
      .send({ tenant_id: 'tenant_test_001' });

    const sqls = capturedSqls();
    const apsSqls = sqls.filter((s) => /agent_platform_sessions/i.test(s));
    expect(apsSqls.length, 'scheduler-tick 应查询 agent_platform_sessions').toBeGreaterThan(0);
    for (const sql of apsSqls) {
      expect(sql, `agent_platform_sessions 必须带 zenithjoy. 前缀: «${sql.slice(0, 80)}»`).toMatch(
        /zenithjoy\.agent_platform_sessions/i,
      );
    }
  });
});
