/**
 * Worker 活动协议 — 冻结失败测试（TDD Red）
 * Sprint: 08301650-kernel-24b76ace — 工作机控制塔可视化·第一刀
 *
 * 覆盖（BEHAVIOR 覆盖名 = 下方 it() 名的字面子串，供 Test Contract 映射）：
 *   - POST tasks 返回 task_id 且续租        → "POST tasks 返回 task_id"
 *   - steps failed 缺三件套返回 400          → "steps failed 缺三件套返回 400"
 *   - steps failed 带三件套现场落库          → "steps failed 带三件套现场落库"
 *   - 同 agent 第二个 running 任务返回 409    → "同 agent 第二个 running 任务返回 409"
 *   - 跨租户 activity 返回 404               → "跨租户 activity 返回 404"
 *   - 总览列出 win32 与 android 卡片          → "总览列出 win32 与 android 卡片"
 *   - worker_tasks 真库写入带时间窗           → "worker_tasks 真库写入带时间窗"
 *
 * 禁 mock 边（CONTRACT IS LAW）：本文件不 mock 任何被改的边——
 *   打真实 api（$API_BASE，未实现时 404 / 连不上 = 真红）+ 真 Postgres（$DATABASE_URL，
 *   验 worker_tasks 落库）。不得引入 vi.mock('pg') / vi.mock('.../db/connection')。
 *
 * 实现文件（待建）：
 *   apps/api/src/routes/workers.ts
 *   apps/api/src/app.ts（挂载 /api/workers）
 *   apps/api/db/migrations/*_worker_tasks.sql（zenithjoy.worker_tasks / worker_task_steps）
 *   apps/api/src/services/worker-lease-sweeper.ts
 *
 * NOTE: 未实现时 supertest 收 404 / ECONNREFUSED，断言失败 = 可失败的真实断言（Red）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { Client } from 'pg';

const API_BASE = process.env.API_BASE || 'http://localhost:5200';
// 两个真实租户 uuid（E2E_FAKE_EXECUTORS 启动 seed 出 stub agents 归属租户 A）
const TENANT_A = process.env.E2E_TENANT_A || '00000000-0000-0000-0000-00000000000a';
const TENANT_B = process.env.E2E_TENANT_B || '00000000-0000-0000-0000-00000000000b';
const AGENT_WIN = process.env.E2E_AGENT_WIN || 'stub-win32-1';
const AGENT_AND = process.env.E2E_AGENT_ANDROID || 'stub-android-1';
const EXECUTOR = 'e2e-fake-executor';

// 执行器→服务端写通道：可信内部调用，携带 X-Tenant-Id（沿用 agent-machines 的 tenantContextOptional 约定）
const asExecutor = (t: string) => ({ 'X-Tenant-Id': t, 'Content-Type': 'application/json' });
// 主理人读通道：本 sprint 测试用 X-Feishu-User-Id 兜底租户；真机走 better-auth session
const asTenant = (t: string) => ({ 'X-Tenant-Id': t });

describe('Worker 活动协议 [BEHAVIOR]', () => {
  it('POST tasks 返回 task_id 且带 lease_until', async () => {
    const res = await request(API_BASE)
      .post(`/api/workers/${AGENT_WIN}/tasks`)
      .set(asExecutor(TENANT_A))
      .send({ title: '发布视频到抖音', steps: ['打开抖音', '选视频', '填标题', '发布', '确认'], executor_id: EXECUTOR });
    expect(res.status).toBe(200);
    expect(typeof res.body.task_id).toBe('string');
    expect(typeof res.body.lease_until).toBe('string');
  });

  it('steps failed 缺三件套返回 400', async () => {
    // 先开一个任务
    const t = await request(API_BASE)
      .post(`/api/workers/${AGENT_AND}/tasks`)
      .set(asExecutor(TENANT_A))
      .send({ title: '私信触达', steps: ['进入会话', '发送'], executor_id: EXECUTOR });
    const taskId = t.body.task_id;
    const res = await request(API_BASE)
      .post(`/api/workers/tasks/${taskId}/steps`)
      .set(asExecutor(TENANT_A))
      // 故意缺 foreground_pkg / diag_line / screenshot_jpeg_b64
      .send({ step_index: 0, status: 'failed', executor_id: EXECUTOR });
    expect(res.status).toBe(400);
  });

  it('steps failed 带三件套现场落库（前台包名+诊断行+截图）', async () => {
    const t = await request(API_BASE)
      .post(`/api/workers/${AGENT_AND}/tasks`)
      .set(asExecutor(TENANT_A))
      .send({ title: '私信触达2', steps: ['进入会话', '发送'], executor_id: EXECUTOR });
    const taskId = t.body.task_id;
    const res = await request(API_BASE)
      .post(`/api/workers/tasks/${taskId}/steps`)
      .set(asExecutor(TENANT_A))
      .send({
        step_index: 0,
        status: 'failed',
        foreground_pkg: 'com.tencent.mm',
        diag_line: 'searchBtnFound=true but foreground stolen after tap',
        screenshot_jpeg_b64: Buffer.from('fake-jpeg').toString('base64'),
        executor_id: EXECUTOR,
      });
    expect(res.status).toBe(200);
    const act = await request(API_BASE).get(`/api/workers/${AGENT_AND}/activity`).set(asTenant(TENANT_A));
    const step = (act.body.history?.[0]?.steps || act.body.current?.steps || []).find((s: any) => s.status === 'failed');
    expect(step).toBeTruthy();
    expect(step.foreground_pkg).toBe('com.tencent.mm');
    expect(step.diag_line).toContain('foreground stolen');
    expect(typeof step.screenshot_ref).toBe('string');
  });

  it('同 agent 第二个 running 任务返回 409', async () => {
    await request(API_BASE)
      .post(`/api/workers/${AGENT_WIN}/tasks`)
      .set(asExecutor(TENANT_A))
      .send({ title: '任务甲', steps: ['a'], executor_id: EXECUTOR });
    const dup = await request(API_BASE)
      .post(`/api/workers/${AGENT_WIN}/tasks`)
      .set(asExecutor(TENANT_A))
      .send({ title: '任务乙', steps: ['b'], executor_id: EXECUTOR });
    expect(dup.status).toBe(409);
  });

  it('跨租户 activity 返回 404（不泄露存在性）', async () => {
    const res = await request(API_BASE).get(`/api/workers/${AGENT_WIN}/activity`).set(asTenant(TENANT_B));
    expect(res.status).toBe(404);
  });

  it('总览列出 win32 与 android 卡片', async () => {
    const res = await request(API_BASE).get('/api/workers').set(asTenant(TENANT_A));
    expect(res.status).toBe(200);
    const kinds = (res.body.workers || []).map((w: any) => w.kind);
    expect(kinds).toContain('win32');
    expect(kinds).toContain('android');
  });
});

describe('Worker 存储真库写入 [BEHAVIOR] 禁 mock 边（真 Postgres）', () => {
  const dbUrl = process.env.DATABASE_URL;
  let client: Client;
  beforeAll(async () => {
    // 未提供 DATABASE_URL（本 attempt runtime_resources.postgres=false）→ 连接失败 = 真红；CI Sprint Tests 供真库转绿
    client = new Client({ connectionString: dbUrl });
    await client.connect();
  });

  it('worker_tasks 真库写入带时间窗（5 分钟内）', async () => {
    // 通过真实端点创建任务
    const t = await request(API_BASE)
      .post(`/api/workers/${AGENT_WIN}/tasks`)
      .set(asExecutor(TENANT_A))
      .send({ title: 'db-窗口校验', steps: ['x'], executor_id: EXECUTOR });
    const taskId = t.body.task_id;
    const r = await client.query(
      `SELECT count(*)::int AS n FROM zenithjoy.worker_tasks
        WHERE id = $1 AND tenant_id = $2 AND started_at > now() - interval '5 minutes'`,
      [taskId, TENANT_A],
    );
    expect(r.rows[0].n).toBe(1);
  });
});
