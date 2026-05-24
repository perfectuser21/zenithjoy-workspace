import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { acquisitionRouter } from '../../../../apps/api/src/routes/acquisition';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const app = express();
app.use(express.json());
app.use('/api/acquisition', acquisitionRouter);

describe('WS4 GET /api/acquisition/leads [BEHAVIOR]', () => {
  it('[BEHAVIOR] 返回 HTTP 200，顶层 keys 精确等于 ["leads","total"]', async () => {
    const res = await request(app).get('/api/acquisition/leads');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['leads', 'total']);
  });

  it('[BEHAVIOR] leads 为数组，total 为数字', async () => {
    const res = await request(app).get('/api/acquisition/leads');
    expect(Array.isArray(res.body.leads)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  it('[BEHAVIOR] 禁用字段 data/items/records/rows/result 不在 response 顶层', async () => {
    const res = await request(app).get('/api/acquisition/leads');
    const banned = ['data', 'items', 'records', 'rows', 'result'];
    for (const f of banned) {
      expect(res.body).not.toHaveProperty(f);
    }
  });

  it('[BEHAVIOR] grade 查询参数筛选生效（grade=高意向 → 所有结果 grade="高意向"）', async () => {
    const res = await request(app).get('/api/acquisition/leads?grade=高意向');
    expect(res.status).toBe(200);
    const grades: string[] = res.body.leads.map((l: { grade: string }) => l.grade);
    if (grades.length > 0) {
      grades.forEach((g) => expect(g).toBe('高意向'));
    }
  });

  it('[BEHAVIOR] grade 非法值返回 HTTP 400 + error="INVALID_GRADE"', async () => {
    const res = await request(app).get('/api/acquisition/leads?grade=invalid');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_GRADE');
  });

  it('[BEHAVIOR] grade=感兴趣 和 grade=精准 也合法（枚举全覆盖）', async () => {
    const r1 = await request(app).get('/api/acquisition/leads?grade=感兴趣');
    expect(r1.status).toBe(200);
    const r2 = await request(app).get('/api/acquisition/leads?grade=精准');
    expect(r2.status).toBe(200);
  });
});

describe('WS4 LeadsPage.tsx + navigation [ARTIFACT]', () => {
  const LEADS_PAGE = resolve(
    __dirname,
    '../../../../apps/dashboard/src/pages/LeadsPage.tsx',
  );
  const NAV_CONFIG = resolve(
    __dirname,
    '../../../../apps/dashboard/src/config/navigation.config.ts',
  );

  it('[ARTIFACT] LeadsPage.tsx 存在', () => {
    expect(existsSync(LEADS_PAGE)).toBe(true);
  });

  it('[ARTIFACT] LeadsPage.tsx 包含 data-testid="leads-table"', () => {
    const content = readFileSync(LEADS_PAGE, 'utf8');
    expect(content).toContain('leads-table');
  });

  it('[ARTIFACT] LeadsPage.tsx 包含 data-testid="grade-badge"', () => {
    const content = readFileSync(LEADS_PAGE, 'utf8');
    expect(content).toContain('grade-badge');
  });

  it('[ARTIFACT] navigation.config.ts 包含 /dashboard/leads 路由', () => {
    const content = readFileSync(NAV_CONFIG, 'utf8');
    expect(content).toContain('/dashboard/leads');
  });
});
