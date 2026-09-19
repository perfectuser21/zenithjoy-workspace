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
import { concatAndScale } from './mashup-render-ffmpeg';
import { extractFrameBase64 } from './video-frame-extract';

export type GateStatus = 'passed' | 'flagged' | 'failed_pending_review';

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
    `SELECT slots FROM zenithjoy.mashup_templates WHERE id = $1`,
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

  const workDir = tmpdir();
  const tempFiles: string[] = [];
  const outputPath = join(workDir, `mashup-render-${randomUUID()}.mp4`);
  tempFiles.push(outputPath);

  try {
    const inputPaths: string[] = [];
    for (const materialId of orderedMaterialIds) {
      const material = materialsById.get(materialId);
      if (!material) continue;
      const signedUrl = await deps.storage.getSignedUrl(material.storage_key);
      const resp = await fetch(signedUrl);
      if (!resp.ok) continue;
      const buffer = Buffer.from(await resp.arrayBuffer());
      const tempPath = join(workDir, `mashup-render-in-${randomUUID()}.mp4`);
      writeFileSync(tempPath, buffer);
      tempFiles.push(tempPath);
      inputPaths.push(tempPath);
    }

    const rendered = inputPaths.length > 0 && concatAndScale(inputPaths, outputPath);
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
      console.error(`[mashup-render] 内容安全审核调用失败 candidateId=${input.candidateId}:`, (err as Error).message);
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
