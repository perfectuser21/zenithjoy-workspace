/**
 * content-judgment.ts — 视频内容判决服务（commit-4 Green）
 *
 * 职责：
 *   1. 幂等性检查：同 video_id 已有非 pending 结果 → 直接返回 cache_hit: true
 *   2. INV-6：target_profile_desc 为空 → 跳过 Gemini，直接返回 matched
 *   3. 调 Gemini（via ToAPIs API）判决截图/录音是否匹配目标画像
 *   4. 8s 超时 → 标 pending，不阻塞其他视频
 *   5. force_result / force_timeout：仅非生产环境可用（测试 hook）
 *
 * Gemini 调用：通过 TOAPIS_API_KEY 走 ToAPIs 代理（国内可访问 Gemini API 的中转）
 */

import axios from 'axios';
import type { QueryablePool } from './acquisition-dispatch';

// ── 导出类型定义 ──────────────────────────────────────────────────────────────
export interface JudgeVideoResult {
  judgment_status: 'matched' | 'rejected' | 'pending';
  judgment_reason?: string | null;
  cache_hit?: true;
}

export interface JudgeVideoOptions {
  // 'uncertain'：仅非生产测试钩子——跳过主判、直接真调 commander，供 smoke 在真环境验证
  // commander 模型（默认 gpt-5.4-mini，见 COMMANDER_MODEL）可用、能返回终态（环境接缝守卫，单测 mock 测不到）。
  forceResult?: 'matched' | 'rejected' | 'pending' | 'uncertain';
  forceTimeout?: boolean;
}

// ── 常量 ─────────────────────────────────────────────────────────────────────
const JUDGMENT_TIMEOUT_MS = 20_000;  // 带图/音判定较慢，留余量（服务端即便 agent 8s 超时也要写库）
/**
 * 主判 max_tokens——**这是含 reasoning_tokens 的 completion 总预算，不是"正文上限"**。
 *
 * gemini-2.5-flash-official 是 thinking 模型，TOAPIS 把思考算进 completion_tokens。
 * 真机 0820 实测（decision fa247355）：同一段 19.6s 音频，reasoning 就要 189~736 tokens，
 * 而线上写死的 200 连思考都不够 —— 模型必然停在 finish_reason=length，
 * judgment_raw 落库原文只有 `REJECTED\n`（9 字）。全库 184 条视频只有 11 条有转写（6%）。
 *
 * prompt 一字不改、只把 200 抬到 2000，就从 9 字截断变成完整转写（finish=stop，6.7s）。
 * 2000 = 最大观测 reasoning(736) + 转写正文(~150) 的 2 倍余量。
 *
 * ⚠️ 别学 comment-grading 用 reasoning_effort='none' 关思考 —— 那个参数**只有 deepseek 认**，
 * gemini-2.5 收到后照样思考（实测 reasoning 仍是 189/577/572）。这边只能靠给够预算。
 */
const JUDGMENT_MAX_TOKENS = 2000;

/** judgment_raw 落库上限：够诊断解析格式，又不会把库撑爆。 */
export const JUDGMENT_RAW_MAX_LEN = 4000;
const TOAPIS_BASE = process.env.TOAPIS_BASE_URL || 'https://toapis.com/v1';  // ToAPIs 代理，国内可用（OpenAI 兼容）；api. 子域 2026-07-14 实测全球挂起（gp2 smoke Step8c 真调抓到），默认切主域，可用 TOAPIS_BASE_URL 覆盖
const JUDGMENT_MODEL = 'gemini-2.5-flash-official';
// commander（复核官）：主判判"存疑"(UNCERTAIN)时的第二个 AI，走同一个 ToAPIs 代理（OpenAI 兼容，
// 换 model 字段即可，不新接 key），用不同模型厂商做跨模型交叉验证，只判"准/不准"。
// 原默认 deepseek-v4-flash；2026-08-23 该模型所在 TOAPIS 渠道 #58 上游欠费（402，无备用渠道），
// 临时切 gpt-5.6-terra（用户 0823 现场拍板）——真机受控失败验证时发现该渠道本身不稳定
// （同一 prompt 连续调用 prompt_tokens 从几百跳到 8000+、偶发整段格式错乱/超时，疑似
// 后端多副本缓存串号），改切 gpt-5.4-mini（同日真调对照：8/8 正确、token 数全程稳定）——
// 依然是与主判 Gemini 不同厂商的模型，交叉验证的设计意图不受影响；reasoning_effort:'none'
// 对它同样生效（reasoning_tokens=0）。
const COMMANDER_MODEL = process.env.COMMANDER_MODEL || 'gpt-5.4-mini';

// ── judgeVideo：核心判决函数 ─────────────────────────────────────────────────
/**
 * 判决视频内容是否匹配租户目标画像。
 *
 * @param pool          DB 连接池
 * @param tenantId      租户 ID
 * @param videoId       抖音视频 ID（用于幂等 key）
 * @param captureType   截图类型（screenshot | audio | skipped_capture_failed）
 * @param dataB64       base64 编码的截图或录音数据
 * @param forceResult   仅非生产：强制返回指定结果
 * @param forceTimeout  仅非生产：强制模拟超时
 * @returns JudgeVideoResult
 */
export async function judgeVideo(
  pool: QueryablePool,
  tenantId: string,
  videoId: string,
  captureType: string,
  dataB64: string,
  forceResult?: 'matched' | 'rejected' | 'pending' | 'uncertain',
  forceTimeout?: boolean,
  title?: string,
): Promise<JudgeVideoResult> {
  // § 幂等检查：非 pending 结果已存在 → 直接返回 cache_hit: true
  const existing = await pool.query(
    `SELECT judgment_status, judgment_reason FROM zenithjoy.acquisition_collect_videos WHERE tenant_id = $1 AND video_id = $2 AND judgment_status != 'pending' LIMIT 1`,
    [tenantId, videoId]
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0] as { judgment_status: string; judgment_reason: string | null };
    // 缓存命中也必须写库：writeJudgment/markPending 都按 (tenant_id, video_id) UPDATE，
    // 不分 task_id——同一热门视频被多个采集任务重复抓到时，新任务 Stage1 刚 INSERT 的
    // 那一行 judgment_status 仍是初始值 'pending'，不写这一步就永远没人碰它，卡死 pending
    // （真机复现 2026-07-16：API 明明返回 cache_hit=true/matched，DB 行却永远 pending）。
    // ⚠️ capture_type 传 null（COALESCE 保留原值）：它记的是"**上次判定**用的采集方式"，
    // 不是判定结论的一部分。用本次的值覆盖会把成功那次的记录改写成"采集失败"，
    // DB 于是显示「采集失败却判通过」——2026-08-20 排查时正是被这条带进沟里。
    await writeJudgment(pool, tenantId, videoId, null, row.judgment_status, row.judgment_reason);
    return {
      judgment_status: row.judgment_status as JudgeVideoResult['judgment_status'],
      judgment_reason: row.judgment_reason,
      cache_hit: true,
    };
  }

  // § 客户端采集失败：capture_type=skipped_capture_failed → 标 pending 并记原因，不调 Gemini。
  //   Agent 端 MediaProjection 授权失效（**进程重启即失效，Android 强制设计**）/截图返回 null
  //   时带这个 capture_type 上报，让 judgment_reason 在 DB 里一眼可辨"采集失败"而非空转 pending。
  //
  //   ⚠️ 这段必须排在 INV-6（空画像→matched）**之前**：拿不到任何内容就没资格判"通过"。
  //   顺序反了就是 fail-open——空画像的租户会把采集失败的视频一律放行。
  //   真机 0817-0819：38 个视频里 16 个是这个状态，判定链实际 100% 空转。
  if (captureType === 'skipped_capture_failed') {
    await markPending(pool, tenantId, videoId, captureType, 'skipped_capture_failed');
    return { judgment_status: 'pending', judgment_reason: 'skipped_capture_failed' };
  }

  // § INV-6：target_profile_desc 为空 → 跳过 Gemini，直接返回 matched
  const configRes = await pool.query(
    `SELECT target_profile_desc FROM zenithjoy.acquisition_config WHERE tenant_id = $1 LIMIT 1`,
    [tenantId]
  );
  const targetProfileDesc: string = configRes.rows[0]?.target_profile_desc ?? '';
  if (!targetProfileDesc || targetProfileDesc.trim() === '') {
    // 空画像 → 所有视频默认匹配。必须落库（此前只返回不写库，
    // API 说 matched 但 acquisition_collect_videos.judgment_status 停在旧值/NULL，
    // 下游任何读库判断——派单/看板——永远读不到这次"匹配"）。
    await writeJudgment(pool, tenantId, videoId, captureType, 'matched', 'empty_profile');
    return { judgment_status: 'matched' };
  }

  // § 测试 hook（仅非生产）
  if (process.env.NODE_ENV !== 'production') {
    if (forceTimeout) {
      // 模拟超时：标 pending 后立即返回
      await markPending(pool, tenantId, videoId, captureType, 'force_timeout');
      return { judgment_status: 'pending', judgment_reason: 'force_timeout' };
    }
    if (forceResult === 'uncertain') {
      // 跳过主判、直接真调 commander（真环境验证 commander 模型可用 + 存疑消化成终态）
      return commanderReview(
        pool, tenantId, videoId, captureType, '（force_uncertain 测试转写）',
        targetProfileDesc, 'force_uncertain', title,
      );
    }
    if (forceResult) {
      await writeJudgment(pool, tenantId, videoId, captureType, forceResult, 'force_result');
      return { judgment_status: forceResult, judgment_reason: 'force_result' };
    }
  }

  // § 调 Gemini 判决
  return await callGemini(pool, tenantId, videoId, captureType, dataB64, targetProfileDesc, title);
}

// ── 内部：调 Gemini ──────────────────────────────────────────────────────────
async function callGemini(
  pool: QueryablePool,
  tenantId: string,
  videoId: string,
  captureType: string,
  dataB64: string,
  targetProfileDesc: string,
  title?: string,
): Promise<JudgeVideoResult> {
  const apiKey = process.env.TOAPIS_API_KEY;
  if (!apiKey) {
    console.error('[content-judgment] TOAPIS_API_KEY 未配置，标 pending');
    await markPending(pool, tenantId, videoId, captureType, 'no_api_key');
    return { judgment_status: 'pending', judgment_reason: 'no_api_key' };
  }

  const prompt = buildPrompt(targetProfileDesc, captureType, title);
  const mimeType = captureType === 'audio' ? 'audio/pcm' : 'image/jpeg';
  // TOAPIS 是 OpenAI 兼容代理：多模态必须走 /chat/completions + image_url / input_audio。
  // Gemini 原生 generateContent + inline_data 在 TOAPIS 上会挂起（2026-07-13 真机排查坐实：
  // 文本秒回、Gemini 原生带图请求 >40s 超时；OpenAI 式 chat/completions 带图 4.7s 正常返回）。
  const mediaPart =
    captureType === 'audio'
      ? { type: 'input_audio', input_audio: { data: dataB64, format: 'wav' } }
      : { type: 'image_url', image_url: { url: `data:${mimeType};base64,${dataB64}` } };

  try {
    const resp = await axios.post(
      `${TOAPIS_BASE}/chat/completions`,
      {
        model: JUDGMENT_MODEL,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: prompt }, mediaPart],
          },
        ],
        max_tokens: JUDGMENT_MAX_TOKENS,
        temperature: 0.1,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: JUDGMENT_TIMEOUT_MS,
      }
    );

    const choice = resp.data?.choices?.[0];
    const text: string = choice?.message?.content ?? '';

    // 截断守卫：finish_reason==='length' 说明模型被预算砍断，这段文本是残缺的。
    // 绝不能拿它当正常判定写库——extractVerdict 会从 `MATCHED\n转` 里抓出 MATCHED，
    // 于是一条什么都没判成的调用被记成 matched。真机 72 行 `matched|无原因|无转写`
    // 的假绿就是这么来的。宁可诚实标 pending（raw 照样落库供诊断），不可假装判成了。
    // 字段缺失（老网关不回 finish_reason）时按正常路径走，不误杀。
    if (choice?.finish_reason === 'length') {
      console.error(
        '[content-judgment] 输出被 max_tokens 截断（finish_reason=length）videoId=%s 已判 pending，raw 前 80 字：%s',
        videoId,
        text.slice(0, 80),
      );
      await markPending(pool, tenantId, videoId, captureType, 'truncated_output', text);
      return { judgment_status: 'pending', judgment_reason: 'truncated_output' };
    }

    return parseGeminiResponse(pool, tenantId, videoId, captureType, text, targetProfileDesc, title);
  } catch (err) {
    const isTimeout = axios.isAxiosError(err) && err.code === 'ECONNABORTED';
    const reason = isTimeout ? 'gemini_timeout' : 'gemini_error';
    console.error(`[content-judgment] Gemini ${reason} videoId=${videoId}:`, (err as Error).message);
    await markPending(pool, tenantId, videoId, captureType, reason);
    return { judgment_status: 'pending', judgment_reason: reason };
  }
}

function buildPrompt(targetProfileDesc: string, captureType: string, title?: string): string {
  // 用户2026-07-17拍板（判定点1d078987，decision f3dbc2ce）：video 类型走音频转写判定——
  // 先转写这段音频内容，再结合视频标题和转写文案共同判断，单次多模态调用内完成
  // 转写+判定两步，不新增独立转写API调用（避免过度设计成两阶段架构）。
  // 2026-07-19（decision 4e421ae8）：转写文字现在要求 Gemini 明确输出（不再只在"心里"转写），
  // 落库供 Seg3→Seg4 之间新增的评论意向分档判定使用完整视频文案。
  const mediaInstruction =
    captureType === 'audio'
      ? title
        ? `这是一段视频开头20秒的音频片段，视频标题是《${title}》。请先转写这段音频的内容，再结合标题和转写内容共同判断`
        : `这是一段视频开头20秒的音频片段。请先转写这段音频的内容，再结合转写内容判断`
      : '判断这段屏幕截图中的内容';
  const transcriptInstruction = captureType === 'audio' ? '\n最后一行：转写：<音频转写出的完整文字内容>' : '';
  return `你是一个内容判决助手。根据以下目标客户画像，${mediaInstruction}是否匹配目标客户群体。

目标客户画像：
${targetProfileDesc}

判断规则：
1. 如果视频内容与目标客户画像高度相关（评论区可能有潜在客户），回复：MATCHED
2. 如果视频内容与目标客户画像明显不相关，回复：REJECTED，并简短说明原因（不超过 30 字）
3. 如果边界模糊、信息不足、拿不准是否相关，回复：UNCERTAIN，并简短说明为什么拿不准（不超过 30 字）
   （不要为了保守而硬判 MATCHED——拿不准就如实说 UNCERTAIN，后面有复核官二次判）

请严格按格式回复：
第一行：MATCHED 或 REJECTED 或 UNCERTAIN
如果是 REJECTED 或 UNCERTAIN，第二行：原因：...${transcriptInstruction}`;
}

/**
 * 从主判输出里找判定关键词——**在全文里找，不要求它在第一行**。
 *
 * 病根：prompt 自相矛盾。一边说「请先转写这段音频的内容，再结合标题和转写内容共同判断」，
 * 一边又说「第一行：MATCHED 或 REJECTED 或 UNCERTAIN」。模型照前一条做就把转写放第一行，
 * 而旧解析用的是 `upper.startsWith('MATCHED')` → 必然失败 → parse_fallback →
 * commander「输出无法解析一律保守判 rejected」。
 * 真机 0817-0819：38 个视频里 20 个 rejected 就是这么来的，**不是视频真的不匹配**。
 *
 * 转写行/原因行整行跳过——否则转写正文里出现一个 "REJECTED" 就能翻转判定。
 */
function extractVerdict(text: string): 'MATCHED' | 'REJECTED' | 'UNCERTAIN' | null {
  for (const line of text.trim().split('\n')) {
    const trimmed = line.trim();
    if (/^(转写|原因)\s*[：:]/.test(trimmed)) continue;
    const m = trimmed.toUpperCase().match(/\b(MATCHED|REJECTED|UNCERTAIN)\b/);
    if (m) return m[1] as 'MATCHED' | 'REJECTED' | 'UNCERTAIN';
  }
  return null;
}

function extractTranscript(text: string): string | null {
  const lines = text.trim().split('\n');
  const transcriptLine = lines.find(l => l.includes('转写：') || l.includes('转写:'));
  const extracted = transcriptLine?.replace(/^转写[：:]/, '').trim();
  return extracted || null;
}

function extractReason(text: string): string | null {
  const lines = text.trim().split('\n');
  const reasonLine = lines.find(l => l.includes('原因：') || l.includes('原因:'));
  return reasonLine?.replace(/^原因[：:]/, '').trim() ?? null;
}

function parseGeminiResponse(
  pool: QueryablePool,
  tenantId: string,
  videoId: string,
  captureType: string,
  text: string,
  targetProfileDesc: string,
  title?: string,
): Promise<JudgeVideoResult> {
  const transcript = extractTranscript(text);
  const verdict = extractVerdict(text);
  if (verdict === 'MATCHED') {
    return writeJudgment(pool, tenantId, videoId, captureType, 'matched', null, transcript, text).then(() => ({
      judgment_status: 'matched' as const,
    }));
  }
  if (verdict === 'REJECTED') {
    const reason = extractReason(text);
    return writeJudgment(pool, tenantId, videoId, captureType, 'rejected', reason, transcript, text).then(() => ({
      judgment_status: 'rejected' as const,
      judgment_reason: reason,
    }));
  }
  if (verdict === 'UNCERTAIN') {
    // 存疑 → 交 commander(第二个 AI)拿主判理由二次判，不再"保守 matched"直接放行
    const primaryReason = extractReason(text) ?? 'uncertain';
    return commanderReview(
      pool, tenantId, videoId, captureType, transcript, targetProfileDesc, primaryReason, title, text,
    );
  }
  // 无法解析主判输出 → 当存疑处理，交 commander（不再直接放行）
  return commanderReview(
    pool, tenantId, videoId, captureType, transcript, targetProfileDesc, 'parse_fallback', title, text,
  );
}

// ── commander 复核官：主判"存疑"时的第二个 AI（DeepSeek via ToAPIs）──────────────
// 拿到【前段转写文案 + 标题 + 画像 + 主判为什么拿不准的理由】整体再看，只判"准/不准"：
//   准   → matched（放行去抓评论）
//   不准 → rejected（丢）
// 无 key / 调用失败 / 输出无法解析 → 一律保守判 rejected（存疑绝不放行）。
async function commanderReview(
  pool: QueryablePool,
  tenantId: string,
  videoId: string,
  captureType: string,
  transcript: string | null,
  targetProfileDesc: string,
  primaryReason: string,
  title?: string,
  /** 主判 AI 的原始返回。解析失败(parse_fallback)时**最需要**它——
   *  不留就永远不知道模型到底吐了什么格式，也就永远修不对解析。 */
  primaryRaw?: string | null,
): Promise<JudgeVideoResult> {
  const finalize = async (
    status: 'matched' | 'rejected',
    tag: string,
  ): Promise<JudgeVideoResult> => {
    const reason = `via_commander|primary存疑:${primaryReason}|commander:${tag}`;
    await writeJudgment(pool, tenantId, videoId, captureType, status, reason, transcript, primaryRaw);
    return { judgment_status: status, judgment_reason: reason };
  };

  const apiKey = process.env.TOAPIS_API_KEY;
  if (!apiKey) {
    console.error('[content-judgment] commander: TOAPIS_API_KEY 未配置，存疑保守判 rejected');
    return finalize('rejected', 'no_api_key');
  }

  const prompt = buildCommanderPrompt(targetProfileDesc, transcript, primaryReason, title);
  try {
    const resp = await axios.post(
      `${TOAPIS_BASE}/chat/completions`,
      {
        model: COMMANDER_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 100,
        temperature: 0.1,
        // gpt-5.4-mini 认这个参数（0823 真调 reasoning_tokens=0），关思考让短判决更稳更快；
        // 若换回 deepseek 系列同样适用，只有 gemini 不认（那边只能靠给够 max_tokens）。
        reasoning_effort: 'none',
      },
      {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: JUDGMENT_TIMEOUT_MS,
      }
    );
    const text: string = resp.data?.choices?.[0]?.message?.content ?? '';
    const verdict = parseCommanderVerdict(text);
    return finalize(verdict, verdict === 'matched' ? '准' : '不准');
  } catch (err) {
    const isTimeout = axios.isAxiosError(err) && err.code === 'ECONNABORTED';
    // 静态格式串 + %s 占位（videoId 用户可控，不能拼进格式串——tainted-format-string）
    console.error(
      '[content-judgment] commander %s videoId=%s: %s',
      isTimeout ? 'timeout' : 'error',
      videoId,
      (err as Error).message
    );
    return finalize('rejected', isTimeout ? 'timeout_保守拒' : 'error_保守拒');
  }
}

function buildCommanderPrompt(
  targetProfileDesc: string,
  transcript: string | null,
  primaryReason: string,
  title?: string,
): string {
  return `你是内容判决的复核官（commander）。主判 AI 对下面这条视频拿不准、判为"存疑"，现在交给你终审。
你只需回答：这条视频是否值得去它的评论区找潜在客户——只回"准"（值得，放行）或"不准"（不值得，丢弃）。

目标客户画像：
${targetProfileDesc}

视频标题：${title || '(无)'}
视频前段文案（转写）：${transcript || '(无转写)'}
主判为什么拿不准：${primaryReason}

请整体权衡后，严格只回一个词：准 或 不准`;
}

function parseCommanderVerdict(text: string): 'matched' | 'rejected' {
  const t = text.trim();
  // "不准" 含 "准" 字，必须先判否定
  if (t.includes('不准') || t.includes('不匹配') || t.includes('不相关')) return 'rejected';
  if (t.includes('准') || t.includes('匹配') || t.includes('相关')) return 'matched';
  return 'rejected'; // 无法解析 → 保守拒（存疑不放行）
}

// ── 内部：写库 ──────────────────────────────────────────────────────────────
async function markPending(
  pool: QueryablePool,
  tenantId: string,
  videoId: string,
  captureType: string,
  reason: string,
  /** AI 原始返回。截断/解析异常时**最需要**它——不落库就永远不知道模型到底吐了什么。
   *  传 undefined 时保留库里原值（超时/无 key 等根本没拿到返回的路径）。 */
  raw?: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE zenithjoy.acquisition_collect_videos
        SET judgment_status = 'pending', judgment_reason = $4, capture_type = $3,
            judgment_raw = COALESCE($5, judgment_raw), updated_at = now()
      WHERE tenant_id = $1 AND video_id = $2`,
    [tenantId, videoId, captureType, reason,
     raw ? raw.slice(0, JUDGMENT_RAW_MAX_LEN) : null]
  );
}

async function writeJudgment(
  pool: QueryablePool,
  tenantId: string,
  videoId: string,
  /** null = 保留库里原值（cache 命中路径用），不覆盖"上次采集怎么样"这个事实 */
  captureType: string | null,
  status: string,
  reason: string | null,
  transcript?: string | null,
  /** 判定 AI 的原始返回；不留它就永远修不对解析（judgment_reason 只有碎片） */
  raw?: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE zenithjoy.acquisition_collect_videos
        SET judgment_status = $3, judgment_reason = $4,
            capture_type  = COALESCE($5, capture_type),
            transcript    = COALESCE($6, transcript),
            judgment_raw  = COALESCE($7, judgment_raw),
            updated_at = now()
      WHERE tenant_id = $1 AND video_id = $2`,
    [tenantId, videoId, status, reason, captureType, transcript ?? null,
     raw ? raw.slice(0, JUDGMENT_RAW_MAX_LEN) : null]
  );
}
