// apps/api/src/services/material-tagging.ts
//
// 批量混剪 S1「客户的素材变成系统认得出内容的可用库」第一刀：素材打标签。
//
// 客户可见的三态（对齐 proposal-v2.md FR 与 explore-report §S1）：
//   tagged                 = 已识别，ai_tags/ai_description 有值
//   failed_pending_review  = 处理失败/人工复核中——抽帧失败、缺 API key、
//                            Gemini 超时/网络错误都落在这一态，不静默丢失、不抛异常
//                            给调用方（调用方只关心"这条素材现在什么状态"）
//
// Gemini 调用复用 content-judgment.ts 已验证过的路子：TOAPIS 代理 + OpenAI 兼容
// /chat/completions + image_url（TOAPIS 上 Gemini 原生 inline_data 会挂起，这条
// 已经是真机排查坐实的教训，不重新踩一遍）。

import axios from 'axios';
import pool from '../db/connection';
import type { MaterialStorage } from './material-storage';
import { extractFrameBase64 } from './video-frame-extract';

export type TagStatus = 'tagged' | 'failed_pending_review';

export interface TagMaterialResult {
  status: TagStatus;
  tags?: string[];
  description?: string;
  reason?: string;
}

export interface TagMaterialDeps {
  storage: MaterialStorage;
}

const TOAPIS_BASE = process.env.TOAPIS_BASE_URL || 'https://toapis.com/v1';
const TAGGING_MODEL = 'gemini-2.5-flash-official';
const TAGGING_TIMEOUT_MS = 20_000;
const TAGGING_MAX_TOKENS = 500;

interface MaterialRow {
  id: string;
  tenant_id: string;
  storage_key: string;
  mime_type: string | null;
}

export async function tagMaterial(materialId: string, deps: TagMaterialDeps): Promise<TagMaterialResult> {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, storage_key, mime_type FROM zenithjoy.materials WHERE id = $1`,
    [materialId],
  );
  const material = rows[0] as MaterialRow | undefined;
  if (!material) {
    throw new Error(`material not found: ${materialId}`);
  }

  const frameDataUrl = await extractFrame(material, deps.storage);
  if (!frameDataUrl) {
    return await markFailed(material, 'frame_extraction_failed');
  }

  const apiKey = process.env.TOAPIS_API_KEY;
  if (!apiKey) {
    console.error('[material-tagging] TOAPIS_API_KEY 未配置，标 failed_pending_review');
    return await markFailed(material, 'no_api_key');
  }

  try {
    const resp = await axios.post(
      `${TOAPIS_BASE}/chat/completions`,
      {
        model: TAGGING_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: buildPrompt() },
              { type: 'image_url', image_url: { url: frameDataUrl } },
            ],
          },
        ],
        max_tokens: TAGGING_MAX_TOKENS,
        temperature: 0.1,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: TAGGING_TIMEOUT_MS,
      },
    );

    const text: string = resp.data?.choices?.[0]?.message?.content ?? '';
    const { tags, description } = parseTaggingResponse(text);
    if (tags.length === 0 && !description) {
      console.error(`[material-tagging] Gemini 返回内容解析不出标签/描述 materialId=${materialId}，原文前 80 字：${text.slice(0, 80)}`);
      return await markFailed(material, 'unparseable_response');
    }

    await pool.query(
      `UPDATE zenithjoy.materials
          SET tag_status = 'tagged', ai_tags = $2::jsonb, ai_description = $3, tagged_at = NOW()
        WHERE id = $1`,
      [material.id, JSON.stringify(tags), description],
    );
    return { status: 'tagged', tags, description: description ?? undefined };
  } catch (err) {
    const isTimeout = axios.isAxiosError(err) && err.code === 'ECONNABORTED';
    const reason = isTimeout ? 'gemini_timeout' : 'gemini_error';
    console.error(`[material-tagging] ${reason} materialId=${materialId}:`, (err as Error).message);
    return await markFailed(material, reason);
  }
}

async function extractFrame(material: MaterialRow, storage: MaterialStorage): Promise<string | null> {
  try {
    const signedUrl = await storage.getSignedUrl(material.storage_key);
    const resp = await fetch(signedUrl);
    if (!resp.ok) return null;
    const buffer = Buffer.from(await resp.arrayBuffer());
    return extractFrameBase64(buffer);
  } catch (err) {
    console.error(`[material-tagging] 下载/抽帧失败 materialId=${material.id}:`, (err as Error).message);
    return null;
  }
}

async function markFailed(material: MaterialRow, reason: string): Promise<TagMaterialResult> {
  await pool.query(
    `UPDATE zenithjoy.materials
        SET tag_status = 'failed_pending_review'
      WHERE id = $1`,
    [material.id],
  );
  return { status: 'failed_pending_review', reason };
}

function buildPrompt(): string {
  return [
    '这是一段短视频素材的关键帧截图。请完成两件事：',
    '1. 给出 3-8 个中文标签，逗号分隔，覆盖画面主体/场景/风格。',
    '2. 用一句话描述画面内容。',
    '严格按下面格式输出，不要多余文字：',
    '标签：标签1, 标签2, 标签3',
    '描述：一句话描述',
  ].join('\n');
}

function parseTaggingResponse(text: string): { tags: string[]; description: string | null } {
  const tagsMatch = text.match(/标签[：:]\s*(.+)/);
  const descMatch = text.match(/描述[：:]\s*(.+)/);
  const tags = tagsMatch
    ? tagsMatch[1].split(/[,，、]/).map((t) => t.trim()).filter(Boolean)
    : [];
  const description = descMatch ? descMatch[1].trim() : null;
  return { tags, description };
}
