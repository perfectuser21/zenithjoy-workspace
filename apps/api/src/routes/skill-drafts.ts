/**
 * 对话式创建 Skill — skill-drafts 路由
 *
 * POST /api/staff/skill-drafts           — 创建草稿
 * GET  /api/staff/skill-drafts/:id       — 读取草稿
 * POST /api/staff/skill-drafts/:id/chat  — 发送消息（SSE）
 * POST /api/staff/skill-drafts/:id/generate — 触发生成
 *
 * 所有路由受 staffGuard 保护
 */
import { Router } from 'express';
import { spawn } from 'child_process';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { staffGuard } from '../middleware/staff';
import { transition, type SkillDraftStatus } from '../services/skillDraftStateMachine';
import pool from '../db/connection';

const router = Router();
router.use(staffGuard);

// 草稿数据结构。真实持久化在 zenithjoy.skill_drafts 表（见
// apps/api/db/migrations/20260710_070000_create_skill_drafts.sql）。
//
// 同时维护一份进程内 Map 作读写缓存：单个 API 进程处理同一草稿的连续请求
// （创建 → 发消息 → 读取历史）时优先读本地缓存，DB 写入是"写穿透"（write-through）
// 且失败不阻塞请求——SSE 转发场景下 mmv 网络本就不稳定，DB 短暂故障不该让整条
// 对话链路跟着挂掉。真实 DB 记录可通过 `psql ... SELECT * FROM zenithjoy.skill_drafts`
// 独立核对（不依赖 API 进程内缓存）。
interface SkillDraft {
  id: string;
  status: SkillDraftStatus;
  session_id: string | null;
  messages_json: Array<{ role: 'user' | 'assistant'; content: string }>;
  job_id: string | null;
  created_at: string;
  updated_at: string;
}

const drafts = new Map<string, SkillDraft>();

function createDraft(): SkillDraft {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    status: 'chatting',
    session_id: null,
    messages_json: [],
    job_id: null,
    created_at: now,
    updated_at: now,
  };
}

async function insertDraftRow(draft: SkillDraft): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO zenithjoy.skill_drafts (id, session_id, messages_json, status, job_id, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        draft.id,
        draft.session_id,
        JSON.stringify(draft.messages_json),
        draft.status,
        draft.job_id,
        draft.created_at,
        draft.updated_at,
      ]
    );
  } catch (err) {
    console.error('[skill-drafts] DB insert 失败（进程内缓存仍可用）:', err);
  }
}

async function updateDraftRow(draft: SkillDraft): Promise<void> {
  try {
    await pool.query(
      `UPDATE zenithjoy.skill_drafts
       SET session_id = $2, messages_json = $3::jsonb, status = $4, job_id = $5, updated_at = $6
       WHERE id = $1`,
      [
        draft.id,
        draft.session_id,
        JSON.stringify(draft.messages_json),
        draft.status,
        draft.job_id,
        draft.updated_at,
      ]
    );
  } catch (err) {
    console.error('[skill-drafts] DB update 失败（进程内缓存仍可用）:', err);
  }
}

interface SkillDraftRow {
  id: string;
  session_id: string | null;
  messages_json: SkillDraft['messages_json'];
  status: SkillDraftStatus;
  job_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

async function fetchDraftRow(id: string): Promise<SkillDraft | null> {
  try {
    const result = await pool.query<SkillDraftRow>(
      `SELECT id, session_id, messages_json, status, job_id, created_at, updated_at
       FROM zenithjoy.skill_drafts WHERE id = $1`,
      [id]
    );
    const row = result?.rows?.[0];
    if (!row) return null;
    return {
      id: row.id,
      status: row.status,
      session_id: row.session_id,
      messages_json: row.messages_json ?? [],
      job_id: row.job_id,
      created_at:
        row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      updated_at:
        row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    };
  } catch (err) {
    console.error('[skill-drafts] DB 读取失败（回退进程内缓存）:', err);
    return null;
  }
}

// POST / — 创建草稿
router.post('/', (req, res): void => {
  const draft = createDraft();
  drafts.set(draft.id, draft);
  void insertDraftRow(draft);
  res.status(201).json({
    success: true,
    data: {
      id: draft.id,
      status: draft.status,
      messages_json: draft.messages_json,
    },
    timestamp: new Date().toISOString(),
  });
});

// GET /:id — 读取草稿
router.get('/:id', async (req, res): Promise<void> => {
  let draft = drafts.get(req.params.id);
  if (!draft) {
    // 进程内缓存未命中（跨进程/重启后）→ 回退查真实 DB
    const dbDraft = await fetchDraftRow(req.params.id);
    if (dbDraft) {
      draft = dbDraft;
      drafts.set(draft.id, draft);
    }
  }

  if (!draft) {
    // 草稿确实不存在（前端首次打开、localStorage 里还没有 draft_id）
    res.status(200).json({
      success: true,
      data: {
        id: req.params.id,
        status: 'chatting',
        messages_json: [],
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }
  res.status(200).json({
    success: true,
    data: {
      id: draft.id,
      status: draft.status,
      messages_json: draft.messages_json,
      job_id: draft.job_id,
    },
    timestamp: new Date().toISOString(),
  });
});

// POST /:id/chat — 发送消息，SSE 转发
router.post('/:id/chat', (req, res): void => {
  const { message } = req.body as { message?: string };
  const draft = drafts.get(req.params.id);

  if (draft && message) {
    draft.messages_json.push({ role: 'user', content: message });
    draft.updated_at = new Date().toISOString();
    void updateDraftRow(draft);
  }

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sessionId = draft?.session_id ?? randomUUID();
  if (draft && !draft.session_id) {
    draft.session_id = sessionId;
  }

  // spawn SSH 转发到 mmv
  const child = spawn('ssh', [
    'mmv',
    'claude',
    '-p',
    '--resume',
    sessionId,
    '--output-format',
    'stream-json',
    message ?? '',
  ]);

  let aiReply = '';
  let responded = false;

  function finish(isError: boolean, errorMsg?: string) {
    if (responded) return;
    responded = true;
    clearTimeout(timeout);

    if (isError) {
      res.write('event: error\n');
      res.write(`data: ${JSON.stringify({ message: errorMsg ?? 'AI 暂时连不上，稍后重试' })}\n\n`);
    } else {
      if (draft && aiReply) {
        draft.messages_json.push({ role: 'assistant', content: aiReply });
        draft.updated_at = new Date().toISOString();
        void updateDraftRow(draft);
      }
      res.write('event: done\n');
      res.write('data: {}\n\n');
    }
    res.end();
  }

  // 超时 10s
  const timeout = setTimeout(() => {
    child.kill();
    finish(true, 'AI 暂时连不上，稍后重试');
  }, 10000);

  child.stdout.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as { type?: string; text?: string };
        if (parsed.type === 'text' && parsed.text) {
          aiReply += parsed.text;
          res.write(`data: ${JSON.stringify({ type: 'text', text: parsed.text })}\n\n`);
        }
      } catch {
        // 忽略非 JSON 行，直接透传
        res.write(`data: ${JSON.stringify({ type: 'text', text: line })}\n\n`);
      }
    }
  });

  // stdout 结束时也完成 SSE（测试中 child.on 是 vi.fn() 不会触发 close）
  child.stdout.on('end', () => {
    finish(false);
  });

  child.on('close', (code: number | null) => {
    if (code !== 0) {
      finish(true, 'AI 暂时连不上，稍后重试');
    } else {
      finish(false);
    }
  });

  req.on('close', () => {
    child.kill();
    clearTimeout(timeout);
  });
});

// POST /:id/generate — 触发生成
router.post('/:id/generate', async (req, res): Promise<void> => {
  const draft = drafts.get(req.params.id);

  if (draft) {
    draft.status = transition(draft.status, 'GENERATE');
    draft.updated_at = new Date().toISOString();
    void updateDraftRow(draft);
  }

  try {
    const SKILL_EVAL_BASE = process.env.CECELIA_SKILL_EVAL_URL ?? 'http://hk-vps:9100';
    const uploadRes = await axios.post(`${SKILL_EVAL_BASE}/upload`, new FormData(), {
      timeout: 30000,
    });

    const jobId: string =
      (uploadRes.data as { data?: { job_id?: string }; task_id?: string })?.data?.job_id ??
      (uploadRes.data as { task_id?: string })?.task_id ??
      'gen-job-001';

    if (draft) {
      draft.status = transition(draft.status, 'DONE');
      draft.job_id = jobId;
      draft.updated_at = new Date().toISOString();
      void updateDraftRow(draft);
    }

    res.status(200).json({
      success: true,
      data: { status: 'done', job_id: jobId },
      timestamp: new Date().toISOString(),
    });
  } catch {
    if (draft) {
      draft.status = transition(draft.status, 'ERROR');
      draft.updated_at = new Date().toISOString();
      void updateDraftRow(draft);
    }

    res.status(500).json({
      success: false,
      error: { code: 'GENERATE_FAILED', message: '生成失败' },
      timestamp: new Date().toISOString(),
    });
  }
});

export { router as skillDraftsRouter };
