import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { acquisitionRouter } from './acquisition';

vi.mock('../services/keyword-expander', () => ({
  expandKeywords: vi.fn().mockResolvedValue(['装修', '装修公司', '室内装修', '家装', '装修报价']),
}));
vi.mock('../services/comment-grader', () => ({
  gradeComment: vi.fn().mockResolvedValue('感兴趣'),
}));
vi.mock('../services/lead-writer', () => ({
  writeLeadsFromComments: vi.fn().mockResolvedValue({ written_count: 1, lead_write_status: 'success' }),
}));

const app = express();
app.use(express.json());
app.use('/api/acquisition', acquisitionRouter);
app.use((_req, res) => res.status(404).json({ error: 'not found' }));

describe('GET /api/acquisition/overview', () => {
  it('returns 200 with correct payload', async () => {
    const res = await request(app).get('/api/acquisition/overview');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.feature).toBe('smart-acquisition');
    expect(res.body.capabilities).toEqual(["overview"]);
    expect(res.body.version).toBe('1.0.0');
  });

  it('schema has exactly the expected top-level keys', async () => {
    const res = await request(app).get('/api/acquisition/overview');
    expect(Object.keys(res.body).sort()).toEqual(['capabilities', 'enabled', 'feature', 'version']);
  });

  it('unknown sub-path returns 404', async () => {
    const res = await request(app).get('/api/acquisition/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/acquisition/keyword-search', () => {
  it('returns 400 when keyword is missing', async () => {
    const res = await request(app).post('/api/acquisition/keyword-search').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_KEYWORD');
  });

  it('returns 400 when keyword is empty string', async () => {
    const res = await request(app).post('/api/acquisition/keyword-search').send({ keyword: '  ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_KEYWORD');
  });

  it('returns 400 when keyword is not a string', async () => {
    const res = await request(app).post('/api/acquisition/keyword-search').send({ keyword: 123 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_KEYWORD');
  });

  it('returns 200 with task_id and keywords (VITEST mode)', async () => {
    const res = await request(app).post('/api/acquisition/keyword-search').send({ keyword: '装修' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('task_id');
    expect(res.body).toHaveProperty('keywords');
    expect(Array.isArray(res.body.keywords)).toBe(true);
    expect(typeof res.body.task_id).toBe('string');
  });

  it('task_id is UUID format', async () => {
    const res = await request(app).post('/api/acquisition/keyword-search').send({ keyword: '家装' });
    expect(res.body.task_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('GET /api/acquisition/pending-keyword-tasks', () => {
  it('returns 200 with empty tasks in VITEST mode', async () => {
    const res = await request(app).get('/api/acquisition/pending-keyword-tasks');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tasks');
    expect(res.body).toHaveProperty('total');
    expect(Array.isArray(res.body.tasks)).toBe(true);
    expect(res.body.total).toBe(0);
  });
});

describe('POST /api/acquisition/video-search-result', () => {
  it('returns 400 when keyword_task_id is missing', async () => {
    const res = await request(app)
      .post('/api/acquisition/video-search-result')
      .send({ videos: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_KEYWORD_TASK_ID');
  });

  it('returns 200 with received:true and video_count', async () => {
    const res = await request(app)
      .post('/api/acquisition/video-search-result')
      .send({
        keyword_task_id: 'test-id',
        keyword: '装修',
        videos: [{ video_url: 'https://douyin.com/v/1' }, { video_url: 'https://douyin.com/v/2' }],
      });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(res.body.video_count).toBe(2);
  });

  it('video_count is 0 for empty videos array', async () => {
    const res = await request(app)
      .post('/api/acquisition/video-search-result')
      .send({ keyword_task_id: 'test-id', videos: [] });
    expect(res.body.video_count).toBe(0);
  });

  it('video_count is 0 when videos is not an array', async () => {
    const res = await request(app)
      .post('/api/acquisition/video-search-result')
      .send({ keyword_task_id: 'test-id', videos: null });
    expect(res.body.video_count).toBe(0);
  });
});

describe('POST /api/acquisition/comment-score-result', () => {
  it('returns 400 when keyword_task_id is missing', async () => {
    const res = await request(app)
      .post('/api/acquisition/comment-score-result')
      .send({ comments: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_KEYWORD_TASK_ID');
  });

  it('returns 200 with written_count=0 for empty comments', async () => {
    const res = await request(app)
      .post('/api/acquisition/comment-score-result')
      .send({ keyword_task_id: 'test-id', comments: [] });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(res.body.written_count).toBe(0);
    expect(res.body.comment_count).toBe(0);
  });

  it('VITEST mode: written_count equals comment count', async () => {
    const comments = [
      { commenter_id: 'u1', text: '请问怎么联系', publish_time: '2026-05-25T00:00:00Z' },
      { commenter_id: 'u2', text: '感觉不错', publish_time: '2026-05-25T00:00:00Z' },
    ];
    const res = await request(app)
      .post('/api/acquisition/comment-score-result')
      .send({ keyword_task_id: 'test-id', video_url: 'https://douyin.com/v/1', comments });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(res.body.written_count).toBe(2);
    expect(res.body.comment_count).toBe(2);
  });
});

describe('GET /api/acquisition/leads', () => {
  it('returns 400 for invalid grade', async () => {
    const res = await request(app).get('/api/acquisition/leads?grade=invalid');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_GRADE');
  });

  it('VITEST mode: returns empty leads for valid grade', async () => {
    const res = await request(app).get('/api/acquisition/leads?grade=%E7%B2%BE%E5%87%86');
    expect(res.status).toBe(200);
    expect(res.body.leads).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('VITEST mode: returns empty leads when no grade filter', async () => {
    const res = await request(app).get('/api/acquisition/leads');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('leads');
    expect(res.body).toHaveProperty('total');
  });
});
