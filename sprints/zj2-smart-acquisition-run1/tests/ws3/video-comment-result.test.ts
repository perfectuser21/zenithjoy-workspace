import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { acquisitionRouter } from '../../../../apps/api/src/routes/acquisition';

const app = express();
app.use(express.json());
app.use('/api/acquisition', acquisitionRouter);

const FAKE_TASK_ID = '00000000-0000-0000-0000-000000000001';

describe('WS3 POST /api/acquisition/video-search-result [BEHAVIOR]', () => {
  it('[BEHAVIOR] 返回 HTTP 200 且 received=true', async () => {
    const res = await request(app)
      .post('/api/acquisition/video-search-result')
      .send({
        keyword_task_id: FAKE_TASK_ID,
        keyword: '装修',
        videos: [{ video_url: 'https://www.douyin.com/video/test001' }],
      });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('[BEHAVIOR] video_count 等于上报视频数', async () => {
    const res = await request(app)
      .post('/api/acquisition/video-search-result')
      .send({
        keyword_task_id: FAKE_TASK_ID,
        keyword: '装修',
        videos: [
          { video_url: 'https://www.douyin.com/video/v1' },
          { video_url: 'https://www.douyin.com/video/v2' },
        ],
      });
    expect(res.body.video_count).toBe(2);
  });

  it('[BEHAVIOR] keyword_task_id 缺失时返回 HTTP 400', async () => {
    const res = await request(app)
      .post('/api/acquisition/video-search-result')
      .send({ videos: [] });
    expect(res.status).toBe(400);
  });
});

describe('WS3 POST /api/acquisition/comment-score-result [BEHAVIOR]', () => {
  it('[BEHAVIOR] 返回 HTTP 200 且 received=true', async () => {
    const res = await request(app)
      .post('/api/acquisition/comment-score-result')
      .send({
        keyword_task_id: FAKE_TASK_ID,
        video_url: 'https://www.douyin.com/video/test001',
        comments: [
          {
            commenter_id: '@test_user',
            text: '怎么联系你',
            publish_time: '2026-05-24T10:00:00Z',
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('[BEHAVIOR] comments 为空时 written_count=0（早返回）', async () => {
    const res = await request(app)
      .post('/api/acquisition/comment-score-result')
      .send({
        keyword_task_id: FAKE_TASK_ID,
        video_url: 'https://www.douyin.com/video/test001',
        comments: [],
      });
    expect(res.status).toBe(200);
    expect(res.body.written_count).toBe(0);
  });

  it('[BEHAVIOR] response 包含 comment_count 字段', async () => {
    const res = await request(app)
      .post('/api/acquisition/comment-score-result')
      .send({
        keyword_task_id: FAKE_TASK_ID,
        video_url: 'https://www.douyin.com/video/test001',
        comments: [{ commenter_id: '@u', text: '联系', publish_time: '2026-05-24T10:00:00Z' }],
      });
    expect(res.body).toHaveProperty('comment_count');
  });

  it('[BEHAVIOR] lead-writer grade 字段包含中文枚举值', () => {
    const { readFileSync } = require('fs');
    const { resolve } = require('path');
    const content = readFileSync(
      resolve(__dirname, '../../../../apps/api/src/services/lead-writer.ts'),
      'utf8',
    );
    const hasGradeEnum = ['感兴趣', '精准', '高意向'].some((g) => content.includes(g));
    expect(hasGradeEnum).toBe(true);
  });
});
