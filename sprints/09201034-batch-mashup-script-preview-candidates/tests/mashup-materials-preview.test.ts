/**
 * 批量混剪加厚 · Step2 素材在线预览重签端点（GP line05/batch_mashup）合同测试（TDD Red）。
 *
 * 这是**读路径**（按 storage_key 重签 signedUrl，供 signedUrl 过期时前端自动重签重试），
 * 非本 sprint 被改的写路径接缝，故按仓库既有 route 测试惯例用替身 db + InMemory 存储。
 * 现在必红：GET /api/materials/:id/preview-url 路由尚未注册（返回 404 Not Found）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../apps/api/src/services/walking-skeleton.service', () => ({ validateLicense: vi.fn() }));
vi.mock('../../../apps/api/src/db/connection', () => ({ default: { query: vi.fn(), connect: vi.fn() } }));

import { validateLicense } from '../../../apps/api/src/services/walking-skeleton.service';
import pool from '../../../apps/api/src/db/connection';
import { InMemoryMaterialStorage } from '../../../apps/api/src/services/material-storage';
import { createMaterialsRouter } from '../../../apps/api/src/routes/materials';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOKEN_A = 'ZJ-F-AAAA1111';

function makeApp() {
  const storage = new InMemoryMaterialStorage();
  const app = express();
  app.use(express.json());
  app.use('/api/materials', createMaterialsRouter({ storage }));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  (validateLicense as any).mockResolvedValue({
    ok: true,
    license: { id: 'lic', license_key: TOKEN_A, tenant_id: TENANT_A, status: 'active', expires_at: '2099-01-01T00:00:00Z' },
  });
});

describe('GET /api/materials/:id/preview-url 在线预览重签 [BEHAVIOR]', () => {
  it('本租户素材 → 200 返回可播放 preview_url', async () => {
    (pool.query as any).mockResolvedValue({ rows: [{ id: 'mat-1', storage_key: `key/${TENANT_A}/1` }] });
    const r = await request(makeApp())
      .get('/api/materials/mat-1/preview-url')
      .set('X-Upload-Token', TOKEN_A);
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(typeof r.body.data.preview_url).toBe('string');
    expect(r.body.data.preview_url.length).toBeGreaterThan(0);
  });

  it('非本租户/不存在素材 → 404，不泄露他人素材', async () => {
    (pool.query as any).mockResolvedValue({ rows: [] });
    const r = await request(makeApp())
      .get('/api/materials/mat-x/preview-url')
      .set('X-Upload-Token', TOKEN_A);
    expect(r.status).toBe(404);
  });

  it('无凭据 → 401', async () => {
    const r = await request(makeApp()).get('/api/materials/mat-1/preview-url');
    expect(r.status).toBe(401);
  });
});
