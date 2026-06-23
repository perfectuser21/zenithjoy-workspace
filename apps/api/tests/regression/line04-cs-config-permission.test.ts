/**
 * Line04 客服配置写接口安全闸（管理员 + 租户隔离）— regression（先红后绿，永久留 CI）
 *
 * 越权根因（Issue 96db53be P1）：写接口 PUT /cs/config/:wechatId、PUT /cs/setup/:machineId、
 * PUT /cs/auto-agent 当前无 guard / 无 tenantContext —— 任何持 better-auth session 的登录用户
 * 都能改任意客服配置 = 串台风险敞口。
 *
 * 安全模型（复用 middleware/tenant-context.ts + tenant_members owner/admin/member 角色）：
 *   1. tenantContext 解出当前用户 req.tenantId + req.tenantRole（无身份 → 401；无租户 → 403 NO_TENANT）
 *   2. 角色闸：req.tenantRole ∈ {owner, admin} 才放行；member / 无 role → 403 NOT_ADMIN（仅管理员可配置）
 *   3. 租户隔离：解出目标客服所属租户，必须 === req.tenantId；不等 → 403 CROSS_TENANT
 *   4. deny by default：目标客服解析不到租户 → 404 TARGET_NOT_FOUND，绝不放行写库
 *
 * 验证方式：supertest + mock pg pool（repo 既有路由测试约定）。DB 是外部边界（可 mock），
 * 被测真实逻辑 = 「写接口是否挂 tenantContext + 角色闸 + 租户隔离 + deny by default」。
 * 断言对象 = 真实 HTTP 状态码 + 写库 store 是否被调用（越权必须 0 写库）→ generator 不挂闸无法转绿。
 *
 * commit-1 RED；commit-2 GREEN。永久 regression。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ── SQL-aware mock pg pool（按 SQL 文本分支，避免依赖调用顺序）──────────────────
const { mockQuery, setScenario } = vi.hoisted(() => {
  let scenario = {
    userRole: 'admin' as string | null, // tenant_members 命中的角色；null = NO_TENANT
    userTenant: 'tenant-A',
    targetTenantByWechat: 'tenant-A' as string | null, // service_agents.wechat_id → tenant；null = 解析不到
    targetTenantByMachine: 'tenant-A' as string | null, // license_machines → tenant；null = 解析不到
  };
  const handler = (sql: string) => {
    // tenantContext 反查当前用户角色 + 租户
    if (/tenant_members/i.test(sql) && /feishu_user_id/i.test(sql)) {
      if (scenario.userRole == null) return { rows: [], rowCount: 0 };
      return { rows: [{ tenant_id: scenario.userTenant, role: scenario.userRole }], rowCount: 1 };
    }
    // 目标客服（wechat_id）→ 所属租户
    if (/service_agents/i.test(sql) && /wechat_id/i.test(sql)) {
      if (scenario.targetTenantByWechat == null) return { rows: [], rowCount: 0 };
      return { rows: [{ tenant_id: scenario.targetTenantByWechat }], rowCount: 1 };
    }
    // 目标机器（machine_id）→ 所属租户（setup 路径，经 license_machines JOIN licenses）
    if (/license_machines/i.test(sql)) {
      if (scenario.targetTenantByMachine == null) return { rows: [], rowCount: 0 };
      return { rows: [{ tenant_id: scenario.targetTenantByMachine }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };
  const mockQuery = vi.fn((sql: string) => Promise.resolve(handler(sql)));
  return { mockQuery, setScenario: (s: Partial<typeof scenario>) => Object.assign(scenario, s) };
});

vi.mock('../../src/db/connection', () => ({
  default: { query: mockQuery, connect: vi.fn(), end: vi.fn() },
}));

// 写库 store 全部做成 spy —— 越权时这些必须「一次都没被调」
const {
  saveCSConfigMock,
  getCSConfigMock,
  setupCSByMachineMock,
  saveAutoAgentConfigMock,
  getAutoAgentConfigMock,
} = vi.hoisted(() => ({
  saveCSConfigMock: vi.fn(),
  getCSConfigMock: vi.fn(),
  setupCSByMachineMock: vi.fn(),
  saveAutoAgentConfigMock: vi.fn(),
  getAutoAgentConfigMock: vi.fn(),
}));

vi.mock('../../src/services/wechat/cs-account-config-store', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    saveCSConfig: saveCSConfigMock,
    getCSConfig: getCSConfigMock,
    setupCSByMachine: setupCSByMachineMock,
  };
});

vi.mock('../../src/services/wechat/cs-config-store', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    saveAutoAgentConfig: saveAutoAgentConfigMock,
    getAutoAgentConfig: getAutoAgentConfigMock,
  };
});

// mock 之后再 import app（确保内部 import 解析到 mock）
import app from '../../src/app';

const VALID_PERSONA = {
  self_name: '小齐',
  address_style: '叫名字',
  tone: '随和',
  sentence_style: '短句',
  use_emoji: '偶尔',
  banned_phrases: ['亲'],
  few_shot: [{ customer: '在吗', me: '在的' }],
};
const VALID_BODY = { persona: VALID_PERSONA, whitelist: ['客户甲'] };
const WECHAT_ID = 'wxid_csa';
const MACHINE_ID = 'machine-abc';

beforeEach(() => {
  mockQuery.mockClear();
  saveCSConfigMock.mockReset().mockResolvedValue(undefined);
  getCSConfigMock.mockReset().mockResolvedValue({ wechat_id: WECHAT_ID, persona: VALID_PERSONA });
  setupCSByMachineMock.mockReset().mockResolvedValue({ wechat_id: WECHAT_ID, agent_id: null });
  saveAutoAgentConfigMock.mockReset().mockResolvedValue(undefined);
  getAutoAgentConfigMock.mockReset().mockResolvedValue({ auto_agent_enabled: false });
  // 默认场景：tenant-A 的 admin 改 tenant-A 的客服（应放行）
  setScenario({
    userRole: 'admin',
    userTenant: 'tenant-A',
    targetTenantByWechat: 'tenant-A',
    targetTenantByMachine: 'tenant-A',
  });
});

describe('Line04 客服配置写接口安全闸 [BEHAVIOR]', () => {
  // ── Golden Path Step 2/3：本租户 admin 改本客服 → 200 + 写库 ──
  it('admin 同租户 PUT /cs/config/:wechatId → 200 且调 saveCSConfig 写该行', async () => {
    setScenario({ userRole: 'admin', userTenant: 'tenant-A', targetTenantByWechat: 'tenant-A' });
    const res = await request(app)
      .put(`/api/wechat/cs/config/${WECHAT_ID}`)
      .set('X-Feishu-User-Id', 'user-admin-A')
      .send(VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(saveCSConfigMock).toHaveBeenCalledTimes(1);
    expect(saveCSConfigMock.mock.calls[0][0]).toBe(WECHAT_ID);
  });

  // ── Golden Path Step 4：member（非管理员）→ 403 NOT_ADMIN 且 0 写库 ──
  it('member PUT /cs/config/:wechatId → 403 NOT_ADMIN 且绝不调 saveCSConfig', async () => {
    setScenario({ userRole: 'member', userTenant: 'tenant-A', targetTenantByWechat: 'tenant-A' });
    const res = await request(app)
      .put(`/api/wechat/cs/config/${WECHAT_ID}`)
      .set('X-Feishu-User-Id', 'user-member-A')
      .send(VALID_BODY);
    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe('NOT_ADMIN');
    expect(saveCSConfigMock).not.toHaveBeenCalled();
  });

  // ── Golden Path Step 5：跨租户 admin（A 改 B 的客服）→ 403 CROSS_TENANT 且 0 写库 ──
  it('跨租户 admin PUT /cs/config/:wechatId（A 改 B 的客服）→ 403 CROSS_TENANT 且绝不写库', async () => {
    setScenario({ userRole: 'admin', userTenant: 'tenant-A', targetTenantByWechat: 'tenant-B' });
    const res = await request(app)
      .put(`/api/wechat/cs/config/${WECHAT_ID}`)
      .set('X-Feishu-User-Id', 'user-admin-A')
      .send(VALID_BODY);
    expect([403, 404]).toContain(res.status);
    expect(saveCSConfigMock).not.toHaveBeenCalled();
  });

  // ── Golden Path Step 6：无身份（无 session 无 header）→ 401 且 0 写库 ──
  it('无身份 PUT /cs/config/:wechatId → 401 且绝不写库', async () => {
    const res = await request(app).put(`/api/wechat/cs/config/${WECHAT_ID}`).send(VALID_BODY);
    expect(res.status).toBe(401);
    expect(saveCSConfigMock).not.toHaveBeenCalled();
  });

  // ── Golden Path Step 7：deny by default — 目标客服解析不到租户 → 404 且 0 写库 ──
  it('目标客服解析不到所属租户 PUT /cs/config/:wechatId → 404 TARGET_NOT_FOUND 且绝不写库（deny by default）', async () => {
    setScenario({ userRole: 'admin', userTenant: 'tenant-A', targetTenantByWechat: null });
    const res = await request(app)
      .put(`/api/wechat/cs/config/${WECHAT_ID}`)
      .set('X-Feishu-User-Id', 'user-admin-A')
      .send(VALID_BODY);
    expect(res.status).toBe(404);
    expect(saveCSConfigMock).not.toHaveBeenCalled();
  });

  // ── 边界：当前用户解析不到租户/角色（NO_TENANT）→ 403 且 0 写库（deny by default）──
  it('当前用户无租户关联 PUT /cs/config/:wechatId → 403 NO_TENANT 且绝不写库', async () => {
    setScenario({ userRole: null, targetTenantByWechat: 'tenant-A' });
    const res = await request(app)
      .put(`/api/wechat/cs/config/${WECHAT_ID}`)
      .set('X-Feishu-User-Id', 'user-orphan')
      .send(VALID_BODY);
    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe('NO_TENANT');
    expect(saveCSConfigMock).not.toHaveBeenCalled();
  });

  // ── 覆盖第二个写接口：PUT /cs/setup/:machineId member → 403 且 0 写库 ──
  it('member PUT /cs/setup/:machineId → 403 且绝不调 setupCSByMachine', async () => {
    setScenario({ userRole: 'member', userTenant: 'tenant-A', targetTenantByMachine: 'tenant-A' });
    const res = await request(app)
      .put(`/api/wechat/cs/setup/${MACHINE_ID}`)
      .set('X-Feishu-User-Id', 'user-member-A')
      .send(VALID_BODY);
    expect(res.status).toBe(403);
    expect(setupCSByMachineMock).not.toHaveBeenCalled();
  });

  // ── 覆盖第三个写接口：PUT /cs/auto-agent member → 403 且 0 写库 ──
  it('member PUT /cs/auto-agent → 403 且绝不调 saveAutoAgentConfig', async () => {
    setScenario({ userRole: 'member', userTenant: 'tenant-A' });
    const res = await request(app)
      .put('/api/wechat/cs/auto-agent')
      .set('X-Feishu-User-Id', 'user-member-A')
      .send({ auto_agent_enabled: true });
    expect(res.status).toBe(403);
    expect(saveAutoAgentConfigMock).not.toHaveBeenCalled();
  });
});
