/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * B-1 burner real-qr fix — heartbeat 必须传真 task.payload.account_label 给 Agent
 *
 * Root cause: 老 heartbeat handler 硬编码 `account_label: 'default'`,
 * burner handler 拿 'default' → 用 cached cookie path → URL 已登录 → return success
 * → 没真扫码弹码。
 *
 * Fix: heartbeat queued_tasks payload 优先合并 t.payload, account_label 取 t.payload.account_label
 * (fallback 'default' 给 legacy folder_bind tasks)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn(), connect: vi.fn() },
}));
vi.mock('../../middleware/license-auth', () => ({
  licenseAuth: (req: any, _res: any, next: any) => {
    req.license = { id: 'lic-1', tenant_id: 'tenant-1' };
    next();
  },
}));
vi.mock('../../services/walking-skeleton.service', () => ({
  upsertAgentByHeartbeat: vi.fn(async () => ({ id: 'agent-uuid-1', tenant_id: 'tenant-1', agent_id: 'a1', hostname: 'h1', version: '1.0.1', license_id: 'lic-1', bound_folder_path: null, last_heartbeat_at: null, status: 'online', last_seen: null })),
  getQueuedTasks: vi.fn(),
  findAgentById: vi.fn(),
  bindFolder: vi.fn(),
  createPublishTask: vi.fn(),
  submitPublishReceipt: vi.fn(),
  getPublishTask: vi.fn(),
  isValidPublishType: vi.fn(),
  // Sprint 06081603: heartbeat handler 新增依赖（下发 modules + 上报 module_status）
  saveModuleStatus: vi.fn(),
  getAllModuleHealth: vi.fn(),
  HEARTBEAT_MODULES: {
    'line04-wechat-cs': { status: 'active', required_version: '1.0.1' },
    'line01-publish': { status: 'active', required_version: '1.0.0' },
    'line02-lead-gen': { status: 'active', required_version: '1.0.0' },
    'line05-video': { status: 'active', required_version: '1.0.0' },
  },
}));

import { heartbeatRouter } from '../walking-skeleton';
import { getQueuedTasks } from '../../services/walking-skeleton.service';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agent', heartbeatRouter);
  return app;
}

describe('heartbeat queued_tasks payload passthrough [B-1 burner real-qr]', () => {
  beforeEach(() => {
    vi.mocked(getQueuedTasks).mockReset();
  });

  it('真 task.payload.account_label 透传 (不被 default 覆盖)', async () => {
    vi.mocked(getQueuedTasks).mockResolvedValueOnce([
      {
        id: 'task-1',
        agent_id: 'agent-uuid-1',
        platform: 'qr_bind/douyin_burner',
        status: 'queued' as any,
        type: 'image' as any,
        folder_path: null,
        result: null,
        receipt_at: null,
        created_at: '2026-05-11T00:00:00Z',
        payload: {
          account_label: 'rog-real-burner-test',
          tenant_id: 'tenant-1',
          agent_id: 'agent-uuid-1',
        },
      } as any,
    ]);
    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/heartbeat')
      .send({ version: '1.0.1', hostname: 'XX-ROG' });
    expect(r.status).toBe(200);
    expect(r.body.queued_tasks).toHaveLength(1);
    const task = r.body.queued_tasks[0];
    // 关键：真 account_label 透传 (不是 'default')
    expect(task.payload.account_label).toBe('rog-real-burner-test');
    // 真 payload 其他字段也应透传
    expect(task.payload.tenant_id).toBe('tenant-1');
    expect(task.payload.agent_id).toBe('agent-uuid-1');
  });

  it('legacy folder_bind task (payload null) → fallback account_label=default', async () => {
    vi.mocked(getQueuedTasks).mockResolvedValueOnce([
      {
        id: 'legacy-task',
        agent_id: 'agent-uuid-1',
        platform: 'folder_bind',
        status: 'pending' as any,
        type: 'image' as any,
        folder_path: '/some/path',
        result: null,
        receipt_at: null,
        created_at: '2026-05-11T00:00:00Z',
        payload: null,
      } as any,
    ]);
    const app = buildApp();
    const r = await request(app).post('/api/agent/heartbeat').send({});
    expect(r.status).toBe(200);
    expect(r.body.queued_tasks[0].payload.account_label).toBe('default');
    expect(r.body.queued_tasks[0].payload.folder_path).toBe('/some/path');
  });
});
