/**
 * Sprint 06081603 — 心跳双向 modules 协议 + module-health 端点测试
 *
 * 覆盖三件事：
 *  1. POST /api/agent/heartbeat 响应含 modules 字段（4 个 Line，每个 status + required_version）
 *  2. POST body 带 module_status 时被持久化（saveModuleStatus 被调用）
 *  3. GET /api/agent/module-health 返回所有机器的 module_status 矩阵
 *
 * 沿用项目 mock service 约定，避免连真库。
 */

import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/app';
import * as wsService from '../../src/services/walking-skeleton.service';

vi.mock('../../src/services/walking-skeleton.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/walking-skeleton.service')>();
  return {
    ...actual,
    validateLicense: vi.fn(),
    upsertAgentByHeartbeat: vi.fn(),
    getQueuedTasks: vi.fn(),
    saveModuleStatus: vi.fn(),
    getAllModuleHealth: vi.fn(),
  };
});

const LICENSE = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  license_key: 'ZJ-B-ABCDEFGH',
  tenant_id: 'tenant-1',
  status: 'active' as const,
  expires_at: new Date(Date.now() + 365 * 86400_000).toISOString(),
};

const AGENT = {
  id: '11111111-2222-3333-4444-555555555555',
  tenant_id: 'tenant-1',
  agent_id: 'ws1-deadbeef',
  hostname: 'test-pc',
  version: '1.0.0',
  license_id: LICENSE.id,
  bound_folder_path: null,
  last_heartbeat_at: new Date().toISOString(),
  status: 'online',
  last_seen: new Date().toISOString(),
};

const EXPECTED_LINES = [
  'line04-wechat-cs',
  'line01-publish',
  'line02-lead-gen',
  'line05-video',
];

describe('POST /api/agent/heartbeat — 响应 modules 双向协议', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (wsService.validateLicense as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      license: LICENSE,
    });
    (wsService.upsertAgentByHeartbeat as ReturnType<typeof vi.fn>).mockResolvedValue(AGENT);
    (wsService.getQueuedTasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (wsService.saveModuleStatus as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('响应含 modules 字段，4 个 Line 每个有 status + required_version', async () => {
    const res = await request(app)
      .post('/api/agent/heartbeat')
      .send({ license: LICENSE.license_key, hostname: 'test-pc', version: '1.0.0' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.modules).toBeDefined();
    const EXPECTED_VERSIONS: Record<string, string> = {
      'line04-wechat-cs': '1.0.22',
      'line01-publish': '1.0.0',
      'line02-lead-gen': '1.0.0',
      'line05-video': '1.0.0',
    };
    for (const line of EXPECTED_LINES) {
      expect(res.body.modules[line]).toBeDefined();
      expect(res.body.modules[line].status).toBe('active');
      expect(res.body.modules[line].required_version).toBe(EXPECTED_VERSIONS[line] ?? '1.0.0');
    }
  });

  it('向后兼容：仍返回 ok / agent_id / queued_tasks', async () => {
    const res = await request(app)
      .post('/api/agent/heartbeat')
      .send({ license: LICENSE.license_key });

    expect(res.body.agent_id).toBe(AGENT.id);
    expect(Array.isArray(res.body.queued_tasks)).toBe(true);
  });

  it('POST body 带 module_status 时调用 saveModuleStatus 持久化', async () => {
    const moduleStatus = {
      'line04-wechat-cs': { ok: false, reason: 'wechat_version_4.2.0_unsupported' },
      'line01-publish': { ok: true },
    };
    const res = await request(app)
      .post('/api/agent/heartbeat')
      .send({ license: LICENSE.license_key, module_status: moduleStatus });

    expect(res.status).toBe(200);
    expect(wsService.saveModuleStatus).toHaveBeenCalledWith(AGENT.id, moduleStatus);
  });

  it('POST body 不带 module_status 时不调用 saveModuleStatus', async () => {
    await request(app)
      .post('/api/agent/heartbeat')
      .send({ license: LICENSE.license_key });

    expect(wsService.saveModuleStatus).not.toHaveBeenCalled();
  });
});

describe('GET /api/agent/module-health — Dashboard 读取模块健康矩阵', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (wsService.validateLicense as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      license: LICENSE,
    });
  });

  it('返回所有已注册机器的 module_status 数据', async () => {
    const rows = [
      {
        agent_id: AGENT.id,
        hostname: 'test-pc',
        module_status: {
          'line04-wechat-cs': { ok: false, reason: 'wechat_version_4.2.0_unsupported' },
          'line01-publish': { ok: true },
        },
        updated_at: new Date().toISOString(),
      },
    ];
    (wsService.getAllModuleHealth as ReturnType<typeof vi.fn>).mockResolvedValue(rows);

    const res = await request(app)
      .get('/api/agent/module-health')
      .set('Authorization', `Bearer ${LICENSE.license_key}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].agent_id).toBe(AGENT.id);
    expect(res.body.data[0].hostname).toBe('test-pc');
    expect(res.body.data[0].module_status['line04-wechat-cs'].ok).toBe(false);
    expect(res.body.data[0].module_status['line04-wechat-cs'].reason).toBe(
      'wechat_version_4.2.0_unsupported'
    );
    expect(res.body.data[0].updated_at).toBeDefined();
  });

  it('无数据时返回空数组', async () => {
    (wsService.getAllModuleHealth as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const res = await request(app)
      .get('/api/agent/module-health')
      .set('Authorization', `Bearer ${LICENSE.license_key}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toEqual([]);
  });
});
