/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Line04 CRM 地基 Track C — friend-scan ingest 收 wechat_id + add_friend_time（钉死契约）
 *
 * agent 扫好友上报时，除昵称/最后消息外还能带「客户微信号」+「加微信时间」，upsert 落 crm_customers。
 * 本测试钉死：
 *   1. ingest 接受 contacts[].wechat_id + contacts[].add_friend_time，upsert SQL 含这两列、绑定到入参值。
 *   2. 冲突路径 COALESCE 保留已有非空（不被本次 null 覆盖）。
 *
 * Mock：pool.query（resolveServiceWriteTenant 反查租户）+ pool.connect（事务 client）+ 鉴权中间件。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockQuery, mockConnect } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockConnect: vi.fn(),
}));

vi.mock('../db/connection', () => ({
  default: { query: mockQuery, connect: mockConnect, end: vi.fn() },
}));

vi.mock('../middleware/cs-config-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/cs-config-guard')>();
  const inject = (req: any, _res: any, next: any) => {
    const t = req.headers['x-test-tenant-id'];
    if (typeof t === 'string' && t.length > 0) req.tenantId = t;
    return next();
  };
  return {
    ...actual,
    requireCsReadAccess: inject,
    requireCsWriteAccess: () => inject,
    requireServiceCredential: inject,
  };
});

import crmRouter from './crm';

const TENANT = 'aaaaaaaa-1111-2222-3333-444444444444';
const CS = 'cs-ingest-test';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/crm', crmRouter);
  return app;
}

// 事务 client：记录每次 query（sql + params），upsert RETURNING inserted=true，其余返回空。
function makeClient(calls: Array<{ sql: string; params: unknown[] }>) {
  return {
    query: vi.fn().mockImplementation((sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      if (/INSERT INTO zenithjoy\.crm_customers/i.test(sql)) {
        return Promise.resolve({ rows: [{ inserted: true }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    }),
    release: vi.fn(),
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
});

describe('POST /api/crm/friend-scan/ingest — 收 wechat_id + add_friend_time（地基 Track C）', () => {
  it('upsert SQL 含 wechat_id + add_friend_time 列，且绑定到入参值', async () => {
    // resolveServiceWriteTenant：cs_wechat_id 反查租户（=本租户）
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT }], rowCount: 1 } as any);
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    mockConnect.mockResolvedValue(makeClient(calls) as any);

    const app = buildApp();
    const r = await request(app)
      .post('/api/crm/friend-scan/ingest')
      .set('x-test-tenant-id', TENANT)
      .send({
        cs_wechat_id: CS,
        contacts: [
          { name: '新客户', wechat_id: 'wx_new_001', add_friend_time: '2026-06-25T03:00:00.000Z', last_message: '在吗' },
        ],
      });

    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.ingested).toBe(1);

    const upsert = calls.find((c) => /INSERT INTO zenithjoy\.crm_customers/i.test(c.sql));
    expect(upsert).toBeDefined();
    // 列名出现在 SQL（INSERT 列 + COALESCE 更新）
    expect(upsert!.sql).toContain('wechat_id');
    expect(upsert!.sql).toContain('add_friend_time');
    expect(upsert!.sql).toMatch(/COALESCE\(EXCLUDED\.wechat_id/i);
    expect(upsert!.sql).toMatch(/COALESCE\(EXCLUDED\.add_friend_time/i);
    // 入参值绑定进去了
    expect(upsert!.params).toContain('wx_new_001');
    expect(upsert!.params).toContain('2026-06-25T03:00:00.000Z');
  });

  it('contacts 项缺 wechat_id/add_friend_time → 绑定 null（不报错）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT }], rowCount: 1 } as any);
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    mockConnect.mockResolvedValue(makeClient(calls) as any);

    const app = buildApp();
    const r = await request(app)
      .post('/api/crm/friend-scan/ingest')
      .set('x-test-tenant-id', TENANT)
      .send({ cs_wechat_id: CS, contacts: [{ name: '只有名字' }] });

    expect(r.status).toBe(200);
    const upsert = calls.find((c) => /INSERT INTO zenithjoy\.crm_customers/i.test(c.sql));
    expect(upsert).toBeDefined();
    // 缺省字段绑 null（params 里出现 null）
    expect(upsert!.params).toContain(null);
  });
});
