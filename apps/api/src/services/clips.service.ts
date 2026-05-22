import pool from '../db/connection';
import { parseOutputUrl } from './clip-output.service';

export interface Clip {
  id: string;
  user_id: string;
  url: string;
  platform: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  title: string | null;
  transcript: string | null;
  content_type: string | null;
  text: string | null;
  ocr_text: string | null;
  images: unknown[];
  author: string | null;
  author_id: string | null;
  like_count: number | null;
  comment_count: number | null;
  share_count: number | null;
  cover_url: string | null;
  video_url: string | null;
  output_url: string | null;
  output_type: string | null;
  output_status: string | null;
  error_msg: string | null;
  retry_count: number;
  raw_response: unknown;
  created_at: Date;
  processed_at: Date | null;
  updated_at: Date;
}

export interface ClipSettings {
  defaultOutputUrl: string | null;
  defaultOutputType: string | null;
  notionBound: boolean;
  feishuBound: boolean;
  feishuUserName?: string;
}

export function detectPlatform(url: string): 'douyin' | 'xiaohongshu' | null {
  if (/douyin\.com|v\.douyin\.com/.test(url)) return 'douyin';
  if (/xiaohongshu\.com|xhslink\.com/.test(url)) return 'xiaohongshu';
  return null;
}

export async function createClip(params: {
  userId: string;
  url: string;
  platform: string;
  outputUrl?: string | null;
  outputType?: string | null;
}): Promise<Clip> {
  const result = await pool.query<Clip>(
    `INSERT INTO zenithjoy.clips (user_id, url, platform, output_url, output_type)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [params.userId, params.url, params.platform, params.outputUrl ?? null, params.outputType ?? null]
  );
  return result.rows[0];
}

export async function getClips(
  userId: string,
  filters: { platform?: string; status?: string; limit?: number; offset?: number }
): Promise<{ data: Clip[]; total: number }> {
  const conditions = ['user_id = $1'];
  const values: unknown[] = [userId];
  let i = 2;

  if (filters.platform && filters.platform !== 'all') {
    conditions.push(`platform = $${i++}`);
    values.push(filters.platform);
  }
  if (filters.status && filters.status !== 'all') {
    conditions.push(`status = $${i++}`);
    values.push(filters.status);
  }

  const where = conditions.join(' AND ');
  const limit = filters.limit ?? 20;
  const offset = filters.offset ?? 0;

  const [dataResult, countResult] = await Promise.all([
    pool.query<Clip>(
      `SELECT * FROM zenithjoy.clips WHERE ${where} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
      [...values, limit, offset]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM zenithjoy.clips WHERE ${where}`,
      values
    ),
  ]);

  return {
    data: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}

export async function getClipById(id: string, userId: string): Promise<Clip | null> {
  const result = await pool.query<Clip>(
    `SELECT * FROM zenithjoy.clips WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return result.rows[0] ?? null;
}

export async function updateClipStatus(
  id: string,
  status: string,
  extra?: Partial<{
    title: string;
    transcript: string;
    images: unknown[];
    author: string;
    author_id: string;
    like_count: number;
    comment_count: number;
    share_count: number;
    cover_url: string;
    video_url: string;
    raw_response: unknown;
    error_msg: string | undefined;
    content_type: string;
    text: string;
    ocr_text: string;
    output_status: string;
    processed_at: Date;
  }>
): Promise<Clip> {
  const fields = ['status = $2', 'updated_at = NOW()'];
  const values: unknown[] = [id, status];
  let i = 3;

  if (extra) {
    for (const [key, val] of Object.entries(extra)) {
      if (val !== undefined) {
        fields.push(`${key} = $${i++}`);
        values.push(val === undefined ? null : val);
      }
    }
  }

  const result = await pool.query<Clip>(
    `UPDATE zenithjoy.clips SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
    values
  );
  return result.rows[0];
}

export async function getExistingClip(userId: string, url: string): Promise<Clip | null> {
  const result = await pool.query<Clip>(
    `SELECT * FROM zenithjoy.clips WHERE user_id = $1 AND url = $2`,
    [userId, url]
  );
  return result.rows[0] ?? null;
}

export async function getSettings(userId: string): Promise<ClipSettings | null> {
  const result = await pool.query<{
    default_output_url: string | null;
    default_output_type: string | null;
    notion_token: string | null;
    feishu_user_token: string | null;
    feishu_user_name: string | null;
  }>(
    `SELECT default_output_url, default_output_type, notion_token, feishu_user_token, feishu_user_name FROM zenithjoy.user_clip_settings WHERE user_id = $1`,
    [userId]
  );
  if (!result.rows[0]) return null;
  return {
    defaultOutputUrl: result.rows[0].default_output_url,
    defaultOutputType: result.rows[0].default_output_type,
    notionBound: !!result.rows[0].notion_token,
    feishuBound: !!result.rows[0].feishu_user_token,
    feishuUserName: result.rows[0].feishu_user_name ?? undefined,
  };
}

export async function upsertSettings(
  userId: string,
  params: { defaultOutputUrl: string; defaultOutputType: string }
): Promise<void> {
  await pool.query(
    `INSERT INTO zenithjoy.user_clip_settings (user_id, default_output_url, default_output_type, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       default_output_url = EXCLUDED.default_output_url,
       default_output_type = EXCLUDED.default_output_type,
       updated_at = NOW()`,
    [userId, params.defaultOutputUrl, params.defaultOutputType]
  );
}


import { FeishuTokenResult } from './clips-auth.service';

export async function upsertFeishuBinding(userId: string, tokenResult: FeishuTokenResult): Promise<void> {
  await pool.query(
    `INSERT INTO zenithjoy.user_clip_settings (user_id, feishu_user_token, feishu_refresh_token, feishu_user_id, feishu_user_name, feishu_token_expires_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       feishu_user_token = EXCLUDED.feishu_user_token,
       feishu_refresh_token = EXCLUDED.feishu_refresh_token,
       feishu_user_id = EXCLUDED.feishu_user_id,
       feishu_user_name = EXCLUDED.feishu_user_name,
       feishu_token_expires_at = EXCLUDED.feishu_token_expires_at,
       updated_at = NOW()`,
    [userId, tokenResult.userToken, tokenResult.refreshToken, tokenResult.userId, tokenResult.userName, tokenResult.expiresAt]
  );
}

export async function upsertNotionToken(userId: string, token: string): Promise<void> {
  await pool.query(
    `INSERT INTO zenithjoy.user_clip_settings (user_id, notion_token, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET notion_token = EXCLUDED.notion_token, updated_at = NOW()`,
    [userId, token]
  );
}

export async function clearFeishuBinding(userId: string): Promise<void> {
  await pool.query(
    `UPDATE zenithjoy.user_clip_settings
     SET feishu_user_token=NULL, feishu_refresh_token=NULL, feishu_user_id=NULL,
         feishu_user_name=NULL, feishu_token_expires_at=NULL, updated_at=NOW()
     WHERE user_id=$1`,
    [userId]
  );
}

export async function clearNotionToken(userId: string): Promise<void> {
  await pool.query(
    `UPDATE zenithjoy.user_clip_settings SET notion_token=NULL, updated_at=NOW() WHERE user_id=$1`,
    [userId]
  );
}

// 重新导出 parseOutputUrl 供 controller 使用（避免 controller 直接依赖 clip-output）
export { parseOutputUrl };
