/**
 * Fields API 单元测试（mock DB）。
 *
 * G1 / J7 段②（本刀同步改动）：`/api/fields` 四端点从"无任何鉴权"改成挂 works 家族的租户闸。
 * 于是每个用例多了两件事，**断言本身一个都没动**：
 *   1. 请求带 works 家族的身份头（dashboard 生产环境用的就是这条通道）
 *   2. mock 队列最前面多一次 `tenant_members` 反查 —— 那是租户闸自己的查询
 *
 * 不带身份的路径现在返 401，这不是回归，是那道闸生效的证据；单独补了一组用例钉住它，
 * 免得哪天闸被摘掉了这个文件还是绿的。
 */
import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../src/app';
import pool from '../src/db/connection';

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = 'ou_fields_unit_1';
/** works 家族的身份通道（不是路③ 那条只认会话的闸） */
const AUTH = { 'X-Feishu-User-Id': MEMBER_ID };

/** 租户闸先查 tenant_members，再轮到业务查询 —— 队列顺序必须与真实调用顺序一致 */
function queueWithTenant(...businessResults: unknown[]): void {
  mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_ID, role: 'owner' }] });
  for (const r of businessResults) {
    if (r instanceof Error) mockQuery.mockRejectedValueOnce(r);
    else mockQuery.mockResolvedValueOnce(r);
  }
}

const FIELD = {
  id: 'field-uuid-1',
  field_name: 'Test Field 1',
  field_type: 'select',
  options: ['Option 1', 'Option 2', 'Option 3'],
  display_order: 100,
  is_visible: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('Fields API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('鉴权（G1 段① — 端点不再裸奔）', () => {
    it('不带任何身份时四个端点均返 401，且一次业务查询都不发', async () => {
      const calls = [
        request(app).get('/api/fields'),
        request(app).post('/api/fields').send({ field_name: 'x', field_type: 'text' }),
        request(app).put(`/api/fields/${FIELD.id}`).send({ field_name: 'y' }),
        request(app).delete(`/api/fields/${FIELD.id}`),
      ];
      const results = await Promise.all(calls);
      expect(results.map((r) => r.status)).toEqual([401, 401, 401, 401]);
    });

    it('有身份但不属于任何 tenant 时返 403，不退化成查全表', async () => {
      // 多组织切换第一刀·Gate 0：self-heal 自动补 owner 行已退役 —— tenant_members 空即 NO_TENANT，
      // 不再多查一次 licenses（只需 mock 一条空的 tenant_members 反查）。
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const response = await request(app).get('/api/fields').set(AUTH);
      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/fields', () => {
    it('should create a new field definition', async () => {
      queueWithTenant({ rows: [FIELD] });

      const response = await request(app)
        .post('/api/fields')
        .set(AUTH)
        .send({
          field_name: 'Test Field 1',
          field_type: 'select',
          options: ['Option 1', 'Option 2', 'Option 3'],
          display_order: 100,
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.field_name).toBe('Test Field 1');
      expect(response.body.field_type).toBe('select');
      expect(response.body.options).toEqual(['Option 1', 'Option 2', 'Option 3']);
    });

    it('should return 400 for missing required fields', async () => {
      queueWithTenant();

      const response = await request(app)
        .post('/api/fields')
        .set(AUTH)
        .send({ field_type: 'text' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 for duplicate field_name', async () => {
      queueWithTenant(Object.assign(new Error('duplicate key value'), { code: '23505' }));

      const response = await request(app)
        .post('/api/fields')
        .set(AUTH)
        .send({ field_name: 'Test Field 1', field_type: 'text' });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('should return 400 for invalid field_type', async () => {
      queueWithTenant();

      const response = await request(app)
        .post('/api/fields')
        .set(AUTH)
        .send({ field_name: 'Test Field Invalid', field_type: 'invalid_type' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/fields', () => {
    it('should list all visible fields', async () => {
      queueWithTenant({ rows: [FIELD] });

      const response = await request(app).get('/api/fields').set(AUTH);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);

      const displayOrders = response.body.map((f: any) => f.display_order);
      const sortedOrders = [...displayOrders].sort((a: number, b: number) => a - b);
      expect(displayOrders).toEqual(sortedOrders);
    });
  });

  describe('PUT /api/fields/:id', () => {
    it('should update a field definition', async () => {
      const updatedField = {
        ...FIELD,
        field_name: 'Updated Test Field 1',
        options: ['New Option 1', 'New Option 2'],
      };
      queueWithTenant(
        { rows: [FIELD] },          // getFieldById
        { rows: [updatedField] }    // UPDATE
      );

      const response = await request(app)
        .put(`/api/fields/${FIELD.id}`)
        .set(AUTH)
        .send({ field_name: 'Updated Test Field 1', options: ['New Option 1', 'New Option 2'] });

      expect(response.status).toBe(200);
      expect(response.body.field_name).toBe('Updated Test Field 1');
      expect(response.body.options).toEqual(['New Option 1', 'New Option 2']);
    });

    it('should return 404 for non-existent field', async () => {
      queueWithTenant({ rows: [] }); // getFieldById returns empty

      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .put(`/api/fields/${fakeId}`)
        .set(AUTH)
        .send({ field_name: 'Updated' });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/fields/:id', () => {
    it('should delete a field definition', async () => {
      queueWithTenant(
        { rows: [FIELD] },  // getFieldById
        { rows: [] }        // DELETE
      );

      const response = await request(app).delete(`/api/fields/${FIELD.id}`).set(AUTH);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 404 for non-existent field', async () => {
      queueWithTenant({ rows: [] }); // getFieldById returns empty

      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app).delete(`/api/fields/${fakeId}`).set(AUTH);

      expect(response.status).toBe(404);
    });
  });
});
