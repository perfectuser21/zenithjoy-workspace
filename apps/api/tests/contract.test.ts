/**
 * API Contract Tests — Response Shape Regression Guard
 *
 * 固化三个核心资源（works/fields/publish-logs）的 HTTP response shape，
 * 防止字段名被意外修改后 dashboard 静默崩溃。
 *
 * 已知 Dashboard/API 不一致（待后续 PR 修复，此处只记录现状）：
 * - Work.body        ↔ dashboard 期待 content_text
 * - WorkStatus.ready ↔ dashboard 期待 pending
 * - PublishLog.status 枚举：API 用 pending/published，dashboard 用 scheduled/success
 * - FieldDefinition 缺少 display_label / is_required
 */
import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../src/app';
import pool from '../src/db/connection';

const TEST_USER = 'ou_test_works_001';

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

// ── 固定测试数据 ────────────────────────────────────────────────────────────

// 必须使用合法 UUID，否则 Zod z.string().uuid() 校验失败
const WORK_UUID = '11111111-1111-1111-1111-111111111111';
const LOG_UUID  = '22222222-2222-2222-2222-222222222222';
const FIELD_UUID = '33333333-3333-3333-3333-333333333333';

const WORK_ROW = {
  id: WORK_UUID,
  title: 'Contract Work',
  body: '# Body content',
  body_en: null,
  content_type: 'article',
  cover_image: null,
  media_files: null,
  platform_links: null,
  status: 'draft',
  account: null,
  is_featured: false,
  is_viral: false,
  custom_fields: null,
  archived_at: null,   // DB 实际列名（非 archived），防止字段名回退
  owner_id: TEST_USER,
  tenant_id: 'tttttttt-1111-2222-3333-444444444444', // 匹配 queueTenantMember
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const FIELD_ROW = {
  id: FIELD_UUID,
  field_name: 'test_field',
  field_type: 'select',
  options: ['a', 'b'],
  display_order: 10,
  is_visible: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const LOG_ROW = {
  id: LOG_UUID,
  work_id: WORK_UUID,
  platform: 'douyin',
  platform_post_id: null,
  status: 'pending',
  scheduled_at: null,
  response: null,
  error_message: null,
  created_at: '2026-01-01T00:00:00Z',
};

// ── beforeEach 用 resetAllMocks，确保 once 队列被清空 ────────────────────────
// 注意：vi.clearAllMocks() 在 vitest v4 不清空 mockResolvedValueOnce 队列，
// 必须用 vi.resetAllMocks() 才能防止跨测试 mock 污染。

// Sprint v2：tenantContext 中间件查询 tenant_members → tenant_id
const TEST_TENANT_ID = 'tttttttt-1111-2222-3333-444444444444';
function queueTenantMember() {
  mockQuery.mockResolvedValueOnce({
    rows: [{ tenant_id: TEST_TENANT_ID, role: 'member' }],
  });
}

describe('API Contract — Works', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    queueTenantMember();
  });

  it('GET /api/works — list response shape', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [WORK_ROW] });

    const { status, body } = await request(app).get('/api/works').set('X-Feishu-User-Id', TEST_USER);

    expect(status).toBe(200);
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('limit');
    expect(body).toHaveProperty('offset');
    expect(Array.isArray(body.data)).toBe(true);

    const work = body.data[0];
    expect(work).toHaveProperty('id');
    expect(work).toHaveProperty('title');
    expect(work).toHaveProperty('content_type');
    expect(work).toHaveProperty('status');
    expect(work).toHaveProperty('created_at');
    expect(work).toHaveProperty('updated_at');
    // NOTE: API 返回 'body'，dashboard 当前期待 'content_text' — 已知不一致
    expect(work).toHaveProperty('body');
  });

  it('GET /api/works/:id — single work shape', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [WORK_ROW] });

    const { status, body } = await request(app).get(`/api/works/${WORK_UUID}`).set('X-Feishu-User-Id', TEST_USER);

    expect(status).toBe(200);
    expect(body.id).toBe(WORK_UUID);
    expect(body).toHaveProperty('title');
    expect(body).toHaveProperty('content_type');
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('body');
    expect(body).toHaveProperty('archived_at');  // DB 实际列名
    expect(body).toHaveProperty('created_at');
    expect(body).toHaveProperty('updated_at');
  });

  it('POST /api/works — created work shape', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [WORK_ROW] });

    const { status, body } = await request(app)
      .post('/api/works')
      .set('X-Feishu-User-Id', TEST_USER)
      .send({ title: 'Contract Work', content_type: 'article' });

    expect(status).toBe(201);
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('title');
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('created_at');
  });

  it('PUT /api/works/:id — updated work shape', async () => {
    const updated = { ...WORK_ROW, title: 'Updated' };
    mockQuery
      .mockResolvedValueOnce({ rows: [WORK_ROW] })
      .mockResolvedValueOnce({ rows: [updated] });

    const { status, body } = await request(app)
      .put(`/api/works/${WORK_UUID}`)
      .set('X-Feishu-User-Id', TEST_USER)
      .send({ title: 'Updated' });

    expect(status).toBe(200);
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('updated_at');
  });

  it('DELETE /api/works/:id — success shape', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [WORK_ROW] })
      .mockResolvedValueOnce({ rows: [] });

    const { status, body } = await request(app).delete(`/api/works/${WORK_UUID}`).set('X-Feishu-User-Id', TEST_USER);

    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true });
  });
});

// ────────────────────────────────────────────────────────────────────────────

describe('API Contract — Fields', () => {
  beforeEach(() => vi.resetAllMocks());

  it('GET /api/fields — plain array (not wrapped)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [FIELD_ROW] });

    const { status, body } = await request(app).get('/api/fields');

    expect(status).toBe(200);
    // fields 返回裸数组，不像 works 包 {data,total,...}
    expect(Array.isArray(body)).toBe(true);

    const field = body[0];
    expect(field).toHaveProperty('id');
    expect(field).toHaveProperty('field_name');
    expect(field).toHaveProperty('field_type');
    expect(field).toHaveProperty('display_order');
    expect(field).toHaveProperty('is_visible');
    expect(field).toHaveProperty('created_at');
    // NOTE: dashboard 期待 display_label / is_required — API 暂无这两个字段
  });

  it('POST /api/fields — created field shape', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [FIELD_ROW] });

    const { status, body } = await request(app)
      .post('/api/fields')
      .send({ field_name: 'test_field', field_type: 'select' });

    expect(status).toBe(201);
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('field_name');
    expect(body).toHaveProperty('field_type');
    expect(body).toHaveProperty('display_order');
  });

  it('PUT /api/fields/:id — updated field shape', async () => {
    const updated = { ...FIELD_ROW, field_name: 'renamed' };
    mockQuery
      .mockResolvedValueOnce({ rows: [FIELD_ROW] })
      .mockResolvedValueOnce({ rows: [updated] });

    const { status, body } = await request(app)
      .put(`/api/fields/${FIELD_UUID}`)
      .send({ field_name: 'renamed' });

    expect(status).toBe(200);
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('field_name');
  });
});

// ────────────────────────────────────────────────────────────────────────────

describe('API Contract — Publish Logs', () => {
  beforeEach(() => vi.resetAllMocks());

  it('GET /api/works/:workId/publish-logs — array shape', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [LOG_ROW] });

    const { status, body } = await request(app).get(`/api/works/${WORK_UUID}/publish-logs`).set('X-Feishu-User-Id', TEST_USER);

    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);

    const log = body[0];
    expect(log).toHaveProperty('id');
    expect(log).toHaveProperty('work_id');
    expect(log).toHaveProperty('platform');
    expect(log).toHaveProperty('status');
    expect(log).toHaveProperty('created_at');
    // NOTE: API status 枚举是 pending/publishing/published/failed
    //       dashboard 期待 scheduled/publishing/success/failed — 已知不一致
  });

  it('POST /api/works/:workId/publish-logs — created log shape', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [LOG_ROW] });

    const { status, body } = await request(app)
      .post(`/api/works/${WORK_UUID}/publish-logs`)
      .set('X-Feishu-User-Id', TEST_USER)
      .send({ work_id: WORK_UUID, platform: 'douyin' });

    expect(status).toBe(201);
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('work_id');
    expect(body).toHaveProperty('platform');
    expect(body).toHaveProperty('status');
  });

  it('PUT /api/publish-logs/:id — updated log shape', async () => {
    const updated = { ...LOG_ROW, status: 'published' };
    mockQuery
      .mockResolvedValueOnce({ rows: [LOG_ROW] })
      .mockResolvedValueOnce({ rows: [updated] });

    const { status, body } = await request(app)
      .put(`/api/publish-logs/${LOG_UUID}`)
      .send({ status: 'published' });

    expect(status).toBe(200);
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('status');
  });
});

// ────────────────────────────────────────────────────────────────────────────

describe('API Contract — Error Format Consistency', () => {
  // 不在 beforeEach 自动 queue tenant_member —— 这个 describe 混合 /api/works 和 /api/fields
  // 测试，分别按需 inline queue
  beforeEach(() => vi.resetAllMocks());

  it('400 VALIDATION_ERROR — error.code 始终存在', async () => {
    queueTenantMember(); // /api/works 走 tenantContext
    const { status, body } = await request(app)
      .post('/api/works')
      .set('X-Feishu-User-Id', TEST_USER)
      .send({ body: 'no title' });

    expect(status).toBe(400);
    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(body.error).toHaveProperty('message');
  });

  it('404 NOT_FOUND — error.code 始终存在', async () => {
    queueTenantMember(); // /api/works 走 tenantContext
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const fakeId = '00000000-0000-0000-0000-000000000000';
    const { status, body } = await request(app).get(`/api/works/${fakeId}`).set('X-Feishu-User-Id', TEST_USER);

    expect(status).toBe(404);
    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('code', 'NOT_FOUND');
    expect(body.error).toHaveProperty('message');
  });

  it('409 CONFLICT — error.code 始终存在', async () => {
    mockQuery.mockRejectedValueOnce(
      Object.assign(new Error('duplicate'), { code: '23505' })
    );

    const { status, body } = await request(app)
      .post('/api/fields')
      .send({ field_name: 'dup', field_type: 'text' });

    expect(status).toBe(409);
    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('code', 'CONFLICT');
    expect(body.error).toHaveProperty('message');
  });

  it('404 for unknown route — notFoundHandler 响应格式', async () => {
    const { status, body } = await request(app).get('/api/nonexistent-route');

    expect(status).toBe(404);
    expect(body).toHaveProperty('error');
  });
});
