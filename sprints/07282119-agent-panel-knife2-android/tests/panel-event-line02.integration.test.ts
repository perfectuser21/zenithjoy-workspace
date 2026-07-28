/**
 * Sprint 07282119-agent-panel-knife2-android — 合同测试（TDD Red 阶段）
 *
 * 覆盖 Golden Path Step 1/2/3/4/5/8：
 *   POST /api/agent/burner/panel-event（新端点，body agent_id 反查 tenant，同 account-scan-result 模型）
 *   GET  /api/agent/burner/panel-active-tasks（新端点，中台 3 分钟看门狗计算）
 *
 * 禁mock边：真 Postgres + 真 app（supertest），不 mock DB 写路径。
 * 仿 apps/api/tests/integration/p2-sprint-b1-ws3/agent-burner-routes.test.ts 同款真库模式。
 *
 * 运行前提：本地/CI 有可连接的 Postgres（DATABASE_* 环境变量），已跑过 migrations（含
 * 20260728_112227_panel_events.sql）。此刻端点尚未实现，POST/GET 应 404 —— 这就是 TDD Red 证据。
 */
import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import app from '../../../apps/api/src/app';

let pool: Pool;
let tenantId: string;
let agentId: string;

beforeAll(async () => {
  pool = new Pool({
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    database: process.env.DATABASE_NAME || 'cecelia',
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD,
  });

  const t = await pool.query(
    `INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ($1, $2, 'free') RETURNING id`,
    [`sprint-line02-panel-${Date.now()}`, `ZJ-F-line02panel-${Date.now()}`],
  );
  tenantId = t.rows[0].id;

  const a = await pool.query(
    `INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status) VALUES ($1, $2, 'android-device', 'online') RETURNING id`,
    [tenantId, `sprint-line02-panel-machine-${Date.now()}`],
  );
  agentId = a.rows[0].id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM zenithjoy.panel_events WHERE tenant_id=$1`, [tenantId]);
  await pool.query(`DELETE FROM zenithjoy.agents WHERE id=$1`, [agentId]);
  await pool.query(`DELETE FROM zenithjoy.tenants WHERE id=$1`, [tenantId]);
  await pool.end();
});

describe('POST /api/agent/burner/panel-event [BEHAVIOR]', () => {
  it('task_started 写入 panel_events，tenant_id 为服务端反查值', async () => {
    const taskId = `test-scan-${Date.now()}`;
    const r = await request(app)
      .post('/api/agent/burner/panel-event')
      .send({
        agent_id: agentId, event: 'task_started', task_id: taskId, line: 'line02', device: 'RMX3478-b6ee', title: 'x', progress: [1, 3],
      });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);

    const row = await pool.query(
      `SELECT tenant_id, event, line, device FROM zenithjoy.panel_events WHERE task_id=$1`,
      [taskId],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].tenant_id).toBe(tenantId);
    expect(row.rows[0].event).toBe('task_started');
    expect(row.rows[0].line).toBe('line02');
    expect(row.rows[0].device).toBe('RMX3478-b6ee');
  });

  it('step 事件 progress 字段正确写入', async () => {
    const taskId = `test-step-${Date.now()}`;
    await request(app).post('/api/agent/burner/panel-event').send({
      agent_id: agentId, event: 'task_started', task_id: taskId, line: 'line02', device: 'RMX3478-b6ee', title: 'x', progress: [1, 3],
    });
    const r = await request(app).post('/api/agent/burner/panel-event').send({
      agent_id: agentId, event: 'step', task_id: taskId, line: 'line02', device: 'RMX3478-b6ee', title: 'x', progress: [2, 3],
    });
    expect(r.status).toBe(200);
    const row = await pool.query(
      `SELECT progress FROM zenithjoy.panel_events WHERE task_id=$1 AND event='step'`,
      [taskId],
    );
    expect(row.rows[0].progress).toEqual([2, 3]);
  });

  it('failed 事件 detail 携带 error_code，severity=error', async () => {
    const taskId = `test-fail-${Date.now()}`;
    const r = await request(app).post('/api/agent/burner/panel-event').send({
      agent_id: agentId, event: 'failed', task_id: taskId, line: 'line02', device: 'RMX3478-b6ee', title: 'x', detail: 'OPEN_PANEL_FAILED', severity: 'error',
    });
    expect(r.status).toBe(200);
    const row = await pool.query(
      `SELECT detail, severity FROM zenithjoy.panel_events WHERE task_id=$1 AND event='failed'`,
      [taskId],
    );
    expect(row.rows[0].detail).toBe('OPEN_PANEL_FAILED');
    expect(row.rows[0].severity).toBe('error');
  });

  it('缺 agent_id → 400 MISSING_AGENT_ID，不写库', async () => {
    const taskId = `test-missing-${Date.now()}`;
    const r = await request(app).post('/api/agent/burner/panel-event').send({
      event: 'task_started', task_id: taskId, line: 'line02', device: 'x', title: 'x',
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('MISSING_AGENT_ID');
    const row = await pool.query(`SELECT 1 FROM zenithjoy.panel_events WHERE task_id=$1`, [taskId]);
    expect(row.rows).toHaveLength(0);
  });

  it('line 不是 line02 → 400 INVALID_LINE', async () => {
    const r = await request(app).post('/api/agent/burner/panel-event').send({
      agent_id: agentId, event: 'task_started', task_id: 'x', line: 'line99', device: 'x', title: 'x',
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('INVALID_LINE');
  });

  it('agent_id 不存在 → 404 AGENT_NOT_FOUND，不信任客户端 tenant', async () => {
    const r = await request(app).post('/api/agent/burner/panel-event').send({
      agent_id: '00000000-0000-0000-0000-000000000000', event: 'task_started', task_id: 'x', line: 'line02', device: 'x', title: 'x',
    });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('AGENT_NOT_FOUND');
  });
});

describe('GET /api/agent/burner/panel-active-tasks [BEHAVIOR]', () => {
  it('缺 X-Tenant-Id → 400', async () => {
    const r = await request(app).get('/api/agent/burner/panel-active-tasks?line=line02');
    expect(r.status).toBe(400);
  });

  it('activeTasks 里 title/progress 字段确实透传（Reviewer round1 问题3）', async () => {
    const taskId = `test-passthrough-${Date.now()}`;
    await request(app).post('/api/agent/burner/panel-event').send({
      agent_id: agentId,
      event: 'task_started',
      task_id: taskId,
      line: 'line02',
      device: 'RMX3478-b6ee',
      title: '📱 RMX3478-b6ee 第1/3步',
      progress: [1, 3],
    });
    const r = await request(app)
      .get('/api/agent/burner/panel-active-tasks?line=line02')
      .set('X-Tenant-Id', tenantId);
    expect(r.status).toBe(200);
    const task = r.body.activeTasks.find((t: { task_id: string }) => t.task_id === taskId);
    expect(task).toBeDefined();
    expect(task.title).toBe('📱 RMX3478-b6ee 第1/3步');
    expect(task.progress).toEqual([1, 3]);
  });

  it('3分钟无新事件（时间窗口回填）→ state=stuck', async () => {
    const taskId = `test-stuck-${Date.now()}`;
    await pool.query(
      `INSERT INTO zenithjoy.panel_events (tenant_id, task_id, event, line, device, title, progress, created_at)
       VALUES ($1, $2, 'task_started', 'line02', 'RMX3478-c3d4', 'x', '[1,3]', NOW() - interval '4 minutes')`,
      [tenantId, taskId],
    );
    const r = await request(app)
      .get('/api/agent/burner/panel-active-tasks?line=line02')
      .set('X-Tenant-Id', tenantId);
    expect(r.status).toBe(200);
    const task = r.body.activeTasks.find((t: { task_id: string }) => t.task_id === taskId);
    expect(task).toBeDefined();
    expect(task.state).toBe('stuck');
  });

  it('stuck 任务收到新事件后自动脱离 stuck（PRD 边界情况：无需人工干预）', async () => {
    const taskId = `test-recover-${Date.now()}`;
    await pool.query(
      `INSERT INTO zenithjoy.panel_events (tenant_id, task_id, event, line, device, title, progress, created_at)
       VALUES ($1, $2, 'task_started', 'line02', 'RMX3478-c3d4', 'x', '[1,3]', NOW() - interval '4 minutes')`,
      [tenantId, taskId],
    );
    await request(app).post('/api/agent/burner/panel-event').send({
      agent_id: agentId, event: 'step', task_id: taskId, line: 'line02', device: 'RMX3478-c3d4', title: 'x', progress: [2, 3],
    });
    const r = await request(app)
      .get('/api/agent/burner/panel-active-tasks?line=line02')
      .set('X-Tenant-Id', tenantId);
    const task = r.body.activeTasks.find((t: { task_id: string }) => t.task_id === taskId);
    expect(task.state).not.toBe('stuck');
  });

  it('done 事件后任务从 activeTasks 消失，出现在 recentCompleted', async () => {
    const taskId = `test-done-${Date.now()}`;
    await request(app).post('/api/agent/burner/panel-event').send({
      agent_id: agentId, event: 'task_started', task_id: taskId, line: 'line02', device: 'RMX3478-b6ee', title: 'x', progress: [1, 1],
    });
    await request(app).post('/api/agent/burner/panel-event').send({
      agent_id: agentId, event: 'done', task_id: taskId, line: 'line02', device: 'RMX3478-b6ee', title: 'x',
    });
    const r = await request(app)
      .get('/api/agent/burner/panel-active-tasks?line=line02')
      .set('X-Tenant-Id', tenantId);
    expect(r.body.activeTasks.find((t: { task_id: string }) => t.task_id === taskId)).toBeUndefined();
    const done = r.body.recentCompleted.find((t: { task_id: string }) => t.task_id === taskId);
    expect(done).toBeDefined();
    expect(done.state).toBe('done');
  });

  it('跨租户互不可见（Invariant 租户隔离）', async () => {
    const other = await pool.query(
      `INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ($1, $2, 'free') RETURNING id`,
      [`sprint-line02-other-${Date.now()}`, `ZJ-F-other-${Date.now()}`],
    );
    const otherTenantId = other.rows[0].id;
    const taskId = `test-isolation-${Date.now()}`;
    await request(app).post('/api/agent/burner/panel-event').send({
      agent_id: agentId, event: 'task_started', task_id: taskId, line: 'line02', device: 'x', title: 'x', progress: [1, 1],
    });
    const r = await request(app)
      .get('/api/agent/burner/panel-active-tasks?line=line02')
      .set('X-Tenant-Id', otherTenantId);
    expect(r.body.activeTasks.find((t: { task_id: string }) => t.task_id === taskId)).toBeUndefined();
    await pool.query(`DELETE FROM zenithjoy.tenants WHERE id=$1`, [otherTenantId]);
  });

  it('同型号两台设备并发扫描不合并显示（Invariant 多设备类型UI区分）', async () => {
    const a2 = await pool.query(
      `INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status) VALUES ($1, $2, 'android-device-2', 'online') RETURNING id`,
      [tenantId, `sprint-line02-device2-${Date.now()}`],
    );
    const agent2Id = a2.rows[0].id;
    const t1 = `test-multidev-a-${Date.now()}`;
    const t2 = `test-multidev-b-${Date.now()}`;
    await request(app).post('/api/agent/burner/panel-event').send({
      agent_id: agentId, event: 'task_started', task_id: t1, line: 'line02', device: 'RMX3478-b6ee', title: 'x', progress: [1, 1],
    });
    await request(app).post('/api/agent/burner/panel-event').send({
      agent_id: agent2Id, event: 'task_started', task_id: t2, line: 'line02', device: 'RMX3478-a1f2', title: 'x', progress: [1, 1],
    });
    const r = await request(app)
      .get('/api/agent/burner/panel-active-tasks?line=line02')
      .set('X-Tenant-Id', tenantId);
    const task1 = r.body.activeTasks.find((t: { task_id: string }) => t.task_id === t1);
    const task2 = r.body.activeTasks.find((t: { task_id: string }) => t.task_id === t2);
    expect(task1).toBeDefined();
    expect(task2).toBeDefined();
    expect(task1.device).not.toBe(task2.device);
    await pool.query(`DELETE FROM zenithjoy.agents WHERE id=$1`, [agent2Id]);
  });
});
