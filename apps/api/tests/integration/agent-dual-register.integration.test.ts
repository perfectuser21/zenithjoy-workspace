/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * H-2 Bug 9 integration test — 真 license register + WS hello → agents 表 only 1 行
 *
 * 真接 zenithjoy_test DB（与其他 integration test 共用 testPool）：
 *   1. 创 tenant + license
 *   2. 调 POST /api/agent/register → 拿 agent_id (UUID), agents 表 +1 行
 *   3. 模拟 WS hello 携带 agentUuid → 调 resolveAgentUuidFromHello 复用 row
 *   4. SELECT count(*) FROM agents WHERE tenant_id=$1 == 1 (不是 2)
 *
 * 这里跳过真起 WebSocket — helper 单独可测，integration 验"helper 真复用 row 不创新"
 * 即可证明 dual register race 已修。
 */
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'crypto';
import app from '../../src/app';
import { testPool, truncateTables } from './helpers';
import { resolveAgentUuidFromHello } from '../../src/services/agent-ws';

// 生成符合 isValidLicenseKeyFormat 的 license key (^ZJ-[FBMSE]-[A-Z0-9]{8}$)
function genTestLicenseKey(): string {
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  let suffix = '';
  for (let i = 0; i < 8; i++) suffix += ALPHA[bytes[i] % ALPHA.length];
  return `ZJ-F-${suffix}`;
}

describe('Agent dual register integration [Bug 9]', () => {
  let tenantId: string;
  let licenseKey: string;

  beforeAll(async () => {
    licenseKey = genTestLicenseKey();
    // 创 tenant + 配套 license（agents.tenant_id 通过 licenses.license_key 反查 tenants 拿到）
    const tenantRes = await testPool.query<{ id: string }>(
      `INSERT INTO zenithjoy.tenants (name, license_key, plan)
         VALUES ($1, $2, 'free')
         RETURNING id`,
      [`bug9-dual-${Date.now()}`, licenseKey]
    );
    tenantId = tenantRes.rows[0].id;

    const expiresAt = new Date(Date.now() + 365 * 86400_000).toISOString();
    await testPool.query(
      `INSERT INTO zenithjoy.licenses
         (license_key, tier, max_machines, expires_at, status)
       VALUES ($1, 'free', 1, $2, 'active')`,
      [licenseKey, expiresAt]
    );
  });

  afterAll(async () => {
    await truncateTables(
      'zenithjoy.agents',
      'zenithjoy.license_machines',
      'zenithjoy.licenses',
      'zenithjoy.tenants'
    );
  });

  it('真 license register + WS hello with agentUuid → agents 表 only 1 行', async () => {
    const machineId = `mach-bug9-${Date.now()}`;
    const agentIdText = `agent-int-bug9-${Date.now()}`;

    // Step 1: register agent — backend 创 agents 行, 返 agent_id (UUID)
    const reg = await request(app)
      .post('/api/agent/register')
      .send({
        license_key: licenseKey,
        machine_id: machineId,
        hostname: `host-bug9-${Date.now()}`,
        agent_id: agentIdText,
        version: '1.0.1',
      });

    expect(reg.status).toBe(200);
    expect(reg.body.ok).toBe(true);
    expect(reg.body.agent_id).toMatch(/^[0-9a-f-]{36}$/);
    const agentUuid = reg.body.agent_id;

    // Step 2: 验 register 后 agents 表此 tenant 下有 1 行 (UUID = reg.body.agent_id)
    const afterReg = await testPool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM zenithjoy.agents WHERE tenant_id=$1`,
      [tenantId]
    );
    expect(afterReg.rows[0].c).toBe(1);

    // Step 3: 模拟 WS hello — agent 携带从 register 拿的 agentUuid，
    // displayName 故意改成 ws connection generated name 来模拟真 race 现场
    const resolvedUuid = await resolveAgentUuidFromHello({
      agentId: `ws1-other-name-${Date.now()}`, // 故意不同 displayName
      agentUuid: agentUuid,                    // 但 agentUuid 一致
      capabilities: ['douyin'],
      version: '1.0.1',
      tenantId,
    });
    expect(resolvedUuid).toBe(agentUuid); // helper 必须返同一 UUID（复用 row）

    // Step 4: 关键验证 — agents 表 only 1 行 (而不是 2 行 race 状态)
    const afterHello = await testPool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM zenithjoy.agents WHERE tenant_id=$1`,
      [tenantId]
    );
    expect(afterHello.rows[0].c).toBe(1);
  });
});
