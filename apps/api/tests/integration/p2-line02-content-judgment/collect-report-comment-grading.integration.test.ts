/**
 * /collect/report 评论意向分档真实落库 — [REGRESSION]
 *
 * 2026-07-19 真机验证音频判定fix全链路时发现：acquisition_leads.outreach_eligible 永远
 * false，Seg4 私信从未真实触发——根因是 grade 字段从来没有任何地方真正产生过值（安卓端
 * 上报评论从不带grade，服务端也没有AI判定环节）。本测试验证接入 gradeComments 之后，
 * /collect/report 真实落库的 grade 能驱动 rescoreLead 算出 outreach_eligible=true。
 *
 * commit-1 时 RED（gradeComments 还没接入路由，grade 落库为 null，outreach_eligible 恒 false）；
 * commit-2 GREEN。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import axios from 'axios';
import app from '../../../src/app';
import { testPool, createTestTenant } from '../helpers';

vi.mock('axios');

let tenantId: string;
let taskId: string;
const RND = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const VIDEO_ID = `grading-vid-${RND}`;

beforeAll(async () => {
  const tenant = await createTestTenant(`comment-grading-test-${RND}`);
  tenantId = tenant.id;

  await testPool.query(
    `INSERT INTO zenithjoy.acquisition_config (tenant_id, target_profile_desc)
     VALUES ($1, $2)
     ON CONFLICT (tenant_id) DO UPDATE SET target_profile_desc = EXCLUDED.target_profile_desc`,
    [tenantId, '装修行业目标客户，准备装修的业主']
  );

  const tRes = await testPool.query(
    `INSERT INTO zenithjoy.acquisition_collect_tasks (tenant_id, keywords, status)
     VALUES ($1, $2::jsonb, 'running')
     RETURNING id`,
    [tenantId, JSON.stringify(['装修'])]
  );
  taskId = tRes.rows[0].id;

  await testPool.query(
    `INSERT INTO zenithjoy.acquisition_collect_videos (video_id, task_id, tenant_id, title)
     VALUES ($1, $2, $3, $4)`,
    [VIDEO_ID, taskId, tenantId, '装修保姆级教学']
  );
});

afterAll(async () => {
  await testPool.query('DELETE FROM zenithjoy.acquisition_lead_comments WHERE video_id = $1', [VIDEO_ID]);
  await testPool.query('DELETE FROM zenithjoy.acquisition_leads WHERE tenant_id = $1', [tenantId]);
  await testPool.query('DELETE FROM zenithjoy.acquisition_collect_videos WHERE task_id = $1', [taskId]);
  await testPool.query('DELETE FROM zenithjoy.acquisition_collect_tasks WHERE id = $1', [taskId]);
  await testPool.query('DELETE FROM zenithjoy.acquisition_config WHERE tenant_id = $1', [tenantId]);
  await testPool.query('DELETE FROM zenithjoy.tenants WHERE id = $1', [tenantId]);
});

describe('POST /collect/report 评论意向分档真实落库 [REGRESSION]', () => {
  it('Gemini判定"精准"时grade真实落库且outreach_eligible变true', async () => {
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({
      data: { choices: [{ message: { content: '1. 精准' } }] },
    } as never);

    const res = await request(app)
      .post('/api/acquisition/collect/report')
      .send({
        task_id: taskId,
        video_id: VIDEO_ID,
        commenters: [
          { nickname: `grading-nick-${RND}`, comment_text: '预算10万求推荐', douyin_id: `grading-douyin-${RND}` },
        ],
        terminal: false,
      });

    expect(res.status).toBe(200);

    const leadRes = await testPool.query(
      `SELECT id, outreach_eligible FROM zenithjoy.acquisition_leads WHERE tenant_id = $1 AND nickname = $2`,
      [tenantId, `grading-nick-${RND}`]
    );
    expect(leadRes.rows.length).toBe(1);
    expect(leadRes.rows[0].outreach_eligible).toBe(true);

    const commentRes = await testPool.query(
      `SELECT grade FROM zenithjoy.acquisition_lead_comments WHERE lead_id = $1`,
      [leadRes.rows[0].id]
    );
    expect(commentRes.rows[0].grade).toBe('精准');
  });
});
