/**
 * 对话式创建 Skill — skill-drafts 路由
 *
 * POST /api/staff/skill-drafts                    — 创建草稿
 * GET  /api/staff/skill-drafts/:id               — 读取草稿（含软超时检测）
 * POST /api/staff/skill-drafts/:id/chat          — 发送消息（SSE）
 * POST /api/staff/skill-drafts/:id/generate      — 触发后台长跑生成（detached 子进程）
 * POST /api/staff/skill-drafts/:id/answer        — 在 needs_input 状态提交答案
 *
 * POST /internal/skill-drafts/:id/callback       — 内部回调（子进程完成后通知，无 staffGuard）
 *
 * /generate 端点改造（sprints/07101942-skill-create-longrun）：
 *   - 立即返回 { status: "running" }，不阻塞 HTTP 响应
 *   - 子进程 detached + unref()，父进程退出后子进程继续运行
 *   - 子进程完成后 POST /internal/skill-drafts/:id/callback 通知终态
 *   - 前端每 8 秒轮询 GET /:id 直到终态
 *
 * 所有 /api/staff/* 路由受 staffGuard 保护；/internal/* 无 staffGuard。
 */
import { Router } from 'express';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { staffGuard } from '../middleware/staff';
import {
  transition,
  GENERATE_BLOCKED,
  type SkillDraftStatus,
} from '../services/skillDraftStateMachine';
import pool from '../db/connection';

const SKILL_CREATE_SYSTEM_PROMPT =
  '你现在的唯一任务是通过对话帮助 ZenithJoy 员工创建一个新的 Claude Code skill——不要引导员工去做其他类型的任务，比如 Sprint、文档、页面，用户来这个对话就是为了做一个 skill。' +
  '规则：第一，先通过提问搞清楚这个 skill 要解决什么场景、输入输出是什么、触发条件和边界是什么，一次问一两个具体问题，不要问"你想创建什么"这种通用问题，用户已经说了要做 skill，直接进入需求细化；' +
  '第二，每轮追问聚焦在这个 skill 的设计细节上；第三，当员工说"生成吧"时，调用 skill-creator 这个 skill 工具，用已经澄清的需求走完整创建流程，产出一个完整的 skill 目录并打包成 zip，最后输出 zip 的绝对路径。' +
  '注意：你的回复内容里不要出现英文圆括号、方括号、星号、反引号这类 shell 特殊符号，一律用中文全角标点或直接不用括号。';

function shellQuoteArg(s: string): string {
  return "'" + s.split("'").join("'\\''") + "'";
}

// ─── 草稿数据结构 ─────────────────────────────────────────────────────────────

interface SkillDraft {
  id: string;
  status: SkillDraftStatus;
  session_id: string | null;
  messages_json: Array<{ role: 'user' | 'assistant'; content: string }>;
  job_id: string | null;
  callback_token: string | null;
  pending_question: string | null;
  result_json: Record<string, unknown> | null;
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
    callback_token: null,
    pending_question: null,
    result_json: null,
    created_at: now,
    updated_at: now,
  };
}

// ─── DB 操作 ──────────────────────────────────────────────────────────────────

async function insertDraftRow(draft: SkillDraft): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO zenithjoy.skill_drafts
         (id, session_id, messages_json, status, job_id, callback_token, pending_question, result_json, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8::jsonb, $9, $10)
       ON CONFLICT (id) DO NOTHING`,
      [
        draft.id,
        draft.session_id,
        JSON.stringify(draft.messages_json),
        draft.status,
        draft.job_id,
        draft.callback_token,
        draft.pending_question,
        draft.result_json ? JSON.stringify(draft.result_json) : null,
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
       SET session_id = $2, messages_json = $3::jsonb, status = $4, job_id = $5,
           callback_token = $6, pending_question = $7, result_json = $8::jsonb, updated_at = $9
       WHERE id = $1`,
      [
        draft.id,
        draft.session_id,
        JSON.stringify(draft.messages_json),
        draft.status,
        draft.job_id,
        draft.callback_token,
        draft.pending_question,
        draft.result_json ? JSON.stringify(draft.result_json) : null,
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
  callback_token: string | null;
  pending_question: string | null;
  result_json: Record<string, unknown> | null;
  created_at: string | Date;
  updated_at: string | Date;
}

async function fetchDraftRow(id: string): Promise<SkillDraft | null> {
  try {
    const result = await pool.query<SkillDraftRow>(
      `SELECT id, session_id, messages_json, status, job_id,
              callback_token, pending_question, result_json,
              created_at, updated_at
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
      callback_token: row.callback_token,
      pending_question: row.pending_question,
      result_json: row.result_json,
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

// ─── 软超时检测（2 小时）────────────────────────────────────────────────────────

const SOFT_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 小时

function isTimedOut(draft: SkillDraft): boolean {
  if (draft.status !== 'running') return false;
  const updatedAt = new Date(draft.updated_at).getTime();
  return Date.now() - updatedAt > SOFT_TIMEOUT_MS;
}

// ─── 后台子进程 spawn（detached + unref）──────────────────────────────────────

function spawnSkillGeneratorDetached(draft: SkillDraft): void {
  const claudeAccountDir =
    process.env.MMV_CLAUDE_ACCOUNT_DIR ?? '/Users/administrator/.claude-account1';
  const callbackBase =
    process.env.INTERNAL_API_BASE ?? 'http://localhost:3001';

  // 生成指令：调用 skill-creator，产出 zip，然后 POST callback
  const genInstruction =
    '请调用 skill-creator 这个 skill 工具，完成我们刚才这段对话里已经聊清楚的 skill 创建。' +
    '创建完成后，把生成的 skill 目录用 zip 命令打包成一个 zip 文件，放在 /tmp 目录下，' +
    '文件名用这个 skill 的英文短横线命名（比如 smart-cs.zip）。' +
    `最后用 curl 调用内部回调：curl -s -X POST ${callbackBase}/internal/skill-drafts/${draft.id}/callback ` +
    `-H 'Content-Type: application/json' ` +
    `-d '{"token":"${draft.callback_token}","event":"done","zip_path":"<ZIP_PATH>"}'。` +
    '如果遇到需要员工决策的问题，调用：' +
    `curl -s -X POST ${callbackBase}/internal/skill-drafts/${draft.id}/callback ` +
    `-H 'Content-Type: application/json' ` +
    `-d '{"token":"${draft.callback_token}","event":"needs_input","question":"<QUESTION>"}'。` +
    '出错时调用：' +
    `curl -s -X POST ${callbackBase}/internal/skill-drafts/${draft.id}/callback ` +
    `-H 'Content-Type: application/json' ` +
    `-d '{"token":"${draft.callback_token}","event":"error","error_message":"<ERROR>"}'。`;

  const resumeArgs = draft.session_id ? ['--resume', draft.session_id] : [];
  const remoteCommand = [
    `CLAUDE_CONFIG_DIR=${claudeAccountDir}`,
    'claude',
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--append-system-prompt',
    shellQuoteArg(SKILL_CREATE_SYSTEM_PROMPT),
    ...resumeArgs,
    shellQuoteArg(genInstruction),
  ].join(' ');

  const logFile = `/tmp/skill-gen-${draft.id}.log`;
  const child = spawn('ssh', ['mmv', remoteCommand], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // stdout/stderr redirect 到日志文件（N-04 可观测）
  // 仅在真实可读流（含 pipe 方法）时才 pipe，避免 mock/测试环境 EventEmitter 报错
  if (child.stdout && typeof (child.stdout as { pipe?: unknown }).pipe === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    (child.stdout as NodeJS.ReadableStream).pipe(logStream);
    if (child.stderr && typeof (child.stderr as { pipe?: unknown }).pipe === 'function') {
      (child.stderr as NodeJS.ReadableStream).pipe(logStream);
    }
  }

  child.unref();
}

// ─── Staff Router（受 staffGuard 保护）──────────────────────────────────────

const router = Router();
router.use(staffGuard);

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
      pending_question: draft.pending_question,
      result_json: draft.result_json,
    },
    timestamp: new Date().toISOString(),
  });
});

// GET /:id — 读取草稿（含软超时检测）
router.get('/:id', async (req, res): Promise<void> => {
  let draft = drafts.get(req.params.id);
  if (!draft) {
    const dbDraft = await fetchDraftRow(req.params.id);
    if (dbDraft) {
      draft = dbDraft;
      drafts.set(draft.id, draft);
    }
  }

  if (!draft) {
    res.status(200).json({
      success: true,
      data: {
        id: req.params.id,
        status: 'chatting',
        messages_json: [],
        pending_question: null,
        result_json: null,
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // 软超时检测（延迟检测，不主动扫描）
  if (isTimedOut(draft)) {
    draft.status = 'error';
    draft.result_json = { error_message: '生成超时（超过2小时未完成），请重新尝试' };
    draft.updated_at = new Date().toISOString();
    void updateDraftRow(draft);
  }

  res.status(200).json({
    success: true,
    data: {
      id: draft.id,
      status: draft.status,
      messages_json: draft.messages_json,
      job_id: draft.job_id,
      callback_token: draft.callback_token,
      pending_question: draft.pending_question,
      result_json: draft.result_json,
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

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const claudeAccountDir =
    process.env.MMV_CLAUDE_ACCOUNT_DIR ?? '/Users/administrator/.claude-account1';

  let responded = false;
  let retried = false;

  function finish(isError: boolean, errorMsg?: string) {
    if (responded) return;
    responded = true;
    if (isError) {
      res.write('event: error\n');
      res.write(`data: ${JSON.stringify({ message: errorMsg ?? 'AI 暂时连不上，稍后重试' })}\n\n`);
    } else {
      res.write('event: done\n');
      res.write('data: {}\n\n');
    }
    res.end();
  }

  function attemptChat(useResume: boolean): void {
    const didResume = Boolean(useResume && draft?.session_id);
    const shellQuote = (s: string): string => "'" + s.split("'").join("'\\''") + "'";
    const remoteCommand = [
      `CLAUDE_CONFIG_DIR=${claudeAccountDir}`,
      'claude',
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--append-system-prompt',
      shellQuote(SKILL_CREATE_SYSTEM_PROMPT),
      ...(didResume ? ['--resume', draft!.session_id!] : []),
      shellQuote(message ?? ''),
    ].join(' ');

    const child = spawn('ssh', ['mmv', remoteCommand]);
    child.stdin?.end();

    let aiReply = '';
    let sawResultError = false;
    let resultErrorMsg = '';
    let sawSessionNotFound = false;
    let attemptCompleted = false;

    const timeout = setTimeout(() => {
      child.kill();
      finish(true, 'AI 暂时连不上，稍后重试');
    }, 60000);

    function finishAttempt(isError: boolean, errorMsg?: string) {
      if (attemptCompleted) return;
      attemptCompleted = true;
      clearTimeout(timeout);
      if (isError && didResume && sawSessionNotFound && !retried) {
        retried = true;
        if (draft) draft.session_id = null;
        attemptChat(false);
        return;
      }
      if (!isError && draft && aiReply) {
        draft.messages_json.push({ role: 'assistant', content: aiReply });
        draft.updated_at = new Date().toISOString();
        void updateDraftRow(draft);
      }
      finish(isError, errorMsg);
    }

    child.stdout.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        let parsed: {
          type?: string;
          session_id?: string;
          is_error?: boolean;
          errors?: string[];
          result?: string;
          message?: { content?: Array<{ type?: string; text?: string }> };
        };
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (parsed.session_id && draft && !draft.session_id) {
          draft.session_id = parsed.session_id;
        }
        if (parsed.type === 'assistant' && Array.isArray(parsed.message?.content)) {
          for (const block of parsed.message.content) {
            if (block.type === 'text' && block.text) {
              aiReply += block.text;
              res.write(`data: ${JSON.stringify({ type: 'text', text: block.text })}\n\n`);
            }
          }
        }
        if (parsed.type === 'result' && parsed.is_error) {
          sawResultError = true;
          resultErrorMsg = parsed.errors?.[0] ?? parsed.result ?? 'AI 暂时连不上，稍后重试';
          if (/No conversation found/i.test(resultErrorMsg)) {
            sawSessionNotFound = true;
          }
        }
      }
    });

    child.stdout.on('end', () => {
      finishAttempt(sawResultError, resultErrorMsg);
    });

    child.on('close', (code: number | null) => {
      if (sawResultError) {
        finishAttempt(true, resultErrorMsg);
      } else if (code !== 0 && !aiReply) {
        finishAttempt(true, 'AI 暂时连不上，稍后重试');
      } else {
        finishAttempt(false);
      }
    });

    res.on('close', () => {
      if (!res.writableEnded) {
        child.kill();
        clearTimeout(timeout);
      }
    });
  }

  attemptChat(true);
});

// POST /:id/generate — 触发后台长跑生成（立即返回 running，子进程 detached）
router.post('/:id/generate', async (req, res): Promise<void> => {
  let draft = drafts.get(req.params.id);
  if (!draft) {
    const dbDraft = await fetchDraftRow(req.params.id);
    if (dbDraft) {
      draft = dbDraft;
      drafts.set(draft.id, draft);
    }
  }

  if (!draft) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: '草稿不存在' },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // 互斥锁：running/needs_input/done 状态拒绝重复触发（I-1, I-2, I-5）
  if (GENERATE_BLOCKED.has(draft.status)) {
    res.status(409).json({
      success: false,
      error: {
        code: 'CONFLICT',
        message: `当前状态 ${draft.status} 不允许触发生成`,
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // 生成新 callback_token（每次 generate 都刷新，保证单次绑定）
  draft.callback_token = randomUUID();
  draft.status = transition(draft.status, 'GENERATE');
  draft.pending_question = null;
  draft.updated_at = new Date().toISOString();
  void updateDraftRow(draft);

  // 后台 spawn detached 子进程（不阻塞 HTTP 响应）
  spawnSkillGeneratorDetached(draft);

  res.status(200).json({
    success: true,
    data: { status: 'running' },
    timestamp: new Date().toISOString(),
  });
});

// POST /:id/answer — needs_input 状态下接收员工答案，重新 spawn
router.post('/:id/answer', async (req, res): Promise<void> => {
  let draft = drafts.get(req.params.id);
  if (!draft) {
    const dbDraft = await fetchDraftRow(req.params.id);
    if (dbDraft) {
      draft = dbDraft;
      drafts.set(draft.id, draft);
    }
  }

  if (!draft) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: '草稿不存在' },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (draft.status !== 'needs_input') {
    res.status(409).json({
      success: false,
      error: {
        code: 'CONFLICT',
        message: `当前状态 ${draft.status} 不允许提交答案（只有 needs_input 状态可以）`,
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const { answer } = req.body as { answer?: string };
  if (answer) {
    draft.messages_json.push({ role: 'user', content: answer });
  }

  // 生成新 callback_token（重新 spawn 后 token 需刷新）
  draft.callback_token = randomUUID();
  draft.status = transition(draft.status, 'ANSWER');
  draft.pending_question = null;
  draft.updated_at = new Date().toISOString();
  void updateDraftRow(draft);

  // 重新 spawn 子进程继续生成
  spawnSkillGeneratorDetached(draft);

  res.status(200).json({
    success: true,
    data: { status: 'running' },
    timestamp: new Date().toISOString(),
  });
});

export { router as skillDraftsRouter };

// ─── Internal Router（无 staffGuard，供子进程回调）──────────────────────────

export const skillDraftsInternalRouter = Router();

// POST /internal/skill-drafts/:id/callback — 子进程完成后通知终态
skillDraftsInternalRouter.post('/:id/callback', async (req, res): Promise<void> => {
  const { token, event, zip_path, question, error_message } = req.body as {
    token?: string;
    event?: string;
    zip_path?: string;
    question?: string;
    error_message?: string;
  };

  let draft = drafts.get(req.params.id);
  if (!draft) {
    const dbDraft = await fetchDraftRow(req.params.id);
    if (dbDraft) {
      draft = dbDraft;
      drafts.set(draft.id, draft);
    }
  }

  if (!draft) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: '草稿不存在' },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // token 不匹配（包括：draft 无 token、token 已消费、token 值不同）
  if (!token || !draft.callback_token || draft.callback_token !== token) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'callback_token 不匹配或已过期' },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // done 终态封闭：任何 callback 均拒绝（I-5）
  if (draft.status === 'done') {
    res.status(400).json({
      success: false,
      error: { code: 'TERMINAL_STATE', message: '草稿已处于终态，无法更新' },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // token 单次绑定：消费后清空（I-9）
  draft.callback_token = null;

  switch (event) {
    case 'done':
      draft.status = transition(draft.status, 'DONE');
      draft.result_json = { zip_path: zip_path ?? '' };
      break;
    case 'needs_input':
      draft.status = transition(draft.status, 'NEEDS_INPUT');
      draft.pending_question = question ?? null;
      break;
    case 'error':
      draft.status = transition(draft.status, 'ERROR');
      draft.result_json = { error_message: error_message ?? '生成失败' };
      break;
    default:
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_EVENT', message: `未知 event: ${String(event)}` },
        timestamp: new Date().toISOString(),
      });
      return;
  }

  draft.updated_at = new Date().toISOString();
  void updateDraftRow(draft);

  res.status(200).json({
    success: true,
    data: { status: draft.status },
    timestamp: new Date().toISOString(),
  });
});
