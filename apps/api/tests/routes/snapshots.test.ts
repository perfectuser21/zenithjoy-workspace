import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/app';
import pool from '../../src/db/connection';

vi.mock('../../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

describe('Snapshots ingest — saves field', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts saves from top-level item.saves', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: '1' }] });

    const res = await request(app)
      .post('/api/snapshots/ingest')
      .send({
        platform: 'xiaohongshu',
        items: [{ content_id: 'note001', scraped_date: '2026-04-20', views: 2000, saves: 500 }],
      });

    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(1);

    const sql: string = mockQuery.mock.calls[0][0];
    const params: unknown[] = mockQuery.mock.calls[0][1];
    expect(sql).toContain('saves');
    expect(params).toContain(500);
  });

  it('falls back to extra_data.favorites when saves not in item', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: '1' }] });

    const res = await request(app)
      .post('/api/snapshots/ingest')
      .send({
        platform: 'kuaishou',
        items: [{ content_id: 'photo001', scraped_date: '2026-04-20', views: 3000, extra_data: { favorites: 200 } }],
      });

    expect(res.status).toBe(200);
    const params: unknown[] = mockQuery.mock.calls[0][1];
    expect(params).toContain(200);
  });
});
