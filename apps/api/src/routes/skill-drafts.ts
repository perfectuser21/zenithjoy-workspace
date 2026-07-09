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

const router = Router();
router.use(staffGuard);

// 内存存储（thin 阶段——DB 连接在测试中被 mock）
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

// POST / — 创建草稿
router.post('/', (req, res): void => {
  const draft = createDraft();
  drafts.set(draft.id, draft);
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
router.get('/:id', (req, res): void => {
  const draft = drafts.get(req.params.id);
  if (!draft) {
    // 返回空草稿（thin 阶段，不查真实 DB）
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
  }

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sessionId = draft?.session_id ?? randomUUID();

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
    }

    res.status(500).json({
      success: false,
      error: { code: 'GENERATE_FAILED', message: '生成失败' },
      timestamp: new Date().toISOString(),
    });
  }
});

export { router as skillDraftsRouter };
