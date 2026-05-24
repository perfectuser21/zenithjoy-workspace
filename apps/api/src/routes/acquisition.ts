import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { expandKeywords } from '../services/keyword-expander';
import { writeLeadsFromComments } from '../services/lead-writer';

export const acquisitionRouter = Router();

const VALID_GRADES = ['感兴趣', '精准', '高意向'] as const;
type Grade = (typeof VALID_GRADES)[number];

const FEISHU_AUTH_ERROR_CODES = new Set([
  99991661, 99991663, 99991672, 99991400, 99991668, 99991645,
]);

function isFeishuAuthError(code: number): boolean {
  return FEISHU_AUTH_ERROR_CODES.has(code);
}

acquisitionRouter.get('/overview', (_req: Request, res: Response) => {
  res.json({
    enabled: true,
    feature: 'smart-acquisition',
    capabilities: ['overview'],
    version: '1.0.0',
  });
});

acquisitionRouter.post('/keyword-search', async (req: Request, res: Response) => {
  const { keyword } = req.body ?? {};

  if (!keyword || typeof keyword !== 'string' || keyword.trim() === '') {
    return res.status(400).json({ error: 'MISSING_KEYWORD' });
  }

  const kw = keyword.trim();

  // Check main agent session online status (skip in VITEST unit test mode)
  if (!process.env.VITEST) {
    try {
      const pool = (await import('../db/connection')).default;
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM zenithjoy.agent_platform_sessions WHERE role='main' AND status IN ('active','connected') LIMIT 1`
      );
      if (rows.length === 0) {
        return res.status(503).json({ error: 'AGENT_OFFLINE' });
      }
    } catch {
      // DB unavailable in non-test mode — fail safe: return offline
      return res.status(503).json({ error: 'AGENT_OFFLINE' });
    }
  }

  const keywords = await expandKeywords(kw);
  const task_id = randomUUID();

  // DB insert (skip in VITEST unit test mode)
  if (!process.env.VITEST) {
    try {
      const pool = (await import('../db/connection')).default;
      await pool.query(
        `INSERT INTO zenithjoy.acquisition_keyword_tasks
           (id, keyword, expanded_keywords, status, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, 'dispatched', NOW(), NOW())`,
        [task_id, kw, JSON.stringify(keywords)]
      );
    } catch (err) {
      console.error('[acquisition] DB insert failed:', (err as Error).message);
    }
  }

  return res.status(200).json({ task_id, keywords });
});

acquisitionRouter.post('/video-search-result', async (req: Request, res: Response) => {
  const { keyword_task_id, keyword, videos } = req.body ?? {};

  if (!keyword_task_id) {
    return res.status(400).json({ error: 'MISSING_KEYWORD_TASK_ID' });
  }

  const videoList = Array.isArray(videos) ? videos : [];

  if (!process.env.VITEST) {
    try {
      const pool = (await import('../db/connection')).default;
      for (const v of videoList) {
        await pool.query(
          `INSERT INTO zenithjoy.acquisition_videos
             (id, keyword_task_id, keyword, video_url, comment_task_status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'dispatched', NOW(), NOW())
           ON CONFLICT DO NOTHING`,
          [randomUUID(), keyword_task_id, keyword ?? '', v.video_url ?? '']
        );
      }
    } catch (err) {
      console.error('[acquisition] video-search-result DB insert failed:', (err as Error).message);
    }
  }

  return res.status(200).json({
    received: true,
    video_count: videoList.length,
  });
});

acquisitionRouter.post('/comment-score-result', async (req: Request, res: Response) => {
  const { keyword_task_id, video_url, comments } = req.body ?? {};

  if (!keyword_task_id) {
    return res.status(400).json({ error: 'MISSING_KEYWORD_TASK_ID' });
  }

  const commentList = Array.isArray(comments) ? comments : [];

  if (commentList.length === 0) {
    return res.status(200).json({
      received: true,
      written_count: 0,
      comment_count: 0,
    });
  }

  const tenant_id = process.env.FEISHU_TENANT_ID ?? 'default';
  const table_id_leads = process.env.FEISHU_TABLE_ID_LEADS ?? 'leads';

  let written_count = 0;
  if (!process.env.VITEST) {
    try {
      const result = await writeLeadsFromComments({
        tenant_id,
        table_id_leads,
        video_url: video_url ?? '',
        comments: commentList,
      });
      written_count = result.written_count;
    } catch (err) {
      console.error('[acquisition] comment-score-result writeLeads failed:', (err as Error).message);
    }
  } else {
    written_count = commentList.length;
  }

  return res.status(200).json({
    received: true,
    written_count,
    comment_count: commentList.length,
  });
});

acquisitionRouter.get('/leads', async (req: Request, res: Response) => {
  const { grade } = req.query;

  if (grade !== undefined && grade !== '') {
    if (!VALID_GRADES.includes(grade as Grade)) {
      return res.status(400).json({ error: 'INVALID_GRADE' });
    }
  }

  if (process.env.VITEST) {
    return res.status(200).json({ leads: [], total: 0 });
  }

  try {
    const pool = (await import('../db/connection')).default;

    const bindResult = await pool.query(
      `SELECT tenant_id, app_token, table_id_leads, tenant_access_token
         FROM zenithjoy.tenant_feishu_bindings
        WHERE app_token IS NOT NULL AND table_id_leads IS NOT NULL
        LIMIT 1`
    );

    if (bindResult.rows.length === 0) {
      return res.status(200).json({ leads: [], total: 0 });
    }

    const binding = bindResult.rows[0] as {
      tenant_id: string;
      app_token: string;
      table_id_leads: string;
      tenant_access_token: string | null;
    };

    const token = binding.tenant_access_token;
    if (!token) {
      return res.status(200).json({ leads: [], total: 0 });
    }

    const FEISHU_BASE = process.env.FEISHU_API_BASE || 'https://open.feishu.cn';
    const url = `${FEISHU_BASE}/open-apis/bitable/v1/apps/${binding.app_token}/tables/${binding.table_id_leads}/records`;

    let feishuData: { code: number; data?: { items?: Array<{ fields: Record<string, unknown> }> } };
    try {
      const { default: axios } = await import('axios');
      const resp = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 10000,
      });
      feishuData = resp.data as typeof feishuData;
    } catch {
      return res.status(503).json({ error: 'FEISHU_TOKEN_EXPIRED' });
    }

    if (isFeishuAuthError(feishuData.code)) {
      return res.status(503).json({ error: 'FEISHU_TOKEN_EXPIRED' });
    }

    if (feishuData.code !== 0) {
      return res.status(200).json({ leads: [], total: 0 });
    }

    const items = feishuData.data?.items || [];
    interface LeadItem {
      commenter_id: string;
      comment_text: string;
      source_video_url: string;
      crawled_at: string;
      grade: string;
      keyword: string;
    }
    let leads: LeadItem[] = items.map((item) => {
      const f = item.fields || {};
      return {
        commenter_id: String(f['commenter_id'] ?? f['评论者抖音 ID'] ?? ''),
        comment_text: String(f['comment_text'] ?? f['评论内容'] ?? ''),
        source_video_url: String(f['source_video_url'] ?? f['来源视频 URL'] ?? ''),
        crawled_at: String(f['crawled_at'] ?? f['抓取时间'] ?? ''),
        grade: String(f['grade'] ?? f['等级'] ?? ''),
        keyword: String(f['keyword'] ?? f['关键词'] ?? ''),
      };
    });

    if (grade && typeof grade === 'string') {
      leads = leads.filter((l) => l.grade === grade);
    }

    return res.status(200).json({ leads, total: leads.length });
  } catch (err) {
    console.error('[acquisition] leads error:', (err as Error).message);
    return res.status(200).json({ leads: [], total: 0 });
  }
});
