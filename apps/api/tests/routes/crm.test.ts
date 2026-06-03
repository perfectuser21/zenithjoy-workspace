import { describe, it, expect, vi, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/services/daily-crm-analysis', () => ({
  runDailyCrmAnalysis: vi.fn().mockResolvedValue({
    customers: [{ name: '张三', rating: 'A1', next_followup: '2026-06-04' }],
    webhook_sent: false,
    analysis_time: '2026-06-03T08:30:00Z',
  }),
}));

let app: express.Application;

beforeAll(async () => {
  const { default: crmRouter } = await import('../../src/routes/crm');
  app = express();
  app.use(express.json());
  app.use('/api/crm', crmRouter);
});

describe('CRM 路由 — Path 4 Step 2', () => {
  describe('POST /api/crm/init', () => {
    it('缺 tenant_id → 400', async () => {
      const res = await request(app).post('/api/crm/init').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('mode=create → 200 + table_id（含 tenant）', async () => {
      const res = await request(app)
        .post('/api/crm/init')
        .send({ tenant_id: 'tenant_001', platform: 'feishu', mode: 'create' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.table_id).toContain('tenant_001');
    });

    it('mode=detect → 200 + table_id 含 existing', async () => {
      const res = await request(app)
        .post('/api/crm/init')
        .send({ tenant_id: 'tenant_002', platform: 'notion', mode: 'detect' });
      expect(res.status).toBe(200);
      expect(res.body.table_id).toContain('existing');
    });
  });

  describe('GET /api/crm/wechat-contacts', () => {
    it('缺 tenant_id → 400', async () => {
      const res = await request(app).get('/api/crm/wechat-contacts');
      expect(res.status).toBe(400);
    });

    it('有 tenant_id → 200 + 精确 5 条联系人', async () => {
      const res = await request(app)
        .get('/api/crm/wechat-contacts')
        .query({ tenant_id: 'tenant_001' });
      expect(res.status).toBe(200);
      expect(res.body.contacts).toHaveLength(5);
      expect(res.body.contacts[0]).toHaveProperty('wechat_id');
      expect(res.body.contacts[0]).toHaveProperty('nickname');
    });
  });

  describe('GET /api/crm/match-preview', () => {
    it('缺 tenant_id → 400', async () => {
      const res = await request(app).get('/api/crm/match-preview');
      expect(res.status).toBe(400);
    });

    it('有 tenant_id → 200 + matched/pending/unmatched 三字段', async () => {
      const res = await request(app)
        .get('/api/crm/match-preview')
        .query({ tenant_id: 'tenant_001' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('matched');
      expect(res.body).toHaveProperty('pending');
      expect(res.body).toHaveProperty('unmatched');
    });
  });

  describe('POST /api/crm/daily-analysis', () => {
    it('缺 tenant_id → 400', async () => {
      const res = await request(app).post('/api/crm/daily-analysis').send({});
      expect(res.status).toBe(400);
    });

    it('dry_run=true → 200 + customers + webhook_sent=false', async () => {
      const res = await request(app)
        .post('/api/crm/daily-analysis')
        .send({ tenant_id: 'tenant_001', dry_run: true });
      expect(res.status).toBe(200);
      expect(res.body.customers).toBeDefined();
      expect(typeof res.body.webhook_sent).toBe('boolean');
    });
  });
});
