/**
 * TDD Red 阶段 — Line02 公司信息 + account-status API 测试
 *
 * 运行预期：公司信息路由 + line02/account-status 路由不存在时这些测试 FAIL。
 * 合约见 contract-dod.md [BEHAVIOR] Step1-a/b/c/d, Step2-a/b。
 *
 * Red 证据：supertest 收到 404（路由未注册）→ expect(res.status).toBe(200) FAIL
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import pool from '../../../apps/api/src/db/connection';

const TEST_TENANT = '2ac0aa4a-99f4-470a-aed7-c3a9fe03149b';
const OTHER_TENANT = '00000000-0000-0000-0000-000000000001';

vi.mock('../../../apps/api/src/db/connection', () => ({
  default: {
    query: vi.fn().mockImplementation(async (sql: string, args: any[]) => ({ rows: sql.includes('tenant_company_profiles') && args?.[0] === TEST_TENANT ? [{ company_id:'company-a',tenant_id:TEST_TENANT, company_name:'甲公司', config_version:1, config_status:'draft', config_owner:'', runtime_config:{},wiki:{},source_evidence:[] }] : [], rowCount:1 })),
    connect: vi.fn(),
  },
}));

vi.mock('../../../apps/api/src/middleware/tenant-context', () => ({
  tenantContext: (req: any, _res: any, next: any) => {
    req.tenantId = req.headers['x-test-tenant-id']; req.tenantRole='owner'; req.feishuUserId='actor'; next();
  },
  tenantContextOptional: (req: any, _res: any, next: any) => {
    const t = req.headers['x-tenant-id'] || req.headers['x-test-tenant-id'] || '';
    if (typeof t === 'string' && t.length > 0) req.tenantId = t;
    next();
  },
}));

beforeEach(() => { vi.mocked(pool.connect).mockResolvedValue({query:pool.query,release:vi.fn()} as any); });
async function buildApp() {
  const app = express();
  app.use(express.json());

  // 新路由：公司信息（这些路由在 Generator 实现之前不存在 → 测试 FAIL）
  try {
    const { companyProfileRouter } = await import(
      '../../../apps/api/src/routes/company-profile'
    );
    app.use('/api/company-profile', companyProfileRouter);
  } catch {
    // 路由不存在时继续（supertest 会收到 404）
  }

  // 新路由：line02 account-status
  try {
    const { line02Router } = await import('../../../apps/api/src/routes/line02');
    app.use('/api/line02', line02Router);
  } catch {
    // 路由不存在时继续
  }

  app.use((_req: any, res: any) => res.status(404).json({ error: 'not found' }));
  return app;
}

describe('GET /api/company-profile', () => {
  it('[Step1-b] 返回 200 + data.company_name 字段', async () => {
    const app = await buildApp();
    const res = await request(app)
      .get('/api/company-profile')
      .set('x-test-tenant-id', TEST_TENANT);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.company_name).toBe('string');
  });

  it('[Step1-c] 缺公司映射返回404明确错误', async () => {
    const app = await buildApp();
    const res = await request(app)
      .get('/api/company-profile')
      .set('x-test-tenant-id', OTHER_TENANT);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COMPANY_MAPPING_MISSING');
  });

  it('[Step1-b] data 包含 products / qa_list 数组字段', async () => {
    const app = await buildApp();
    const res = await request(app)
      .get('/api/company-profile')
      .set('x-test-tenant-id', TEST_TENANT);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.products)).toBe(true);
    expect(Array.isArray(res.body.data.qa_list)).toBe(true);
  });
});

describe('PUT /api/company-profile', () => {
  it('[Step1-a] 保存成功返回 200 + data.updated == true', async () => {
    const app = await buildApp();
    const res = await request(app)
      .put('/api/company-profile')
      .set('x-test-tenant-id', TEST_TENANT)
      .send({
        expected_version: 1,
        company_name: 'Smoke 公司',
        city: '西安',
        industry: '餐饮',
        description: '测试描述',
        products: ['测试产品'],
        key_advantages: ['测试优势'],
        customer_problem: '测试问题',
        customer_portrait: '25-35岁消费者',
        qa_list: [{ q: '问', a: '答' }],
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.updated).toBe(true);
    expect(res.body.data.config_version).toBe(2);
  });

  it('[Error-b] 缺 company_name 返回 400', async () => {
    const app = await buildApp();
    const res = await request(app)
      .put('/api/company-profile')
      .set('x-test-tenant-id', TEST_TENANT)
      .send({});
    expect(res.status).toBe(400);
  });

  it('[Step1-a] 禁用字段 ok/saved 不在 data 中', async () => {
    const app = await buildApp();
    const res = await request(app)
      .put('/api/company-profile')
      .set('x-test-tenant-id', TEST_TENANT)
      .send({ company_name: 'X', expected_version:1 });
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBeUndefined();
    expect(res.body.data.saved).toBeUndefined();
  });
});

describe('GET /api/line02/account-status', () => {
  it('[Step2-a] 返回 200 + data.accounts 数组', async () => {
    const app = await buildApp();
    const res = await request(app)
      .get('/api/line02/account-status')
      .set('X-Tenant-Id', TEST_TENANT);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.accounts)).toBe(true);
  });

  it('[Step2-a] data 顶层 keys 仅含 accounts', async () => {
    const app = await buildApp();
    const res = await request(app)
      .get('/api/line02/account-status')
      .set('X-Tenant-Id', TEST_TENANT);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data)).toEqual(['accounts']);
  });

  it('[Step2-b] 禁用字段 status/main_account 不在 data 顶层', async () => {
    const app = await buildApp();
    const res = await request(app)
      .get('/api/line02/account-status')
      .set('X-Tenant-Id', TEST_TENANT);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBeUndefined();
    expect(res.body.data.main_account).toBeUndefined();
  });

  it('[Step2-a] accounts 条目包含 label/role/health 字段', async () => {
    const app = await buildApp();
    const res = await request(app)
      .get('/api/line02/account-status')
      .set('X-Tenant-Id', TEST_TENANT);
    expect(res.status).toBe(200);
    for (const account of res.body.data.accounts) {
      expect(typeof account.label).toBe('string');
      expect(['main', 'burner']).toContain(account.role);
      expect(['ok', 'expired', 'unknown']).toContain(account.health);
    }
  });
});
