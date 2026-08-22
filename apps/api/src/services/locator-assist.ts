/**
 * AI on-call 横切件 · 刀2a：定位求助（树→候选 node）。
 *
 * 干什么：安卓 RPA 某一步找不到元素时，把失败那一刻的无障碍树快照（刀1 的病历格式）
 * 发上来问"应该是哪个"，AI 指认树行号 → 组装成结构化候选返回。安卓端拿候选去点、
 * 过验证闸（刀2b），机型×安卓版本×抖音版本的 UI 漂移由此自愈——每个碎片化格子的
 * AI 成本只花一次（中台缓存 + 刀3 周报固化进定位器）。
 *
 * 双后端插座（0822 主理人拍板）：
 *   tree-llm（主力）：树→deepseek-v4-flash via TOAPIS。纯文本任务，树比截图省一个
 *     数量级 token；`reasoning_effort:'none'` 关思考（只有 deepseek 认——PR#1684 教训）
 *   vision（兜底插座）：截图→UI-TARS（树失明页面/二裁/未来 RPA 量产冷启动）。
 *     本刀只定义插座：UITARS_BASE_URL/UITARS_API_KEY 未配置时显式降级，不假装可用。
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
const ASSIST_MODEL = process.env.LOCATOR_ASSIST_MODEL || 'deepseek-v4-flash';
const ASSIST_TIMEOUT_MS = 20_000;
/** 行号 JSON 一句话就够；预算含 reasoning_tokens（TOAPIS 口径），deepseek 已关思考。 */
const ASSIST_MAX_TOKENS = 300;
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
}

/** prompt：目标 + 步骤上下文 + 整棵树（行号从 0 起可直接引用），只许回一行 JSON。 */
export function buildLocatorPrompt(req: LocatorAssistRequest): string {
  return [
    `你是安卓 UI 自动化的定位专家。下面是无障碍树快照，每行一个节点，行号从 0 开始。`,
    `当前步骤: ${req.step}（错误码: ${req.errorCode || '-'}）`,
    `要找的目标: ${req.targetDesc}`,
    `请指出最匹配目标的那一行。只回一行 JSON，格式 {"line": 行号}，不要任何其他文字。`,
    `如果树里确实没有匹配的节点，回 {"line": -1}。`,
    ``,
    req.uiTree,
  ].join('\n');
}

/** 从模型输出抠行号；越界/负数/非 JSON → null（绝不拿坏答案当答案）。 */
export function parseLineAnswer(raw: string, treeLines: number): number | null {
  const m = raw.match(/\{[^{}]*"line"\s*:\s*(-?\d+)[^{}]*\}/);
  if (!m) return null;
  const line = parseInt(m[1], 10);
  if (!Number.isInteger(line) || line < 0 || line >= treeLines) return null;
  return line;
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
  opts: { backend: string; model: string | null; answerLine: number | null; selector: LocatorCandidate | null; cacheHit: boolean },
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO zenithjoy.rpa_locator_assist
         (tenant_id, step, target_desc, device_model, os_version, douyin_version, app_version,
          error_code, ui_tree_snapshot, backend, model, answer_line, answer_selector, cache_hit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        req.tenantId, req.step, req.targetDesc,
        req.deviceModel ?? null, req.osVersion ?? null, req.douyinVersion ?? null, req.appVersion ?? null,
        req.errorCode ?? null,
        // 缓存命中不重复存树（同键首问已存过；重列 30 天保留期与刀1 同策略另行清扫）
        opts.cacheHit ? null : req.uiTree.slice(0, TREE_MAX_CHARS),
        opts.backend, opts.model, opts.answerLine,
        opts.selector ? JSON.stringify(opts.selector) : null,
        opts.cacheHit,
      ],
    );
  } catch (e) {
    // 病历写失败只记日志——不许因为记账问题挡住答案返回（fail-open 同一原则）
    console.error('[locator-assist] 病历落库失败: %s', (e as Error).message);
  }
}

/** vision 插座：UI-TARS。本刀只定义接缝，未配置 env 时显式降级。 */
function visionConfigured(): boolean {
  return Boolean(process.env.UITARS_BASE_URL && process.env.UITARS_API_KEY);
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
        // 只有 deepseek 认这个参数；thinking 模型会把含 reasoning 的总预算吃光（PR#1684）
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

export async function requestLocatorAssist(req: LocatorAssistRequest): Promise<LocatorAssistResult> {
  // vision 插座：显式降级，绝不假装可用
  if (req.backend === 'vision') {
    if (!visionConfigured()) {
      await recordVisit(req, { backend: 'vision', model: null, answerLine: null, selector: null, cacheHit: false });
      return { status: 'unavailable', reason: 'vision_not_configured' };
    }
    // UI-TARS 通电属后续接线（插座已留：UITARS_BASE_URL/UITARS_API_KEY + 截图输入）
    return { status: 'unavailable', reason: 'vision_not_implemented' };
  }

  // 1. 缓存（碎片化格子坐标键）
  try {
    const cached = await lookupCache(req);
    if (cached) {
      await recordVisit(req, { backend: 'cache', model: null, answerLine: cached.line, selector: cached, cacheHit: true });
      return { status: 'ok', cacheHit: true, backend: 'cache', candidates: [cached] };
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
  await recordVisit(req, { backend: 'tree-llm', model: ans.model, answerLine: ans.line, selector, cacheHit: false });
  if (!selector) return { status: 'unavailable', reason: 'line_extract_failed' };
  return { status: 'ok', cacheHit: false, backend: 'tree-llm', candidates: [selector] };
}
