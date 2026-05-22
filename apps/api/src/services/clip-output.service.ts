import axios from 'axios';
import pool from '../db/connection';
import { upsertFeishuBinding } from './clips.service';
import { refreshFeishuToken } from './clips-auth.service';
import type { Clip } from './clips.service';

export type ParsedOutput =
  | { type: 'notion'; databaseId: string }
  | { type: 'feishu'; appToken: string; tableId?: string }
  | null;

export function parseOutputUrl(url: string): ParsedOutput {
  if (!url) return null;

  if (url.includes('notion.so') || url.includes('notion.site')) {
    const stripped = url.replace(/-/g, '');
    const hex32 = stripped.match(/([a-f0-9]{32})(?:[^a-f0-9]|$)/i);
    if (!hex32) return null;
    const raw = hex32[1].toLowerCase();
    const databaseId = `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`;
    return { type: 'notion', databaseId };
  }

  if (url.includes('feishu.cn') || url.includes('larksuite.com')) {
    const match = url.match(/\/base\/([^/?#]+)/);
    if (!match) return null;
    const appToken = match[1];
    const tableMatch = url.match(/[?&]table=([^&]+)/);
    const tableId = tableMatch ? tableMatch[1] : undefined;
    return { type: 'feishu', appToken, tableId };
  }

  return null;
}

async function getUserTokens(userId: string): Promise<{
  notionToken: string | null;
  feishuToken: string | null;
  feishuRefreshToken: string | null;
  feishuExpiresAt: Date | null;
}> {
  const r = await pool.query<{
    notion_token: string | null;
    feishu_user_token: string | null;
    feishu_refresh_token: string | null;
    feishu_token_expires_at: Date | null;
  }>(
    `SELECT notion_token, feishu_user_token, feishu_refresh_token, feishu_token_expires_at
     FROM zenithjoy.user_clip_settings WHERE user_id = $1`,
    [userId]
  );
  const row = r.rows[0];
  return {
    notionToken: row?.notion_token ?? null,
    feishuToken: row?.feishu_user_token ?? null,
    feishuRefreshToken: row?.feishu_refresh_token ?? null,
    feishuExpiresAt: row?.feishu_token_expires_at ?? null,
  };
}

async function pushToNotion(clip: Clip, token: string): Promise<void> {
  const parsed = parseOutputUrl(clip.output_url || '');
  if (!parsed || parsed.type !== 'notion') throw new Error('invalid notion output_url');

  const today = new Date().toISOString().split('T')[0];
  const properties: Record<string, unknown> = {
    '标题': { title: [{ text: { content: (clip.title || '未命名').substring(0, 2000) } }] },
    '链接': { url: clip.url || null },
    '日期': { date: { start: today } },
    '状态': { status: { name: '未使用' } },
  };
  if (clip.platform) {
    properties['平台'] = { select: { name: clip.platform } };
  }

  const children: unknown[] = [];
  const transcript = clip.transcript?.trim();
  if (transcript) {
    children.push({
      object: 'block', type: 'heading_2',
      heading_2: { rich_text: [{ type: 'text', text: { content: '转写文案' } }] },
    });
    for (let i = 0; i < transcript.length && children.length < 95; i += 1900) {
      children.push({
        object: 'block', type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: transcript.slice(i, i + 1900) } }] },
      });
    }
  }

  const resp = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: { database_id: parsed.databaseId },
      properties,
      children: children.length > 0 ? children : undefined,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Notion API ${resp.status}: ${body}`);
  }
}

async function pushToFeishu(clip: Clip, userToken: string): Promise<void> {
  const parsed = parseOutputUrl(clip.output_url || '');
  if (!parsed || parsed.type !== 'feishu') throw new Error('invalid feishu output_url');
  if (!parsed.tableId) throw new Error('飞书 Bitable URL 缺少 table 参数');

  const today = new Date().toISOString().split('T')[0];
  const fields: Record<string, unknown> = {
    '标题': clip.title || '未命名',
    '链接': { link: clip.url, text: clip.url },
    '日期': today,
    '平台': clip.platform || '',
  };
  if (clip.transcript?.trim()) {
    fields['转写文案'] = clip.transcript.substring(0, 50000);
  }

  const resp = await axios.post(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${parsed.appToken}/tables/${parsed.tableId}/records`,
    { fields },
    { headers: { Authorization: `Bearer ${userToken}` } }
  );
  if (resp.data.code !== 0) {
    throw new Error(`飞书写入失败: code=${resp.data.code} msg=${resp.data.msg}`);
  }
}

export async function pushClipOutput(clip: Clip): Promise<{ success: boolean; error?: string }> {
  if (!clip.output_url || !clip.output_type) {
    return { success: false, error: 'no_output_configured' };
  }

  const tokens = await getUserTokens(clip.user_id);

  try {
    if (clip.output_type === 'notion') {
      if (!tokens.notionToken) return { success: false, error: 'no_binding' };
      await pushToNotion(clip, tokens.notionToken);

    } else if (clip.output_type === 'feishu') {
      let feishuToken = tokens.feishuToken;
      if (!feishuToken) return { success: false, error: 'no_binding' };

      // Auto-refresh if expiring within 5 minutes
      if (tokens.feishuExpiresAt && tokens.feishuExpiresAt < new Date(Date.now() + 5 * 60 * 1000)) {
        if (tokens.feishuRefreshToken) {
          try {
            const refreshed = await refreshFeishuToken(tokens.feishuRefreshToken);
            await upsertFeishuBinding(clip.user_id, refreshed);
            feishuToken = refreshed.userToken;
          } catch (e) {
            console.warn('[clip-output] feishu refresh failed, using existing token');
          }
        }
      }

      await pushToFeishu(clip, feishuToken);
    }

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[clip-output] 推送失败:', msg);
    return { success: false, error: msg };
  }
}
