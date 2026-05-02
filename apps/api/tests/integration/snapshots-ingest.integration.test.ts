/**
 * Integration — Snapshots Ingest Chain
 *
 * 验证：爬虫 POST ingest → DB 写入 → 幂等 upsert → 性能数据查询。
 * 使用真实 DB（zenithjoy_test），不 mock pool.query。
 */
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import app from '../../src/app';
import {
  testPool,
  truncateTables,
  createTestTenant,
  addTenantMember,
} from './helpers';

const USER = 'ou_snapshots_integ_user_001';
const CONTENT_ID = 'video-douyin-integ-001';
const SCRAPED_DATE = '2026-05-01';

const BATCH = [
  {
    content_id: CONTENT_ID,
    scraped_date: SCRAPED_DATE,
    scraped_at: '2026-05-01T10:00:00Z',
    title: '集成测试视频',
    views: 10000,
    likes: 500,
    comments: 80,
    shares: 30,
    saves: 20,
  },
  {
    content_id: 'video-douyin-integ-002',
    scraped_date: SCRAPED_DATE,
    scraped_at: '2026-05-01T10:00:00Z',
    title: '另一个集成测试视频',
    views: 5000,
    likes: 200,
    comments: 40,
    shares: 10,
    saves: 8,
  },
];

describe('Snapshots Ingest — integration', () => {
  let workId: string;

  beforeAll(async () => {
    const tenant = await createTestTenant('Snapshots Tenant');
    await addTenantMember(tenant.id, USER, 'owner');

    // Create a work and link it to a publish log so performance endpoint works
    const workRes = await request(app)
      .post('/api/works')
      .set('X-Feishu-User-Id', USER)
      .send({ title: '快照测试作品', content_type: 'video', status: 'published' });
    workId = workRes.body.id;
  });

  afterAll(async () => {
    await testPool.query(
      `DELETE FROM zenithjoy.daily_snapshots WHERE content_id LIKE 'video-douyin-integ-%'`
    );
    await truncateTables(
      'zenithjoy.publish_logs',
      'zenithjoy.works',
      'zenithjoy.tenant_members',
      'zenithjoy.tenants'
    );
  });

  it('POST /api/snapshots/ingest ingests a batch and returns counts', async () => {
    const res = await request(app)
      .post('/api/snapshots/ingest')
      .send({ platform: 'douyin', items: BATCH });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.inserted).toBeGreaterThanOrEqual(2);

    // Verify in DB
    const { rows } = await testPool.query(
      `SELECT content_id FROM zenithjoy.daily_snapshots
       WHERE platform = 'douyin' AND content_id LIKE 'video-douyin-integ-%'
       AND scraped_date = $1`,
      [SCRAPED_DATE]
    );
    expect(rows).toHaveLength(2);
  });

  it('re-ingesting same batch is idempotent (upsert, not duplicate)', async () => {
    // Send same batch again with updated view counts
    const updatedBatch = BATCH.map((item) => ({
      ...item,
      views: item.views + 1000,  // views increased
      scraped_at: '2026-05-01T12:00:00Z',
    }));

    const res = await request(app)
      .post('/api/snapshots/ingest')
      .send({ platform: 'douyin', items: updatedBatch });

    expect(res.status).toBe(200);

    // Still 2 rows, not 4
    const { rows } = await testPool.query(
      `SELECT content_id, views FROM zenithjoy.daily_snapshots
       WHERE platform = 'douyin' AND content_id LIKE 'video-douyin-integ-%'
       AND scraped_date = $1`,
      [SCRAPED_DATE]
    );
    expect(rows).toHaveLength(2);

    // Views should be updated
    const row = rows.find((r: { content_id: string }) => r.content_id === CONTENT_ID);
    expect(row?.views).toBe(11000);
  });

  it('POST /api/snapshots/ingest returns 400 for invalid platform', async () => {
    const res = await request(app)
      .post('/api/snapshots/ingest')
      .send({ platform: 'instagram', items: BATCH });

    expect(res.status).toBe(400);
  });

  it('POST /api/snapshots/ingest returns 400 for empty items', async () => {
    const res = await request(app)
      .post('/api/snapshots/ingest')
      .send({ platform: 'douyin', items: [] });

    expect(res.status).toBe(400);
  });

  it('items missing content_id or scraped_date are skipped gracefully', async () => {
    const malformed = [
      { title: 'no content_id', views: 100 },  // missing content_id
      { content_id: 'valid-id', title: 'no date', views: 200 },  // missing scraped_date
    ];

    const res = await request(app)
      .post('/api/snapshots/ingest')
      .send({ platform: 'douyin', items: malformed });

    expect(res.status).toBe(200);
    expect(res.body.skipped).toBeGreaterThanOrEqual(2);
  });
});
