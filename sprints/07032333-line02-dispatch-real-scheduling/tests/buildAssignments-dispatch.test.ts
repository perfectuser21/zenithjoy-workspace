/**
 * TDD Red — buildAssignments 真调度合同测试
 * 验证：在线感知调度 + dispatch_reason + pending_dispatch + 重试 + 租户隔离
 *
 * 这些测试当前全部 FAIL（Red 阶段）：
 *  - BuildResult 无 pending 字段
 *  - buildAssignments INSERT 无 dispatch_reason
 *  - 全离线时不写 pending_dispatch（当前直接跳过）
 *  - 无 pending_dispatch 重试逻辑
 *  - burner 查询不过滤 last_heartbeat_at
 */
import { describe, it, expect } from 'vitest';
import {
  buildAssignments,
  type QueryablePool,
  type BuildResult,
} from '../../../apps/api/src/services/acquisition-dispatch';

// ── 扩展 fake pool，支持本 sprint 新增的心跳感知 + dispatch_reason + pending_dispatch ──

interface Lead {
  id: string;
  tenant_id: string;
  sec_uid: string | null;
  profile_url: string | null;
  partial: boolean;
  relevance_score: number | null;
  nickname: string;
  created_at: string;
}

interface AgentRow {
  id: string;
  tenant_id: string;
  last_heartbeat_at: string | null;
}

interface Session {
  account_label: string;
  role: string;
  platform: string;
  status: string;
  bound_at: string | null;
  tenant_id: string;
  agent_id: string;
}

interface Assignment {
  id: string;
  tenant_id: string;
  lead_id: string;
  account_label: string;
  status: string;
  scheduled_for: string | null;
  dispatch_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface OutreachLog {
  id: string;
  tenant_id: string;
  account_label: string;
  lead_id: string | null;
  profile_url: string | null;
  status: string;
  sent_at: string;
}

function makeDispatchPool(seed: {
  configRow?: Record<string, unknown> | null;
  leads?: Lead[];
  agents?: AgentRow[];
  sessions?: Session[];
  assignments?: Assignment[];
  logs?: OutreachLog[];
}): QueryablePool & { _state: { assignments: Assignment[] } } {
  const leads = seed.leads ?? [];
  const agents = seed.agents ?? [];
  const sessions = seed.sessions ?? [];
  const assignments = seed.assignments ?? [];
  const logs = seed.logs ?? [];
  let idc = 1;

  const pool = {
    _state: { assignments },
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

      // scoreLeads
      if (sql.includes('FROM zenithjoy.acquisition_leads') && sql.includes('relevance_score IS NULL')) {
        return { rows: leads.filter((l) => l.tenant_id === params[0] && l.relevance_score === null) };
      }
      if (sql.startsWith('UPDATE zenithjoy.acquisition_leads SET relevance_score')) {
        const l = leads.find((x) => x.id === params[0]);
        if (l) l.relevance_score = Number(params[1]);
        return { rows: [] };
      }

      // burner query — NEW: must JOIN agents and filter last_heartbeat_at
      // The upgraded query should look up sessions joined with agents, filtered by heartbeat
      if (sql.includes('FROM zenithjoy.agent_platform_sessions s') && sql.includes("s.role = 'burner'")) {
        const tenantId = params[0] as string;
        const limit = Number(params[1]);
        const nowParam = params[2] as string | undefined;
        const now = nowParam ? new Date(nowParam) : new Date();
        const cutoff = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes

        // Filter burners: must have agent with last_heartbeat_at > now - 2 min
        const onlineSessions = sessions.filter((s) => {
          if (s.tenant_id !== tenantId) return false;
          if (s.role !== 'burner' || s.status !== 'active') return false;
          const agent = agents.find((a) => a.id === s.agent_id && a.tenant_id === tenantId);
          if (!agent) return false;
          if (!agent.last_heartbeat_at) return false;
          return new Date(agent.last_heartbeat_at) > cutoff;
        });

        // Sort by today's dm_assignments count (ascending — least load first)
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString();

        const withLoad = Array.from(new Set(onlineSessions.map((s) => s.account_label)))
          .map((label) => {
            const count = assignments.filter(
              (a) => a.tenant_id === tenantId && a.account_label === label &&
                ['queued', 'dispatched', 'sent'].includes(a.status) &&
                a.scheduled_for != null && a.scheduled_for >= todayStr
            ).length;
            return { account_label: label, day_count: count };
          })
          .sort((a, b) => a.day_count - b.day_count)
          .slice(0, limit);

        return { rows: withLoad };
      }

      // scored leads desc
      if (sql.includes('FROM zenithjoy.acquisition_leads') && sql.includes('relevance_score IS NOT NULL')) {
        const rows = leads.filter((l) => l.tenant_id === params[0] && l.relevance_score !== null)
          .sort((a, b) => (b.relevance_score! - a.relevance_score!) || a.created_at.localeCompare(b.created_at))
          .map((l) => ({ id: l.id, profile_url: l.profile_url, relevance_score: l.relevance_score }));
        return { rows };
      }

      // pending_dispatch leads for retry (NEW — upgraded buildAssignments fetches these first)
      if (sql.includes('FROM zenithjoy.dm_assignments') && sql.includes("status = 'pending_dispatch'")) {
        const rows = assignments.filter(
          (a) => a.tenant_id === params[0] && a.status === 'pending_dispatch'
        ).map((a) => ({ id: a.id, lead_id: a.lead_id, account_label: a.account_label }));
        return { rows };
      }

      // perDay used count (buildAssignments)
      if (sql.includes('dm_assignments') && sql.includes('dm_outreach_log') && sql.includes('AS used')) {
        const [tenant, label] = params as string[];
        const a = assignments.filter((x) => x.tenant_id === tenant && x.account_label === label &&
          ['queued', 'dispatched', 'sent'].includes(x.status)).length;
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

      // insert assignment — NEW: must include dispatch_reason
      if (sql.startsWith('INSERT INTO zenithjoy.dm_assignments')) {
        // Expected params: [tenant, leadId, label, scheduledFor, dispatchReason]
        // Or for pending_dispatch: [tenant, leadId, status='pending_dispatch']
        const status = sql.includes("'pending_dispatch'") ? 'pending_dispatch' : 'queued';
        if (status === 'pending_dispatch') {
          const [tenant, leadId] = params as string[];
          const exists = assignments.some((x) => x.tenant_id === tenant && x.lead_id === leadId && x.status === 'pending_dispatch');
          if (!exists) {
            assignments.push({
              id: `p${idc++}`, tenant_id: tenant, lead_id: leadId,
              account_label: '', status: 'pending_dispatch',
              scheduled_for: null, dispatch_reason: null,
              created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            });
          }
        } else {
          const [tenant, leadId, label, scheduled, dispatchReason] = params as string[];
          const exists = assignments.some((x) => x.tenant_id === tenant && x.lead_id === leadId && x.account_label === label);
          if (!exists) {
            assignments.push({
              id: `a${idc++}`, tenant_id: tenant, lead_id: leadId, account_label: label,
              status: 'queued', scheduled_for: scheduled,
              dispatch_reason: dispatchReason ?? null,
              created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            });
          }
        }
        return { rows: [] };
      }

      // update pending_dispatch → queued (retry)
      if (sql.startsWith('UPDATE zenithjoy.dm_assignments SET status') && sql.includes("'queued'")) {
        const [assignId, label, scheduled, dispatchReason] = params as string[];
        const a = assignments.find((x) => x.id === assignId);
        if (a) {
          a.status = 'queued';
          a.account_label = label;
          a.scheduled_for = scheduled;
          a.dispatch_reason = dispatchReason;
          a.updated_at = new Date().toISOString();
        }
        return { rows: [] };
      }

      throw new Error('fake pool: unhandled SQL: ' + sql.slice(0, 150));
    },
  };
  return pool;
}

const BASE_CFG = {
  dm_per_day: 30, dm_per_hour: 5, burner_count: 3,
  dm_active_start: '00:00', dm_active_end: '23:59',
  dm_interval_min_sec: 60, dm_interval_max_sec: 120,
  collect_rounds_per_day: 2, keywords_per_round_min: 3, keywords_per_round_max: 5,
  collect_active_start: '00:00', collect_active_end: '23:59',
  nurture_per_day_min: 1, nurture_per_day_max: 2, cookie_check_interval_hours: 6,
  dm_message: 'test',
};

function lead(id: string, score: number): Lead {
  return { id, tenant_id: 't1', sec_uid: `sec_${id}`, profile_url: `https://d/${id}`, partial: false, relevance_score: score, nickname: `nick_${id}`, created_at: `2026-07-03T0${id.length}:00:00Z` };
}

function agent(id: string, heartbeatAt: Date | null, tenantId = 't1'): AgentRow {
  return { id, tenant_id: tenantId, last_heartbeat_at: heartbeatAt ? heartbeatAt.toISOString() : null };
}

function session(label: string, agentId: string, tenantId = 't1'): Session {
  return { account_label: label, role: 'burner', platform: 'douyin', status: 'active', bound_at: new Date().toISOString(), tenant_id: tenantId, agent_id: agentId };
}

const NOW = new Date('2026-07-03T10:00:00Z');
const ONLINE_HB = new Date(NOW.getTime() - 30_000);   // 30s ago = online
const OFFLINE_HB = new Date(NOW.getTime() - 600_000);  // 10 min ago = offline

// ══════════════════════════════════════════════════════════════════════
describe('buildAssignments 在线感知调度 — TDD Red', () => {
  it('在线小号有心跳 → 被选中，dispatch_reason = least_load', async () => {
    const pool = makeDispatchPool({
      configRow: BASE_CFG,
      leads: [lead('L1', 90)],
      agents: [agent('agent-1', ONLINE_HB)],
      sessions: [session('b1', 'agent-1')],
    });

    const result = await buildAssignments(pool, 't1', NOW);

    // 期望: assigned=1, pending=0
    expect(result.assigned).toBe(1);
    // BuildResult 必须有 pending 字段（当前 FAIL: 无此字段）
    expect((result as BuildResult & { pending: number }).pending).toBe(0);

    // dispatch_reason 必须写入 dm_assignments（当前 FAIL: INSERT 无 dispatch_reason）
    const row = pool._state.assignments.find((a) => a.lead_id === 'L1');
    expect(row).toBeDefined();
    expect(row!.dispatch_reason).toBe('least_load');
    expect(row!.status).toBe('queued');
  });

  it('离线小号（heartbeat > 2min）不被选中', async () => {
    const pool = makeDispatchPool({
      configRow: BASE_CFG,
      leads: [lead('L1', 90)],
      agents: [agent('agent-offline', OFFLINE_HB)],
      sessions: [session('b-offline', 'agent-offline')],
    });

    const result = await buildAssignments(pool, 't1', NOW);

    // 期望: assigned=0（离线小号跳过），当前 FAIL: 旧代码不过滤 heartbeat 会 assigned=1
    expect(result.assigned).toBe(0);
    // pending 必须包含被跳过的 lead（当前 FAIL: 无 pending 字段 + 无 pending_dispatch 逻辑）
    expect((result as BuildResult & { pending: number }).pending).toBe(1);

    const pending = pool._state.assignments.filter((a) => a.status === 'pending_dispatch');
    expect(pending.length).toBe(1);
    expect(pending[0].lead_id).toBe('L1');
  });

  it('两个在线小号，负载不同 → 选当天任务量最少的小号', async () => {
    // b1 当天已有 5 条 queued，b2 当天 2 条
    const pre: Assignment[] = [];
    for (let i = 0; i < 5; i++) {
      pre.push({
        id: `pre-b1-${i}`, tenant_id: 't1', lead_id: `pre${i}`, account_label: 'b1',
        status: 'queued', scheduled_for: new Date(NOW.getTime() + i * 60_000).toISOString(),
        dispatch_reason: 'least_load', created_at: NOW.toISOString(), updated_at: NOW.toISOString(),
      });
    }
    for (let i = 0; i < 2; i++) {
      pre.push({
        id: `pre-b2-${i}`, tenant_id: 't1', lead_id: `pre-b2-${i}`, account_label: 'b2',
        status: 'queued', scheduled_for: new Date(NOW.getTime() + i * 60_000).toISOString(),
        dispatch_reason: 'least_load', created_at: NOW.toISOString(), updated_at: NOW.toISOString(),
      });
    }

    const pool = makeDispatchPool({
      configRow: BASE_CFG,
      leads: [lead('NEW', 95)],
      agents: [agent('a1', ONLINE_HB), agent('a2', ONLINE_HB)],
      sessions: [session('b1', 'a1'), session('b2', 'a2')],
      assignments: pre,
    });

    await buildAssignments(pool, 't1', NOW);

    // 新 lead 应被派给 b2（负载最少）
    const newRow = pool._state.assignments.find((a) => a.lead_id === 'NEW');
    expect(newRow).toBeDefined();
    // 当前 FAIL: 旧代码按字母序轮换，不感知负载（会给 b1 而非 b2）
    expect(newRow!.account_label).toBe('b2');
    expect(newRow!.dispatch_reason).toBe('least_load');
  });

  it('全部小号离线 → assigned=0, pending=1, lead 写入 pending_dispatch 状态', async () => {
    const pool = makeDispatchPool({
      configRow: BASE_CFG,
      leads: [lead('L-offline', 80)],
      agents: [agent('a-dead', OFFLINE_HB)],
      sessions: [session('b-dead', 'a-dead')],
    });

    const result = await buildAssignments(pool, 't1', NOW);

    // 当前 FAIL: 无 pending 字段
    expect((result as BuildResult & { pending: number }).pending).toBe(1);
    expect(result.assigned).toBe(0);

    // 当前 FAIL: 无 pending_dispatch 写入逻辑
    const pendingRow = pool._state.assignments.find((a) => a.status === 'pending_dispatch');
    expect(pendingRow).toBeDefined();
    expect(pendingRow!.lead_id).toBe('L-offline');
  });

  it('pending_dispatch 重试 — 下一轮有在线小号时补派为 queued', async () => {
    // 预置一条 pending_dispatch 行（上一轮留下的）
    const preAssignment: Assignment = {
      id: 'pending-001', tenant_id: 't1', lead_id: 'L-pending', account_label: '',
      status: 'pending_dispatch', scheduled_for: null, dispatch_reason: null,
      created_at: new Date(NOW.getTime() - 60_000).toISOString(),
      updated_at: new Date(NOW.getTime() - 60_000).toISOString(),
    };

    const pool = makeDispatchPool({
      configRow: BASE_CFG,
      leads: [{ id: 'L-pending', tenant_id: 't1', sec_uid: 'sp', profile_url: 'https://d/p', partial: false, relevance_score: 85, nickname: 'p', created_at: '2026-07-03T09:00:00Z' }],
      agents: [agent('a-online', ONLINE_HB)],
      sessions: [session('b-online', 'a-online')],
      assignments: [preAssignment],
    });

    const result = await buildAssignments(pool, 't1', NOW);

    // 当前 FAIL: 无 pending_dispatch 重试逻辑
    expect(result.assigned).toBeGreaterThanOrEqual(1);
    expect((result as BuildResult & { pending: number }).pending).toBe(0);

    // pending 行应已更新为 queued
    const retried = pool._state.assignments.find((a) => a.id === 'pending-001');
    expect(retried).toBeDefined();
    expect(retried!.status).toBe('queued');
    expect(retried!.dispatch_reason).toBe('least_load');
    expect(retried!.account_label).toBe('b-online');
  });

  it('pending_dispatch 去重 — 已存在 pending 行的 (tenant,lead) 不重复插入', async () => {
    const existingPending: Assignment = {
      id: 'dup-pending', tenant_id: 't1', lead_id: 'L-dup', account_label: '',
      status: 'pending_dispatch', scheduled_for: null, dispatch_reason: null,
      created_at: new Date(NOW.getTime() - 60_000).toISOString(),
      updated_at: new Date(NOW.getTime() - 60_000).toISOString(),
    };

    const pool = makeDispatchPool({
      configRow: BASE_CFG,
      leads: [{ id: 'L-dup', tenant_id: 't1', sec_uid: 's', profile_url: 'https://d/d', partial: false, relevance_score: 70, nickname: 'd', created_at: '2026-07-03T09:00:00Z' }],
      agents: [agent('a-dead2', OFFLINE_HB)],
      sessions: [session('b-dead2', 'a-dead2')],
      assignments: [existingPending],
    });

    await buildAssignments(pool, 't1', NOW);

    // 不应重复插入同一 pending_dispatch
    const dupCount = pool._state.assignments.filter((a) => a.lead_id === 'L-dup' && a.status === 'pending_dispatch').length;
    expect(dupCount).toBe(1);
  });

  it('租户隔离 — 租户 A 的 pending_dispatch 不影响租户 B 的正常派发', async () => {
    // 租户 A: 离线，有 pending_dispatch 积压
    const pendingA: Assignment = {
      id: 'pa-001', tenant_id: 'tA', lead_id: 'LA', account_label: '',
      status: 'pending_dispatch', scheduled_for: null, dispatch_reason: null,
      created_at: NOW.toISOString(), updated_at: NOW.toISOString(),
    };

    // 租户 B: 在线
    const pool = makeDispatchPool({
      configRow: BASE_CFG,
      leads: [
        { id: 'LA', tenant_id: 'tA', sec_uid: 'sa', profile_url: 'https://d/a', partial: false, relevance_score: 80, nickname: 'a', created_at: NOW.toISOString() },
        { id: 'LB', tenant_id: 'tB', sec_uid: 'sb', profile_url: 'https://d/b', partial: false, relevance_score: 80, nickname: 'b', created_at: NOW.toISOString() },
      ],
      agents: [
        agent('a-offline-A', OFFLINE_HB, 'tA'),
        agent('a-online-B', ONLINE_HB, 'tB'),
      ],
      sessions: [
        session('bA', 'a-offline-A', 'tA'),
        session('bB', 'a-online-B', 'tB'),
      ],
      assignments: [pendingA],
    });

    // 触发租户 B 的 buildAssignments
    const resultB = await buildAssignments(pool, 'tB', NOW);

    // 租户 B 应正常派发
    expect(resultB.assigned).toBeGreaterThanOrEqual(1);
    expect((resultB as BuildResult & { pending: number }).pending).toBe(0);

    // 租户 B 的 assignments 无 pending_dispatch
    const tenantBPending = pool._state.assignments.filter(
      (a) => a.tenant_id === 'tB' && a.status === 'pending_dispatch'
    );
    expect(tenantBPending.length).toBe(0);
  });
});
