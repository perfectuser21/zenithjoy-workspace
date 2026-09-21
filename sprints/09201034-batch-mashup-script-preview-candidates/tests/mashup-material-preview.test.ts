/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Step2 素材在线预览重签端点契约（GET /api/materials/:id/preview）。
 * 该端点为读路径（非本单禁 mock 边：不涉调度/状态机/DB 写），按 repo 既有
 * mashup.test.ts 惯例桩掉 license 鉴权与 storage 叶子，聚焦端点形状与租户隔离。
 *
 * TDD Red：GET /api/materials/:id/preview 尚未注册 → 命中通用 404 → 全红。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../apps/api/src/services/walking-skeleton.service', () => ({ validateLicense: vi.fn() }));
vi.mock('../../../apps/api/src/db/connection', () => ({ default: { query: vi.fn() } }));
vi.mock('../../../apps/api/src/services/material-storage', () => ({
  createMaterialStorage: () => ({
    getSignedUrl: vi.fn(async (k: string) => `https://signed.example/${k}?exp=1`),
    putObject: vi.fn(async () => {}),
  }),
}));

import { validateLicense } from '../../../apps/api/src/services/walking-skeleton.service';
import pool from '../../../apps/api/src/db/connection';
import { createMaterialsRouter } from '../../../apps/api/src/routes/materials';

const TOKEN_A = 'ZJ-F-AAAA1111';
const MATERIAL_ID = '11111111-1111-1111-1111-111111111111';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/materials', createMaterialsRouter());
  return app;
}
const licenseOk = (tenantId: string) => ({
  ok: true as const,
  license: { id: 'lic', license_key: TOKEN_A, tenant_id: tenantId, status: 'active', expires_at: '2099-01-01T00:00:00Z' },
});

beforeEach(() => vi.clearAllMocks());

describe('GET /api/materials/:id/preview 素材在线预览重签', () => {
  it('preview 返回重签 previewUrl 与 previewAvailable', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    (pool.query as any).mockResolvedValue({
      rows: [{ id: MATERIAL_ID, storage_key: 'mat/a.mp4', mime_type: 'video/mp4', tenant_id: 'tenant-a' }],
    });
    const r = await request(makeApp()).get(`/api/materials/${MATERIAL_ID}/preview`).set('X-Upload-Token', TOKEN_A);
    expect(r.status).toBe(200);
    expect(r.body.data.materialId).toBe(MATERIAL_ID);
    expect(typeof r.body.data.previewAvailable).toBe('boolean');
    expect(typeof r.body.data.expiresAt).toBe('string');
    expect(r.body.data.previewUrl === null || typeof r.body.data.previewUrl === 'string').toBe(true);
  });

  it('跨租户 preview 返回 404（租户隔离 INV-1）', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-b'));
    (pool.query as any).mockResolvedValue({ rows: [] }); // 素材不属于 tenant-b
    const r = await request(makeApp()).get(`/api/materials/${MATERIAL_ID}/preview`).set('X-Upload-Token', TOKEN_A);
    expect(r.status).toBe(404);
  });

  it('无凭据 preview 返回 401', async () => {
    const r = await request(makeApp()).get(`/api/materials/${MATERIAL_ID}/preview`);
    expect(r.status).toBe(401);
  });
});
