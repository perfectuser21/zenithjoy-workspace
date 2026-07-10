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

  const claudeAccountDir = process.env.MMV_CLAUDE_ACCOUNT_DIR ?? '/Users/administrator/.claude-account1';

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

  // claude -p --resume 只能续接已存在的会话，不能拿一个自造的新 UUID 起会话
  // （bug: 之前这里对每个新草稿的第一条消息都生成一个随机 UUID 硬塞进 --resume，
  // 但 claude CLI 侧根本不存在这个会话 → 每次首条消息都以
  // "No conversation found with session ID: ..." 报错收场）。
  // 有真实 session_id（此前 claude 回过至少一轮）才传 --resume；首条消息不传，
  // 让 claude 自己开一个新会话，session_id 从流里的事件读回来存起来。
  //
  // bug（生产实测，PR#1213合并前创建的旧草稿复现）：即便这次调用逻辑对了，
  // draft.session_id 也可能是"死会话"——claude 侧的会话可能已过期/被清理，
  // 或者（历史遗留）是旧版本代码曾经无脑塞进去的假 UUID。--resume 一个死会话
  // 会报 "No conversation found"，此时不该直接报错甩给员工，而应该清掉这个
  // 坏掉的 session_id、当作全新会话重试一次（员工的消息不会丢，只是话题
  // 断了要重新起会话，比"直接报错"体验好得多，也不需要人工介入清库）。
  function attemptChat(useResume: boolean): void {
    const didResume = Boolean(useResume && draft?.session_id);
    const claudeArgs = ['claude', '-p', '--output-format', 'stream-json', '--verbose'];
    if (didResume) {
      claudeArgs.push('--resume', draft!.session_id!);
    }
    claudeArgs.push(message ?? '');

    // spawn SSH 转发到 mmv（CLAUDE_CONFIG_DIR 指向账号池，不用本机默认可能过期的账号）
    const child = spawn('ssh', ['mmv', `CLAUDE_CONFIG_DIR=${claudeAccountDir}`, ...claudeArgs]);
    // 不喂 stdin 时 claude CLI 会白等 3s 探测有没有管道输入才继续——主动关闭省掉这 3s
    child.stdin?.end();

    let aiReply = '';
    let sawResultError = false;
    let resultErrorMsg = '';
    let sawSessionNotFound = false;

    // 超时 60s（bug: 原来是10s——生产实测单次 claude -p 调用仅"首字节"就要
    // 9秒+（每次都带全套 skill 上下文注入，input_tokens 1.7万+起步），10秒硬超时
    // 几乎必然在正文吐出来之前就把子进程杀掉，导致员工发消息永远收不到回复）
    const timeout = setTimeout(() => {
      child.kill();
      finish(true, 'AI 暂时连不上，稍后重试');
    }, 60000);

    function finishAttempt(isError: boolean, errorMsg?: string) {
      clearTimeout(timeout);
      if (isError && didResume && sawSessionNotFound && !retried) {
        // 死会话兜底：清掉坏session_id，当全新会话重试一次（不算给员工的最终错误）
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
          // 非 JSON 行，忽略（真实 stream-json 不应出现，容错跳过而非当文本转发）
          continue;
        }

        // 真实 claude CLI 每类事件都带 session_id；第一次拿到就存下来，
        // 后续这个草稿的消息才能真的 --resume 到同一个会话
        if (parsed.session_id && draft && !draft.session_id) {
          draft.session_id = parsed.session_id;
        }

        // 真实 stream-json 的文字回复是嵌套结构：
        // {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
        // （之前代码错认成扁平的 {"type":"text","text":"..."}，永远匹配不上）
        if (parsed.type === 'assistant' && Array.isArray(parsed.message?.content)) {
          for (const block of parsed.message.content) {
            if (block.type === 'text' && block.text) {
              aiReply += block.text;
              res.write(`data: ${JSON.stringify({ type: 'text', text: block.text })}\n\n`);
            }
          }
        }

        // 终局 result 事件：is_error=true 才是真失败（认证过期/会话找不到等），
        // 不能只靠进程 exit code——exit code 判定和 stdout 'end' 之间有竞态，
        // exit code 非0时 stdout 'end' 经常先跑完，把真错误误判成"成功但空回复"
        if (parsed.type === 'result' && parsed.is_error) {
          sawResultError = true;
          resultErrorMsg = parsed.errors?.[0] ?? parsed.result ?? 'AI 暂时连不上，稍后重试';
          if (/No conversation found/i.test(resultErrorMsg)) {
            sawSessionNotFound = true;
          }
        }
      }
    });

    // stdout 结束时收尾（测试中 child.on 是 vi.fn() 不会触发 close）
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

    // bug: req.on('close') 在真实 HTTP 连接下几乎瞬间触发（POST body 读完就触发，
    // 不代表客户端断线），会在子进程还没来得及输出任何内容时就把它杀掉——
    // supertest 的假 req/res 对象从未真实触发过这个 timing，所以合同测试全绿
    // 但真实环境下每次聊天都被这个"假断线检测"秒杀。改用 res.writableEnded 判断：
    // 只有响应还没写完就真的 close 了，才是员工关浏览器/换页这种真实断线场景。
    res.on('close', () => {
      if (!res.writableEnded) {
        child.kill();
        clearTimeout(timeout);
      }
    });
  }

  attemptChat(true);
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
