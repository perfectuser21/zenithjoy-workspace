/**
 * Path 2 Step4 — 客户智能获客：飞书企业信息文档 + 扩词 + 中台采集闭环
 *
 * 纯逻辑层（无 DB / 无 HTTP），便于单测：
 *   - dedupCommenters       — 按 (sec_uid) 去重 + sec_uid 缺失按 nickname 弱去重，重复仅累加 source_video_ids
 *   - profileUrlForSecUid   — sec_uid → 抖音主页链接；残缺号(null) → null
 *   - EMPTY_DOC_MIN_CHARS   — 企业信息文档「空」判定纯文本字数下限
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

/** 终态集合（cancelling 不是终态，是待落章）。 */
export const TERMINAL_COLLECT_STATUSES = ['done', 'partial', 'failed', 'cancelled'] as const;

export interface SettleInput {
  currentStatus: string;
  agentTerminal?: TerminalReport | null;
  videoTotal: number;
  videoDone: number;
  leadCount: number;
}

export interface SettleResult {
  status: CollectStatus;
  error_code: string | null;
  changed: boolean;
}

/**
 * 服务端终态结算（纯函数，report / report-videos / sweep-timeouts 三处共用）：
 *  - 已终态 → changed=false（终态守卫，杜绝二次结算/二次点火）
 *  - cancelling → cancelled（唯一落章路径，修「全 repo 无人写 cancelled」bug）
 *  - agent 报 failed → failed + error_code 字面落库
 *  - agent 报 done：视频全完成 → done；未收全 → 诚实结算 partial(videos_incomplete)
 *  - agent 报 partial → partial（partial_reason 优先）
 *  - 无 terminal：仅当 stage_1_done 且清单全完成才自动 done（running 阶段 total==done 是
 *    逐视频回报的自然态，不能据此结算）
 *  - 其他非标准 terminal（如旧 agent 的 'stage_1'）→ stage_1_done（向后兼容）
 */
export function settleCollectTask(input: SettleInput): SettleResult {
  const cur = input.currentStatus as CollectStatus;
  if ((TERMINAL_COLLECT_STATUSES as readonly string[]).includes(cur)) {
    return { status: cur, error_code: null, changed: false };
  }
  if (cur === 'cancelling') {
    return { status: 'cancelled', error_code: null, changed: true };
  }
  const t = input.agentTerminal;
  const allDone = input.videoTotal > 0 && input.videoDone >= input.videoTotal;
  if (t?.terminal === 'failed') {
    return { status: 'failed', error_code: t.error_code ?? null, changed: true };
  }
  if (t?.terminal === 'done') {
    return allDone
      ? { status: 'done', error_code: null, changed: true }
      : { status: 'partial', error_code: t.partial_reason ?? 'videos_incomplete', changed: true };
  }
  if (t?.terminal === 'partial') {
    return { status: 'partial', error_code: t.partial_reason ?? t.error_code ?? null, changed: true };
  }
  if (t?.terminal) {
    // 非标准值（旧 agent 'stage_1'）→ stage_1_done（向后兼容）
    return { status: 'stage_1_done', error_code: null, changed: cur !== 'stage_1_done' };
  }
  if (cur === 'stage_1_done' && allDone) {
    return { status: 'done', error_code: null, changed: true };
  }
  return { status: cur, error_code: null, changed: false };
}
