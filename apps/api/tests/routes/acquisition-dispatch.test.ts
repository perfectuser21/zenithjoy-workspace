/**
 * 智能获客「分析+指派」引擎 + 路由测试（刀1，TDD commit-1）
 * 契约：scratchpad/dispatch-engine-contract.md
 *
 * 两层：
 *  A. 引擎纯逻辑 — 用「内存 fake pool」按 SQL 关键字解释，真实跑 buildAssignments / dispatchDue /
 *     cookieHealth / config 的排序/轮换/去重/频控预算/时段闸逻辑。
 *  B. 路由 — supertest + vi.mock('../../src/db/connection')，验 config 默认/PUT 校验 / tenant 隔离 / 401。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import {
  defaultConfig,
  validateConfigPatch,
  heuristicScore,
  withinActiveWindow,
  classifyCookie,
  buildAssignments,
  dispatchDue,
  cookieHealth,
  scoreLeads,
  type QueryablePool,
} from '../../src/services/acquisition-dispatch';

// ─────────────────────────────────────────────────────────────────────────
// 内存 fake pool — 只支持 service 用到的几类查询，按 SQL 关键字派发
// ─────────────────────────────────────────────────────────────────────────
interface Lead { id: string; tenant_id: string; sec_uid: string | null; profile_url: string | null; partial: boolean; relevance_score: number | null; nickname: string; created_at: string }
interface Session { account_label: string; role: string; platform: string; status: string; bound_at: string | null; tenant_id: string; agent_id?: string }
interface Assignment { id: string; tenant_id: string; lead_id: string; account_label: string; status: string; scheduled_for: string | null; created_at: string }
interface OutreachLog { id: string; tenant_id: string; account_label: string; lead_id: string | null; profile_url: string | null; status: string; sent_at: string }

function makeFakePool(seed: {
  configRow?: Record<string, unknown> | null;
  leads?: Lead[];
  sessions?: Session[];
  assignments?: Assignment[];
  logs?: OutreachLog[];
}): QueryablePool & { _state: { leads: Lead[]; assignments: Assignment[]; logs: OutreachLog[] } } {
  const leads = seed.leads ?? [];
  const sessions = seed.sessions ?? [];
  const assignments = seed.assignments ?? [];
  const logs = seed.logs ?? [];
  let idc = 1;

  const pool = {
    _state: { leads, assignments, logs },
    async query(text: string, params: unknown[] = []) {
      const sql = text.replace(/\s+/g, ' ').trim();

      // getConfig
      if (sql.includes('FROM zenithjoy.acquisition_config')) {
        return { rows: seed.configRow ? [seed.configRow] : [] };
      }
      // upsertConfig INSERT — no-op
      if (sql.startsWith('INSERT INTO zenithjoy.acquisition_config')) {
        return { rows: [] };
      }
      // scoreLeads SELECT unscored
      if (sql.includes('FROM zenithjoy.acquisition_leads') && sql.includes('relevance_score IS NULL')) {
        return { rows: leads.filter((l) => l.tenant_id === params[0] && l.relevance_score === null) };
      }
      // scoreLeads UPDATE
      if (sql.startsWith('UPDATE zenithjoy.acquisition_leads SET relevance_score')) {
        const lead = leads.find((l) => l.id === params[0]);
        if (lead) lead.relevance_score = Number(params[1]);
        return { rows: [] };
      }
      // burners
      if (sql.includes('FROM zenithjoy.agent_platform_sessions s') && sql.includes("s.role = 'burner'")) {
        const limit = Number(params[1]);
        const labels = Array.from(new Set(
          sessions.filter((s) => s.tenant_id === params[0] && s.role === 'burner' && s.status === 'active')
            .map((s) => s.account_label)
        )).sort().slice(0, limit);
        return { rows: labels.map((account_label) => ({ account_label })) };
      }
      // scored leads desc
      if (sql.includes('FROM zenithjoy.acquisition_leads') && sql.includes('relevance_score IS NOT NULL')) {
        const rows = leads.filter((l) => l.tenant_id === params[0] && l.relevance_score !== null)
          .sort((a, b) => (b.relevance_score! - a.relevance_score!) || a.created_at.localeCompare(b.created_at))
          .map((l) => ({ id: l.id, profile_url: l.profile_url, relevance_score: l.relevance_score }));
        return { rows };
      }
      // perDay used count (buildAssignments)
      if (sql.includes('dm_assignments') && sql.includes('dm_outreach_log') && sql.includes('AS used')) {
        const [tenant, label] = params as string[];
        const a = assignments.filter((x) => x.tenant_id === tenant && x.account_label === label && ['queued', 'dispatched', 'sent'].includes(x.status)).length;
        const l = logs.filter((x) => x.tenant_id === tenant && x.account_label === label).length;
        return { rows: [{ used: a + l }] };
      }
      // dedup check
      if (sql.includes('FROM zenithjoy.dm_assignments') && sql.includes('UNION ALL') && sql.includes('dm_outreach_log')) {
        const [tenant, leadId, label] = params as string[];
        const inA = assignments.some((x) => x.tenant_id === tenant && x.lead_id === leadId && x.account_label === label);
        const inL = logs.some((x) => x.tenant_id === tenant && x.lead_id === leadId && x.account_label === label);
        return { rows: inA || inL ? [{ '?column?': 1 }] : [] };
      }
      // insert assignment
      if (sql.startsWith('INSERT INTO zenithjoy.dm_assignments')) {
        const [tenant, leadId, label, scheduled] = params as string[];
        const exists = assignments.some((x) => x.tenant_id === tenant && x.lead_id === leadId && x.account_label === label);
        if (!exists) {
          assignments.push({ id: `a${idc++}`, tenant_id: tenant, lead_id: leadId, account_label: label, status: 'queued', scheduled_for: scheduled, created_at: new Date().toISOString() });
        }
        return { rows: [] };
      }
      // dispatchDue due query
      if (sql.includes('FROM zenithjoy.dm_assignments') && sql.includes("status = 'queued'") && sql.includes('scheduled_for <=')) {
        const [tenant, nowIso] = params as string[];
        const rows = assignments.filter((x) => x.tenant_id === tenant && x.status === 'queued' && x.scheduled_for !== null && x.scheduled_for <= nowIso)
          .sort((a, b) => (a.scheduled_for! < b.scheduled_for! ? -1 : 1))
          .map((x) => ({ id: x.id, lead_id: x.lead_id, account_label: x.account_label }));
        return { rows };
      }
      // dispatchDue hour/day count
      if (sql.includes('AS hour') && sql.includes('AS day')) {
        const [tenant, label, nowIso] = params as string[];
        const now = new Date(nowIso).getTime();
        const hour = logs.filter((x) => x.tenant_id === tenant && x.account_label === label && now - new Date(x.sent_at).getTime() <= 3_600_000).length;
        const dayStart = new Date(nowIso); dayStart.setHours(0, 0, 0, 0);
        const day = logs.filter((x) => x.tenant_id === tenant && x.account_label === label && new Date(x.sent_at) >= dayStart).length;
        return { rows: [{ hour, day }] };
      }
      // dispatchDue: lead profile_url + agent_id via LEFT JOIN agent_platform_sessions
      if (sql.includes('FROM zenithjoy.acquisition_leads l') && sql.includes('LEFT JOIN zenithjoy.agent_platform_sessions s')) {
        const [leadId, label] = params as string[];
        const l = leads.find((x) => x.id === leadId);
        const s = sessions.find((x) => x.account_label === label && x.role === 'burner' && x.status === 'active');
        return { rows: l ? [{ profile_url: l.profile_url, agent_id: s?.agent_id ?? null }] : [] };
      }
      // insert publish_tasks (真派单)
      if (sql.startsWith('INSERT INTO zenithjoy.publish_tasks')) {
        return { rows: [] };
      }
      // insert outreach log
      if (sql.startsWith('INSERT INTO zenithjoy.dm_outreach_log')) {
        const [tenant, label, leadId, profileUrl] = params as string[];
        logs.push({ id: `l${idc++}`, tenant_id: tenant, account_label: label, lead_id: leadId, profile_url: profileUrl, status: 'dispatched', sent_at: new Date().toISOString() });
        return { rows: [] };
      }
      // update assignment status (含 agent_id 更新)
      if (sql.startsWith('UPDATE zenithjoy.dm_assignments SET status')) {
        const [assignId] = params as string[];
        const a = assignments.find((x) => x.id === assignId);
        if (a) a.status = sql.includes("'dispatched'") ? 'dispatched' : 'limited';
        return { rows: [] };
      }
      // cookieHealth sessions
      if (sql.includes('FROM zenithjoy.agent_platform_sessions s') && sql.includes("role IN ('main','burner')")) {
        const rows = sessions.filter((s) => s.tenant_id === params[0])
          .map((s) => ({ account_label: s.account_label, role: s.role, platform: s.platform, status: s.status, bound_at: s.bound_at }));
        return { rows };
      }
      throw new Error('fake pool: unhandled SQL: ' + sql.slice(0, 120));
    },
  };
  return pool;
}

const CFG_ROW = { ...defaultConfig('t1'), dm_per_day: 30, dm_per_hour: 5, burner_count: 3, dm_active_start: '00:00', dm_active_end: '23:59', dm_interval_min_sec: 60, dm_interval_max_sec: 120 };

function lead(id: string, score: number | null, extra: Partial<Lead> = {}): Lead {
  return { id, tenant_id: 't1', sec_uid: `sec_${id}`, profile_url: `https://d/${id}`, partial: false, relevance_score: score, nickname: `nick_${id}`, created_at: `2026-06-26T0${id.length}:00:00Z`, ...extra };
}
function burner(label: string): Session {
  return { account_label: label, role: 'burner', platform: 'douyin', status: 'active', bound_at: new Date().toISOString(), tenant_id: 't1' };
}

// ═══════════════════════ A. 引擎纯逻辑 ═══════════════════════
describe('acquisition-dispatch service — 纯函数', () => {
  it('defaultConfig 全字段 + 默认值正确', () => {
    const c = defaultConfig('x');
    expect(c.dm_per_day).toBe(30);
    expect(c.dm_per_hour).toBe(5);
    expect(c.burner_count).toBe(3);
    expect(c.dm_active_start).toBe('09:00');
    expect(c.cookie_check_interval_hours).toBe(6);
  });

  it('validateConfigPatch — 合法通过/越界拒绝/min>max 拒绝/时段格式', () => {
    expect(validateConfigPatch({ dm_per_day: 30 })).toBeNull();
    expect(validateConfigPatch({ dm_per_day: 0 })).toMatch(/dm_per_day/);
    expect(validateConfigPatch({ dm_per_hour: 999 })).toMatch(/dm_per_hour/);
    expect(validateConfigPatch({ burner_count: -1 })).toMatch(/burner_count/);
    expect(validateConfigPatch({ dm_per_day: 1.5 })).toMatch(/dm_per_day/);
    expect(validateConfigPatch({ keywords_per_round_min: 5, keywords_per_round_max: 3 })).toMatch(/min/);
    expect(validateConfigPatch({ dm_active_start: '25:00' })).toMatch(/dm_active_start/);
    expect(validateConfigPatch({ dm_active_start: '09:30' })).toBeNull();
  });

  it('heuristicScore — sec+url=80 / 其一=50 / partial=20', () => {
    expect(heuristicScore({ sec_uid: 'a', profile_url: 'u' })).toBe(80);
    expect(heuristicScore({ sec_uid: 'a', profile_url: null })).toBe(50);
    expect(heuristicScore({ sec_uid: null, profile_url: null })).toBe(20);
    expect(heuristicScore({ sec_uid: 'a', profile_url: 'u', partial: true })).toBe(20);
  });

  it('withinActiveWindow — 普通区间 + 跨夜区间', () => {
    const at = (h: number, m = 0) => new Date(2026, 5, 26, h, m);
    expect(withinActiveWindow(at(10), '09:00', '22:00')).toBe(true);
    expect(withinActiveWindow(at(23), '09:00', '22:00')).toBe(false);
    expect(withinActiveWindow(at(1), '22:00', '02:00')).toBe(true); // 跨夜
    expect(withinActiveWindow(at(12), '22:00', '02:00')).toBe(false);
  });

  it('classifyCookie — expired/stale(陈旧)/healthy 分类', () => {
    const now = new Date('2026-06-26T12:00:00Z');
    expect(classifyCookie({ status: 'expired', bound_at: now.toISOString() }, 6, now)).toBe('expired');
    expect(classifyCookie({ status: 'active', bound_at: null }, 6, now)).toBe('stale');
    expect(classifyCookie({ status: 'active', bound_at: '2026-06-26T01:00:00Z' }, 6, now)).toBe('stale'); // 11h>6h
    expect(classifyCookie({ status: 'active', bound_at: '2026-06-26T10:00:00Z' }, 6, now)).toBe('healthy'); // 2h<6h
  });
});

describe('scoreLeads — 给未评分 leads 打分', () => {
  it('只更新 relevance_score IS NULL 的行', async () => {
    const pool = makeFakePool({ leads: [lead('1', null), lead('2', 70), lead('3', null, { partial: true, sec_uid: null, profile_url: null })] });
    const r = await scoreLeads(pool, 't1');
    expect(r.scored).toBe(2);
    expect(pool._state.leads.find((l) => l.id === '1')!.relevance_score).toBe(80);
    expect(pool._state.leads.find((l) => l.id === '3')!.relevance_score).toBe(20);
    expect(pool._state.leads.find((l) => l.id === '2')!.relevance_score).toBe(70); // 不动
  });
});

describe('buildAssignments — 按分排序 + 轮换 + 去重 + 频控预算 + 排期', () => {
  it('无活跃 burner → 不指派', async () => {
    const pool = makeFakePool({ configRow: CFG_ROW, leads: [lead('1', 90)], sessions: [] });
    const r = await buildAssignments(pool, 't1', new Date('2026-06-26T10:00:00Z'));
    expect(r.assigned).toBe(0);
    expect(r.burners).toEqual([]);
  });

  it('按 relevance_score 降序 + 轮换分摊到多个 burner', async () => {
    const pool = makeFakePool({
      configRow: CFG_ROW,
      leads: [lead('lo', 30), lead('hi', 95), lead('mid', 60)],
      sessions: [burner('b1'), burner('b2')],
    });
    const r = await buildAssignments(pool, 't1', new Date('2026-06-26T10:00:00Z'));
    expect(r.assigned).toBe(3);
    const a = pool._state.assignments;
    // 第一条（最高分 hi）派给 b1，第二条（mid）派给 b2 → 轮换
    expect(a.find((x) => x.lead_id === 'hi')!.account_label).toBe('b1');
    expect(a.find((x) => x.lead_id === 'mid')!.account_label).toBe('b2');
    // 负载分摊：两号各 1~2 条
    const cntB1 = a.filter((x) => x.account_label === 'b1').length;
    const cntB2 = a.filter((x) => x.account_label === 'b2').length;
    expect(Math.abs(cntB1 - cntB2)).toBeLessThanOrEqual(1);
  });

  it('去重：(tenant,lead,label) 已有指派 → 跳过', async () => {
    const pool = makeFakePool({
      configRow: CFG_ROW,
      leads: [lead('1', 90)],
      sessions: [burner('b1')],
      assignments: [{ id: 'old', tenant_id: 't1', lead_id: '1', account_label: 'b1', status: 'queued', scheduled_for: '2026-06-26T11:00:00Z', created_at: '2026-06-26T09:00:00Z' }],
    });
    const r = await buildAssignments(pool, 't1', new Date('2026-06-26T10:00:00Z'));
    expect(r.assigned).toBe(0);
    expect(r.skipped_dedup).toBeGreaterThanOrEqual(1);
  });

  it('天预算闸：该号当天已达 dm_per_day → 不再指派', async () => {
    // dm_per_day=2，b1 已有 2 条 queued 占满
    const cfg = { ...CFG_ROW, dm_per_day: 2 };
    const pre: Assignment[] = [
      { id: 'p1', tenant_id: 't1', lead_id: 'x1', account_label: 'b1', status: 'queued', scheduled_for: '2026-06-26T11:00:00Z', created_at: 'c' },
      { id: 'p2', tenant_id: 't1', lead_id: 'x2', account_label: 'b1', status: 'queued', scheduled_for: '2026-06-26T11:30:00Z', created_at: 'c' },
    ];
    const pool = makeFakePool({ configRow: cfg, leads: [lead('new', 90)], sessions: [burner('b1')], assignments: pre });
    const r = await buildAssignments(pool, 't1', new Date('2026-06-26T10:00:00Z'));
    expect(r.assigned).toBe(0);
    expect(r.skipped_budget).toBeGreaterThanOrEqual(1);
  });

  it('scheduled_for 落在 dm_active 时段内', async () => {
    const cfg = { ...CFG_ROW, dm_active_start: '09:00', dm_active_end: '22:00', dm_interval_min_sec: 60, dm_interval_max_sec: 120 };
    const pool = makeFakePool({ configRow: cfg, leads: [lead('1', 90), lead('2', 80)], sessions: [burner('b1')] });
    // now 用本地壁钟 10:00（withinActiveWindow 按本地时分判断时段）
    await buildAssignments(pool, 't1', new Date(2026, 5, 26, 10, 0));
    expect(pool._state.assignments.length).toBe(2);
    for (const a of pool._state.assignments) {
      const d = new Date(a.scheduled_for!);
      expect(withinActiveWindow(d, '09:00', '22:00')).toBe(true);
    }
  });
});

describe('dispatchDue — 时段闸 + 上限闸', () => {
  const due = (id: string, label: string, when: string): Assignment =>
    ({ id, tenant_id: 't1', lead_id: `lead_${id}`, account_label: label, status: 'queued', scheduled_for: when, created_at: 'c' });

  it('不在活跃时段 → 一条不发（skipped_window=-1）', async () => {
    const cfg = { ...CFG_ROW, dm_active_start: '09:00', dm_active_end: '22:00' };
    const pool = makeFakePool({ configRow: cfg, assignments: [due('1', 'b1', '2026-06-26T23:00:00Z')], leads: [lead('lead_1', 90)] });
    const r = await dispatchDue(pool, 't1', new Date(2026, 5, 26, 23, 30)); // 本地 23:30 出窗
    expect(r.dispatched).toBe(0);
    expect(r.skipped_window).toBe(-1);
  });

  it('到期指派 → 真派单到 publish_tasks + 写 dm_outreach_log + 标 dispatched', async () => {
    const cfg = { ...CFG_ROW, dm_active_start: '00:00', dm_active_end: '23:59', dm_per_hour: 5, dm_per_day: 30 };
    const pool = makeFakePool({
      configRow: cfg,
      assignments: [due('1', 'b1', '2026-06-26T09:00:00Z')],
      leads: [{ ...lead('lead_1', 90) }],
      sessions: [{ account_label: 'b1', role: 'burner', platform: 'douyin', status: 'active', bound_at: new Date().toISOString(), tenant_id: 't1', agent_id: 'agent-uuid-b1' }],
    });
    const r = await dispatchDue(pool, 't1', new Date('2026-06-26T10:00:00Z'));
    expect(r.dispatched).toBe(1);
    expect(pool._state.logs.length).toBe(1);
    expect(pool._state.assignments[0].status).toBe('dispatched');
  });

  it('per-hour 上限：该号本小时已发满 → 标 limited 不发', async () => {
    const cfg = { ...CFG_ROW, dm_active_start: '00:00', dm_active_end: '23:59', dm_per_hour: 1, dm_per_day: 30 };
    const now = '2026-06-26T10:00:00Z';
    const pool = makeFakePool({
      configRow: cfg,
      assignments: [due('1', 'b1', '2026-06-26T09:30:00Z')],
      leads: [lead('lead_1', 90)],
      logs: [{ id: 'L0', tenant_id: 't1', account_label: 'b1', lead_id: 'old', profile_url: null, status: 'sent', sent_at: '2026-06-26T09:50:00Z' }],
    });
    const r = await dispatchDue(pool, 't1', new Date(now));
    expect(r.dispatched).toBe(0);
    expect(r.skipped_limit).toBe(1);
    expect(pool._state.assignments[0].status).toBe('limited');
  });
});

describe('cookieHealth — 分类 + 告警项', () => {
  it('healthy/stale/expired 三类 + alerts 含非 healthy', async () => {
    const now = new Date('2026-06-26T12:00:00Z');
    const cfg = { ...CFG_ROW, cookie_check_interval_hours: 6 };
    const pool = makeFakePool({
      configRow: cfg,
      sessions: [
        { account_label: 'main', role: 'main', platform: 'douyin', status: 'active', bound_at: '2026-06-26T10:00:00Z', tenant_id: 't1' }, // 2h healthy
        { account_label: 'b1', role: 'burner', platform: 'douyin', status: 'active', bound_at: '2026-06-26T01:00:00Z', tenant_id: 't1' }, // 11h stale
        { account_label: 'b2', role: 'burner', platform: 'douyin', status: 'expired', bound_at: '2026-06-26T11:00:00Z', tenant_id: 't1' }, // expired
      ],
    });
    const { items, alerts } = await cookieHealth(pool, 't1', now);
    const byLabel = Object.fromEntries(items.map((i) => [i.account_label, i.status]));
    expect(byLabel.main).toBe('healthy');
    expect(byLabel.b1).toBe('stale');
    expect(byLabel.b2).toBe('expired');
    expect(alerts.map((a) => a.account_label).sort()).toEqual(['b1', 'b2']);
    expect(items.find((i) => i.account_label === 'b2')!.needs_rescan).toBe(true);
  });
});

// ═══════════════════════ B. 路由（supertest + mocked default pool）═══════════════════════
vi.mock('../../src/db/connection', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
}));
vi.mock('../../src/middleware/tenant-context', () => ({
  tenantContextOptional: (req: any, res: any, next: () => void) => {
    const t = req.header('X-Tenant-Id');
    if (t) { req.tenantId = String(t).trim(); }
    next();
  },
}));

const { acquisitionDispatchRouter } = await import('../../src/routes/acquisition-dispatch');

const app = express();
app.use(express.json());
app.use('/api/acquisition', acquisitionDispatchRouter);

async function mockPool() {
  return (await import('../../src/db/connection')).default as unknown as { query: ReturnType<typeof vi.fn> };
}

describe('acquisition-dispatch routes', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    (await mockPool()).query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('GET /config 无 tenant → 401', async () => {
    const res = await request(app).get('/api/acquisition/config');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('NO_TENANT');
  });

  it('GET /config 无配置行 → 返默认 + tenant 由 X-Tenant-Id 驱动', async () => {
    (await mockPool()).query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/acquisition/config').set('X-Tenant-Id', 't1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tenant_id).toBe('t1');
    expect(res.body.data.dm_per_day).toBe(30);
  });

  it('PUT /config 非法数值 → 400 INVALID_CONFIG，不写库', async () => {
    const pool = await mockPool();
    const res = await request(app).put('/api/acquisition/config').set('X-Tenant-Id', 't1').send({ dm_per_day: 99999 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CONFIG');
    // 不应触发 INSERT
    const inserted = pool.query.mock.calls.some((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO zenithjoy.acquisition_config'));
    expect(inserted).toBe(false);
  });

  it('PUT /config 合法 → 200 + upsert', async () => {
    const pool = await mockPool();
    pool.query
      .mockResolvedValueOnce({ rows: [] })  // getConfig (内部)
      .mockResolvedValueOnce({ rows: [] }); // INSERT upsert
    const res = await request(app).put('/api/acquisition/config').set('X-Tenant-Id', 't1').send({ dm_per_day: 20 });
    expect(res.status).toBe(200);
    expect(res.body.data.dm_per_day).toBe(20);
    const inserted = pool.query.mock.calls.some((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO zenithjoy.acquisition_config'));
    expect(inserted).toBe(true);
  });

  it('GET /dispatch/plan 无 tenant → 401；带 tenant → 200 envelope', async () => {
    expect((await request(app).get('/api/acquisition/dispatch/plan')).status).toBe(401);
    (await mockPool()).query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/acquisition/dispatch/plan').set('X-Tenant-Id', 't1');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('plan');
  });

  it('GET /cookie-health 带 tenant → 200 + items/alerts', async () => {
    const pool = await mockPool();
    pool.query
      .mockResolvedValueOnce({ rows: [] })  // getConfig
      .mockResolvedValueOnce({ rows: [] }); // sessions
    const res = await request(app).get('/api/acquisition/cookie-health').set('X-Tenant-Id', 't1');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('items');
    expect(res.body.data).toHaveProperty('alert_count');
  });

  it('tenant 隔离：plan 查询 SQL 第一参数为 req.tenantId（不信 query.tenant_id）', async () => {
    const pool = await mockPool();
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/api/acquisition/dispatch/plan?tenant_id=EVIL').set('X-Tenant-Id', 'real-tenant');
    const planCall = pool.query.mock.calls.find((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('FROM zenithjoy.dm_assignments a'));
    expect(planCall).toBeDefined();
    expect((planCall![1] as unknown[])[0]).toBe('real-tenant');
  });
});
