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
import pool from '../../../src/db/connection';
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

  it('判定调用发生在 pool.connect()（事务开始）之前，不占事务锁等外部 HTTP', async () => {
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockClear();
    mockedPost.mockResolvedValue({
      data: { choices: [{ message: { content: '1. 精准' } }] },
    } as never);

    const connectSpy = vi.spyOn(pool, 'connect');

    const res = await request(app)
      .post('/api/acquisition/collect/report')
      .send({
        task_id: taskId,
        video_id: VIDEO_ID,
        commenters: [
          { nickname: `grading-order-nick-${RND}`, comment_text: '预算10万求推荐', douyin_id: `grading-order-douyin-${RND}` },
        ],
        terminal: false,
      });

    expect(res.status).toBe(200);
    expect(mockedPost).toHaveBeenCalled();
    expect(connectSpy).toHaveBeenCalled();
    // 注意：pg-pool 的 pool.query() 内部也会调用 pool.connect()（见 node_modules/pg-pool/index.js
    // `query(...) { this.connect((err, client) => { ... }) }`），所以判定前用 pool.query() 预读
    // tenant_id/画像等信息本身也会触发若干次 connect —— connectSpy 的"第一次"调用因此测不出
    // 事务是否延后开启。真正要证明的不变量是：**事务专用的那次 connect（紧跟着 BEGIN 的那次，
    // 也是本请求生命周期里最后一次 pool.connect() —— BEGIN 之后的所有查询都走 client.query()，
    // 不再经过 pool.connect()）晚于 axios.post**。用 connectSpy 的最后一次调用顺序来比较。
    const lastConnectOrder = connectSpy.mock.invocationCallOrder[connectSpy.mock.invocationCallOrder.length - 1];
    expect(mockedPost.mock.invocationCallOrder[0]).toBeLessThan(lastConnectOrder);

    connectSpy.mockRestore();
  });
});

describe('POST /collect/report 终态/cancelling task 提前跳过 LLM 判定 [REGRESSION]', () => {
  // 回归背景：commit 86db6626 把 gradeComments() 挪到事务外解决了行锁问题，但引入新代价——
  // 终态/cancelling 任务的迟到回报（路由自身注释写明是为防旧 agent 死循环重试而设计的常规场景，
  // 不是边缘 case）此前在事务内的权威 FOR UPDATE 检查处就短路、零成本；现在权威检查挪到判定
  // 调用之后，导致每次迟到回报都先白打一次真实计费的 LLM 调用，结果再被权威检查丢弃。
  let terminalTaskId: string;
  let cancellingTaskId: string;

  beforeAll(async () => {
    const tRes = await testPool.query(
      `INSERT INTO zenithjoy.acquisition_collect_tasks (tenant_id, keywords, status)
       VALUES ($1, $2::jsonb, 'done')
       RETURNING id`,
      [tenantId, JSON.stringify(['装修'])]
    );
    terminalTaskId = tRes.rows[0].id;

    const cRes = await testPool.query(
      `INSERT INTO zenithjoy.acquisition_collect_tasks (tenant_id, keywords, status)
       VALUES ($1, $2::jsonb, 'cancelling')
       RETURNING id`,
      [tenantId, JSON.stringify(['装修'])]
    );
    cancellingTaskId = cRes.rows[0].id;
  });

  afterAll(async () => {
    await testPool.query('DELETE FROM zenithjoy.acquisition_collect_tasks WHERE id = ANY($1::uuid[])', [
      [terminalTaskId, cancellingTaskId],
    ]);
  });

  it('终态(done) task 回报不触发 gradeComments/axios.post', async () => {
    const mockedPost = vi.mocked(axios.post);
    vi.clearAllMocks();
    mockedPost.mockResolvedValue({
      data: { choices: [{ message: { content: '1. 精准' } }] },
    } as never);

    const res = await request(app)
      .post('/api/acquisition/collect/report')
      .send({
        task_id: terminalTaskId,
        video_id: `terminal-vid-${RND}`,
        commenters: [
          { nickname: `terminal-nick-${RND}`, comment_text: '预算10万求推荐', douyin_id: `terminal-douyin-${RND}` },
        ],
        terminal: false,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.ignored).toBe(true);
    expect(res.body.data.status).toBe('done');
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('cancelling task 回报不触发 gradeComments/axios.post', async () => {
    const mockedPost = vi.mocked(axios.post);
    vi.clearAllMocks();
    mockedPost.mockResolvedValue({
      data: { choices: [{ message: { content: '1. 精准' } }] },
    } as never);

    const res = await request(app)
      .post('/api/acquisition/collect/report')
      .send({
        task_id: cancellingTaskId,
        video_id: `cancelling-vid-${RND}`,
        commenters: [
          { nickname: `cancelling-nick-${RND}`, comment_text: '预算10万求推荐', douyin_id: `cancelling-douyin-${RND}` },
        ],
        terminal: false,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.ignored).toBe(true);
    expect(mockedPost).not.toHaveBeenCalled();
  });
});
