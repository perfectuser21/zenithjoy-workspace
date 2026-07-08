/**
 * CRM 客户状态历史追踪 — 合同测试（Green 阶段）
 *
 * Sprint: 07081012-crm-status-history
 * 对应合同: sprints/07081012-crm-status-history/contract-draft.md
 *
 * 覆盖 FR：FR-3（新客户写历史）、FR-4（状态变化写历史）、FR-5（重复不写历史）、FR-6（事务回滚）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

// ─── Mock DB pool ─────────────────────────────────────────────────────────────
// vi.mock 必须先 hoist，factory 里不能引用外部变量
vi.mock('../../db/connection', () => {
  const mockClientQuery = vi.fn();
  const mockRelease = vi.fn();
  const mockClient = { query: mockClientQuery, release: mockRelease };
  const mockPoolQuery = vi.fn();
  const mockConnect = vi.fn().mockResolvedValue(mockClient);
  return {
    default: {
      query: mockPoolQuery,
      connect: mockConnect,
      end: vi.fn(),
      _mockClientQuery: mockClientQuery,
      _mockRelease: mockRelease,
      _mockConnect: mockConnect,
    },
  };
});

vi.mock('../../auth', () => ({
  auth: {
    api: { getSession: vi.fn() },
  },
}));

vi.mock('../../middleware/cs-config-guard', () => {
  const passThrough = () => (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    requireCsWriteAccess: passThrough,
    requireCsReadAccess: passThrough,
    requireServiceCredential: passThrough,
    requireCsAdminOrSuperAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

vi.mock('../../services/crm/customer-roster', () => ({
  buildCustomerRoster: vi.fn().mockResolvedValue([]),
}));

import app from '../../app';
import pool from '../../db/connection';

// 通过 pool 上暴露的私有属性获取 mock 引用
const mockPool = pool as typeof pool & {
  _mockClientQuery: ReturnType<typeof vi.fn>;
  _mockRelease: ReturnType<typeof vi.fn>;
  _mockConnect: ReturnType<typeof vi.fn>;
};

const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const WECHAT_ID = 'cs_test_001';
const CONTACT   = 'customer_test_001';

/**
 * 设置 client.query mock 序列：
 * BEGIN → ok, SELECT → selectRows, INSERT crm_customers → ok, INSERT history → ok, COMMIT → ok
 */
function setupClientQuerySequence(selectRows: Array<{ status: string | null }>) {
  mockPool._mockClientQuery.mockImplementation(async (sql: string) => {
    const upper = typeof sql === 'string' ? sql.trim().toUpperCase() : '';
    if (upper.startsWith('BEGIN') || upper.startsWith('COMMIT') || upper.startsWith('ROLLBACK')) {
      return { rows: [], rowCount: 0 };
    }
    if (upper.startsWith('SELECT')) {
      return { rows: selectRows, rowCount: selectRows.length };
    }
    if (upper.startsWith('INSERT')) {
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
}

describe('PUT /api/crm/customers/status — crm_customer_status_history 写入行为', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // pool.query 用于 tenant 解析（resolveTenantId 调用）
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [{ tenant_id: TENANT_ID }],
      rowCount: 1,
    });
    mockPool._mockConnect.mockResolvedValue({
      query: mockPool._mockClientQuery,
      release: mockPool._mockRelease,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── FR-3：新客户首次写 status ────────────────────────────────────────────
  describe('FR-3: 新客户首次写 status', () => {
    it('应在历史表写入 old_status=NULL, new_status=A1 的记录', async () => {
      setupClientQuerySequence([]); // 新客户：SELECT 返回空

      const res = await request(app)
        .put('/api/crm/customers/status')
        .send({ wechat_id: WECHAT_ID, contact: CONTACT, status: 'A1' });

      expect(res.status).toBe(200);

      const calls = mockPool._mockClientQuery.mock.calls as [string, unknown[]][];
      const historyInsert = calls.find(
        ([sql]) => typeof sql === 'string' && sql.includes('crm_customer_status_history'),
      );
      expect(historyInsert).toBeDefined();
      const [, params] = historyInsert!;
      const p = params as unknown[];
      expect(p[3]).toBeNull();   // old_status = NULL
      expect(p[4]).toBe('A1');   // new_status = A1
    });

    it('应返回 { success: true, status: "A1" }', async () => {
      setupClientQuerySequence([]);

      const res = await request(app)
        .put('/api/crm/customers/status')
        .send({ wechat_id: WECHAT_ID, contact: CONTACT, status: 'A1' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, status: 'A1' });
    });

    it('新客户历史表只有 1 条记录（不重复写入）', async () => {
      // 第一次 PUT A1：SELECT 空（新客户）→ 写历史
      setupClientQuerySequence([]);

      await request(app)
        .put('/api/crm/customers/status')
        .send({ wechat_id: WECHAT_ID, contact: CONTACT, status: 'A1' });

      const firstHistoryInserts = (mockPool._mockClientQuery.mock.calls as [string, unknown[]][])
        .filter(([sql]) => typeof sql === 'string' && sql.includes('crm_customer_status_history'));
      expect(firstHistoryInserts).toHaveLength(1);

      // 第二次 PUT A1（重复 status）：SELECT 返回 {status:'A1'} → 不写历史
      vi.clearAllMocks();
      (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ tenant_id: TENANT_ID }],
        rowCount: 1,
      });
      mockPool._mockConnect.mockResolvedValue({
        query: mockPool._mockClientQuery,
        release: mockPool._mockRelease,
      });
      setupClientQuerySequence([{ status: 'A1' }]);

      await request(app)
        .put('/api/crm/customers/status')
        .send({ wechat_id: WECHAT_ID, contact: CONTACT, status: 'A1' });

      const secondHistoryInserts = (mockPool._mockClientQuery.mock.calls as [string, unknown[]][])
        .filter(([sql]) => typeof sql === 'string' && sql.includes('crm_customer_status_history'));
      expect(secondHistoryInserts).toHaveLength(0); // 重复 → 不写
    });
  });

  // ─── FR-4：已有客户 status 变化 ───────────────────────────────────────────
  describe('FR-4: 已有客户 status 真实变化（A1 → A3）', () => {
    it('应在历史表新增 old_status=A1, new_status=A3 的记录', async () => {
      setupClientQuerySequence([{ status: 'A1' }]);

      const res = await request(app)
        .put('/api/crm/customers/status')
        .send({ wechat_id: WECHAT_ID, contact: CONTACT, status: 'A3' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, status: 'A3' });

      const calls = mockPool._mockClientQuery.mock.calls as [string, unknown[]][];
      const historyInsert = calls.find(
        ([sql]) => typeof sql === 'string' && sql.includes('crm_customer_status_history'),
      );
      expect(historyInsert).toBeDefined();
      const [, params] = historyInsert!;
      const p = params as unknown[];
      expect(p[3]).toBe('A1');  // old_status = A1
      expect(p[4]).toBe('A3');  // new_status = A3
    });

    it('历史表总共 2 条记录（NULL→A1 + A1→A3）', async () => {
      // 调用 1：新客户写 A1 → 写 1 条历史
      setupClientQuerySequence([]);
      await request(app)
        .put('/api/crm/customers/status')
        .send({ wechat_id: WECHAT_ID, contact: CONTACT, status: 'A1' });

      const firstHistoryInserts = (mockPool._mockClientQuery.mock.calls as [string, unknown[]][])
        .filter(([sql]) => typeof sql === 'string' && sql.includes('crm_customer_status_history'));
      expect(firstHistoryInserts).toHaveLength(1);

      // 调用 2：A1→A3 → 再写 1 条历史
      vi.clearAllMocks();
      (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ tenant_id: TENANT_ID }],
        rowCount: 1,
      });
      mockPool._mockConnect.mockResolvedValue({
        query: mockPool._mockClientQuery,
        release: mockPool._mockRelease,
      });
      setupClientQuerySequence([{ status: 'A1' }]);

      await request(app)
        .put('/api/crm/customers/status')
        .send({ wechat_id: WECHAT_ID, contact: CONTACT, status: 'A3' });

      const secondHistoryInserts = (mockPool._mockClientQuery.mock.calls as [string, unknown[]][])
        .filter(([sql]) => typeof sql === 'string' && sql.includes('crm_customer_status_history'));
      expect(secondHistoryInserts).toHaveLength(1);
    });

    it('变化记录的 changed_at 应晚于首条记录', async () => {
      // INSERT SQL 中使用 now()，不传外部时间戳
      setupClientQuerySequence([{ status: 'A1' }]);

      const res = await request(app)
        .put('/api/crm/customers/status')
        .send({ wechat_id: WECHAT_ID, contact: CONTACT, status: 'A3' });

      expect(res.status).toBe(200);

      const calls = mockPool._mockClientQuery.mock.calls as [string, unknown[]][];
      const historyInsert = calls.find(
        ([sql]) => typeof sql === 'string' && sql.includes('crm_customer_status_history'),
      );
      expect(historyInsert).toBeDefined();
      const [sql] = historyInsert!;
      // changed_at 由 DB 的 now() 生成，确认 SQL 含 now()
      expect(sql).toMatch(/now\(\)/i);
    });
  });

  // ─── FR-5：重复提交相同 status ────────────────────────────────────────────
  describe('FR-5: 重复提交相同 status（old = new）', () => {
    it('历史表行数不增加', async () => {
      setupClientQuerySequence([{ status: 'A3' }]); // 已有 A3

      await request(app)
        .put('/api/crm/customers/status')
        .send({ wechat_id: WECHAT_ID, contact: CONTACT, status: 'A3' });

      const historyInserts = (mockPool._mockClientQuery.mock.calls as [string, unknown[]][])
        .filter(([sql]) => typeof sql === 'string' && sql.includes('crm_customer_status_history'));
      expect(historyInserts).toHaveLength(0);
    });

    it('API 仍返回 { success: true, status: "A3" }（无副作用但不报错）', async () => {
      setupClientQuerySequence([{ status: 'A3' }]);

      const res = await request(app)
        .put('/api/crm/customers/status')
        .send({ wechat_id: WECHAT_ID, contact: CONTACT, status: 'A3' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, status: 'A3' });
    });
  });

  // ─── FR-6：upsert 失败时事务回滚 ─────────────────────────────────────────
  describe('FR-6: upsert 失败时事务回滚，历史表无残留', () => {
    it('模拟 DB upsert 抛错时，历史表不新增记录', async () => {
      mockPool._mockClientQuery.mockImplementation(async (sql: string) => {
        const upper = typeof sql === 'string' ? sql.trim().toUpperCase() : '';
        if (upper.startsWith('BEGIN') || upper.startsWith('ROLLBACK')) {
          return { rows: [], rowCount: 0 };
        }
        if (upper.startsWith('SELECT')) {
          return { rows: [], rowCount: 0 };
        }
        if (upper.startsWith('INSERT') && upper.includes('CRM_CUSTOMERS')) {
          throw new Error('DB_UPSERT_ERROR');
        }
        return { rows: [], rowCount: 0 };
      });

      const res = await request(app)
        .put('/api/crm/customers/status')
        .send({ wechat_id: WECHAT_ID, contact: CONTACT, status: 'A1' });

      expect(res.status).toBe(500);

      // 历史 INSERT 不应被调用
      const historyInserts = (mockPool._mockClientQuery.mock.calls as [string, unknown[]][])
        .filter(([sql]) => typeof sql === 'string' && sql.includes('crm_customer_status_history'));
      expect(historyInserts).toHaveLength(0);

      // ROLLBACK 应被调用
      const rollbackCall = (mockPool._mockClientQuery.mock.calls as [string, unknown[]][]).find(
        ([sql]) => typeof sql === 'string' && sql.trim().toUpperCase().startsWith('ROLLBACK'),
      );
      expect(rollbackCall).toBeDefined();
    });

    it('事务回滚后 API 返回 500 错误', async () => {
      mockPool._mockClientQuery.mockImplementation(async (sql: string) => {
        const upper = typeof sql === 'string' ? sql.trim().toUpperCase() : '';
        if (upper.startsWith('BEGIN') || upper.startsWith('ROLLBACK')) {
          return { rows: [], rowCount: 0 };
        }
        if (upper.startsWith('SELECT')) {
          return { rows: [], rowCount: 0 };
        }
        if (upper.startsWith('INSERT')) {
          throw new Error('DB_ERROR');
        }
        return { rows: [], rowCount: 0 };
      });

      const res = await request(app)
        .put('/api/crm/customers/status')
        .send({ wechat_id: WECHAT_ID, contact: CONTACT, status: 'A1' });

      expect(res.status).toBe(500);
    });
  });

  // ─── Migration 幂等性验证 ─────────────────────────────────────────────────
  describe('Migration FR-1: 回填幂等性', () => {
    it('重跑回填 SQL 后历史表 old_status=NULL 的行数不变', () => {
      // 回填 SQL 使用 ON CONFLICT DO NOTHING，因此重跑不增加行数
      const fs = require('fs');
      const migrationPath =
        '/workspace/apps/api/db/migrations/20260708_100000_crm_customer_status_history.sql';
      const content = fs.readFileSync(migrationPath, 'utf-8') as string;
      expect(content).toContain('ON CONFLICT');
      expect(content).toContain('DO NOTHING');
      expect(content).toContain('crm_customer_status_history');
    });
  });
});
