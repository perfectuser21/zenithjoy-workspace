/**
 * pending-collect-tasks 响应体须带 video_titles — [REGRESSION]
 *
 * 2026-07-19 根因排查：acquisition_collect_videos.title 列早已存在且 report-videos
 * 已支持写入，但 GET /pending-collect-tasks 的 stage_2 响应体只回传纯 URL 字符串数组
 * (video_urls)，没有任何字段能把 title 带回 Android——即使 Stage1 把 title 存进库了，
 * Stage2 判定时 Android 侧依然拿不到，"转写文案+title判定"(判定点1d078987)的 title
 * 信号在这一步断链。
 *
 * commit-1 时 RED（video_titles 字段不存在于响应体）；commit-2 GREEN。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../../src/app';
import { testPool, createTestTenant } from '../helpers';

let tenantId: string;
let agentId: string;
let taskId: string;
const RND = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

beforeAll(async () => {
  const tenant = await createTestTenant(`pending-tasks-titles-test-${RND}`);
  tenantId = tenant.id;

  const aRes = await testPool.query(
    `INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status, os_type, capabilities, last_heartbeat_at)
     VALUES ($1, $2, 'pending-tasks-titles-host', 'online', 'android', ARRAY['android'], NOW())
     RETURNING id`,
    [tenantId, `pending-tasks-titles-agent-${RND}`],
  );
  agentId = aRes.rows[0].id;

  const tRes = await testPool.query(
    `INSERT INTO zenithjoy.acquisition_collect_tasks (tenant_id, keywords, status, agent_id)
     VALUES ($1, $2::jsonb, 'stage_1_done', $3)
     RETURNING id`,
    [tenantId, JSON.stringify(['装修']), `pending-tasks-titles-agent-${RND}`],
  );
  taskId = tRes.rows[0].id;

  await testPool.query(
    `INSERT INTO zenithjoy.acquisition_collect_videos (video_id, task_id, tenant_id, title)
     VALUES ($1, $2, $3, $4)`,
    [`ptt-vid-${RND}`, taskId, tenantId, '真实标题测试样本'],
  );
});

afterAll(async () => {
  await testPool.query('DELETE FROM zenithjoy.acquisition_collect_videos WHERE task_id = $1', [taskId]);
  await testPool.query('DELETE FROM zenithjoy.acquisition_collect_tasks WHERE id = $1', [taskId]);
  await testPool.query('DELETE FROM zenithjoy.agents WHERE id = $1', [agentId]);
  await testPool.query('DELETE FROM zenithjoy.tenants WHERE id = $1', [tenantId]);
});

describe('GET /pending-collect-tasks video_titles [REGRESSION]', () => {
  it('stage_2 任务响应体须带 video_titles，videoId→title 与库里一致', async () => {
    const res = await request(app)
      .get('/api/acquisition/pending-collect-tasks')
      .set('x-agent-id', `pending-tasks-titles-agent-${RND}`);

    expect(res.status).toBe(200);
    const task = res.body.tasks.find((t: { task_id: string }) => t.task_id === taskId);
    expect(task).toBeDefined();
    expect(task.stage).toBe('stage_2');
    expect(task.video_titles).toBeDefined();
    expect(task.video_titles[`ptt-vid-${RND}`]).toBe('真实标题测试样本');
  });
});
