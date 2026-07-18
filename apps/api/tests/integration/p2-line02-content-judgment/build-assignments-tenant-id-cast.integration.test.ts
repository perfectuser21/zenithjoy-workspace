/**
 * buildAssignments 在线 burner 查询 text=uuid 类型不匹配 — [REGRESSION]
 *
 * 2026-07-18 根因排查发现：Path2 四段(采集/判定/抓评论/私信)从未在同一次真实数据流里
 * 被串起来验证过——之前 buildAssignments 的所有单测全部 mock pool.query，从没真正对
 * Postgres 执行过这条 SQL。新增 golden-path-2-smoke.sh Step22 首次真实调用 dispatch/build
 * 时才发现：SQL 里同一个 $1 参数在同一条查询内既比较 dm_assignments.tenant_id(text) 又
 * 比较 agents.tenant_id(uuid)，PostgreSQL 对同一参数只推断一个类型 → "operator does not
 * exist: text = uuid"，导致该端点在有在线 burner 时必现 500。
 *
 * 修法（acquisition-dispatch.ts:363）：agents.tenant_id 侧显式 ::text 转型。
 *
 * commit-1 时 RED（未加 cast，真连 Postgres 执行会报 42883）；commit-2 GREEN。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildAssignments } from '../../../src/services/acquisition-dispatch';
import { testPool, createTestTenant } from '../helpers';

let tenantId: string;
let agentId: string;
const RND = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

beforeAll(async () => {
  const tenant = await createTestTenant(`build-assign-cast-test-${RND}`);
  tenantId = tenant.id;

  const aRes = await testPool.query(
    `INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status, os_type, capabilities, last_heartbeat_at)
     VALUES ($1, $2, 'build-assign-cast-host', 'online', 'android', ARRAY['android'], NOW())
     RETURNING id`,
    [tenantId, `build-assign-cast-agent-${RND}`],
  );
  agentId = aRes.rows[0].id;

  // 在线 burner session（触发 buildAssignments 里那条 JOIN agents 的 SQL）
  await testPool.query(
    `INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status, device_type)
     VALUES ($1, 'douyin', $2, 'burner', 'active', 'android')`,
    [agentId, `build-assign-cast-burner-${RND}`],
  );

  // 一条已评分、outreach_eligible=true 的 lead，让 buildAssignments 真的走到派单分支
  await testPool.query(
    `INSERT INTO zenithjoy.acquisition_leads
       (tenant_id, nickname, douyin_id, relevance_score, outreach_eligible, source_video_ids)
     VALUES ($1, $2, $3, 90, true, '[]'::jsonb)`,
    [tenantId, `build-assign-cast-lead-${RND}`, `bactid${RND}`],
  );
});

afterAll(async () => {
  // dm_assignments/acquisition_leads/agent_platform_sessions/agents 的 tenant_id 均无
  // FK CASCADE 指向 tenants，必须逐表显式清理，光 TRUNCATE tenants CASCADE 清不掉它们。
  await testPool.query('DELETE FROM zenithjoy.dm_assignments WHERE tenant_id = $1', [tenantId]);
  await testPool.query('DELETE FROM zenithjoy.acquisition_leads WHERE tenant_id = $1', [tenantId]);
  await testPool.query('DELETE FROM zenithjoy.agent_platform_sessions WHERE agent_id = $1', [agentId]);
  await testPool.query('DELETE FROM zenithjoy.agents WHERE id = $1', [agentId]);
  await testPool.query('DELETE FROM zenithjoy.tenants WHERE id = $1', [tenantId]);
});

describe('buildAssignments 在线 burner 查询 [REGRESSION]', () => {
  it('有在线 burner + 已评分 lead 时不抛 text=uuid 类型错误，真实生成 assignment', async () => {
    const result = await buildAssignments(testPool, tenantId);
    expect(result.assigned).toBeGreaterThanOrEqual(1);

    const { rows } = await testPool.query(
      `SELECT count(*) AS cnt FROM zenithjoy.dm_assignments WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(Number(rows[0].cnt)).toBeGreaterThanOrEqual(1);
  });
});
