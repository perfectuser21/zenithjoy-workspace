/**
 * 智能获客「分析+指派」API 客户端（Line02 — 刀1 中台大脑）
 *
 * 契约见 scratchpad/dispatch-engine-contract.md：
 *   GET  /api/acquisition/config            读 acquisition_config（无则默认）
 *   PUT  /api/acquisition/config            upsert config（数值范围校验，非法 400）
 *   POST /api/acquisition/dispatch/build    scoreLeads + buildAssignments → {scored, assigned}
 *   POST /api/acquisition/dispatch/run      dispatchDue → {dispatched}
 *   GET  /api/acquisition/dispatch/plan     dm_assignments join leads（谁×哪个号×何时×状态）
 *   GET  /api/acquisition/cookie-health     各号 healthy/stale/expired + 需重扫项
 *
 * 鉴权与 machines.api 同款：credentials:'include' + 可选 license token；信封解析。
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

function getLicenseToken(): string {
  if (typeof document !== 'undefined') {
    const m = document.cookie.match(/(^|; )license=([^;]+)/);
    if (m) return decodeURIComponent(m[2]);
  }
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem('zj_license') || '';
  }
  return '';
}

function authHeaders(extra?: Record<string, string>): Headers {
  const headers = new Headers(extra);
  const lic = getLicenseToken();
  if (lic) headers.set('Authorization', `Bearer ${lic}`);
  return headers;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function parseEnvelope<T>(r: Response): Promise<T> {
  let j: ApiEnvelope<T> | null = null;
  try {
    j = (await r.json()) as ApiEnvelope<T>;
  } catch {
    throw new Error(`请求失败（${r.status}）`);
  }
  if (!r.ok || !j?.success) {
    throw new Error(j?.error?.message || `请求失败（${r.status}）`);
  }
  return j.data as T;
}

// ============ 类型（按契约字段） ============

/** acquisition_config 一行（每租户一行，所有参数中台可调） */
export interface AcquisitionConfig {
  tenant_id?: string;
  // 采集
  collect_rounds_per_day: number;
  keywords_per_round_min: number;
  keywords_per_round_max: number;
  collect_active_start: string;
  collect_active_end: string;
  // 触达
  burner_count: number;
  dm_per_hour: number;
  dm_per_day: number;
  dm_interval_min_sec: number;
  dm_interval_max_sec: number;
  dm_active_start: string;
  dm_active_end: string;
  // 养号
  nurture_per_day_min: number;
  nurture_per_day_max: number;
  // Cookie
  cookie_check_interval_hours: number;
  created_at?: string;
  updated_at?: string;
}

/** 可写入 config 的字段（去掉只读元字段） */
export type AcquisitionConfigPatch = Omit<
  AcquisitionConfig,
  'tenant_id' | 'created_at' | 'updated_at'
>;

/** 指派计划一行（dm_assignments join leads） */
export interface DispatchPlanItem {
  id: string;
  lead_id: string;
  nickname: string | null;
  relevance_score: number | null;
  profile_url: string | null;
  account_label: string;
  status: 'queued' | 'dispatched' | 'sent' | 'limited' | 'failed';
  scheduled_for: string;
  created_at?: string;
}

/** Cookie 健康一行（每个号一项） */
export interface CookieHealthItem {
  account_label: string;
  role: string;
  health: 'healthy' | 'stale' | 'expired';
  bound_at: string | null;
  needs_rescan: boolean;
}

export interface CookieHealthResult {
  items: CookieHealthItem[];
  /** 需告警/重扫的号数量 */
  alert_count: number;
}

export interface BuildResult {
  scored: number;
  assigned: number;
}

export interface RunResult {
  dispatched: number;
}

export interface OutreachHistoryItem {
  id: string;
  lead_nickname: string | null;
  account_label: string;
  status: 'queued' | 'dispatched' | 'sent' | 'limited' | 'failed';
  scheduled_for: string | null;
  sent_at: string | null;
}

export interface OutreachHistoryResult {
  items: OutreachHistoryItem[];
  total: number;
}

// ============ 端点封装 ============

/** 读取本租户获客配置（无则后端返默认） */
export async function fetchAcquisitionConfig(): Promise<AcquisitionConfig> {
  const r = await fetch(`${API_BASE}/acquisition/config`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  return parseEnvelope<AcquisitionConfig>(r);
}

/** 保存（upsert）获客配置 */
export async function updateAcquisitionConfig(
  patch: AcquisitionConfigPatch
): Promise<AcquisitionConfig> {
  const r = await fetch(`${API_BASE}/acquisition/config`, {
    method: 'PUT',
    credentials: 'include',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(patch),
  });
  return parseEnvelope<AcquisitionConfig>(r);
}

/** 跑分析指派（scoreLeads + buildAssignments） */
export async function buildDispatch(): Promise<BuildResult> {
  const r = await fetch(`${API_BASE}/acquisition/dispatch/build`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({}),
  });
  return parseEnvelope<BuildResult>(r);
}

/** 执行到期指派（dispatchDue） */
export async function runDispatch(): Promise<RunResult> {
  const r = await fetch(`${API_BASE}/acquisition/dispatch/run`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({}),
  });
  return parseEnvelope<RunResult>(r);
}

/** 读指派计划（可按 status 过滤） */
export async function fetchDispatchPlan(
  status?: string
): Promise<DispatchPlanItem[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const r = await fetch(`${API_BASE}/acquisition/dispatch/plan${qs}`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  // 后端返回信封 {plan: DispatchPlanItem[], total: number}，需提取 .plan 数组
  const result = await parseEnvelope<{ plan: DispatchPlanItem[]; total: number }>(r);
  return result.plan ?? [];
}

/** 读触达历史 */
export async function fetchOutreachHistory(): Promise<OutreachHistoryResult> {
  const r = await fetch(`${API_BASE}/acquisition/outreach-history`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  return parseEnvelope<OutreachHistoryResult>(r);
}

/** 读 Cookie 健康 */
export async function fetchCookieHealth(): Promise<CookieHealthResult> {
  const r = await fetch(`${API_BASE}/acquisition/cookie-health`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  // 后端真实字段是 status（'healthy'|'stale'|'expired'），接口定义用 health；
  // 在 API 层映射，页面侧 it.health 无需改动。
  const raw = await parseEnvelope<{
    items: Array<Omit<CookieHealthItem, 'health'> & { status?: string; health?: string }>;
    alert_count: number;
  }>(r);
  return {
    alert_count: raw.alert_count,
    items: (raw.items ?? []).map((item) => ({
      ...item,
      health: (item.health ?? item.status ?? '') as CookieHealthItem['health'],
    })),
  };
}
