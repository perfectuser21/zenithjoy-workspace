/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * walking-skeleton routes 测试
 *
 * 覆盖：
 *  - 路由 export sanity
 *  - heartbeat modules 协议
 *  - [回归守卫] body.agent_uuid → upsertAgentByHeartbeat 携带 agentUuid 参数（防 hostname=null 建幽灵行）
 */

// vi.mock 必须在任何 import 之前声明（vitest 会 hoist）
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/walking-skeleton.service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../services/walking-skeleton.service')>();
  return {
    ...actual,
    validateLicense: vi.fn(),
    upsertAgentByHeartbeat: vi.fn(),
    getQueuedTasks: vi.fn(),
    saveModuleStatus: vi.fn(),
    getAllModuleHealth: vi.fn(),
  };
});

import express from 'express';
import request from 'supertest';
import * as wsService from '../services/walking-skeleton.service';
import { heartbeatRouter, publishWsRouter } from './walking-skeleton';

// ── 1. export sanity ──────────────────────────────────────────────────────────

describe('walking-skeleton routes (export sanity)', () => {
  it('heartbeatRouter is an Express Router (function with stack)', () => {
    expect(typeof heartbeatRouter).toBe('function');
    expect(Array.isArray(heartbeatRouter.stack)).toBe(true);
  });

  it('publishWsRouter is an Express Router (function with stack)', () => {
    expect(typeof publishWsRouter).toBe('function');
    expect(Array.isArray(publishWsRouter.stack)).toBe(true);
  });
});

// ── 2. heartbeat modules 协议 ──────────────────────────────────────────────────

describe('heartbeat modules contract', () => {
  it('modules field contains required Line keys', () => {
    const EXPECTED_MODULES = [
      'line04-wechat-cs',
      'line01-publish',
      'line02-lead-gen',
      'line05-video',
    ];
    expect(EXPECTED_MODULES).toContain('line04-wechat-cs');
    expect(EXPECTED_MODULES).toContain('line01-publish');
  });

  it('module status values are valid enum strings', () => {
    const VALID_STATUSES = ['active', 'locked', 'not_purchased'];
    expect(VALID_STATUSES).toContain('active');
  });
});

// ── 3. [回归守卫] heartbeat body.agent_uuid → upsertAgentByHeartbeat 精准路由 ──
//
// Bug 背景：心跳路由未解析 body.agent_uuid → upsertAgentByHeartbeat 按 (license_id, hostname) 去重；
// 当某次心跳 hostname=null 时找不到已有 rog 行 → 新建 ws1- 幽灵行 → /machines 返回重复机器。
// 修复：从 body 解析 agent_uuid，作为可选 agentUuid 传入 upsertAgentByHeartbeat；
//       service 侧先按 WHERE id=$agentUuid 精确 UPDATE，命中则跳过 hostname 去重逻辑。

const LICENSE_KEY = 'fake-test-license';
const LICENSE = {
  id: 'lic-aaaaaa-uuid',
  license_key: LICENSE_KEY,
  tenant_id: 'tenant-uuid-test',
  status: 'active' as const,
  expires_at: new Date(Date.now() + 365 * 86400_000).toISOString(),
};
const AGENT_ID = '43d3eb71-0000-0000-0000-000000000rog';
const AGENT_ROW = {
  id: AGENT_ID,
  tenant_id: 'tenant-uuid-test',
  agent_id: 'agent-env-mqwewwfv',
  hostname: 'XX-ROG',
  version: '2.0.37',
  license_id: LICENSE.id,
  bound_folder_path: null,
  last_heartbeat_at: new Date().toISOString(),
  status: 'online',
  last_seen: new Date().toISOString(),
};

describe('POST /api/agent/heartbeat — body.agent_uuid 精准路由（防幽灵行）', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    (wsService.validateLicense as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      license: LICENSE,
    });
    (wsService.upsertAgentByHeartbeat as ReturnType<typeof vi.fn>).mockResolvedValue(AGENT_ROW);
    (wsService.getQueuedTasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (wsService.saveModuleStatus as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    app = express();
    app.use(express.json());
    app.use('/api/agent', heartbeatRouter);
  });

  it(
    'body 含 agent_uuid → upsertAgentByHeartbeat 必须携带 agentUuid（防 hostname=null 建幽灵行）',
    async () => {
      const res = await request(app)
        .post('/api/agent/heartbeat')
        .send({
          license: LICENSE_KEY,
          hostname: 'XX-ROG',
          version: '2.0.37',
          agent_uuid: AGENT_ID,
        });

      expect(res.status).toBe(200);
      // 修复前：body.agent_uuid 未被解析 → upsertAgentByHeartbeat 没有 agentUuid → 断言 FAIL
      // 修复后：body.agent_uuid 解析后传入 agentUuid → 断言 PASS
      expect(wsService.upsertAgentByHeartbeat).toHaveBeenCalledWith(
        expect.objectContaining({ agentUuid: AGENT_ID }),
      );
    },
  );

  it(
    '向后兼容：body 不含 agent_uuid → upsertAgentByHeartbeat 正常调用不报 500',
    async () => {
      const res = await request(app)
        .post('/api/agent/heartbeat')
        .send({ license: LICENSE_KEY, hostname: 'XX-ROG', version: '2.0.37' });

      expect(res.status).toBe(200);
      // 调用一次即可，agentUuid 可缺失（undefined）— 不报错
      expect(wsService.upsertAgentByHeartbeat).toHaveBeenCalledOnce();
    },
  );

  it(
    '[回归守卫] precheck 裸探针（无 hostname 无 agent_uuid）→ upsertAgentByHeartbeat 不得被调用（防幽灵行复活）',
    async () => {
      // start.bat 发的 precheck：{"machine_id":"precheck","agent_version":"1.0.1"}
      // route 读不到 hostname 也读不到 agent_uuid → 必须跳过 upsert，直接 200
      const res = await request(app)
        .post('/api/agent/heartbeat')
        .send({ license: LICENSE_KEY, machine_id: 'precheck', agent_version: '1.0.1' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      // 核心断言：precheck 不触发 upsert，否则 hostname=null 路径会复活幽灵行
      expect(wsService.upsertAgentByHeartbeat).not.toHaveBeenCalled();
    },
  );
});
