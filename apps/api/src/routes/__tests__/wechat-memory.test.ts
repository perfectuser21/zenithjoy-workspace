/* eslint-disable @typescript-eslint/no-explicit-any -- 测试注入 mock */
/**
 * 同目录单测（CI lint-test-pairing 配对）— /api/wechat/memory/* 路由契约。
 *
 * mock 三层记忆服务，只验路由层：租户解析（X-Tenant-Id / body.tenant_id）、
 * 缺 tenant → 400 MISSING_TENANT（不回退）、字段/role 校验、成功回显。
 * 端到端真链路另在 apps/api/tests/integration/p4-line04-cs-memory/ 覆盖。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../services/wechat/tenant-memory', () => ({
  MissingTenantError: class MissingTenantError extends Error {},
  appendTenantMessage: vi.fn(),
  getReplyContext: vi.fn(),
  runDailyConsolidation: vi.fn(),
}));

import {
  appendTenantMessage,
  getReplyContext,
  runDailyConsolidation,
} from '../../services/wechat/tenant-memory';
import { wechatMemoryRouter } from '../wechat-memory';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/wechat', wechatMemoryRouter);
  return app;
}

const app = makeApp();

beforeEach(() => vi.clearAllMocks());

describe('POST /api/wechat/memory/message', () => {
  it('缺 tenant_id → 400 MISSING_TENANT，不调服务', async () => {
    const r = await request(app)
      .post('/api/wechat/memory/message')
      .send({ contact: 'c', role: 'in', text: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('MISSING_TENANT');
    expect(appendTenantMessage).not.toHaveBeenCalled();
  });

  it('缺字段 → 400 MISSING_FIELDS；role 非 in/out → 400', async () => {
    const miss = await request(app)
      .post('/api/wechat/memory/message')
      .set('X-Tenant-Id', 'tenantA')
      .send({ contact: 'c' });
    expect(miss.status).toBe(400);
    expect(miss.body.error).toBe('MISSING_FIELDS');

    const bad = await request(app)
      .post('/api/wechat/memory/message')
      .set('X-Tenant-Id', 'tenantA')
      .send({ contact: 'c', role: 'x', text: 'y' });
    expect(bad.status).toBe(400);
  });

  it('正常写入 → 200 ok + 回显 tenant_id/message_id', async () => {
    (appendTenantMessage as any).mockResolvedValue({ message_id: 7 });
    const r = await request(app)
      .post('/api/wechat/memory/message')
      .set('X-Tenant-Id', 'tenantA')
      .send({ contact: 'wxid_c', role: 'in', text: '你好' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, message_id: 7, tenant_id: 'tenantA', contact: 'wxid_c' });
  });
});

describe('POST /api/wechat/memory/consolidate', () => {
  it('缺 tenant_id → 400 MISSING_TENANT', async () => {
    const r = await request(app).post('/api/wechat/memory/consolidate').send({ contact: 'c' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('MISSING_TENANT');
  });

  it('正常 → 200 回显 daily_generated/folded', async () => {
    (runDailyConsolidation as any).mockResolvedValue({ daily_generated: true, folded: false, day: '2026-06-18' });
    const r = await request(app)
      .post('/api/wechat/memory/consolidate')
      .set('X-Tenant-Id', 'tenantA')
      .send({ contact: 'wxid_c' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, daily_generated: true, folded: false, day: '2026-06-18' });
  });
});

describe('GET /api/wechat/memory/context', () => {
  it('缺 tenant_id → 400 MISSING_TENANT，响应体不含 assembled', async () => {
    const r = await request(app).get('/api/wechat/memory/context?contact=c');
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('MISSING_TENANT');
    expect(JSON.stringify(r.body)).not.toContain('assembled');
  });

  it('正常 → 200 含 context 三层 + assembled', async () => {
    (getReplyContext as any).mockResolvedValue({
      context: { longterm: '', mid: '', short: [] },
      assembled: '[长期记忆]\n（无）',
    });
    const r = await request(app)
      .get('/api/wechat/memory/context?contact=wxid_c')
      .set('X-Tenant-Id', 'tenantA');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.context).sort()).toEqual(['longterm', 'mid', 'short']);
    expect(typeof r.body.assembled).toBe('string');
  });
});
