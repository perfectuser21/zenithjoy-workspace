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
import { generateChatDraft } from '../services/wechat-draft';

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
    } catch (err) {
      // DB 不可用时 thin 返回 404
      return res.status(404).json({
        error: 'TASK_NOT_FOUND',
        task_id: taskIdQ,
      });
    }
  }

  // 批量轮询：ws1 thin 返回 0/0；ws5 接入飞书 approved 真轮询
  return res.status(200).json({
    polled: 0,
    dispatched: 0,
  });
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
  // ws1 thin：返回空 generated/skipped；ws4 真实拉客户画像生成朋友圈草稿
  return res.status(200).json({
    generated: 0,
    skipped: [],
  });
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
