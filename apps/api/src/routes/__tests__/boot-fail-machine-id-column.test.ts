/**
 * 回归测试：POST /api/agent/boot-fail 的 UPDATE zenithjoy.agents ... WHERE machine_id = $2
 * 引用了不存在的列 —— zenithjoy.agents 表（20260428_100100_create_agents.sql）没有
 * machine_id 列，machine_id 只存在于 zenithjoy.license_machines 表。
 *
 * 生产 staging 直接对该 SQL 探测过：ERROR: column "machine_id" does not exist（42703）。
 * 本测试 mock pool.query 复现同样的 schema 约束：SQL 若直接对 agents 表按 machine_id
 * 过滤而不经 license_machines 反查，一律像真实 Postgres 一样抛 42703 —— 逼修复走
 * license_machines JOIN 反查 agent_id 再更新。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

interface FakeLicenseMachine {
  machine_id: string;
  agent_id: string | null;
}
interface FakeAgent {
  id: string;
  agent_id: string;
  last_boot_error: unknown;
}

let licenseMachines: FakeLicenseMachine[];
let agents: FakeAgent[];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const isAgentsUpdateByMachineId =
    /UPDATE\s+zenithjoy\.agents\b/i.test(sql) && /\bmachine_id\s*=/i.test(sql);
  const joinsLicenseMachines = /zenithjoy\.license_machines/i.test(sql);

  if (isAgentsUpdateByMachineId && !joinsLicenseMachines) {
    // 真实 Postgres 约束复现：zenithjoy.agents 没有 machine_id 列
    const err = new Error('column "machine_id" does not exist') as Error & { code: string };
    err.code = '42703';
    throw err;
  }

  if (isAgentsUpdateByMachineId && joinsLicenseMachines) {
    const [payloadJson, machineId] = params as [string, string];
    const lm = licenseMachines.find((m) => m.machine_id === machineId && m.agent_id);
    if (!lm) return { rows: [], rowCount: 0 };
    const agent = agents.find((a) => a.agent_id === lm.agent_id);
    if (!agent) return { rows: [], rowCount: 0 };
    agent.last_boot_error = JSON.parse(payloadJson);
    return { rows: [{ id: agent.id }], rowCount: 1 };
  }

  return { rows: [], rowCount: 0 };
});

vi.mock('../../db/connection', () => ({
  default: { query: (...args: unknown[]) => mockQuery(...(args as [string, unknown[]])) },
}));
vi.mock('../../services/agent-ws', () => ({ sendToAgent: vi.fn() }));
vi.mock('../../services/license.service', () => ({
  registerAgent: vi.fn(),
  isValidLicenseKeyFormat: vi.fn(),
}));

import { agentRouter } from '../agent';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agent', agentRouter);
  return app;
}

describe('POST /api/agent/boot-fail — machine_id 列 bug 回归', () => {
  beforeEach(() => {
    mockQuery.mockClear();
    licenseMachines = [{ machine_id: 'mach-1', agent_id: 'agent-display-1' }];
    agents = [{ id: 'uuid-1', agent_id: 'agent-display-1', last_boot_error: null }];
  });

  it('已注册机器上报 boot-fail → 200 且真正写入 last_boot_error（不因不存在的列 500）', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/agent/boot-fail').send({
      machine_id: 'mach-1',
      hostname: 'host-1',
      reason: 'license_401',
      timestamp: new Date().toISOString(),
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, success: true, recorded: true });
    expect(agents[0].last_boot_error).toMatchObject({ reason: 'license_401' });
  });

  it('未注册机器 → 202（graceful，不 500）', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/agent/boot-fail').send({
      machine_id: 'mach-unknown',
      hostname: 'host-x',
      reason: 'license_401',
      timestamp: new Date().toISOString(),
    });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ ok: true, success: true, recorded: false });
  });
});
