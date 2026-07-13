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
  forceResult?: 'matched' | 'rejected' | 'pending';
  forceTimeout?: boolean;
}

// ── 常量 ─────────────────────────────────────────────────────────────────────
const JUDGMENT_TIMEOUT_MS = 20_000;  // 带图/音判定较慢，留余量（服务端即便 agent 8s 超时也要写库）
const TOAPIS_BASE = process.env.TOAPIS_BASE_URL || 'https://toapis.com/v1';  // ToAPIs 代理，国内可用（OpenAI 兼容）；api. 子域 2026-07-14 实测全球挂起（gp2 smoke Step8c 真调抓到），默认切主域，可用 TOAPIS_BASE_URL 覆盖
const JUDGMENT_MODEL = 'gemini-2.5-flash-official';

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
  forceResult?: 'matched' | 'rejected' | 'pending',
  forceTimeout?: boolean,
): Promise<JudgeVideoResult> {
  // § 幂等检查：非 pending 结果已存在 → 直接返回 cache_hit: true
  const existing = await pool.query(
    `SELECT judgment_status, judgment_reason FROM zenithjoy.acquisition_collect_videos WHERE tenant_id = $1 AND video_id = $2 AND judgment_status != 'pending' LIMIT 1`,
    [tenantId, videoId]
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0] as { judgment_status: string; judgment_reason: string | null };
    return {
      judgment_status: row.judgment_status as JudgeVideoResult['judgment_status'],
      judgment_reason: row.judgment_reason,
      cache_hit: true,
    };
  }

  // § INV-6：target_profile_desc 为空 → 跳过 Gemini，直接返回 matched
  const configRes = await pool.query(
    `SELECT target_profile_desc FROM zenithjoy.acquisition_config WHERE tenant_id = $1 LIMIT 1`,
    [tenantId]
  );
  const targetProfileDesc: string = configRes.rows[0]?.target_profile_desc ?? '';
  if (!targetProfileDesc || targetProfileDesc.trim() === '') {
    // 空画像 → 所有视频默认匹配（不写库，下次调用时仍走此逻辑）
    return { judgment_status: 'matched' };
  }

  // § 客户端截图失败：capture_type=skipped_capture_failed → 直接标 pending 并记原因，不调 Gemini。
  //   Agent 端 Android 14 MediaProjection 授权失效/截图返回 null 时会带这个 capture_type 上报，
  //   目的是让 judgment_reason 落到 acquisition_collect_videos —— 环境守卫：DB 里一眼可辨"截图失败"
  //   而非空转 pending（此前 Agent 截图失败时本地短路、从不 POST，judgment_reason 永远为空）。
  if (captureType === 'skipped_capture_failed') {
    await markPending(pool, tenantId, videoId, captureType, 'skipped_capture_failed');
    return { judgment_status: 'pending', judgment_reason: 'skipped_capture_failed' };
  }

  // § 测试 hook（仅非生产）
  if (process.env.NODE_ENV !== 'production') {
    if (forceTimeout) {
      // 模拟超时：标 pending 后立即返回
      await markPending(pool, tenantId, videoId, captureType, 'force_timeout');
      return { judgment_status: 'pending', judgment_reason: 'force_timeout' };
    }
    if (forceResult) {
      await writeJudgment(pool, tenantId, videoId, captureType, forceResult, 'force_result');
      return { judgment_status: forceResult, judgment_reason: 'force_result' };
    }
  }

  // § 调 Gemini 判决
  return await callGemini(pool, tenantId, videoId, captureType, dataB64, targetProfileDesc);
}

// ── 内部：调 Gemini ──────────────────────────────────────────────────────────
async function callGemini(
  pool: QueryablePool,
  tenantId: string,
  videoId: string,
  captureType: string,
  dataB64: string,
  targetProfileDesc: string,
): Promise<JudgeVideoResult> {
  const apiKey = process.env.TOAPIS_API_KEY;
  if (!apiKey) {
    console.error('[content-judgment] TOAPIS_API_KEY 未配置，标 pending');
    await markPending(pool, tenantId, videoId, captureType, 'no_api_key');
    return { judgment_status: 'pending', judgment_reason: 'no_api_key' };
  }

  const prompt = buildPrompt(targetProfileDesc, captureType);
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
        max_tokens: 200,
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

    const text: string = resp.data?.choices?.[0]?.message?.content ?? '';
    return parseGeminiResponse(pool, tenantId, videoId, captureType, text);
  } catch (err) {
    const isTimeout = axios.isAxiosError(err) && err.code === 'ECONNABORTED';
    const reason = isTimeout ? 'gemini_timeout' : 'gemini_error';
    console.error(`[content-judgment] Gemini ${reason} videoId=${videoId}:`, (err as Error).message);
    await markPending(pool, tenantId, videoId, captureType, reason);
    return { judgment_status: 'pending', judgment_reason: reason };
  }
}

function buildPrompt(targetProfileDesc: string, captureType: string): string {
  const mediaDesc = captureType === 'audio' ? '音频片段' : '屏幕截图';
  return `你是一个内容判决助手。根据以下目标客户画像，判断这段${mediaDesc}中的内容是否匹配目标客户群体。

目标客户画像：
${targetProfileDesc}

判断规则：
1. 如果视频内容与目标客户画像高度相关（评论区可能有潜在客户），回复：MATCHED
2. 如果视频内容与目标客户画像明显不相关，回复：REJECTED，并简短说明原因（不超过 30 字）
3. 如果无法判断，回复：MATCHED（保守策略，不漏过潜在客户）

请严格按格式回复，第一行必须是 MATCHED 或 REJECTED，如果是 REJECTED 则第二行说明原因：
MATCHED
或
REJECTED
原因：...`;
}

function parseGeminiResponse(
  pool: QueryablePool,
  tenantId: string,
  videoId: string,
  captureType: string,
  text: string,
): Promise<JudgeVideoResult> {
  const upper = text.trim().toUpperCase();
  if (upper.startsWith('MATCHED')) {
    return writeJudgment(pool, tenantId, videoId, captureType, 'matched', null).then(() => ({
      judgment_status: 'matched' as const,
    }));
  }
  if (upper.startsWith('REJECTED')) {
    // 提取原因（第二行）
    const lines = text.trim().split('\n');
    const reasonLine = lines.find(l => l.includes('原因：') || l.includes('原因:'));
    const reason = reasonLine?.replace(/^原因[：:]/, '').trim() ?? null;
    return writeJudgment(pool, tenantId, videoId, captureType, 'rejected', reason).then(() => ({
      judgment_status: 'rejected' as const,
      judgment_reason: reason,
    }));
  }
  // 无法解析 → 保守 matched
  return writeJudgment(pool, tenantId, videoId, captureType, 'matched', 'parse_fallback').then(() => ({
    judgment_status: 'matched' as const,
    judgment_reason: 'parse_fallback',
  }));
}

// ── 内部：写库 ──────────────────────────────────────────────────────────────
async function markPending(
  pool: QueryablePool,
  tenantId: string,
  videoId: string,
  captureType: string,
  reason: string,
): Promise<void> {
  await pool.query(
    `UPDATE zenithjoy.acquisition_collect_videos
        SET judgment_status = 'pending', judgment_reason = $4, capture_type = $3, updated_at = now()
      WHERE tenant_id = $1 AND video_id = $2`,
    [tenantId, videoId, captureType, reason]
  );
}

async function writeJudgment(
  pool: QueryablePool,
  tenantId: string,
  videoId: string,
  captureType: string,
  status: string,
  reason: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE zenithjoy.acquisition_collect_videos
        SET judgment_status = $3, judgment_reason = $4, capture_type = $5, updated_at = now()
      WHERE tenant_id = $1 AND video_id = $2`,
    [tenantId, videoId, status, reason, captureType]
  );
}
