/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Sprint 06222100 — 核心自升级：心跳响应必须下发 required_agent_version
 *
 * 根治"客户机 Agent 核心不自升级"：模块（line04）有 required_version 自升级，但核心运行时本体
 * 一直没有自升级信号。中台心跳响应加 required_agent_version（含 version/sha256/size），
 * 客户端据此对比自身版本，> 自身则下载新核心包自换重启。
 */
import { describe, it, expect, vi } from 'vitest';
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
  upsertAgentByHeartbeat: vi.fn(async () => ({
    id: 'agent-uuid-1',
    tenant_id: 'tenant-1',
    agent_id: 'a1',
    hostname: 'h1',
    version: '2.0.20',
    license_id: 'lic-1',
    bound_folder_path: null,
    last_heartbeat_at: null,
    status: 'online',
    last_seen: null,
  })),
  getQueuedTasks: vi.fn(async () => []),
  findAgentById: vi.fn(),
  bindFolder: vi.fn(),
  createPublishTask: vi.fn(),
  submitPublishReceipt: vi.fn(),
  getPublishTask: vi.fn(),
  isValidPublishType: vi.fn(),
  saveModuleStatus: vi.fn(),
  getAllModuleHealth: vi.fn(),
  HEARTBEAT_MODULES: {
    'line04-wechat-cs': { status: 'active', required_version: '1.0.55' },
  },
  // 核心自升级单一来源
  getRequiredAgentVersion: vi.fn(() => ({
    version: '2.0.22',
    sha256: 'sha-of-core-pack',
    size: 12345,
  })),
}));

import { heartbeatRouter } from '../walking-skeleton';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agent', heartbeatRouter);
  return app;
}

describe('heartbeat 下发 required_agent_version [核心自升级]', () => {
  it('响应含 required_agent_version（含 version/sha256/size），供客户端核心自升级', async () => {
    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/heartbeat')
      .send({ version: '2.0.20', hostname: 'XX-ROG' });
    expect(r.status).toBe(200);
    expect(r.body.required_agent_version).toBeDefined();
    expect(r.body.required_agent_version.version).toBe('2.0.22');
    // sha/size 一并下发，客户端下载后校验，防中途篡改/截断
    expect(r.body.required_agent_version.sha256).toBe('sha-of-core-pack');
    expect(r.body.required_agent_version.size).toBe(12345);
  });
});
