/**
 * /api/wechat/* — Path 4 微信个人号端点（ws1 thin → ws3 加厚私聊草稿）
 *
 * 4 个端点：
 *   - POST /api/wechat/qr-bind         {platform, agent_id} → {task_id, status}
 *   - POST /api/wechat/draft-review-poll  → {polled, dispatched}
 *   - GET  /api/wechat/draft-review-poll?task_id=X  → 单 task 状态 / 404
 *   - POST /api/wechat/scheduler-tick  {force?, customer?} → {generated, skipped}
 *   - POST /api/wechat/draft-generate  {sender, wechat_id, content} → {task_id, draft_id, status}（ws3）
 *
 * ws1 阶段端点行为是 thin（qr-bind / poll / tick）。
 * ws3 加厚 /draft-generate：DeepSeek 私聊草稿 + 写飞书互动记录 + DB pending_review。
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import pool from '../db/connection';
import { generateChatDraft, generateMomentDraft } from '../services/wechat-draft';
import { pollOnce } from '../services/feishu-poll';
import {
  getupdates,
  sendmessage,
  getBotQrcode,
  pollQrStatus,
  type ILinkSession,
  type SendMessageInput,
} from '../services/ilink-client';
import { runPollerOnce } from '../services/ilink-poller';
import { callOpenRouter } from '../llm/openrouter';

export const wechatRouter = Router();

// ─── Schemas ────────────────────────────────────────────────────────────────

const QrBindSchema = z.object({
  platform: z.literal('wechat_personal'),
  agent_id: z.string().min(1),
});

const SchedulerTickSchema = z
  .object({
    force: z.boolean().optional(),
    customer: z.string().optional(),
  })
  .strict();

const DraftGenerateSchema = z.object({
  sender: z.string().min(1),
  wechat_id: z.string().min(1),
  content: z.string().min(1),
});

// ─── POST /api/wechat/qr-bind ───────────────────────────────────────────────

wechatRouter.post('/qr-bind', async (req: Request, res: Response) => {
  const parsed = QrBindSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    // zod 错误响应明文含字段名（platform / agent_id）— RED 测试硬要求
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    const fields = issues.map((i) => i.path).join(',');
    return res.status(400).json({
      error: 'INVALID_BODY',
      message: `字段校验失败: ${fields || 'platform, agent_id'}`,
      issues,
      // 兜底显式列出必填字段名（zod issues 里 path 取不到时也保证含字段名）
      required: ['platform', 'agent_id'],
    });
  }

  const { platform, agent_id } = parsed.data;
  const taskId = crypto.randomUUID();

  // ws1 thin：写一行占位 wechat_publish_task（type=chat target_user=agent_id 作为关联）
  // ws2-5 加厚后真正派 wechat_qr_bind task；当前只验证表写得通
  try {
    await pool.query(
      `INSERT INTO wechat_publish_task
        (task_id, platform, type, target_user, content_draft, approval_status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [taskId, platform, 'chat', agent_id, '[ws1-thin] qr-bind dispatch placeholder', 'pending_review'],
    );
  } catch (err) {
    // ws1 thin：写表失败也返回 dispatched（DB 未跑 migration 时单测 mock 会接管）
    console.warn('[wechat/qr-bind] INSERT wechat_publish_task 失败（ws1 thin 容忍）:', err);
  }

  return res.status(200).json({
    task_id: taskId,
    status: 'dispatched',
  });
});

// ─── POST /api/wechat/draft-review-poll & GET 单查 ─────────────────────────

async function handlePoll(req: Request, res: Response): Promise<Response> {
  const taskIdQ = (req.query.task_id ?? req.body?.task_id) as string | undefined;
  if (taskIdQ) {
    // 单查模式
    try {
      const { rows } = await pool.query(
        'SELECT task_id, approval_status, approval_source, content_draft, feishu_record_id FROM wechat_publish_task WHERE task_id = $1',
        [taskIdQ],
      );
      if (!rows || rows.length === 0) {
        return res.status(404).json({
          error: 'TASK_NOT_FOUND',
          task_id: taskIdQ,
        });
      }
      return res.status(200).json({ task: rows[0] });
    } catch {
      // DB 不可用时 thin 返回 404
      return res.status(404).json({
        error: 'TASK_NOT_FOUND',
        task_id: taskIdQ,
      });
    }
  }

  // ws5 真轮询：调 feishu-poll.pollOnce 拉飞书 approved 草稿，写 DB approval_source='feishu_user'
  // + 频控校验 + dispatchTask
  try {
    const result = await pollOnce();
    return res.status(200).json({
      polled: result.polled ?? 0,
      dispatched: result.dispatched ?? 0,
    });
  } catch (err) {
    console.warn('[wechat/draft-review-poll] pollOnce 异常:', err);
    return res.status(200).json({
      polled: 0,
      dispatched: 0,
    });
  }
}

wechatRouter.post('/draft-review-poll', handlePoll);
wechatRouter.get('/draft-review-poll', handlePoll);

// ─── POST /api/wechat/scheduler-tick ────────────────────────────────────────

wechatRouter.post('/scheduler-tick', async (req: Request, res: Response) => {
  const parsed = SchedulerTickSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: 'INVALID_BODY',
      issues: parsed.error.issues,
    });
  }

  // ws4 真逻辑：
  //   1) 若指定 customer → 仅对该客户跑 generateMomentDraft
  //   2) 否则 → 拉 DB agent_platform_sessions 中已绑微信（platform='wechat_personal' status='bound'）的所有客户
  //      逐个调 generateMomentDraft，汇总 generated/skipped 返回
  const { customer } = parsed.data;
  let customers: string[] = [];

  if (customer) {
    customers = [customer];
  } else {
    try {
      const { rows } = await pool.query<{ customer: string }>(
        `SELECT DISTINCT customer
           FROM agent_platform_sessions
          WHERE platform = $1
            AND status = $2`,
        ['wechat_personal', 'bound'],
      );
      customers = (rows ?? [])
        .map((r) => String(r.customer ?? '').trim())
        .filter((c) => c.length > 0);
    } catch (err) {
      console.warn('[wechat/scheduler-tick] 拉已绑微信客户失败:', err);
      customers = [];
    }
  }

  let generated = 0;
  const skipped: Array<{ customer: string; reason: string }> = [];

  for (const c of customers) {
    try {
      const result = await generateMomentDraft({ customer: c });
      if (result.ok) {
        generated += 1;
      } else {
        skipped.push({ customer: c, reason: result.reason });
      }
    } catch (err) {
      console.warn(`[wechat/scheduler-tick] generateMomentDraft for ${c} 异常:`, err);
      skipped.push({ customer: c, reason: 'internal_error' });
    }
  }

  return res.status(200).json({ generated, skipped });
});

// ─── POST /api/wechat/draft-generate（ws3）──────────────────────────────────
// 私聊草稿生成：listen_chat.py 拉到名单内客户消息 → POST 这里 → DeepSeek 生草稿 →
// 写飞书"互动记录" + DB wechat_publish_task（pending_review，approval_source NULL）

wechatRouter.post('/draft-generate', async (req: Request, res: Response) => {
  const parsed = DraftGenerateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    const fields = issues.map((i) => i.path).join(',');
    return res.status(400).json({
      error: 'INVALID_BODY',
      message: `字段校验失败: ${fields || 'sender, wechat_id, content'}`,
      issues,
      required: ['sender', 'wechat_id', 'content'],
    });
  }

  try {
    const result = await generateChatDraft(parsed.data);
    return res.status(200).json(result);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[wechat/draft-generate] generateChatDraft 抛异常:', errMsg);
    return res.status(500).json({
      error: 'DRAFT_GENERATE_FAILED',
      message: errMsg,
    });
  }
});

// ─── 微信 iLink 个人号通道（Path 4 Step 1）──────────────────────────────────
// 腾讯官方 iLink 协议：扫码登录拿 token → getupdates 收私聊 → DeepSeek 回复 →
// sendmessage 自动回 → 写飞书 Lead。token 存 agent_platform_sessions(role=burner, extra_json)。

const ILinkLoginStartSchema = z.object({ agent_id: z.string().min(1) });
const ILinkPollerStartSchema = z.object({ session_id: z.string().min(1) });

/**
 * 写一条 iLink 私聊交互记录。
 * thin 阶段：结构化 log（真实链路已跑通即留痕）。
 * 加厚阶段：接 feishu-bitable 写「互动记录 / Lead」表。
 */
async function writeIlinkLead(
  session: ILinkSession,
  rec: {
    from_user_id: string;
    to_user_id?: string;
    text: string;
    reply: string;
    context_token: string;
    received_at?: string;
  },
): Promise<void> {
  console.info('[wechat/ilink] lead', JSON.stringify({ session_id: session.id, ...rec }));
}

// POST /api/wechat/ilink-login-start {agent_id} → {session_id, qr_url, qrcode}
// 调真实 ilink/bot/get_bot_qrcode 拉二维码，建 pending burner session 存 qrcode 句柄。
wechatRouter.post('/ilink-login-start', async (req: Request, res: Response) => {
  const parsed = ILinkLoginStartSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: 'INVALID_BODY',
      required: ['agent_id'],
      issues: parsed.error.issues,
    });
  }

  const { agent_id } = parsed.data;
  const sessionId = crypto.randomUUID();

  let qr;
  try {
    qr = await getBotQrcode();
  } catch (err) {
    console.error('[wechat/ilink-login-start] get_bot_qrcode 失败:', err);
    return res.status(502).json({ error: 'ILINK_QRCODE_FAILED', message: String(err) });
  }
  if (!qr?.qrcode) {
    return res.status(502).json({ error: 'ILINK_QRCODE_EMPTY' });
  }

  // 建 pending burner session，存 qrcode（轮询句柄），token 待 login-status 确认后回填
  try {
    await pool.query(
      `INSERT INTO zenithjoy.agent_platform_sessions
         (id, agent_id, platform, account_label, role, status, extra_json)
       VALUES ($1, $2, 'wechat_personal_ilink', $3, 'burner', 'pending', $4::jsonb)`,
      [sessionId, agent_id, `ilink-${sessionId.slice(0, 8)}`, JSON.stringify({ login_qrcode: qr.qrcode })],
    );
  } catch (err) {
    console.warn('[wechat/ilink-login-start] 建 pending session 失败（thin 容忍）:', err);
  }

  return res.status(200).json({
    session_id: sessionId,
    qr_url: qr.qrcode_img_content,
    qrcode: qr.qrcode,
  });
});

// GET /api/wechat/ilink-login-status?session_id=X → {status, nickname?}
// 用本 session 的 qrcode 句柄长轮询 ilink/bot/get_qrcode_status；confirmed → 存 bot_token + status=bound。
wechatRouter.get('/ilink-login-status', async (req: Request, res: Response) => {
  const sessionId = (req.query.session_id ?? req.body?.session_id) as string | undefined;
  if (!sessionId) {
    return res.status(400).json({ error: 'INVALID_BODY', required: ['session_id'] });
  }

  let qrcode: string | undefined;
  try {
    const { rows } = await pool.query(
      `SELECT extra_json FROM zenithjoy.agent_platform_sessions WHERE id = $1`,
      [sessionId],
    );
    qrcode = rows?.[0]?.extra_json?.login_qrcode;
  } catch (err) {
    console.warn('[wechat/ilink-login-status] 读 session 失败:', err);
  }
  if (!qrcode) {
    return res.status(404).json({ error: 'LOGIN_SESSION_NOT_FOUND', session_id: sessionId });
  }

  let st;
  try {
    st = await pollQrStatus(qrcode);
  } catch (err) {
    console.warn('[wechat/ilink-login-status] get_qrcode_status 失败:', err);
    return res.status(200).json({ status: 'wait' });
  }

  if (st?.status === 'confirmed' && st.bot_token) {
    // 扫码确认：存 bot_token，status→bound
    try {
      await pool.query(
        `UPDATE zenithjoy.agent_platform_sessions
            SET status = 'bound', bound_at = now(),
                extra_json = extra_json || $2::jsonb
          WHERE id = $1`,
        [
          sessionId,
          JSON.stringify({
            token: st.bot_token,
            ilink_bot_id: st.ilink_bot_id,
            ilink_user_id: st.ilink_user_id,
            nickname: st.nickname,
          }),
        ],
      );
    } catch (err) {
      console.warn('[wechat/ilink-login-status] 写 bound session 失败:', err);
    }
    return res.status(200).json({ status: 'bound', nickname: st.nickname });
  }

  // wait / scaned / expired 原样透传
  return res.status(200).json({ status: st?.status ?? 'wait' });
});

// POST /api/wechat/ilink-poller-start {session_id} → 跑一轮 B→C→D→E
wechatRouter.post('/ilink-poller-start', async (req: Request, res: Response) => {
  const parsed = ILinkPollerStartSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: 'INVALID_BODY',
      required: ['session_id'],
      issues: parsed.error.issues,
    });
  }

  const { session_id } = parsed.data;

  // 载入已绑定 session 凭据
  let session: ILinkSession;
  try {
    const { rows } = await pool.query(
      `SELECT id, extra_json FROM zenithjoy.agent_platform_sessions
        WHERE id = $1 AND platform = 'wechat_personal_ilink' AND status = 'bound'`,
      [session_id],
    );
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'SESSION_NOT_BOUND', session_id });
    }
    const ej = rows[0].extra_json || {};
    session = { id: rows[0].id, token: ej.token, uin: ej.uin, wxid: ej.wxid };
  } catch (err) {
    return res.status(500).json({ error: 'LOAD_SESSION_FAILED', message: String(err) });
  }

  const result = await runPollerOnce({
    session,
    ilink: {
      getupdates: (cursor?: string) => getupdates(session, cursor),
      sendmessage: (input: SendMessageInput) => sendmessage(session, input),
    },
    openrouter: async ({ purpose, prompt }) => {
      const r = await callOpenRouter({ purpose, prompt });
      return { content: r.content };
    },
    writeLead: (rec) => writeIlinkLead(session, rec),
    markSessionNeedsRebind: async (sid: string) => {
      await pool
        .query(`UPDATE zenithjoy.agent_platform_sessions SET status = 'needs_rebind' WHERE id = $1`, [sid])
        .catch((e) => console.warn('[wechat/ilink-poller-start] markNeedsRebind 失败:', e));
    },
  });

  return res.status(200).json(result);
});
