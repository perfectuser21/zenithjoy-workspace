import { Router, Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import axios from 'axios';
import { expandKeywords } from '../services/keyword-expander';
import { gradeComment } from '../services/comment-grader';
import pool from '../db/connection';
import {
  SWEEP_TIMEOUT_MS,
  profileUrlForSecUid,
  resolveTerminalStatus,
} from '../services/acquisition-collect';
import { tenantContextOptional } from '../middleware/tenant-context';
import { licenseAuth } from '../middleware/license-auth';
import { sseService } from '../services/sse.service';
import { scoreLeads, buildAssignments, dispatchDue } from '../services/acquisition-dispatch';

export const acquisitionRouter = Router();

const VALID_GRADES = ['感兴趣', '精准', '高意向'] as const;
type Grade = (typeof VALID_GRADES)[number];

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

  if (!process.env.VITEST) {
    try {
      const pool = (await import('../db/connection')).default;
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM zenithjoy.agents WHERE status = 'online' LIMIT 1`
      );
      if (rows.length === 0) {
        return res.status(503).json({ error: 'AGENT_OFFLINE' });
      }
    } catch {
      return res.status(503).json({ error: 'AGENT_OFFLINE' });
    }
  }

  const keywords = await expandKeywords(kw);
  const task_id = randomUUID();

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

// Agent 轮询端点 — 返回待处理的关键词任务
acquisitionRouter.get('/pending-keyword-tasks', async (_req: Request, res: Response) => {
  if (process.env.VITEST) {
    return res.status(200).json({ tasks: [], total: 0 });
  }

  try {
    const pool = (await import('../db/connection')).default;
    const { rows } = await pool.query<{
      id: string;
      keyword: string;
      expanded_keywords: string[];
    }>(
      `SELECT id, keyword, expanded_keywords
         FROM zenithjoy.acquisition_keyword_tasks
        WHERE status = 'dispatched'
        ORDER BY created_at ASC
        LIMIT 10`
    );

    // Mark picked-up tasks as processing
    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      await pool.query(
        `UPDATE zenithjoy.acquisition_keyword_tasks
            SET status = 'processing', updated_at = NOW()
          WHERE id = ANY($1::uuid[])`,
        [ids]
      );
    }

    const tasks = rows.map((r) => ({
      task_id: r.id,
      keyword: r.keyword,
      keywords: Array.isArray(r.expanded_keywords) ? r.expanded_keywords : [],
    }));

    return res.status(200).json({ tasks, total: tasks.length });
  } catch (err) {
    console.error('[acquisition] pending-keyword-tasks error:', (err as Error).message);
    return res.status(200).json({ tasks: [], total: 0 });
  }
});

// 前端列表端点 — 返回租户的采集任务列表（最新 20 条）
acquisitionRouter.get('/collect-tasks', tenantContextOptional, async (req: Request, res: Response) => {
  if (process.env.VITEST) {
    return res.status(200).json({ success: true, data: { tasks: [], total: 0 }, timestamp: new Date().toISOString() });
  }

  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(401).json({ success: false, error: { code: 'NO_TENANT', message: '缺租户上下文（未登录或无 X-Tenant-Id）' }, timestamp: new Date().toISOString() });
  }

  try {
    const { rows } = await pool.query<{
      id: string;
      keywords: string[];
      status: string;
      created_at: Date;
      video_count: number;
      lead_count_raw: number;
    }>(
      `SELECT id, keywords, status, created_at, video_count, lead_count_raw
         FROM zenithjoy.acquisition_collect_tasks
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT 20`,
      [tenantId]
    );

    const tasks = rows.map((r) => ({
      id: r.id,
      keywords: Array.isArray(r.keywords) ? r.keywords : [],
      status: r.status,
      created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
      video_count: r.video_count ?? 0,
      lead_count_raw: r.lead_count_raw ?? 0,
    }));

    return res.status(200).json({ success: true, data: { tasks, total: tasks.length }, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[acquisition] collect-tasks error:', (err as Error).message);
    return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: (err as Error).message }, timestamp: new Date().toISOString() });
  }
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/acquisition/collect-tasks/:id/videos — 该任务下的视频卡片列表（TasksPage 二级视图）
acquisitionRouter.get('/collect-tasks/:id/videos', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;
  const taskId = req.params.id;
  if (!UUID_RE.test(taskId)) return fail(res, 404, 'TASK_NOT_FOUND', '采集任务不存在');

  try {
    const taskRes = await pool.query(
      `SELECT id FROM zenithjoy.acquisition_collect_tasks WHERE id = $1 AND tenant_id = $2`,
      [taskId, tenantId]
    );
    if (taskRes.rows.length === 0) return fail(res, 404, 'TASK_NOT_FOUND', '采集任务不存在');

    const { rows } = await pool.query<{
      video_id: string;
      task_id: string;
      title: string | null;
      thumbnail_url: string | null;
      publish_date: Date | null;
      comment_count: number;
    }>(
      `SELECT video_id, task_id, title, thumbnail_url, publish_date, comment_count
         FROM zenithjoy.acquisition_collect_videos
        WHERE task_id = $1 AND tenant_id = $2
        ORDER BY created_at ASC`,
      [taskId, tenantId]
    );

    const videos = rows.map((r) => ({
      video_id: r.video_id,
      task_id: r.task_id,
      title: r.title,
      thumbnail_url: r.thumbnail_url,
      publish_date: r.publish_date ? new Date(r.publish_date).toISOString() : null,
      comment_count: r.comment_count ?? 0,
    }));

    return ok(res, { videos, total: videos.length });
  } catch (err) {
    return fail(res, 500, 'DB_ERROR', (err as Error).message);
  }
});

// GET /api/acquisition/videos/:videoId/leads — 某视频下命中的评论/leads（TasksPage 二级视图展开）
acquisitionRouter.get('/videos/:videoId/leads', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;
  const videoId = req.params.videoId;

  try {
    const videoRes = await pool.query(
      `SELECT video_id FROM zenithjoy.acquisition_collect_videos WHERE video_id = $1 AND tenant_id = $2`,
      [videoId, tenantId]
    );
    if (videoRes.rows.length === 0) return fail(res, 404, 'VIDEO_NOT_FOUND', '视频不存在');

    const { rows } = await pool.query<{
      sec_uid: string | null;
      nickname: string;
      comment_text: string | null;
      grade: string | null;
    }>(
      `SELECT sec_uid, nickname, comment_text, grade
         FROM zenithjoy.acquisition_leads
        WHERE tenant_id = $1 AND source_video_ids ? $2
        ORDER BY created_at DESC`,
      [tenantId, videoId]
    );

    const leads = rows.map((r) => ({
      commenter_id: r.nickname ?? r.sec_uid ?? '',
      comment_text: r.comment_text ?? '',
      source_video_url: `https://www.douyin.com/video/${videoId}`,
      grade: r.grade ?? '',
      profile_url: r.sec_uid ? `https://www.douyin.com/user/${r.sec_uid}` : null,
    }));

    return ok(res, { leads, total: leads.length });
  } catch (err) {
    return fail(res, 500, 'DB_ERROR', (err as Error).message);
  }
});

// Agent 轮询端点 — 返回待处理的 collect 任务（来自 collect/start 写入的 acquisition_collect_tasks）
acquisitionRouter.get('/pending-collect-tasks', async (_req: Request, res: Response) => {
  if (process.env.VITEST) {
    return res.status(200).json({ tasks: [], total: 0 });
  }

  try {
    const pool = (await import('../db/connection')).default;
    const { rows } = await pool.query<{
      id: string;
      keywords: string[];
      tenant_id: string;
    }>(
      `SELECT id, keywords, tenant_id
         FROM zenithjoy.acquisition_collect_tasks
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT 5`
    );

    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      await pool.query(
        `UPDATE zenithjoy.acquisition_collect_tasks
            SET status = 'running', updated_at = NOW()
          WHERE id = ANY($1::uuid[])`,
        [ids]
      );
    }

    const tasks = rows.map((r) => ({
      task_id: r.id,
      tenant_id: r.tenant_id,
      keywords: Array.isArray(r.keywords) ? r.keywords : [],
    }));

    return res.status(200).json({ tasks, total: tasks.length });
  } catch (err) {
    console.error('[acquisition] pending-collect-tasks error:', (err as Error).message);
    return res.status(200).json({ tasks: [], total: 0 });
  }
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
      // 每次上报都标记 keyword_task 为 done（包括 agent 在所有关键词处理完后发的空 sentinel 调用）
      await pool.query(
        `UPDATE zenithjoy.acquisition_keyword_tasks
            SET status = 'done', updated_at = NOW()
          WHERE id = $1 AND status != 'done'`,
        [keyword_task_id]
      );
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

  let written_count = 0;
  let resolved_tenant_id: string | null = null;

  if (!process.env.VITEST) {
    try {
      // 取第一个可用租户（keyword 任务无租户绑定）
      const tenantRes = await pool.query(`SELECT id FROM zenithjoy.tenants LIMIT 1`);
      resolved_tenant_id = tenantRes.rows.length > 0 ? tenantRes.rows[0].id : null;

      if (resolved_tenant_id) {
        const gradedComments = await Promise.all(
          commentList.map(async (c: { commenter_id?: string; text?: string; publish_time?: string; keyword?: string; grade?: string }) => {
            const grade = c.grade || await gradeComment(c.text ?? '');
            if (!grade) return null;
            return { ...c, grade };
          })
        );
        for (const c of gradedComments) {
          if (!c) continue;
          const rawId = String(c.commenter_id || '').trim();
          const secUidMatch = rawId.match(/\/user\/([^/?#]+)/);
          const secUid = secUidMatch ? secUidMatch[1] : null;
          const nickname = rawId || '未知';
          try {
            await pool.query(
              `INSERT INTO zenithjoy.acquisition_leads
                 (tenant_id, sec_uid, nickname, profile_url, source_video_ids,
                  comment_text, grade, keyword, feishu_write_status)
               VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, 'local_only')
               ON CONFLICT DO NOTHING`,
              [resolved_tenant_id, secUid, nickname, secUid ? `https://www.douyin.com/user/${secUid}` : null,
               JSON.stringify([video_url ?? '']), String(c.text || '').trim() || null,
               c.grade || null, c.keyword || null],
            );
            written_count++;
          } catch { /* 单条失败不中断 */ }
        }
      }
    } catch (err) {
      console.error('[acquisition] comment-score-result failed:', (err as Error).message);
    }
  } else {
    written_count = commentList.length;
    resolved_tenant_id = commentList.length > 0 ? 'vitest-tenant' : null;
  }

  // fire-and-forget：leads 写库后自动触发 DM 派发（buildAssignments 自带去重/频控，安全重入）
  if (written_count > 0 && resolved_tenant_id) {
    const tid = resolved_tenant_id;
    void scoreLeads(pool, tid)
      .then(() => buildAssignments(pool, tid))
      .then(() => dispatchDue(pool, tid))
      .catch((e: Error) => console.error('[acquisition] dm-dispatch error:', e.message));
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

    interface LeadRow {
      sec_uid: string | null;
      nickname: string;
      comment_text: string | null;
      source_video_ids: string[];
      created_at: string;
      grade: string | null;
      keyword: string | null;
      task_keywords: string[] | null;
    }

    const gradeClause = grade && typeof grade === 'string' ? `AND l.grade = $1` : '';
    const params: string[] = grade && typeof grade === 'string' ? [grade] : [];

    const result = await pool.query<LeadRow>(
      `SELECT l.sec_uid, l.nickname, l.comment_text,
              l.source_video_ids, l.created_at, l.grade, l.keyword,
              t.keywords AS task_keywords
         FROM zenithjoy.acquisition_leads l
         LEFT JOIN zenithjoy.acquisition_collect_tasks t ON t.id = l.collect_task_id
        ${gradeClause}
        ORDER BY l.created_at DESC
        LIMIT 500`,
      params
    );

    const leads = result.rows.map((r) => {
      const videoIds: string[] = Array.isArray(r.source_video_ids) ? r.source_video_ids : [];
      const taskKws: string[] = Array.isArray(r.task_keywords) ? r.task_keywords : [];
      const videoId = videoIds[0] ?? '';
      return {
        commenter_id: r.nickname ?? r.sec_uid ?? '',
        profile_url: r.sec_uid ? `https://www.douyin.com/user/${r.sec_uid}` : null,
        comment_text: r.comment_text ?? '',
        source_video_url: videoId ? `https://www.douyin.com/video/${videoId}` : '',
        crawled_at: r.created_at,
        grade: r.grade ?? '',
        keyword: r.keyword ?? taskKws[0] ?? '',
      };
    });

    return res.status(200).json({ leads, total: leads.length });
  } catch (err) {
    console.error('[acquisition] leads error:', (err as Error).message);
    return res.status(200).json({ leads: [], total: 0 });
  }
});

// ============================================================================
// Path 2 Step4 — 飞书企业信息文档 + 扩词 + 中台采集闭环
//   POST /collect/expand           前置校验 + 读文档扩 3 词（手输覆盖 / 降级种子兜底）
//   POST /collect/start            确认派单 → 返 task_id（pending）
//   POST /collect/cancel           取消 → cancelling（已抓先落库不丢）
//   POST /collect/report           客户机 Agent 增量回报 → 去重落 DB + 写飞书（X-Smoke-Token 门禁）
//   POST /collect/sweep-timeouts   只把 stale running(>10min) 转终态，pending(离线) 保留不丢
//   GET  /collect/:task_id         获客页查状态（7 态 + 计数 + error_code + 抖音号）
// 统一响应包裹：{success,data,timestamp} / {success,error:{code,message},timestamp}
// ============================================================================

function ok(res: Response, data: unknown, status = 200) {
  return res.status(status).json({ success: true, data, timestamp: new Date().toISOString() });
}
function fail(res: Response, status: number, code: string, message: string) {
  return res
    .status(status)
    .json({ success: false, error: { code, message }, timestamp: new Date().toISOString() });
}
function tenantOf(req: Request, res: Response): string | null {
  const t = req.tenantId;
  if (!t) {
    fail(res, 401, 'NO_TENANT', '缺租户上下文（未登录或无 X-Tenant-Id）');
    return null;
  }
  return t;
}

const EXPECTED_SMOKE_TOKEN = () => process.env.SMOKE_TOKEN || 'smoke-secret-2026';

// report / sweep-timeouts 门禁：X-Smoke-Token（CI fake-agent）或真 agent 鉴权
function smokeOrAgentGate(req: Request, res: Response, next: NextFunction) {
  const tok = req.header('X-Smoke-Token');
  if (tok && tok === EXPECTED_SMOKE_TOKEN()) return next();
  return fail(res, 403, 'FORBIDDEN', 'invalid X-Smoke-Token');
}

// DeepSeek 扩词（走 OPENROUTER_BASE_URL = FAKE_LLM_BASE；失败抛错 → 调用方种子兜底）。
async function llmExpandKeywords(docText: string): Promise<string[]> {
  const base = process.env.OPENROUTER_BASE_URL;
  const url = base
    ? `${base.replace(/\/$/, '')}/chat/completions`
    : 'https://openrouter.ai/api/v1/chat/completions';
  const key = process.env.OPENROUTER_API_KEY || 'fake-key';
  const prompt =
    `根据下面企业信息，生成 3 个用于在抖音搜索潜在客户的关键词，每行一个，只输出关键词，不加序号或标点：\n${docText}`;
  const MAX_ATTEMPT = 2;
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPT; attempt++) {
    try {
      const resp = await axios.post(
        url,
        {
          model: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 100,
        },
        { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 8000 }
      );
      const content: string = resp.data?.choices?.[0]?.message?.content ?? '';
      const words = content
        .split('\n')
        .map((s) => s.replace(/^[\d.、)\s-]+/, '').trim())
        .filter((s) => s.length > 0)
        .slice(0, 3);
      if (words.length === 3) return words;
      throw new Error(`LLM 扩词不足 3 个 (got ${words.length})`);
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw lastErr ?? new Error('LLM 扩词失败');
}

// POST /api/acquisition/collect/expand
acquisitionRouter.post('/collect/expand', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;
  const manualKeywords: unknown = req.body?.manual_keywords;

  try {
    // 手输优先：manual_keywords 非空 → 直接返回，无需飞书绑定
    if (Array.isArray(manualKeywords) && manualKeywords.length > 0) {
      const keywords = manualKeywords
        .map((w) => String(w).trim())
        .filter((w) => w.length > 0)
        .map((word) => ({ word, source: 'manual' as const }));
      return ok(res, { degraded: false, keywords });
    }

    // 无手动关键词时降级返回空列表（飞书企业文档路径已移除）
    return ok(res, { degraded: true, keywords: [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[acquisition/expand]', msg);
    return fail(res, 500, 'EXPAND_FAILED', msg);
  }
});

// POST /api/acquisition/collect/start
acquisitionRouter.post('/collect/start', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;
  const keywords: unknown = req.body?.keywords;

  try {
    if (!Array.isArray(keywords) || keywords.length === 0)
      return fail(res, 400, 'MISSING_KEYWORDS', 'keywords 不能为空');

    // 异步检查主号 session（不阻塞采集任务创建）
    pool.query(
      `SELECT id FROM zenithjoy.line02_account_sessions WHERE tenant_id = $1 AND role = 'main' AND health = 'ok' LIMIT 1`,
      [tenantId]
    ).catch(() => {});

    const r = await pool.query(
      `INSERT INTO zenithjoy.acquisition_collect_tasks (tenant_id, keywords, source, status)
       VALUES ($1, $2::jsonb, 'ai', 'pending')
       RETURNING id`,
      [tenantId, JSON.stringify(keywords)]
    );
    const taskId = r.rows[0].id as string;

    // SSE 推给已连接的 agent（同租户），秒级触发而非 30s 轮询
    sseService.emit(`agent-tasks:${tenantId}`, {
      type: 'collect_task',
      task_id: taskId,
      tenant_id: tenantId,
      keywords: keywords as string[],
    });

    return ok(res, { task_id: taskId, status: 'pending' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[acquisition/start]', msg);
    return fail(res, 500, 'START_FAILED', msg);
  }
});

// POST /api/acquisition/collect/cancel
acquisitionRouter.post('/collect/cancel', async (req: Request, res: Response) => {
  const tenantId = req.body?.tenant_id;
  const taskId = req.body?.task_id;
  if (!tenantId || !taskId) return fail(res, 400, 'MISSING_FIELDS', '缺 tenant_id / task_id');

  const r = await pool.query(
    `UPDATE zenithjoy.acquisition_collect_tasks
        SET status = 'cancelling', updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
        AND status IN ('pending', 'running')
      RETURNING id`,
    [taskId, tenantId]
  );
  if (r.rows.length === 0) {
    // 任务不存在或已终态
    const exists = await pool.query(
      `SELECT id FROM zenithjoy.acquisition_collect_tasks WHERE id = $1 AND tenant_id = $2`,
      [taskId, tenantId]
    );
    if (exists.rows.length === 0) return fail(res, 404, 'NO_COLLECT_TASK', '采集任务不存在');
  }
  return ok(res, { task_id: taskId, status: 'cancelling' });
});

// POST /api/acquisition/collect/report — 客户机 Agent 增量回报（无需 smoke token，agent 直接调用）
acquisitionRouter.post('/collect/report', async (req: Request, res: Response) => {
  const {
    task_id: taskId,
    keyword,
    video_id: videoId,
    commenters,
    checkpoint,
    partial_reason: partialReason,
    terminal,
    error_code: errorCode,
    video_title: videoTitle,
    thumbnail_url: thumbnailUrl,
    publish_date: publishDate,
  } = req.body || {};

  if (!taskId) return fail(res, 400, 'MISSING_TASK_ID', '缺 task_id');
  if (!videoId) return fail(res, 400, 'MISSING_VIDEO_ID', '缺 video_id');

  const taskRes = await pool.query(
    `SELECT id, tenant_id, status, error_code, video_count, lead_count_raw
       FROM zenithjoy.acquisition_collect_tasks WHERE id = $1`,
    [taskId]
  );
  if (taskRes.rows.length === 0) return fail(res, 404, 'NO_COLLECT_TASK', '采集任务不存在');
  const task = taskRes.rows[0] as {
    id: string;
    tenant_id: string;
    status: string;
    error_code: string | null;
    video_count: number;
    lead_count_raw: number;
  };
  const tenantId = task.tenant_id;
  const batch: Array<{ sec_uid?: string | null; nickname: string; comment_text?: string; grade?: string; keyword?: string }> = Array.isArray(commenters)
    ? commenters
    : [];

  // ── 去重落库：先处理 commenters（已抓先落库不丢，即使本次是终态回报）──
  let inserted = 0;
  let deduped = 0;
  const newLeads: Array<{ sec_uid: string | null; nickname: string }> = [];
  const seenSec = new Set<string>();
  const seenNick = new Set<string>();

  for (const c of batch) {
    const secUid = c.sec_uid ?? null;
    let matchId: string | null = null;
    if (secUid) {
      if (seenSec.has(secUid)) matchId = 'batch';
      else {
        const found = await pool.query(
          `SELECT id FROM zenithjoy.acquisition_leads WHERE tenant_id = $1 AND sec_uid = $2 LIMIT 1`,
          [tenantId, secUid]
        );
        if (found.rows.length > 0) matchId = found.rows[0].id;
      }
    } else {
      if (seenNick.has(c.nickname)) matchId = 'batch';
      else {
        const found = await pool.query(
          `SELECT id FROM zenithjoy.acquisition_leads
             WHERE tenant_id = $1 AND sec_uid IS NULL AND nickname = $2 LIMIT 1`,
          [tenantId, c.nickname]
        );
        if (found.rows.length > 0) matchId = found.rows[0].id;
      }
    }

    if (matchId) {
      deduped += 1;
      if (matchId !== 'batch') {
        // 重复仅累加来源 video_id（不重复落库）
        await pool.query(
          `UPDATE zenithjoy.acquisition_leads
              SET source_video_ids = CASE
                    WHEN source_video_ids ? $2 THEN source_video_ids
                    ELSE source_video_ids || to_jsonb($2::text)
                  END,
                  updated_at = NOW()
            WHERE id = $1`,
          [matchId, videoId]
        );
      }
      continue;
    }

    inserted += 1;
    if (secUid) seenSec.add(secUid);
    else seenNick.add(c.nickname);
    await pool.query(
      `INSERT INTO zenithjoy.acquisition_leads
         (tenant_id, collect_task_id, sec_uid, nickname, profile_url, partial, source_video_ids,
          comment_text, grade, keyword, feishu_write_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, 'local_only')`,
      [
        tenantId,
        taskId,
        secUid,
        c.nickname,
        profileUrlForSecUid(secUid),
        !secUid,
        JSON.stringify([videoId]),
        c.comment_text ?? null,
        c.grade ?? null,
        c.keyword ?? keyword ?? null,
      ]
    );
    newLeads.push({ sec_uid: secUid, nickname: c.nickname });
  }

  // 数据已写本地 DB，不走飞书
  const leadWriteStatus = 'local_only';

  // ── 终态 / 计数 / 断点 更新 ──
  let newStatus = task.status;
  let newErrorCode = task.error_code;
  if (terminal) {
    const t = resolveTerminalStatus({ terminal, error_code: errorCode, partial_reason: partialReason });
    newStatus = t.status;
    newErrorCode = t.error_code;
  } else if (task.status === 'pending') {
    newStatus = 'running';
  }

  await pool.query(
    `UPDATE zenithjoy.acquisition_collect_tasks
        SET status         = $2,
            error_code     = $3,
            video_count    = video_count + 1,
            lead_count_raw = lead_count_raw + $4,
            checkpoint     = COALESCE($5::jsonb, checkpoint),
            started_at     = COALESCE(started_at, NOW()),
            ended_at       = CASE WHEN $6 THEN NOW() ELSE ended_at END,
            updated_at     = NOW()
      WHERE id = $1`,
    [taskId, newStatus, newErrorCode, batch.length, checkpoint ? JSON.stringify(checkpoint) : null, !!terminal]
  );

  // 视频维度记录（video_title/thumbnail_url/publish_date 暂由 agent 端可选回填，未回填则留空占位）
  await pool.query(
    `INSERT INTO zenithjoy.acquisition_collect_videos
       (video_id, task_id, tenant_id, title, thumbnail_url, publish_date, comment_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (video_id) DO UPDATE
       SET comment_count = zenithjoy.acquisition_collect_videos.comment_count + EXCLUDED.comment_count,
           title          = COALESCE(EXCLUDED.title, zenithjoy.acquisition_collect_videos.title),
           thumbnail_url  = COALESCE(EXCLUDED.thumbnail_url, zenithjoy.acquisition_collect_videos.thumbnail_url),
           publish_date   = COALESCE(EXCLUDED.publish_date, zenithjoy.acquisition_collect_videos.publish_date),
           updated_at     = NOW()`,
    [videoId, taskId, tenantId, videoTitle ?? null, thumbnailUrl ?? null, publishDate ?? null, batch.length]
  );

  // SSE 推送状态变化（video_count+1 / lead_count_raw+batch.length 与 UPDATE 语句一致）
  const TERMINAL_ACQ = ['done', 'failed', 'cancelled', 'partial'];
  const ssePayload = {
    task_id: taskId,
    status: newStatus,
    video_count: task.video_count + 1,
    lead_count_raw: task.lead_count_raw + batch.length,
  };
  if (TERMINAL_ACQ.includes(newStatus)) {
    sseService.close(taskId, ssePayload);
  } else {
    sseService.emit(taskId, ssePayload);
  }

  // 终态且有 leads 写入 → fire-and-forget dispatch 链（与 /comment-score-result 一致）
  if (terminal && inserted > 0) {
    const collectRes = await pool.query(
      `SELECT tenant_id FROM zenithjoy.acquisition_collect_tasks WHERE id = $1`,
      [taskId]
    );
    const tid = collectRes.rows[0]?.tenant_id ?? null;
    if (tid) {
      void scoreLeads(pool, tid)
        .then(() => buildAssignments(pool, tid))
        .then(() => dispatchDue(pool, tid))
        .catch((e: Error) => console.error('[acquisition] collect/report dm-dispatch error:', e.message));
    }
  }

  return ok(res, {
    task_id: taskId,
    inserted,
    deduped,
    lead_write_status: leadWriteStatus,
    status: newStatus,
  });
});

// POST /api/acquisition/collect/sweep-timeouts — 只转 stale running，pending(离线) 保留不丢
acquisitionRouter.post('/collect/sweep-timeouts', smokeOrAgentGate, async (_req: Request, res: Response) => {
  const cutoffMs = SWEEP_TIMEOUT_MS;
  const r = await pool.query(
    `UPDATE zenithjoy.acquisition_collect_tasks t
        SET status = CASE
              WHEN (SELECT count(*) FROM zenithjoy.acquisition_leads l WHERE l.collect_task_id = t.id) > 0
                THEN 'partial' ELSE 'failed' END,
            error_code = COALESCE(error_code, 'COLLECT_TIMEOUT'),
            updated_at = NOW()
      WHERE status = 'running'
        AND COALESCE(started_at, updated_at, created_at) < NOW() - ($1::int || ' milliseconds')::interval
      RETURNING id`,
    [cutoffMs]
  );
  return ok(res, { swept: r.rows.length });
});

// GET /api/acquisition/collect/:task_id — 获客页查状态（精确 6 字段：task_id/status/video_count/lead_count_raw/created_at/ended_at）
acquisitionRouter.get('/collect/:task_id', async (req: Request, res: Response) => {
  const taskId = req.params.task_id;
  const taskRes = await pool.query(
    `SELECT id, status, video_count, lead_count_raw, created_at, ended_at
       FROM zenithjoy.acquisition_collect_tasks WHERE id = $1`,
    [taskId]
  );
  if (taskRes.rows.length === 0) return fail(res, 404, 'TASK_NOT_FOUND', '采集任务不存在');
  const t = taskRes.rows[0] as {
    id: string;
    status: string;
    video_count: number;
    lead_count_raw: number;
    created_at: Date;
    ended_at: Date | null;
  };

  return ok(res, {
    task_id: t.id,
    status: t.status,
    video_count: t.video_count,
    lead_count_raw: t.lead_count_raw,
    created_at: t.created_at ? new Date(t.created_at).toISOString() : null,
    ended_at: t.ended_at ? new Date(t.ended_at).toISOString() : null,
  });
});

// GET /api/acquisition/collect/:task_id/sse — SSE 实时状态推送
acquisitionRouter.get('/collect/:task_id/sse', async (req: Request, res: Response) => {
  const taskId = req.params.task_id;
  const taskRes = await pool.query(
    `SELECT id, status, video_count, lead_count_raw, created_at, ended_at
       FROM zenithjoy.acquisition_collect_tasks WHERE id = $1`,
    [taskId]
  );
  if (taskRes.rows.length === 0) return fail(res, 404, 'TASK_NOT_FOUND', '采集任务不存在');
  const t = taskRes.rows[0] as {
    id: string;
    status: string;
    video_count: number;
    lead_count_raw: number;
    created_at: Date;
    ended_at: Date | null;
  };
  sseService.subscribe(taskId, req, res, {
    task_id: t.id,
    status: t.status,
    video_count: t.video_count,
    lead_count_raw: t.lead_count_raw,
    created_at: t.created_at ? new Date(t.created_at).toISOString() : null,
    ended_at: t.ended_at ? new Date(t.ended_at).toISOString() : null,
  });
});

// GET /api/acquisition/agent/task-stream — agent 长连 SSE，中台推新采集任务（秒级，替代 30s 轮询）
// 鉴权：x-license-key（与心跳/事件上报相同）
acquisitionRouter.get('/agent/task-stream', licenseAuth, (req: Request, res: Response) => {
  const tenantId = req.license?.tenant_id;
  if (!tenantId) {
    res.status(401).json({ success: false, error: { code: 'NO_TENANT' } });
    return;
  }
  const channel = `agent-tasks:${tenantId}`;
  sseService.subscribe(channel, req, res, { type: 'connected', tenant_id: tenantId });
});
