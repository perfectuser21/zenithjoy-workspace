/**
 * Path 2 Step4 — 客户智能获客：飞书企业信息文档 + 扩词 + 中台采集闭环
 *
 * 纯逻辑层（无 DB / 无 HTTP），便于单测：
 *   - dedupCommenters       — 按 (sec_uid) 去重 + sec_uid 缺失按 nickname 弱去重，重复仅累加 source_video_ids
 *   - profileUrlForSecUid   — sec_uid → 抖音主页链接；残缺号(null) → null
 *   - EMPTY_DOC_MIN_CHARS   — 企业信息文档「空」判定纯文本字数下限
 *   - resolveTerminalStatus — report 终态回报 → {status, error_code}（区分 failed/partial 原因）
 *   - shouldSweepToTerminal — sweep-timeouts 判定：stale running 转终态，pending(离线 agent) 永不转
 *
 * 端到端行为（建文档 / 扩词 / 派单 / 落库 / 写飞书 / 查状态）由 routes/acquisition.ts 编排，
 * 以 contract-dod.md 的 [BEHAVIOR] manual:bash 为 evaluator oracle。
 */

/** 企业信息文档「空」判定：纯文本字数 < 该下限 → EMPTY_DOC（全图片/表格也命中）。 */
export const EMPTY_DOC_MIN_CHARS = 20;

/** 整体采集超时：started 早于 NOW-10min 仍 running → sweep 转终态（PRD「不假死在 running」）。 */
export const SWEEP_TIMEOUT_MS = 10 * 60 * 1000;

/** 8 态状态机枚举（与 migration CHECK 约束一致）。 */
export const COLLECT_STATUSES = [
  'pending',
  'running',
  'cancelling',
  'cancelled',
  'done',
  'stage_1_done',
  'partial',
  'failed',
] as const;
export type CollectStatus = (typeof COLLECT_STATUSES)[number];

/** sec_uid → 抖音主页链接；残缺号（sec_uid 缺失）→ null。 */
export function profileUrlForSecUid(secUid: string | null | undefined): string | null {
  if (!secUid) return null;
  return `https://www.douyin.com/user/${secUid}`;
}

export interface CommenterInput {
  sec_uid?: string | null;
  nickname: string;
}

export interface LeadRow {
  sec_uid: string | null;
  nickname: string;
  profile_url: string | null;
  partial: boolean;
  source_video_ids: string[];
}

export interface DedupResult {
  inserted: number;
  deduped: number;
  rows: LeadRow[];
}

/**
 * 去重落库逻辑（纯函数）：
 *  - 有 sec_uid → 按 (sec_uid) 去重；命中既有行仅把 videoId 累加进 source_video_ids
 *  - 无 sec_uid → 昵称兜底入库，partial=true / profile_url=null，按 (nickname) 弱去重
 *  - 同一批内的重复也算 deduped（不重复落库）
 *
 * @param existing 该租户已落库的 leads（同状态字段）
 * @param batch    本批回报的评论者
 * @param videoId  本批来源视频 id（累加进 source_video_ids）
 */
export function dedupCommenters(
  existing: LeadRow[],
  batch: CommenterInput[],
  videoId: string
): DedupResult {
  // 拷贝既有行（不可变输入），后续累加 video_id 在副本上做
  const rows: LeadRow[] = existing.map((r) => ({
    ...r,
    source_video_ids: [...(r.source_video_ids ?? [])],
  }));

  const findMatch = (c: CommenterInput): LeadRow | undefined => {
    const secUid = c.sec_uid ?? null;
    if (secUid) {
      return rows.find((r) => r.sec_uid === secUid);
    }
    // 弱去重：仅在「无 sec_uid」的残缺行里按昵称匹配
    return rows.find((r) => !r.sec_uid && r.nickname === c.nickname);
  };

  let inserted = 0;
  let deduped = 0;

  for (const c of batch) {
    const match = findMatch(c);
    if (match) {
      deduped += 1;
      if (videoId && !match.source_video_ids.includes(videoId)) {
        match.source_video_ids.push(videoId);
      }
      continue;
    }
    const secUid = c.sec_uid ?? null;
    rows.push({
      sec_uid: secUid,
      nickname: c.nickname,
      profile_url: profileUrlForSecUid(secUid),
      partial: !secUid,
      source_video_ids: videoId ? [videoId] : [],
    });
    inserted += 1;
  }

  return { inserted, deduped, rows };
}

export interface TerminalReport {
  terminal?: 'done' | 'partial' | 'failed' | string;
  error_code?: string | null;
  partial_reason?: string | null;
}

export interface TerminalResolution {
  status: CollectStatus;
  error_code: string | null;
}

/**
 * 终态回报 → {status, error_code}：
 *  - failed  → status=failed，error_code=入参 error_code（DOUYIN_RISK/DOUYIN_CAPTCHA/... 字面落库区分原因）
 *  - partial → status=partial，error_code=partial_reason（video_insufficient/comments_closed/zero_comment）
 *  - done    → status=done，error_code=null
 */
export function resolveTerminalStatus(report: TerminalReport): TerminalResolution {
  if (report.terminal === 'failed') {
    return { status: 'failed', error_code: report.error_code ?? null };
  }
  if (report.terminal === 'partial') {
    return { status: 'partial', error_code: report.partial_reason ?? report.error_code ?? null };
  }
  return { status: 'stage_1_done', error_code: null };
}

export interface SweepCandidate {
  status: string;
  /** 任务「年龄」毫秒（NOW - started_at|created_at）。 */
  ageMs: number;
}

/**
 * sweep-timeouts 判定（纯函数）：
 *  - running 且 ageMs > 10min → true（stale running 转终态，修「假死在 running」）
 *  - pending → 永远 false（离线 agent 未领取，保留不丢，等上线续抓）
 *  - 其它态（已终态 / cancelling）→ false
 */
export function shouldSweepToTerminal(c: SweepCandidate): boolean {
  if (c.status !== 'running') return false;
  return c.ageMs > SWEEP_TIMEOUT_MS;
}

/**
 * 从企业信息文档纯文本兜底抽 3 个关键词（DeepSeek 降级时用）。
 * 取中文/英数词片段，去重，不足 3 个用文档整体兜底，保证恰好 3 个。
 */
export function seedKeywordsFromDoc(text: string): string[] {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  const tokens = cleaned
    .split(/[\s,，。、:：;；/|]+/)
    .map((t) => t.replace(/^[行业受众卖点钩子关键词]+[:：]?/, '').trim())
    .filter((t) => t.length >= 2);
  const uniq: string[] = [];
  for (const t of tokens) {
    if (!uniq.includes(t)) uniq.push(t);
    if (uniq.length >= 3) break;
  }
  while (uniq.length < 3) {
    uniq.push(cleaned.slice(0, 6) || `获客${uniq.length + 1}`);
  }
  return uniq.slice(0, 3);
}
