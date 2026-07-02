/**
 * 智能获客「分析+指派」引擎 service（刀1，架构 A — 薄指挥放中台）
 * 契约：scratchpad/dispatch-engine-contract.md「引擎 service」节
 *
 * 三段链路的中段②：抓(主号,已有) → 【分析+指派(本 service)】 → 执行(小号,复用 dm 派单)。
 *
 * 设计：纯函数 + 注入 pool（便于 vitest mock）+ 时钟 now 作参数注入（便于测时段/间隔）。
 *   - scoreLeads      给未评分 leads 打 relevance_score（thin 启发式，留 TODO 接真 AI comment-score）
 *   - buildAssignments 按分降序 + 轮换分摊 burner + (tenant,lead,label) 去重 + 频控预算 + 随机排期 → 插 dm_assignments
 *   - dispatchDue     取到期 queued、过时段闸/上限闸 → 派单 + 写 dm_outreach_log + 标 dispatched
 *   - cookieHealth    按 status + 陈旧度算 healthy|stale|expired（真 cookie 校验留刀2）
 */

// 最小 pool 抽象（只用到 query），便于注入 mock
export interface QueryablePool {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pg 行结果动态形状，下游各函数自行收窄
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

// ── 配置默认值（与 migration DEFAULT 对齐，无配置行时返回它）──────────────
export interface AcquisitionConfig {
  tenant_id: string;
  collect_rounds_per_day: number;
  keywords_per_round_min: number;
  keywords_per_round_max: number;
  collect_active_start: string;
  collect_active_end: string;
  burner_count: number;
  dm_per_hour: number;
  dm_per_day: number;
  dm_interval_min_sec: number;
  dm_interval_max_sec: number;
  dm_active_start: string;
  dm_active_end: string;
  nurture_per_day_min: number;
  nurture_per_day_max: number;
  cookie_check_interval_hours: number;
  dm_message: string;
}

export function defaultConfig(tenantId: string): AcquisitionConfig {
  return {
    tenant_id: tenantId,
    collect_rounds_per_day: 2,
    keywords_per_round_min: 3,
    keywords_per_round_max: 5,
    collect_active_start: '09:00',
    collect_active_end: '21:00',
    burner_count: 3,
    dm_per_hour: 5,
    dm_per_day: 30,
    dm_interval_min_sec: 300,
    dm_interval_max_sec: 900,
    dm_active_start: '09:00',
    dm_active_end: '22:00',
    nurture_per_day_min: 1,
    nurture_per_day_max: 2,
    cookie_check_interval_hours: 6,
    dm_message: '您好，看到您的评论，我们正在做相关品牌，有合作意向欢迎联系企微😊',
  };
}

// 配置数值字段范围校验规格（PUT 用；非法 → 400）
export const CONFIG_RANGES: Record<keyof Omit<AcquisitionConfig, 'tenant_id' | 'collect_active_start' | 'collect_active_end' | 'dm_active_start' | 'dm_active_end' | 'dm_message'>, [number, number]> = {
  collect_rounds_per_day: [1, 24],
  keywords_per_round_min: [1, 50],
  keywords_per_round_max: [1, 50],
  burner_count: [1, 20],
  dm_per_hour: [1, 100],
  dm_per_day: [1, 1000],
  dm_interval_min_sec: [1, 86400],
  dm_interval_max_sec: [1, 86400],
  nurture_per_day_min: [0, 100],
  nurture_per_day_max: [0, 100],
  cookie_check_interval_hours: [1, 168],
};

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 校验配置 patch，返回错误信息（null=通过）。只校验存在的字段。 */
export function validateConfigPatch(patch: Record<string, unknown>): string | null {
  for (const [key, [lo, hi]] of Object.entries(CONFIG_RANGES)) {
    if (patch[key] === undefined || patch[key] === null) continue;
    const v = patch[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) {
      return `${key} 必须是 [${lo}, ${hi}] 内的整数，收到 ${JSON.stringify(v)}`;
    }
  }
  for (const key of ['collect_active_start', 'collect_active_end', 'dm_active_start', 'dm_active_end']) {
    const v = patch[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' || !HHMM_RE.test(v)) {
      return `${key} 必须是 HH:MM 格式（00:00–23:59），收到 ${JSON.stringify(v)}`;
    }
  }
  // min/max 自洽
  if (typeof patch.keywords_per_round_min === 'number' && typeof patch.keywords_per_round_max === 'number'
      && patch.keywords_per_round_min > patch.keywords_per_round_max) {
    return 'keywords_per_round_min 不能大于 keywords_per_round_max';
  }
  if (typeof patch.dm_interval_min_sec === 'number' && typeof patch.dm_interval_max_sec === 'number'
      && patch.dm_interval_min_sec > patch.dm_interval_max_sec) {
    return 'dm_interval_min_sec 不能大于 dm_interval_max_sec';
  }
  if (typeof patch.nurture_per_day_min === 'number' && typeof patch.nurture_per_day_max === 'number'
      && patch.nurture_per_day_min > patch.nurture_per_day_max) {
    return 'nurture_per_day_min 不能大于 nurture_per_day_max';
  }
  return null;
}

// ── getConfig：读配置（无则返默认）─────────────────────────────────────────
export async function getConfig(pool: QueryablePool, tenantId: string): Promise<AcquisitionConfig> {
  const r = await pool.query(
    `SELECT * FROM zenithjoy.acquisition_config WHERE tenant_id = $1`,
    [tenantId]
  );
  if (!r.rows || r.rows.length === 0) return defaultConfig(tenantId);
  const row = r.rows[0];
  return { ...defaultConfig(tenantId), ...row, tenant_id: tenantId };
}

// ── upsertConfig：写配置（merge 默认 + patch 后整行 upsert）───────────────
export async function upsertConfig(
  pool: QueryablePool,
  tenantId: string,
  patch: Record<string, unknown>
): Promise<AcquisitionConfig> {
  const current = await getConfig(pool, tenantId);
  const next: AcquisitionConfig = { ...current, ...sanitizePatch(patch), tenant_id: tenantId };
  await pool.query(
    `INSERT INTO zenithjoy.acquisition_config (
       tenant_id, collect_rounds_per_day, keywords_per_round_min, keywords_per_round_max,
       collect_active_start, collect_active_end, burner_count, dm_per_hour, dm_per_day,
       dm_interval_min_sec, dm_interval_max_sec, dm_active_start, dm_active_end,
       nurture_per_day_min, nurture_per_day_max, cookie_check_interval_hours, dm_message, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now())
     ON CONFLICT (tenant_id) DO UPDATE SET
       collect_rounds_per_day = EXCLUDED.collect_rounds_per_day,
       keywords_per_round_min = EXCLUDED.keywords_per_round_min,
       keywords_per_round_max = EXCLUDED.keywords_per_round_max,
       collect_active_start   = EXCLUDED.collect_active_start,
       collect_active_end     = EXCLUDED.collect_active_end,
       burner_count           = EXCLUDED.burner_count,
       dm_per_hour            = EXCLUDED.dm_per_hour,
       dm_per_day             = EXCLUDED.dm_per_day,
       dm_interval_min_sec    = EXCLUDED.dm_interval_min_sec,
       dm_interval_max_sec    = EXCLUDED.dm_interval_max_sec,
       dm_active_start        = EXCLUDED.dm_active_start,
       dm_active_end          = EXCLUDED.dm_active_end,
       nurture_per_day_min    = EXCLUDED.nurture_per_day_min,
       nurture_per_day_max    = EXCLUDED.nurture_per_day_max,
       cookie_check_interval_hours = EXCLUDED.cookie_check_interval_hours,
       dm_message             = EXCLUDED.dm_message,
       updated_at             = now()`,
    [
      tenantId, next.collect_rounds_per_day, next.keywords_per_round_min, next.keywords_per_round_max,
      next.collect_active_start, next.collect_active_end, next.burner_count, next.dm_per_hour, next.dm_per_day,
      next.dm_interval_min_sec, next.dm_interval_max_sec, next.dm_active_start, next.dm_active_end,
      next.nurture_per_day_min, next.nurture_per_day_max, next.cookie_check_interval_hours, next.dm_message,
    ]
  );
  return next;
}

// 只挑配置已知字段（防注入未知列）
function sanitizePatch(patch: Record<string, unknown>): Partial<AcquisitionConfig> {
  const allowed = Object.keys(defaultConfig('x')) as (keyof AcquisitionConfig)[];
  const out: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k === 'tenant_id') continue;
    if (patch[k] !== undefined && patch[k] !== null) out[k] = patch[k];
  }
  return out as Partial<AcquisitionConfig>;
}

// ── scoreLeads：给未评分 leads 打 relevance_score（thin 启发式）─────────────
// TODO(刀2)：接真 AI comment-score（acquisition.ts /comment-score-result 已有 gradeComment DeepSeek）。
//   thin 启发式：有 sec_uid + 有 profile_url → 80；只有其一 → 50；partial/都缺 → 20。
export function heuristicScore(lead: { sec_uid?: string | null; profile_url?: string | null; partial?: boolean }): number {
  const hasSec = !!(lead.sec_uid && String(lead.sec_uid).trim());
  const hasUrl = !!(lead.profile_url && String(lead.profile_url).trim());
  if (lead.partial) return 20;
  if (hasSec && hasUrl) return 80;
  if (hasSec || hasUrl) return 50;
  return 20;
}

export async function scoreLeads(pool: QueryablePool, tenantId: string): Promise<{ scored: number }> {
  const r = await pool.query(
    `SELECT id, sec_uid, profile_url, partial
       FROM zenithjoy.acquisition_leads
      WHERE tenant_id = $1 AND relevance_score IS NULL`,
    [tenantId]
  );
  let scored = 0;
  for (const lead of r.rows) {
    const score = heuristicScore(lead);
    await pool.query(
      `UPDATE zenithjoy.acquisition_leads SET relevance_score = $2, updated_at = now() WHERE id = $1`,
      [lead.id, score]
    );
    scored += 1;
  }
  return { scored };
}

// ── 时段工具：now 是否在 [start,end] HH:MM 区间内（按 now 的本地小时分钟）──
export function parseHHMM(s: string): number {
  const m = HHMM_RE.exec(s);
  if (!m) return -1;
  const [hh, mm] = s.split(':').map((x) => parseInt(x, 10));
  return hh * 60 + mm;
}

export function withinActiveWindow(now: Date, start: string, end: string): boolean {
  const cur = now.getHours() * 60 + now.getMinutes();
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  if (s < 0 || e < 0) return true; // 配置异常时不阻塞
  if (s <= e) return cur >= s && cur <= e;
  // 跨夜区间（如 22:00–02:00）
  return cur >= s || cur <= e;
}

/** 把 now 推进到活跃时段内：若已在窗口内返回 now；否则推到当天（或次日）start。 */
export function clampToWindowStart(now: Date, start: string): Date {
  const s = parseHHMM(start);
  if (s < 0) return new Date(now);
  const d = new Date(now);
  const startToday = new Date(now);
  startToday.setHours(Math.floor(s / 60), s % 60, 0, 0);
  if (d < startToday) return startToday;
  return d;
}

// ── buildAssignments：分析+指派 ────────────────────────────────────────────
export interface BuildResult {
  assigned: number;
  skipped_dedup: number;
  skipped_budget: number;
  burners: string[];
}

export async function buildAssignments(
  pool: QueryablePool,
  tenantId: string,
  now: Date = new Date()
): Promise<BuildResult> {
  const cfg = await getConfig(pool, tenantId);

  // ① 活跃 burner 小号（role=burner status=active，最多 burner_count 个，account_label 去重）
  const burnersRes = await pool.query(
    `SELECT DISTINCT s.account_label
       FROM zenithjoy.agent_platform_sessions s
       JOIN zenithjoy.agents a ON a.id = s.agent_id
      WHERE a.tenant_id = $1 AND s.role = 'burner' AND s.status = 'active'
      ORDER BY s.account_label ASC
      LIMIT $2`,
    [tenantId, cfg.burner_count]
  );
  const burners: string[] = burnersRes.rows.map((r) => r.account_label).filter(Boolean);
  if (burners.length === 0) {
    return { assigned: 0, skipped_dedup: 0, skipped_budget: 0, burners: [] };
  }

  // ② 已评分 leads 按 relevance_score 降序
  const leadsRes = await pool.query(
    `SELECT id, profile_url, COALESCE(relevance_score, 0) AS relevance_score
       FROM zenithjoy.acquisition_leads
      WHERE tenant_id = $1 AND relevance_score IS NOT NULL
      ORDER BY relevance_score DESC, created_at ASC`,
    [tenantId]
  );

  // ⑤ 频控预算：每号当天/当前小时已用量（已 queued/dispatched 的指派 + 24h 真发日志 合并计已占用）
  // 这里以"今天已派 + 今天已发"为天预算消耗，"本小时已派 + 本小时已发"为小时预算消耗。
  const perDayUsed = new Map<string, number>();
  const perHourUsed = new Map<string, number>();
  for (const label of burners) {
    const dayRes = await pool.query(
      `SELECT
         (SELECT count(*) FROM zenithjoy.dm_assignments
            WHERE tenant_id = $1 AND account_label = $2
              AND status IN ('queued','dispatched','sent')
              AND scheduled_for >= date_trunc('day', $3::timestamptz)
              AND scheduled_for <  date_trunc('day', $3::timestamptz) + interval '1 day')
       + (SELECT count(*) FROM zenithjoy.dm_outreach_log
            WHERE tenant_id = $1 AND account_label = $2
              AND sent_at >= date_trunc('day', $3::timestamptz)
              AND sent_at <  date_trunc('day', $3::timestamptz) + interval '1 day') AS used`,
      [tenantId, label, now.toISOString()]
    );
    perDayUsed.set(label, Number(dayRes.rows[0]?.used ?? 0));
    perHourUsed.set(label, 0); // 排期分布在时段内，简化为按 day 预算闸 + 排期间隔控小时节奏
  }

  // 排期游标：每号下一条可排时间（从活跃时段起点 / now 起，按随机间隔递增）
  const cursor = new Map<string, Date>();
  const startCursor = clampToWindowStart(now, cfg.dm_active_start);
  for (const label of burners) cursor.set(label, new Date(startCursor));

  let assigned = 0;
  let skippedDedup = 0;
  let skippedBudget = 0;
  let rr = 0; // round-robin 指针，轮换分摊各号负载

  for (const lead of leadsRes.rows) {
    // 轮换：从 rr 起找一个"预算未满 + 未重复指派"的号
    let placed = false;
    for (let attempt = 0; attempt < burners.length; attempt++) {
      const label = burners[(rr + attempt) % burners.length];

      // ⑤ 天预算闸
      if ((perDayUsed.get(label) ?? 0) >= cfg.dm_per_day) {
        skippedBudget += 1;
        continue;
      }

      // ④ 去重：(tenant,lead,label) 已在 dm_assignments 或 24h 内 dm_outreach_log
      const dup = await pool.query(
        `SELECT 1 FROM zenithjoy.dm_assignments
           WHERE tenant_id = $1 AND lead_id = $2 AND account_label = $3
         UNION ALL
         SELECT 1 FROM zenithjoy.dm_outreach_log
           WHERE tenant_id = $1 AND lead_id = $2 AND account_label = $3
             AND sent_at >= $4::timestamptz - interval '24 hours'
         LIMIT 1`,
        [tenantId, lead.id, label, now.toISOString()]
      );
      if (dup.rows.length > 0) {
        skippedDedup += 1;
        continue;
      }

      // ⑥ scheduled_for：在 dm_active 时段内、随机间隔递增排期
      const gap = randInt(cfg.dm_interval_min_sec, cfg.dm_interval_max_sec);
      let when = new Date(cursor.get(label)!.getTime() + gap * 1000);
      if (!withinActiveWindow(when, cfg.dm_active_start, cfg.dm_active_end)) {
        // 越过时段尾 → 顺延到次日时段起点
        const nextDay = new Date(when);
        nextDay.setDate(nextDay.getDate() + 1);
        when = clampToWindowStart(nextDay, cfg.dm_active_start);
      }
      cursor.set(label, when);

      await pool.query(
        `INSERT INTO zenithjoy.dm_assignments (tenant_id, lead_id, account_label, status, scheduled_for)
         VALUES ($1, $2, $3, 'queued', $4)
         ON CONFLICT (tenant_id, lead_id, account_label) DO NOTHING`,
        [tenantId, lead.id, label, when.toISOString()]
      );
      perDayUsed.set(label, (perDayUsed.get(label) ?? 0) + 1);
      assigned += 1;
      rr = (rr + attempt + 1) % burners.length; // 下一个 lead 从下一号开始
      placed = true;
      break;
    }
    if (!placed) {
      // 所有号都被预算/去重挡住，跳过此 lead
    }
  }

  return { assigned, skipped_dedup: skippedDedup, skipped_budget: skippedBudget, burners };
}

function randInt(lo: number, hi: number): number {
  if (hi <= lo) return lo;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

// ── dispatchDue：执行到期指派（时段闸 + per-hour/per-day 上限闸）────────────
export interface DispatchResult {
  dispatched: number;
  skipped_window: number;
  skipped_limit: number;
}

export async function dispatchDue(
  pool: QueryablePool,
  tenantId: string,
  now: Date = new Date()
): Promise<DispatchResult> {
  const cfg = await getConfig(pool, tenantId);

  // 时段闸：当前不在 dm_active 时段 → 一条都不发
  if (!withinActiveWindow(now, cfg.dm_active_start, cfg.dm_active_end)) {
    return { dispatched: 0, skipped_window: -1, skipped_limit: 0 };
  }

  const dueRes = await pool.query(
    `SELECT id, lead_id, account_label
       FROM zenithjoy.dm_assignments
      WHERE tenant_id = $1 AND status = 'queued' AND scheduled_for <= $2::timestamptz
      ORDER BY scheduled_for ASC`,
    [tenantId, now.toISOString()]
  );

  let dispatched = 0;
  let skippedLimit = 0;
  const skippedWindow = 0;

  // 每号本轮已发计数（叠加历史 + 本轮），避免一轮内冲破上限
  const hourUsed = new Map<string, number>();
  const dayUsed = new Map<string, number>();

  for (const row of dueRes.rows) {
    const label = row.account_label as string;

    if (!hourUsed.has(label)) {
      const cntRes = await pool.query(
        `SELECT
           (SELECT count(*) FROM zenithjoy.dm_outreach_log
              WHERE tenant_id = $1 AND account_label = $2 AND sent_at >= $3::timestamptz - interval '1 hour') AS hour,
           (SELECT count(*) FROM zenithjoy.dm_outreach_log
              WHERE tenant_id = $1 AND account_label = $2
                AND sent_at >= date_trunc('day', $3::timestamptz)
                AND sent_at <  date_trunc('day', $3::timestamptz) + interval '1 day') AS day`,
        [tenantId, label, now.toISOString()]
      );
      hourUsed.set(label, Number(cntRes.rows[0]?.hour ?? 0));
      dayUsed.set(label, Number(cntRes.rows[0]?.day ?? 0));
    }

    // 上限闸：per-hour / per-day
    if ((hourUsed.get(label) ?? 0) >= cfg.dm_per_hour || (dayUsed.get(label) ?? 0) >= cfg.dm_per_day) {
      skippedLimit += 1;
      await pool.query(
        `UPDATE zenithjoy.dm_assignments SET status = 'limited', updated_at = now() WHERE id = $1`,
        [row.id]
      );
      continue;
    }

    // 取 lead profile_url 和 agent_id（burner session 为本号绑定的 agent）
    const leadRes = await pool.query(
      `SELECT l.profile_url, s.agent_id
         FROM zenithjoy.acquisition_leads l
         LEFT JOIN zenithjoy.agent_platform_sessions s
           ON s.account_label = $2 AND s.platform = 'douyin' AND s.role = 'burner' AND s.status = 'active'
         WHERE l.id = $1
         LIMIT 1`,
      [row.lead_id, label]
    );
    const profileUrl = leadRes.rows[0]?.profile_url ?? null;
    const agentId = leadRes.rows[0]?.agent_id ?? null;

    if (!profileUrl || !agentId) {
      // profile_url 缺失（lead 无主页）或该号无 active agent → 跳过，标 limited
      await pool.query(
        `UPDATE zenithjoy.dm_assignments SET status = 'limited', updated_at = now() WHERE id = $1`,
        [row.id]
      );
      skippedLimit += 1;
      continue;
    }

    // 真派单：写 publish_tasks → agent 收到后执行 douyin-dm-outreach.cjs
    await pool.query(
      `INSERT INTO zenithjoy.publish_tasks
         (agent_id, platform, status, task_type, payload, tenant_id, created_at, updated_at)
       VALUES ($1, 'douyin', 'queued', 'dm_outreach', $2, $3, NOW(), NOW())`,
      [
        agentId,
        JSON.stringify({
          agent_id: agentId,
          account_label: label,
          profile_url: profileUrl,
          message: cfg.dm_message,
          tenant_id: tenantId,
          task_type: 'dm_outreach',
          dm_assignment_id: row.id,
        }),
        tenantId,
      ]
    );
    // 记录日志（status=dispatched，等 agent 回报后再改 sent/failed）
    await pool.query(
      `INSERT INTO zenithjoy.dm_outreach_log (tenant_id, account_label, lead_id, profile_url, status)
       VALUES ($1, $2, $3, $4, 'dispatched')`,
      [tenantId, label, row.lead_id, profileUrl]
    );
    await pool.query(
      `UPDATE zenithjoy.dm_assignments SET status = 'dispatched', agent_id = $2, updated_at = now() WHERE id = $1`,
      [row.id, agentId]
    );
    hourUsed.set(label, (hourUsed.get(label) ?? 0) + 1);
    dayUsed.set(label, (dayUsed.get(label) ?? 0) + 1);
    dispatched += 1;
  }

  return { dispatched, skipped_window: skippedWindow, skipped_limit: skippedLimit };
}

// ── cookieHealth：按 status + 陈旧度分类 ─────────────────────────────────────
export type CookieStatus = 'healthy' | 'stale' | 'expired';
export interface CookieHealthItem {
  account_label: string;
  role: string;
  platform: string;
  status: CookieStatus;
  bound_at: string | null;
  needs_rescan: boolean;
}

export function classifyCookie(
  row: { status?: string | null; bound_at?: string | Date | null },
  staleHours: number,
  now: Date
): CookieStatus {
  if (row.status === 'expired') return 'expired';
  if (!row.bound_at) return 'stale';
  const boundMs = new Date(row.bound_at).getTime();
  if (Number.isNaN(boundMs)) return 'stale';
  const ageHours = (now.getTime() - boundMs) / 3_600_000;
  if (ageHours > staleHours) return 'stale';
  return 'healthy';
}

export async function cookieHealth(
  pool: QueryablePool,
  tenantId: string,
  now: Date = new Date()
): Promise<{ items: CookieHealthItem[]; alerts: CookieHealthItem[] }> {
  const cfg = await getConfig(pool, tenantId);
  const r = await pool.query(
    `SELECT s.account_label, s.role, s.platform, s.status, s.bound_at
       FROM zenithjoy.agent_platform_sessions s
       JOIN zenithjoy.agents a ON a.id = s.agent_id
      WHERE a.tenant_id = $1 AND s.role IN ('main','burner')
      ORDER BY s.role ASC, s.account_label ASC`,
    [tenantId]
  );
  const items: CookieHealthItem[] = r.rows.map((row) => {
    const status = classifyCookie(row, cfg.cookie_check_interval_hours, now);
    return {
      account_label: row.account_label,
      role: row.role,
      platform: row.platform,
      status,
      bound_at: row.bound_at ? new Date(row.bound_at).toISOString() : null,
      needs_rescan: status === 'expired',
    };
  });
  const alerts = items.filter((i) => i.status !== 'healthy');
  return { items, alerts };
}
