/**
 * Line04 客服配置写接口安全闸（管理员 + 租户隔离）— regression（先红后绿，永久留 CI）
 *
 * 越权根因（Issue 96db53be P1）：`PUT /cs/config/:wechatId`、`PUT /cs/setup/:machineId`
 * 完全无 guard；`PUT /cs/auto-agent` 仅挂 superAdminGuard（不认 dashboard better-auth
 * session）→ 任何登录用户可改任意客服配置 = 串台。
 *
 * 本 sprint 给三个写接口前置 tenantContext + 管理员角色闸 + 租户隔离（deny by default）：
 *   - 无身份               → 401 UNAUTHORIZED（tenantContext）
 *   - 当前用户无租户关联   → 403 NO_TENANT（tenantContext）
 *   - member / 无 role     → 403 NOT_ADMIN
 *   - 目标客服属别家租户   → 403 CROSS_TENANT
 *   - 目标客服解析不到租户 → 404 TARGET_NOT_FOUND（不默认放行到任一租户）
 *
 * 验证方式：supertest + mock pg pool + mock 写库 store（repo 既有路由测试约定）。
 * 断言对象 = route 真实返回的 HTTP 状态码 / error.code + 写库 store 调用次数（越权必须 0 调用）
 * → generator 不写真闸无法转绿。
 *
 * commit-1 RED（缺闸时 member/跨租户/无身份/deny-by-default 错误放行）；commit-2 GREEN。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const TENANT_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const TENANT_B = 'bbbbbbbb-1111-2222-3333-444444444444';

// ── tenant_members 角色表（feishu_user_id → {tenant_id, role}）──
const MEMBERS: Record<string, { tenant_id: string; role: string }> = {
  'user-admin-A': { tenant_id: TENANT_A, role: 'admin' },
  'user-owner-A': { tenant_id: TENANT_A, role: 'owner' },
  'user-member-A': { tenant_id: TENANT_A, role: 'member' },
  'user-admin-B': { tenant_id: TENANT_B, role: 'admin' },
  // user-no-tenant：故意不在表里 → tenantContext 返回 NO_TENANT
};
// ── service_agents.wechat_id → tenant_id（目标客服所属租户）──
const AGENT_TENANT: Record<string, string> = {
  wxid_csa: TENANT_A,
  wxid_csb: TENANT_B,
  // wxid_never_zzz：故意不存在 → 解析不到租户 → TARGET_NOT_FOUND
};
// ── license_machines.machine_id → tenant_id ──
const MACHINE_TENANT: Record<string, string> = {
  'machine-A': TENANT_A,
  'machine-B': TENANT_B,
};

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../../src/db/connection', () => ({
  default: { query: mockQuery, connect: vi.fn(), end: vi.fn() },
}));

// 写库 store 全部 mock —— 既隔离真实 DB，又能 spy「越权时是否 0 调用」
const store = vi.hoisted(() => ({
  saveCSConfig: vi.fn(),
  getCSConfig: vi.fn(),
  getCSConfigByMachine: vi.fn(),
  setupCSByMachine: vi.fn(),
  recordIdentityAlert: vi.fn(),
  listIdentityAlerts: vi.fn(),
  listPendingMachines: vi.fn(),
  listAllMachines: vi.fn(),
}));
vi.mock('../../src/services/wechat/cs-account-config-store', () => ({
  saveCSConfig: store.saveCSConfig,
  getCSConfig: store.getCSConfig,
  getCSConfigByMachine: store.getCSConfigByMachine,
  setupCSByMachine: store.setupCSByMachine,
  recordIdentityAlert: store.recordIdentityAlert,
  listIdentityAlerts: store.listIdentityAlerts,
  listPendingMachines: store.listPendingMachines,
  listAllMachines: store.listAllMachines,
}));

const globalStore = vi.hoisted(() => ({
  getPersona: vi.fn(),
  savePersona: vi.fn(),
  getBusinessKB: vi.fn(),
  saveBusinessKB: vi.fn(),
  getAutoAgentConfig: vi.fn(),
  saveAutoAgentConfig: vi.fn(),
}));
vi.mock('../../src/services/wechat/cs-config-store', () => ({
  getPersona: globalStore.getPersona,
  savePersona: globalStore.savePersona,
  getBusinessKB: globalStore.getBusinessKB,
  saveBusinessKB: globalStore.saveBusinessKB,
  getAutoAgentConfig: globalStore.getAutoAgentConfig,
  saveAutoAgentConfig: globalStore.saveAutoAgentConfig,
}));

const outbound = vi.hoisted(() => ({
  enqueueKeyContactBroadcast: vi.fn(),
  enqueueSetupSuccess: vi.fn(),
}));
vi.mock('../../src/services/wechat/cs-outbound', () => ({
  enqueueKeyContactBroadcast: outbound.enqueueKeyContactBroadcast,
  enqueueSetupSuccess: outbound.enqueueSetupSuccess,
}));

vi.mock('../../src/llm/openrouter', () => ({
  callOpenRouter: vi.fn().mockResolvedValue({ content: 'mock' }),
}));

// 必须在 mock 之后 import app
import app from '../../src/app';

/** 一份合法的 Persona（满足 zod strict 校验，happy path 用） */
const VALID_PERSONA = {
  self_name: '小齐',
  address_style: '亲切',
  tone: '友好',
  sentence_style: '简洁',
  use_emoji: '少量',
  banned_phrases: [] as string[],
  few_shot: [] as { customer: string; me: string }[],
};

/** 合法配置 body（含本 sprint 新增的营业时间 + 每日上限） */
const VALID_BODY = {
  persona: VALID_PERSONA,
  business_hours_start: '09:00',
  business_hours_end: '21:00',
  daily_limit: 50,
  whitelist: ['客户甲'],
};

beforeEach(() => {
  mockQuery.mockReset();
  // pool.query 按 SQL + 绑定参数路由到对应假表（tenantContext + guard 目标租户解析）
  mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
    const s = String(sql);
    // tenantContext：按 feishu_user_id 查 tenant_members 角色
    if (/tenant_members/i.test(s) && /feishu_user_id/i.test(s)) {
      const uid = String(params?.[0] ?? '');
      const m = MEMBERS[uid];
      return Promise.resolve({ rows: m ? [m] : [], rowCount: m ? 1 : 0 });
    }
    // guard：按 wechat_id 查 service_agents 取目标租户
    if (/service_agents/i.test(s) && /wechat_id/i.test(s)) {
      const wid = String(params?.[0] ?? '');
      const t = AGENT_TENANT[wid];
      return Promise.resolve({ rows: t ? [{ tenant_id: t }] : [], rowCount: t ? 1 : 0 });
    }
    // guard：按 machine_id 查 license_machines JOIN licenses 取目标租户
    if (/license_machines/i.test(s) && /machine_id/i.test(s)) {
      const mid = String(params?.[0] ?? '');
      const t = MACHINE_TENANT[mid];
      return Promise.resolve({ rows: t ? [{ tenant_id: t }] : [], rowCount: t ? 1 : 0 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });

  store.saveCSConfig.mockReset().mockResolvedValue(undefined);
  store.getCSConfig.mockReset().mockResolvedValue({
    wechat_id: 'wxid_csa',
    persona: VALID_PERSONA,
    auto_agent_enabled: false,
    business_hours_start: '09:00',
    business_hours_end: '21:00',
    key_contact_wechat: '',
    whitelist: ['客户甲'],
    daily_limit: 50,
  });
  store.setupCSByMachine.mockReset().mockResolvedValue({ wechat_id: 'cs-machine', agent_id: null });
  store.recordIdentityAlert.mockReset().mockResolvedValue(undefined);

  globalStore.getAutoAgentConfig.mockReset().mockResolvedValue({ auto_agent_enabled: false });
  globalStore.saveAutoAgentConfig.mockReset().mockResolvedValue(undefined);
  outbound.enqueueKeyContactBroadcast.mockReset().mockResolvedValue({ action: 'skip' });
  outbound.enqueueSetupSuccess.mockReset().mockResolvedValue(null);
});

describe('Line04 客服配置写接口安全闸（管理员 + 租户隔离）[BEHAVIOR]', () => {
  // ── Step 3（核心安全断言，钉死 Issue 96db53be）──
  it('member PUT /cs/config/:wechatId → 403 NOT_ADMIN 且绝不调 saveCSConfig', async () => {
    const res = await request(app)
      .put('/api/wechat/cs/config/wxid_csa')
      .set('X-Feishu-User-Id', 'user-member-A')
      .send(VALID_BODY);
    expect(res.status, 'member 非管理员必须被拒').toBe(403);
    expect(res.body?.error?.code).toBe('NOT_ADMIN');
    expect(store.saveCSConfig, 'member 越权绝不允许写库').not.toHaveBeenCalled();
  });

  // ── Step 2（happy path）──
  it('admin 同租户 PUT /cs/config/:wechatId → 200 且调 saveCSConfig 写该行', async () => {
    const res = await request(app)
      .put('/api/wechat/cs/config/wxid_csa')
      .set('X-Feishu-User-Id', 'user-admin-A')
      .send(VALID_BODY);
    expect(res.status, '本租户 admin 应放行').toBe(200);
    expect(res.body?.success).toBe(true);
    expect(store.saveCSConfig, 'admin 应写库一次').toHaveBeenCalledTimes(1);
    expect(store.saveCSConfig.mock.calls[0][0], '只写目标那一行').toBe('wxid_csa');
  });

  // ── Step 4（租户隔离）──
  it('跨租户 admin PUT /cs/config/:wechatId（A 改 B 的客服）→ 403 CROSS_TENANT 且绝不写库', async () => {
    const res = await request(app)
      .put('/api/wechat/cs/config/wxid_csb') // 属 tenant-B
      .set('X-Feishu-User-Id', 'user-admin-A') // 当前是 tenant-A admin
      .send(VALID_BODY);
    expect([403, 404], '跨租户必须被拒').toContain(res.status);
    if (res.status === 403) expect(res.body?.error?.code).toBe('CROSS_TENANT');
    expect(store.saveCSConfig, '跨租户绝不允许写 B 的行').not.toHaveBeenCalled();
  });

  // ── Step 5（无身份）──
  it('无身份 PUT /cs/config/:wechatId → 401 且绝不写库', async () => {
    const res = await request(app).put('/api/wechat/cs/config/wxid_csa').send(VALID_BODY);
    expect(res.status, '无 session 无头必须 401').toBe(401);
    expect(res.body?.error?.code).toBe('UNAUTHORIZED');
    expect(store.saveCSConfig).not.toHaveBeenCalled();
  });

  // ── Step 6（deny by default — 目标客服解析不到所属租户）──
  it('deny by default：目标客服解析不到所属租户 → 404 TARGET_NOT_FOUND 且不写库', async () => {
    const res = await request(app)
      .put('/api/wechat/cs/config/wxid_never_zzz') // service_agents 查不到
      .set('X-Feishu-User-Id', 'user-admin-A')
      .send(VALID_BODY);
    expect(res.status, '解析不出目标 → deny by default').toBe(404);
    expect(res.body?.error?.code).toBe('TARGET_NOT_FOUND');
    expect(store.saveCSConfig, '解析不出目标绝不放行写库').not.toHaveBeenCalled();
  });

  // ── Step 6（deny by default — 当前用户无租户关联）──
  it('deny by default：当前用户无租户关联 → 403 NO_TENANT 且不写库', async () => {
    const res = await request(app)
      .put('/api/wechat/cs/config/wxid_csa')
      .set('X-Feishu-User-Id', 'user-no-tenant') // tenant_members 查不到
      .send(VALID_BODY);
    expect(res.status, '当前用户无租户 → 拒绝').toBe(403);
    expect(res.body?.error?.code).toBe('NO_TENANT');
    expect(store.saveCSConfig).not.toHaveBeenCalled();
  });

  // ── Step 7（第二个写接口同样挂闸）──
  it('member PUT /cs/setup/:machineId → 403 且 setupCSByMachine 0 调用', async () => {
    const res = await request(app)
      .put('/api/wechat/cs/setup/machine-A')
      .set('X-Feishu-User-Id', 'user-member-A')
      .send(VALID_BODY);
    expect(res.status, 'setup 写接口 member 必须被拒').toBe(403);
    expect(store.setupCSByMachine, 'member 越权绝不允许写库').not.toHaveBeenCalled();
  });

  // ── Step 7（第三个写接口同样挂闸）──
  it('member PUT /cs/auto-agent → 403 且 saveAutoAgentConfig 0 调用', async () => {
    const res = await request(app)
      .put('/api/wechat/cs/auto-agent')
      .set('X-Feishu-User-Id', 'user-member-A')
      .send({ auto_agent_enabled: true });
    expect(res.status, 'auto-agent 写接口 member 必须被拒').toBe(403);
    expect(globalStore.saveAutoAgentConfig, 'member 越权绝不允许写全局配置').not.toHaveBeenCalled();
  });

  // ── error path：既有 zod body 校验保持不变（合法身份 + 空 persona → 400 INVALID_BODY）──
  it('admin 合法身份传空 persona → 400 INVALID_BODY（不被新闸吞掉，也不误判 403）', async () => {
    const res = await request(app)
      .put('/api/wechat/cs/config/wxid_csa')
      .set('X-Feishu-User-Id', 'user-admin-A')
      .send({}); // 缺 persona → zod 校验失败
    expect(res.status, '空 body 应走既有 zod 校验 400').toBe(400);
    expect(res.body?.error).toBe('INVALID_BODY');
    expect(store.saveCSConfig, 'body 非法绝不写库').not.toHaveBeenCalled();
  });

  // ── GET /cs/my-role 供前台渲染只读态 ──
  it('GET /cs/my-role：admin → can_config=true；member → can_config=false', async () => {
    const adminRes = await request(app)
      .get('/api/wechat/cs/my-role')
      .set('X-Feishu-User-Id', 'user-admin-A');
    expect(adminRes.status).toBe(200);
    expect(adminRes.body?.role).toBe('admin');
    expect(adminRes.body?.can_config).toBe(true);

    const memberRes = await request(app)
      .get('/api/wechat/cs/my-role')
      .set('X-Feishu-User-Id', 'user-member-A');
    expect(memberRes.status).toBe(200);
    expect(memberRes.body?.role).toBe('member');
    expect(memberRes.body?.can_config).toBe(false);
  });
});

// ── IA 重设计刀1：每号承载【完整 persona + business_kb】（API 接收并转发给 store）──
describe('Line04 IA重设计刀1 — 每号 persona/business_kb 读写 [BEHAVIOR]', () => {
  const FULL_PERSONA = {
    self_name: '小苏',
    address_style: '亲切',
    tone: '友好专业',
    sentence_style: '简洁',
    use_emoji: '少量',
    banned_phrases: ['呵呵'],
    few_shot: [{ customer: 'a', me: 'b' }],
  };
  const KB = {
    company: { name: '甲号公司', what_we_do: '做A', value_prop: 'V', contact: 'wx-a' },
    products: [{ name: 'P1', selling_points: 'sp', price: '￥9' }],
    audience_segments: [{ code: 'A1', label: 'L', desc: 'D' }],
    qa_docs: [{ q: 'q', a: 'a' }],
  };

  it('admin PUT /cs/config 带【完整 persona + business_kb】→ 200 且原样转发给 saveCSConfig', async () => {
    const res = await request(app)
      .put('/api/wechat/cs/config/wxid_csa')
      .set('X-Feishu-User-Id', 'user-admin-A')
      .send({ persona: FULL_PERSONA, business_kb: KB });
    expect(res.status, '完整 persona + business_kb 应被接受').toBe(200);
    expect(store.saveCSConfig).toHaveBeenCalledTimes(1);
    const patch = store.saveCSConfig.mock.calls[0][1] as Record<string, unknown>;
    // 完整 persona（含 style 字段）不被截断
    expect(patch.persona).toMatchObject({ self_name: '小苏', tone: '友好专业' });
    // business_kb 被转发
    expect(patch.business_kb).toMatchObject({ company: { name: '甲号公司' } });
  });

  it('admin PUT /cs/setup 不带 persona（人设已挪到话术库页）→ 200 且不报 zod 必填错', async () => {
    const res = await request(app)
      .put('/api/wechat/cs/setup/machine-A')
      .set('X-Feishu-User-Id', 'user-admin-A')
      .send({
        auto_agent_enabled: true,
        business_hours_start: '09:00',
        business_hours_end: '21:00',
        daily_limit: 50,
      });
    expect(res.status, '客服机页只发运营参数应被接受').toBe(200);
    expect(store.setupCSByMachine).toHaveBeenCalledTimes(1);
  });
});
