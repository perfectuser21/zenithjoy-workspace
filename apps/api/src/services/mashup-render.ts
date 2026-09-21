// apps/api/src/services/mashup-render.ts
//
// 批量混剪 S4（GP f6f96e17）：客户选中的方案变成能直接发的高清成片。
//
// fail-closed（proposal-v2.md A1）：内容安全/水印自查任一非"通过"，
// export_url/download_url 恒为 NULL——绝不允许"先给文件后补检查"。
// 内容安全+水印复用同一次 Gemini 多模态调用（TOAPIS 代理，与
// material-tagging.ts/content-judgment.ts 同一条已验证过的路子），不新增
// 第三方账号：水印检测全库原本就是空白，这里把它折进已有的安全审核调用里
// 一起判，不是新立一个独立技术栈。

import axios from 'axios';
import { randomUUID } from 'crypto';
import { writeFileSync, unlinkSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import pool from '../db/connection';
import type { MaterialStorage } from './material-storage';
import { concatAndScale, renderMashupWithAudio } from './mashup-render-ffmpeg';
import { synthesize } from './tts-volcengine';
import { writeSrtFile } from './mashup-subtitle';
import { checkCopy } from './copy-compliance';
import { extractFrameBase64 } from './video-frame-extract';

export type GateStatus = 'passed' | 'flagged' | 'failed_pending_review';

/**
 * 横竖屏（GP line05/batch_mashup#step4，客户原话"抖音横屏和竖屏是我们要选择的
 * 呀"）。存在 mashup_runs.aspect_ratio（见同名 migration），渲染时按它翻译成
 * width/height 喂给 mashup-render-ffmpeg.ts——那边早就支持传，只是这里之前
 * 从未传过，永远吃硬编码默认横屏。
 */
export type AspectRatio = 'landscape' | 'portrait';

const ASPECT_RATIO_DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
};

export interface RenderCandidateInput {
  tenantId: string;
  candidateId: string;
}

export interface RenderCandidateDeps {
  storage: MaterialStorage;
}

export interface RenderCandidateResult {
  contentId: string;
  safetyCheckStatus: GateStatus;
  watermarkCheckStatus: GateStatus;
  exportUrl?: string;
  downloadUrl?: string;
}

const TOAPIS_BASE = process.env.TOAPIS_BASE_URL || 'https://toapis.com/v1';
const SAFETY_MODEL = 'gemini-2.5-flash-official';
const SAFETY_TIMEOUT_MS = 20_000;
const SAFETY_MAX_TOKENS = 300;

interface MaterialRow {
  id: string;
  storage_key: string;
}

export interface OrderedMaterial {
  id: string;
  storageKey: string;
}

/**
 * 取这个候选对应的客户文案原文（口播刀，决策 f10195d7）。
 *
 * 没有文案的情况是常态而非异常：内置「标准四槽位」模板本来就没文案，
 * 口播刀之前建的老 run 也没有。这两种一律返回 null，让渲染退回无声档，
 * 不能因为拿不到文案就把出片判死。
 */
export async function resolveScriptText(input: RenderCandidateInput): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT t.script_text
       FROM zenithjoy.mashup_candidates c
       JOIN zenithjoy.mashup_runs r ON r.id = c.run_id
       JOIN zenithjoy.mashup_templates t ON t.id = r.template_id
      WHERE c.id = $1 AND r.tenant_id = $2`,
    [input.candidateId, input.tenantId],
  );
  const text = rows[0]?.script_text;
  return typeof text === 'string' && text.trim() ? text : null;
}

/**
 * 取这个候选对应 run 的横竖屏选择。列有 NOT NULL DEFAULT，正常情况恒有值；
 * 这里仍做防御性兜底——库里出现空值/未知字面值（老数据、手工改库）一律退回
 * landscape，绝不因为一个枚举读不出来就把整条渲染链路搞崩。
 */
export async function resolveAspectRatio(input: RenderCandidateInput): Promise<AspectRatio> {
  const { rows } = await pool.query(
    `SELECT r.aspect_ratio
       FROM zenithjoy.mashup_candidates c
       JOIN zenithjoy.mashup_runs r ON r.id = c.run_id
      WHERE c.id = $1 AND r.tenant_id = $2`,
    [input.candidateId, input.tenantId],
  );
  const value = rows[0]?.aspect_ratio;
  return value === 'portrait' ? 'portrait' : 'landscape';
}

/**
 * 候选 → run → 模板槽位 → 按槽位顺序取回填充素材（预览档/终版档共用这一步，
 * 避免两条渲染路径的候选解析逻辑分叉走样）。候选不存在时抛错，其余情况尽力
 * 而为（缺素材的槽位直接跳过，不阻断）。
 */
export async function resolveOrderedMaterials(input: RenderCandidateInput): Promise<OrderedMaterial[]> {
  const { rows: candidateRows } = await pool.query(
    `SELECT c.id, c.run_id, c.slot_fill FROM zenithjoy.mashup_candidates c
       JOIN zenithjoy.mashup_runs r ON r.id = c.run_id
      WHERE c.id = $1 AND r.tenant_id = $2`,
    [input.candidateId, input.tenantId],
  );
  const candidate = candidateRows[0];
  if (!candidate) {
    throw new Error(`candidate not found: ${input.candidateId}`);
  }

  const { rows: runRows } = await pool.query(
    `SELECT id, template_id FROM zenithjoy.mashup_runs WHERE id = $1`,
    [candidate.run_id],
  );
  const run = runRows[0];

  const { rows: tmplRows } = await pool.query(
    `SELECT slots, script_text FROM zenithjoy.mashup_templates WHERE id = $1`,
    [run.template_id],
  );
  const slots: { key: string }[] = tmplRows[0]?.slots ?? [];

  const slotFill: Record<string, string> = candidate.slot_fill;
  const orderedMaterialIds = slots.map((s) => slotFill[s.key]).filter((id): id is string => Boolean(id));

  const { rows: materialRows } = await pool.query(
    `SELECT id, storage_key FROM zenithjoy.materials WHERE id = ANY($1::uuid[])`,
    [orderedMaterialIds],
  );
  const materialsById = new Map<string, MaterialRow>(materialRows.map((m: MaterialRow) => [m.id, m]));

  return orderedMaterialIds
    .map((id) => materialsById.get(id))
    .filter((m): m is MaterialRow => Boolean(m))
    .map((m) => ({ id: m.id, storageKey: m.storage_key }));
}

async function insertContent(
  tenantId: string,
  candidateId: string,
  safety: GateStatus,
  watermark: GateStatus,
  exportUrl?: string,
): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO zenithjoy.contents (tenant_id, type, status, safety_check_status, watermark_check_status, export_url, download_url, source_candidate_id)
     VALUES ($1, 'video', 'draft', $2, $3, $4, $4, $5)
     RETURNING id`,
    [tenantId, safety, watermark, exportUrl ?? null, candidateId],
  );
  return rows[0].id;
}

function buildSafetyPrompt(): string {
  return [
    '这是一段合成短视频的关键帧截图。请完成两项审核：',
    '1. 内容安全：画面是否存在色情/暴力/违法违规内容。',
    '2. 水印：画面是否可见其他平台的水印/标识（如抖音号、其他App logo）。',
    '严格按下面格式输出，不要多余文字：',
    '安全：通过 或 安全：不通过',
    '水印：无 或 水印：有',
  ].join('\n');
}

function parseSafetyResponse(text: string): { safety: 'passed' | 'flagged'; watermark: 'passed' | 'flagged' } | null {
  const safetyMatch = text.match(/安全[：:]\s*(通过|不通过)/);
  const watermarkMatch = text.match(/水印[：:]\s*(无|有)/);
  if (!safetyMatch || !watermarkMatch) return null;
  return {
    safety: safetyMatch[1] === '通过' ? 'passed' : 'flagged',
    watermark: watermarkMatch[1] === '无' ? 'passed' : 'flagged',
  };
}

export async function renderCandidate(
  input: RenderCandidateInput,
  deps: RenderCandidateDeps,
): Promise<RenderCandidateResult> {
  const orderedMaterials = await resolveOrderedMaterials(input);
  const aspectRatio = await resolveAspectRatio(input);
  const dimensions = ASPECT_RATIO_DIMENSIONS[aspectRatio];

  const workDir = tmpdir();
  const tempFiles: string[] = [];
  const outputPath = join(workDir, `mashup-render-${randomUUID()}.mp4`);
  tempFiles.push(outputPath);

  try {
    const inputPaths: string[] = [];
    for (const material of orderedMaterials) {
      // 下载单个素材失败（含 fetch() 本身网络层 throw，不只是 !resp.ok 的 HTTP
      // 错误状态）就跳过这一条，不让整个渲染因为一个素材下不动而裸崩——
      // 与 material-tagging.ts 的 extractFrame 同一个教训：下载失败要优雅降级，
      // 不能把网络异常直接冒泡到路由层变成裸 500。
      try {
        const signedUrl = await deps.storage.getSignedUrl(material.storageKey);
        const resp = await fetch(signedUrl);
        if (!resp.ok) continue;
        const buffer = Buffer.from(await resp.arrayBuffer());
        const tempPath = join(workDir, `mashup-render-in-${randomUUID()}.mp4`);
        writeFileSync(tempPath, buffer);
        tempFiles.push(tempPath);
        inputPaths.push(tempPath);
      } catch (err) {
        console.error('[mashup-render] 素材下载失败 materialId=%s reason=%s', material.id, (err as Error).message);
      }
    }

    // ── 口播成片（决策 f10195d7）────────────────────────────────────────
    // 有文案就走「配音 + 字幕 + 声画对齐」，没有则退回原来的无声拼接。
    // 顺序很重要：合规检查必须在 TTS 之前——配音和字幕会把违规词从"藏在文案里"
    // 放大成"念出来 + 写在屏幕上"，客户卖蟑螂药属农药类目，极限词是账号级风险，
    // 绝不能等成片出来再补救。
    const scriptText = await resolveScriptText(input);
    let voice: { audioPath: string; durationMs: number } | null = null;
    let srtPath: string | null = null;

    if (scriptText) {
      const compliance = checkCopy(scriptText);
      if (!compliance.passed) {
        const terms = compliance.issues.map((i) => i.term).join('、');
        console.error('[mashup-render] 文案命中违规宣称，拒绝合成 candidateId=%s terms=%s', input.candidateId, terms);
        const contentId = await insertContent(input.tenantId, input.candidateId, 'failed_pending_review', 'failed_pending_review');
        return { contentId, safetyCheckStatus: 'failed_pending_review', watermarkCheckStatus: 'failed_pending_review' };
      }
      try {
        const tts = await synthesize(scriptText);
        voice = { audioPath: tts.audioPath, durationMs: tts.durationMs };
        tempFiles.push(tts.audioPath);
        const srt = join(workDir, `mashup-sub-${randomUUID()}.srt`);
        writeSrtFile(tts.words, srt);
        tempFiles.push(srt);
        srtPath = srt;
      } catch (err) {
        // TTS 是增强项不是阻断项：火山挂了/欠费/网关 520 都只该让这一条退回
        // 无声成片，不能连累整个渲染失败——客户至少还能拿到画面。
        console.error('[mashup-render] TTS 不可用，退回无声成片 reason=%s', (err as Error).message);
        voice = null;
        srtPath = null;
      }
    }

    let rendered: boolean;
    if (inputPaths.length === 0) {
      rendered = false;
    } else if (voice) {
      // 配音时长均分到各段：每段画面放多久由声音决定，而不是素材原时长硬凑。
      const perSegSec = voice.durationMs / 1000 / inputPaths.length;
      rendered = renderMashupWithAudio(
        inputPaths.map((path) => ({ path, durationSec: perSegSec })),
        outputPath,
        { audioPath: voice.audioPath, srtPath: srtPath ?? undefined, width: dimensions.width, height: dimensions.height },
      );
    } else {
      rendered = concatAndScale(inputPaths, outputPath, { width: dimensions.width, height: dimensions.height });
    }
    if (!rendered) {
      const contentId = await insertContent(input.tenantId, input.candidateId, 'failed_pending_review', 'failed_pending_review');
      return { contentId, safetyCheckStatus: 'failed_pending_review', watermarkCheckStatus: 'failed_pending_review' };
    }

    const frameDataUrl = extractFrameBase64(readFileSync(outputPath));
    const apiKey = process.env.TOAPIS_API_KEY;
    if (!frameDataUrl || !apiKey) {
      const contentId = await insertContent(input.tenantId, input.candidateId, 'failed_pending_review', 'failed_pending_review');
      return { contentId, safetyCheckStatus: 'failed_pending_review', watermarkCheckStatus: 'failed_pending_review' };
    }

    let gate: { safety: 'passed' | 'flagged'; watermark: 'passed' | 'flagged' } | null = null;
    try {
      const resp = await axios.post(
        `${TOAPIS_BASE}/chat/completions`,
        {
          model: SAFETY_MODEL,
          messages: [
            { role: 'user', content: [{ type: 'text', text: buildSafetyPrompt() }, { type: 'image_url', image_url: { url: frameDataUrl } }] },
          ],
          max_tokens: SAFETY_MAX_TOKENS,
          temperature: 0.1,
        },
        { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: SAFETY_TIMEOUT_MS },
      );
      const text: string = resp.data?.choices?.[0]?.message?.content ?? '';
      gate = parseSafetyResponse(text);
    } catch (err) {
      // candidateId 来自 URL 路径参数（外部可控）：不拼进第一个字符串参数（console.error
      // 的首参会被当格式串，含 %s 等占位符会被当成格式化指令，CodeQL
      // js/tainted-format-string 拦此模式），改成独立参数传入。
      console.error('[mashup-render] 内容安全审核调用失败 candidateId=%s reason=%s', input.candidateId, (err as Error).message);
    }

    if (!gate) {
      const contentId = await insertContent(input.tenantId, input.candidateId, 'failed_pending_review', 'failed_pending_review');
      return { contentId, safetyCheckStatus: 'failed_pending_review', watermarkCheckStatus: 'failed_pending_review' };
    }

    if (gate.safety !== 'passed' || gate.watermark !== 'passed') {
      const contentId = await insertContent(input.tenantId, input.candidateId, gate.safety, gate.watermark);
      return { contentId, safetyCheckStatus: gate.safety, watermarkCheckStatus: gate.watermark };
    }

    const storageKey = `mashup-exports/${input.tenantId}/${input.candidateId}.mp4`;
    await deps.storage.putObject({ key: storageKey, filePath: outputPath, contentType: 'video/mp4' });
    const signedUrl = await deps.storage.getSignedUrl(storageKey);

    const contentId = await insertContent(input.tenantId, input.candidateId, 'passed', 'passed', signedUrl);
    return { contentId, safetyCheckStatus: 'passed', watermarkCheckStatus: 'passed', exportUrl: signedUrl, downloadUrl: signedUrl };
  } finally {
    for (const f of tempFiles) {
      try { unlinkSync(f); } catch { /* ignore */ }
    }
  }
}
