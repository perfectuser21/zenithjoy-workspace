/**
 * AI on-call 横切件 · 刀2a：定位求助（树→候选 node）。
 *
 * 干什么：安卓 RPA 某一步找不到元素时，把失败那一刻的无障碍树快照（刀1 的病历格式）
 * 发上来问"应该是哪个"，AI 指认树行号 → 组装成结构化候选返回。安卓端拿候选去点、
 * 过验证闸（刀2b），机型×安卓版本×抖音版本的 UI 漂移由此自愈——每个碎片化格子的
 * AI 成本只花一次（中台缓存 + 刀3 周报固化进定位器）。
 *
 * 双后端插座（0822 主理人拍板）：
 *   tree-llm（主力）：树→LLM via TOAPIS。纯文本任务，树比截图省一个数量级 token；
 *     `reasoning_effort:'none'` 关思考。原默认 deepseek-v4-flash；2026-08-23 该模型
 *     所在 TOAPIS 渠道 #58 上游欠费（402，无备用渠道），临时切 gpt-5.6-terra（用户
 *     0823 现场拍板）——真机受控失败验证时发现该渠道本身不稳定（同一 prompt 连续调用
 *     prompt_tokens 从几百跳到 8000+、偶发整段格式错乱/超时，疑似后端多副本缓存串号，
 *     真机上实测出现过 AI 已正确指认目标却因为这类抖动被判定不可用的情况），改切
 *     gpt-5.4-mini（同日真调对照：8/8 正确、token 数全程稳定，也认 reasoning_effort:'none'）。
 *   vision（兜底插座）：截图→UI-TARS（树失明页面/二裁/未来 RPA 量产冷启动）。
 *     视觉后端走 TOAPIS 通用视觉模型（4o/Gemini），同判定链已踩通的 image_url 调法，
 *     不自托管 UI-TARS、不用火山 endpoint（0823 主理人纠正：任何视觉模型都行，TOAPIS 现成最省）。
 *
 * 铁律：
 *   - fail-open：求助通道自身故障（超时/解析失败/行号越界/未配置）一律返回
 *     unavailable，安卓端走原失败路径。保底通道绝不能反过来变成新的阻塞点。
 *   - 截断守卫：finish_reason==='length' 的输出是残缺的，绝不当答案。
 *   - 出诊必留病历（rpa_locator_assist）：这是刀3 周报聚类与固化发版的原材料，
 *     缓存命中也要留（要统计命中率）。
 */
import axios from 'axios';
import pool from '../db/connection';

const TOAPIS_BASE = process.env.TOAPIS_BASE_URL || 'https://toapis.com/v1';
const ASSIST_MODEL = process.env.LOCATOR_ASSIST_MODEL || 'gpt-5.4-mini';
/** 视觉后端模型：治 Lynx 失明页（树是空的）——看截图选结果序号。通用视觉模型即可
 *  （强于数数读字），走 TOAPIS 同判定链已踩通的 image_url 调法，不自托管不用火山。
 *  默认用判定链同款 gemini-2.5-flash-official（0823 真调实测：该渠道只开了 -official 后缀
 *  的模型，gpt-4o/裸 gemini 名报 model_not_found；真截图选目标 index 一次答对）。 */
const VISION_MODEL = process.env.LOCATOR_VISION_MODEL || 'gemini-2.5-flash-official';
const ASSIST_TIMEOUT_MS = 20_000;
/** 行号 JSON 一句话就够；预算含 reasoning_tokens（TOAPIS 口径），gpt-5.4-mini 已关思考。 */
const ASSIST_MAX_TOKENS = 300;
/** 视觉后端预算：gemini-2.5-*-official 是 thinking 模型，TOAPIS 把思考算进 completion_tokens
 *  且关不掉（reasoning_effort:'none' 只 deepseek 认）——预算给不够会被截断（PR#1684 教训）。
 *  0823 真调实测 2000 够（含思考 ~500-600 + JSON）。 */
const VISION_MAX_TOKENS = 2000;
export const TREE_MAX_CHARS = 65536;

export interface LocatorAssistRequest {
  tenantId: string;
  step: string;
  targetDesc: string;
  uiTree: string;
  deviceModel?: string;
  osVersion?: string;
  douyinVersion?: string;
  appVersion?: string;
  errorCode?: string;
  backend?: 'tree-llm' | 'vision';
  /** locate（找元素点它）/ extract（抽单个文本值）/ extract_list（抽一整份列表，如账号
   *  昵称列表——单值协议表达不了"读出全部匹配项"）/ vision_select（截图选结果序号，治 Lynx 失明页）。 */
  mode?: 'locate' | 'extract' | 'extract_list' | 'vision_select';
  /** vision_select：屏幕截图 base64（jpeg）。树失明页专用。 */
  screenshotB64?: string;
  /** vision_select：屏幕上候选结果个数（让模型只在 0..N-1 里选）。 */
  visionCandidateCount?: number;
}

export interface LocatorCandidate {
  line: number;
  view_id: string | null;
  text: string | null;
  content_desc: string | null;
  bounds: string | null;
}

export interface LocatorAssistResult {
  status: 'ok' | 'unavailable';
  reason?: string;
  cacheHit?: boolean;
  backend?: string;
  candidates?: LocatorCandidate[];
  /** 本次出诊病历 id——安卓端验证闸回执（/verify）靠它定位行。 */
  assistId?: string;
  /** extract 模式抽取到的文本值（如抖音号）。 */
  extractedValue?: string;
  /** extract_list 模式抽取到的列表（如账号昵称列表）；空数组是合法答案（确认没有），
   *  跟 status='unavailable'（AI 读不出来）语义不同。 */
  extractedValues?: string[];
  /** vision_select：匹配的结果序号（0-based）；-1 = AI 诚实说没匹配。 */
  matchIndex?: number;
}

/**
 * 按 step 记录的 UI 识别经验——真机踩过的坑，喂给 AI 当参考知识，让它越用越准
 * 而不是每次从零猜。
 *
 * 颗粒度是"capability 的具体一步"（如 scan_me_tab），不是整个 value stream：
 * 这是"先走通 Path、记下每一步该认什么，再转成代码"这条既有开发方法论的延伸——
 * 经验按 step 归档，只在验证过的那个 step 生效，不污染其它 step 的 prompt；写新
 * capability 时可以照抄相似 step 已经踩过的经验（人工判断复用，不是自动共享）。
 * 固化的不是写死的答案（UI 改版就失效），是一条选择依据（UI 改版后依然有参考价值）。
 *
 * 新增：往对应 step 的数组末尾加一行，不要改写/删除已有条目（除非确认已过期）。
 */
export const STEP_KNOWLEDGE: Record<string, string[]> = {
  scan_me_tab: [
    '底部导航栏（首页/朋友/消息/我等 tab）经常共用同一个 view_id（模板复用），仅凭 id 无法区分——必须结合 content_desc（如"我，按钮"这类带明确后缀的完整描述）精确匹配整段文字，不要因为看到 id 相同或位置相近就选错行（真机 0823 撞过：错选成"消息"tab 旁边的未读数字徽标，其 desc 是"-"、text 是"4"，跟目标描述完全对不上却被选中）。',
    '正确目标的 content_desc 必须以"，按钮"结尾（这是"我"tab 真实的完整描述），树里其它主题上看似相关、但 content_desc 不是这个格式的文本节点都不是目标——真机 0824 撞过两次：选中过信息流里的推荐语文案"推荐抖音精选内容"/"共141人推荐"（desc 是"-"，纯展示文案不可点），也选中过评论区按钮"评论736，按钮"（desc 确实以"，按钮"结尾，但内容对不上"我"）。判断标准是 content_desc 完整匹配"我，按钮"这段文字，不是"看起来像按钮"或"内容沾边"就采信；同时正确目标的 bounds 应落在屏幕最下方（y 坐标接近树里最大高度），信息流内容区的节点通常不会到这么靠下。',
  ],
};

function renderStepKnowledge(step: string): string[] {
  const notes = STEP_KNOWLEDGE[step];
  if (!notes || notes.length === 0) return [];
  return [
    `这一步（${step}）已知的真机识别经验（供参考，不要机械套用，树里没有类似情况就忽略）:`,
    ...notes.map((n) => `- ${n}`),
    ``,
  ];
}

/** prompt：目标 + 步骤上下文 + 整棵树（行号从 0 起可直接引用），只许回一行 JSON。 */
export function buildLocatorPrompt(req: LocatorAssistRequest): string {
  return [
    `你是安卓 UI 自动化的定位专家。下面是无障碍树快照，每行一个节点，行号从 0 开始。`,
    `当前步骤: ${req.step}（错误码: ${req.errorCode || '-'}）`,
    `要找的目标: ${req.targetDesc}`,
    ...renderStepKnowledge(req.step),
    `请指出最匹配目标的那一行。只回一行 JSON，格式 {"line": 行号}，不要任何其他文字。`,
    `如果树里确实没有匹配的节点，回 {"line": -1}。`,
    ``,
    req.uiTree,
  ].join('\n');
}

/** vision_select prompt：看搜索结果截图，选出抖音号完全匹配的那一个结果的序号。
 *  只让模型做它擅长的"数数+读字"，坐标落点交设备端行距逻辑（通用模型不擅长像素定位）。 */
export function buildVisionSelectPrompt(req: LocatorAssistRequest): string {
  const n = req.visionCandidateCount ?? 0;
  return [
    `这是抖音搜索结果页的截图，从上到下依次排列着${n > 0 ? ` ${n} 个` : '若干个'}用户结果（序号从 0 开始，最上面的是 0）。`,
    `我要找的目标: ${req.targetDesc}`,
    `请判断：哪一个结果是我要找的目标（抖音号要完全一致，不是昵称相似）？`,
    `只回一行 JSON，格式 {"match_index": 序号}，序号从 0 开始。`,
    `如果截图里没有任何一个结果的抖音号与目标完全一致，回 {"match_index": -1}——绝不要勉强选一个。`,
  ].join('\n');
}

/** 抠 match_index（含 -1）；非 JSON → null。 */
export function parseVisionSelectAnswer(raw: string): number | null {
  const m = raw.match(/\{[^{}]*"match_index"\s*:\s*(-?\d+)[^{}]*\}/);
  if (!m) return null;
  const idx = parseInt(m[1], 10);
  return Number.isInteger(idx) ? idx : null;
}

/** 从模型输出抠行号；越界/负数/非 JSON → null（绝不拿坏答案当答案）。 */
export function parseLineAnswer(raw: string, treeLines: number): number | null {
  const m = raw.match(/\{[^{}]*"line"\s*:\s*(-?\d+)[^{}]*\}/);
  if (!m) return null;
  const line = parseInt(m[1], 10);
  if (!Number.isInteger(line) || line < 0 || line >= treeLines) return null;
  return line;
}

/** extract prompt：从树里抽取目标文本值（如抖音号），只回 JSON {"extracted": "值"}。 */
export function buildExtractPrompt(req: LocatorAssistRequest): string {
  return [
    `你是安卓 UI 信息抽取专家。下面是无障碍树快照，每行一个节点。`,
    `当前步骤: ${req.step}（错误码: ${req.errorCode || '-'}）`,
    `要抽取的信息: ${req.targetDesc}`,
    ...renderStepKnowledge(req.step),
    `请从树里找出这个信息的值。只回一行 JSON，格式 {"extracted": "值"}，不要任何其他文字。`,
    `如果树里确实没有这个信息，回 {"extracted": null}。`,
    ``,
    req.uiTree,
  ].join('\n');
}

/** 从 extract 输出抠 extracted 值；null/非 JSON → null。 */
export function parseExtractAnswer(raw: string): string | null {
  const m = raw.match(/\{[^{}]*"extracted"\s*:\s*(null|"([^"]*)")[^{}]*\}/);
  if (!m) return null;
  if (m[1] === 'null') return null;
  const v = (m[2] ?? '').trim();
  return v.length > 0 ? v : null;
}

/** extract_list prompt：从树里抽取目标的全部匹配值（如全部账号昵称），
 *  只回 JSON {"values": ["值1", "值2", ...]}——跟 extract 的区别是这里要的是一整份列表。 */
export function buildExtractListPrompt(req: LocatorAssistRequest): string {
  return [
    `你是安卓 UI 信息抽取专家。下面是无障碍树快照，每行一个节点。`,
    `当前步骤: ${req.step}（错误码: ${req.errorCode || '-'}）`,
    `要抽取的信息: ${req.targetDesc}——把树里所有匹配的值都列出来，不是只列一个。`,
    ...renderStepKnowledge(req.step),
    `请返回一行 JSON，格式 {"values": ["值1", "值2", ...]}，不要任何其他文字。`,
    `如果树里一个匹配的值都没有，回 {"values": []}——这是合法答案，不要瞎编凑数。`,
    ``,
    req.uiTree,
  ].join('\n');
}

/** 从 extract_list 输出抠 values 数组；非 JSON/无法解析 → null。空数组 [] 是合法答案，
 *  跟 null（AI 读不出来）必须区分开——调用方靠这个区分"确认没有"和"问不出来"。 */
export function parseExtractListAnswer(raw: string): string[] | null {
  const m = raw.match(/"values"\s*:\s*(\[[^\]]*\])/);
  if (!m) return null;
  try {
    const arr = JSON.parse(m[1]);
    if (!Array.isArray(arr)) return null;
    return arr
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  } catch {
    return null;
  }
}

/** 从树第 N 行提取结构化候选（刀1 UiTreeSnapshot 的行格式）。 */
export function selectorFromTreeLine(tree: string, line: number): LocatorCandidate | null {
  const rows = tree.split('\n');
  const row = rows[line];
  if (!row) return null;
  const pick = (re: RegExp): string | null => {
    const m = row.match(re);
    const v = m?.[1];
    return v && v !== '-' ? v : null;
  };
  return {
    line,
    view_id: pick(/ id=(\S+)/),
    text: pick(/ text="([^"]*)"/),
    content_desc: pick(/ desc="([^"]*)"/),
    bounds: pick(/ bounds=(\S+)/),
  };
}

/** 缓存键：步骤×目标×机型×系统版本×抖音版本 —— 正是碎片化矩阵的格子坐标。 */
async function lookupCache(req: LocatorAssistRequest): Promise<LocatorCandidate | null> {
  const r = await pool.query(
    `SELECT answer_line, answer_selector FROM zenithjoy.rpa_locator_assist
      WHERE step=$1 AND target_desc=$2
        AND COALESCE(device_model,'')=COALESCE($3,'')
        AND COALESCE(os_version,'')=COALESCE($4,'')
        AND COALESCE(douyin_version,'')=COALESCE($5,'')
        AND cache_hit=false AND answer_selector IS NOT NULL AND verified IS NOT FALSE
      ORDER BY created_at DESC LIMIT 1`,
    [req.step, req.targetDesc, req.deviceModel ?? null, req.osVersion ?? null, req.douyinVersion ?? null],
  );
  const row = r.rows[0];
  if (!row?.answer_selector) return null;
  return row.answer_selector as LocatorCandidate;
}

async function recordVisit(
  req: LocatorAssistRequest,
  opts: { backend: string; model: string | null; answerLine: number | null; selector: LocatorCandidate | null; cacheHit: boolean; mode?: string },
): Promise<string | null> {
  try {
    const r = await pool.query(
      `INSERT INTO zenithjoy.rpa_locator_assist
         (tenant_id, step, target_desc, device_model, os_version, douyin_version, app_version,
          error_code, ui_tree_snapshot, backend, model, answer_line, answer_selector, cache_hit, mode)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [
        req.tenantId, req.step, req.targetDesc,
        req.deviceModel ?? null, req.osVersion ?? null, req.douyinVersion ?? null, req.appVersion ?? null,
        req.errorCode ?? null,
        // 缓存命中不重复存树（同键首问已存过；重列 30 天保留期与刀1 同策略另行清扫）
        opts.cacheHit ? null : req.uiTree.slice(0, TREE_MAX_CHARS),
        opts.backend, opts.model, opts.answerLine,
        opts.selector ? JSON.stringify(opts.selector) : null,
        opts.cacheHit,
        opts.mode ?? 'locate',
      ],
    );
    return r.rows[0]?.id ?? null;
  } catch (e) {
    // 病历写失败只记日志——不许因为记账问题挡住答案返回（fail-open 同一原则）
    console.error('[locator-assist] 病历落库失败: %s', (e as Error).message);
    return null;
  }
}


async function askTreeLlm(req: LocatorAssistRequest): Promise<{ line: number | null; model: string; failReason?: string }> {
  const apiKey = process.env.TOAPIS_API_KEY;
  if (!apiKey) return { line: null, model: ASSIST_MODEL, failReason: 'no_api_key' };
  try {
    const resp = await axios.post(
      `${TOAPIS_BASE}/chat/completions`,
      {
        model: ASSIST_MODEL,
        messages: [{ role: 'user', content: buildLocatorPrompt(req) }],
        max_tokens: ASSIST_MAX_TOKENS,
        temperature: 0,
        // deepseek/gpt-5.4-mini 都认这个参数；thinking 模型（如 gemini）不认，
        // 会把含 reasoning 的总预算吃光（PR#1684）
        reasoning_effort: 'none',
      },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: ASSIST_TIMEOUT_MS },
    );
    const choice = resp.data?.choices?.[0];
    if (choice?.finish_reason === 'length') {
      return { line: null, model: ASSIST_MODEL, failReason: 'truncated_output' };
    }
    const text: string = choice?.message?.content ?? '';
    const line = parseLineAnswer(text, req.uiTree.split('\n').length);
    return { line, model: ASSIST_MODEL, failReason: line === null ? 'unparseable_answer' : undefined };
  } catch (err) {
    const isTimeout = axios.isAxiosError(err) && (err as { code?: string }).code === 'ECONNABORTED';
    return { line: null, model: ASSIST_MODEL, failReason: isTimeout ? 'llm_timeout' : 'llm_error' };
  }
}

async function askExtract(req: LocatorAssistRequest): Promise<{ value: string | null; model: string; failReason?: string }> {
  const apiKey = process.env.TOAPIS_API_KEY;
  if (!apiKey) return { value: null, model: ASSIST_MODEL, failReason: 'no_api_key' };
  try {
    const resp = await axios.post(
      `${TOAPIS_BASE}/chat/completions`,
      {
        model: ASSIST_MODEL,
        messages: [{ role: 'user', content: buildExtractPrompt(req) }],
        max_tokens: ASSIST_MAX_TOKENS,
        temperature: 0,
        reasoning_effort: 'none',
      },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: ASSIST_TIMEOUT_MS },
    );
    const choice = resp.data?.choices?.[0];
    if (choice?.finish_reason === 'length') return { value: null, model: ASSIST_MODEL, failReason: 'truncated_output' };
    const value = parseExtractAnswer(choice?.message?.content ?? '');
    return { value, model: ASSIST_MODEL, failReason: value === null ? 'unparseable_answer' : undefined };
  } catch (err) {
    const isTimeout = axios.isAxiosError(err) && (err as { code?: string }).code === 'ECONNABORTED';
    return { value: null, model: ASSIST_MODEL, failReason: isTimeout ? 'llm_timeout' : 'llm_error' };
  }
}

async function askExtractList(req: LocatorAssistRequest): Promise<{ values: string[] | null; model: string; failReason?: string }> {
  const apiKey = process.env.TOAPIS_API_KEY;
  if (!apiKey) return { values: null, model: ASSIST_MODEL, failReason: 'no_api_key' };
  try {
    const resp = await axios.post(
      `${TOAPIS_BASE}/chat/completions`,
      {
        model: ASSIST_MODEL,
        messages: [{ role: 'user', content: buildExtractListPrompt(req) }],
        max_tokens: ASSIST_MAX_TOKENS,
        temperature: 0,
        reasoning_effort: 'none',
      },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: ASSIST_TIMEOUT_MS },
    );
    const choice = resp.data?.choices?.[0];
    if (choice?.finish_reason === 'length') return { values: null, model: ASSIST_MODEL, failReason: 'truncated_output' };
    const values = parseExtractListAnswer(choice?.message?.content ?? '');
    return { values, model: ASSIST_MODEL, failReason: values === null ? 'unparseable_answer' : undefined };
  } catch (err) {
    const isTimeout = axios.isAxiosError(err) && (err as { code?: string }).code === 'ECONNABORTED';
    return { values: null, model: ASSIST_MODEL, failReason: isTimeout ? 'llm_timeout' : 'llm_error' };
  }
}

/** vision_select：截图→通用视觉模型（TOAPIS，同判定链 image_url 调法），选结果序号。 */
async function askVisionSelect(req: LocatorAssistRequest): Promise<{ matchIndex: number | null; model: string; failReason?: string }> {
  const apiKey = process.env.TOAPIS_API_KEY;
  if (!apiKey) return { matchIndex: null, model: VISION_MODEL, failReason: 'no_api_key' };
  try {
    const resp = await axios.post(
      `${TOAPIS_BASE}/chat/completions`,
      {
        model: VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: buildVisionSelectPrompt(req) },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${req.screenshotB64}` } },
            ],
          },
        ],
        max_tokens: VISION_MAX_TOKENS,
        temperature: 0,
      },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: ASSIST_TIMEOUT_MS },
    );
    const choice = resp.data?.choices?.[0];
    if (choice?.finish_reason === 'length') return { matchIndex: null, model: VISION_MODEL, failReason: 'truncated_output' };
    const idx = parseVisionSelectAnswer(choice?.message?.content ?? '');
    return { matchIndex: idx, model: VISION_MODEL, failReason: idx === null ? 'unparseable_answer' : undefined };
  } catch (err) {
    const isTimeout = axios.isAxiosError(err) && (err as { code?: string }).code === 'ECONNABORTED';
    return { matchIndex: null, model: VISION_MODEL, failReason: isTimeout ? 'llm_timeout' : 'llm_error' };
  }
}

export async function requestLocatorAssist(req: LocatorAssistRequest): Promise<LocatorAssistResult> {
  // vision_select 模式（视觉后端，治 Lynx 失明页 NO_MATCH）：截图→通用视觉模型选序号。
  // 树在这类页面是空的，只能靠看图。不查缓存（每次结果页内容不同）。
  if (req.mode === 'vision_select') {
    if (!req.screenshotB64) return { status: 'unavailable', reason: 'no_screenshot' };
    const vs = await askVisionSelect(req);
    // 病历：answer_selector 存 {matchIndex}，答不出/-1 都留档供刀3 周报
    const selector = vs.matchIndex !== null
      ? ({ line: vs.matchIndex, view_id: null, text: null, content_desc: `match_index=${vs.matchIndex}`, bounds: null } as LocatorCandidate)
      : null;
    const aid = await recordVisit(
      { ...req, uiTree: '' },
      { backend: 'vision', model: vs.model, answerLine: vs.matchIndex, selector, cacheHit: false, mode: 'vision_select' },
    );
    if (vs.matchIndex === null) return { status: 'unavailable', reason: vs.failReason ?? 'no_answer' };
    return { status: 'ok', cacheHit: false, backend: 'vision', matchIndex: vs.matchIndex, assistId: aid ?? undefined };
  }

  // extract 模式（读取类保底）：树→AI 抽取文本，不查缓存（读取值每条不同）
  if (req.mode === 'extract') {
    const ex = await askExtract(req);
    const selector = ex.value ? ({ line: -1, view_id: null, text: ex.value, content_desc: null, bounds: null } as LocatorCandidate) : null;
    const aid = await recordVisit(req, { backend: 'tree-llm', model: ex.model, answerLine: null, selector, cacheHit: false, mode: 'extract' });
    if (ex.value === null) return { status: 'unavailable', reason: ex.failReason ?? 'no_value' };
    return { status: 'ok', cacheHit: false, backend: 'tree-llm', extractedValue: ex.value, assistId: aid ?? undefined };
  }

  // extract_list 模式（多值提取保底）：树→AI 抽取一整份列表（如账号昵称列表），不查缓存。
  // ⚠️ values === [] 是合法答案（AI 确认没有匹配项），只有 values === null 才是真失败——
  // 两者判定分开，别把空数组误判成 unavailable（那会掩盖"确认没有账号"这个有意义的结果）。
  if (req.mode === 'extract_list') {
    const exl = await askExtractList(req);
    const selector = exl.values && exl.values.length > 0
      ? ({ line: -1, view_id: null, text: exl.values.join('|'), content_desc: null, bounds: null } as LocatorCandidate)
      : null;
    const aid = await recordVisit(req, { backend: 'tree-llm', model: exl.model, answerLine: null, selector, cacheHit: false, mode: 'extract_list' });
    if (exl.values === null) return { status: 'unavailable', reason: exl.failReason ?? 'no_value' };
    return { status: 'ok', cacheHit: false, backend: 'tree-llm', extractedValues: exl.values, assistId: aid ?? undefined };
  }

  // 1. 缓存（碎片化格子坐标键）
  try {
    const cached = await lookupCache(req);
    if (cached) {
      const aid = await recordVisit(req, { backend: 'cache', model: null, answerLine: cached.line, selector: cached, cacheHit: true });
      return { status: 'ok', cacheHit: true, backend: 'cache', candidates: [cached], assistId: aid ?? undefined };
    }
  } catch (e) {
    console.error('[locator-assist] 缓存查询失败(降级直问模型): %s', (e as Error).message);
  }

  // 2. tree-llm 主力后端
  const ans = await askTreeLlm(req);
  if (ans.line === null) {
    await recordVisit(req, { backend: 'tree-llm', model: ans.model, answerLine: null, selector: null, cacheHit: false });
    return { status: 'unavailable', reason: ans.failReason ?? 'no_answer' };
  }
  const selector = selectorFromTreeLine(req.uiTree, ans.line);
  const aid = await recordVisit(req, { backend: 'tree-llm', model: ans.model, answerLine: ans.line, selector, cacheHit: false });
  if (!selector) return { status: 'unavailable', reason: 'line_extract_failed' };
  return { status: 'ok', cacheHit: false, backend: 'tree-llm', candidates: [selector], assistId: aid ?? undefined };
}

/** 验证闸回执：安卓端用完候选后回填 verified——刀3 周报判"AI 在该格子的答案稳不稳"的依据。 */
export async function markAssistVerified(assistId: string, verified: boolean): Promise<boolean> {
  const r = await pool.query(
    `UPDATE zenithjoy.rpa_locator_assist SET verified=$2 WHERE id=$1`,
    [assistId, verified],
  );
  return (r.rowCount ?? 0) > 0;
}
