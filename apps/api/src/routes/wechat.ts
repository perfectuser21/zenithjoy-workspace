/**
 * P4 WS1 — wechat 3 endpoints (thin stub).
 *
 *   POST /api/wechat/qr-bind          → zod { platform: 'wechat', agent_id: uuid }
 *   GET  /api/wechat/draft-review-poll?task_id=<uuid> → 查 zenithjoy.wechat_publish_task
 *   POST /api/wechat/scheduler-tick   → zod { dryrun?: boolean }
 *
 * thin stub：占位响应。
 *   - qr-bind 真 agent dispatch 在 WS3
 *   - scheduler-tick 真调度在 WS5
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import pool from '../db/connection';
import { pushWechatTaskToFeishu } from '../services/feishu-bitable-multitenant';

export const wechatRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============ POST /api/wechat/qr-bind ============
const qrBindSchema = z.object({
  platform: z.literal('wechat'),
  agent_id: z.string().regex(UUID_RE, 'agent_id must be uuid'),
});

wechatRouter.post('/qr-bind', async (req: Request, res: Response) => {
  const parse = qrBindSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_BODY',
      errors: parse.error.format(),
    });
  }
  // thin stub: WS3 接真 agent dispatch
  return res.json({
    ok: true,
    task_id: '00000000-0000-0000-0000-000000000000',
    platform: parse.data.platform,
    agent_id: parse.data.agent_id,
    note: 'thin stub — real dispatch in WS3',
  });
});

// ============ GET /api/wechat/draft-review-poll ============
wechatRouter.get('/draft-review-poll', async (req: Request, res: Response) => {
  const taskId = String(req.query.task_id || '');
  if (!UUID_RE.test(taskId)) {
    return res.status(400).json({ ok: false, code: 'INVALID_TASK_ID' });
  }
  try {
    const row = await pool.query(
      'SELECT * FROM zenithjoy.wechat_publish_task WHERE id=$1',
      [taskId],
    );
    if (row.rowCount === 0) {
      return res.status(404).json({ ok: false, code: 'TASK_NOT_FOUND', task_id: taskId });
    }
    return res.json({ ok: true, task: row.rows[0] });
  } catch (e) {
    return res.status(500).json({ ok: false, code: 'DB_ERROR', message: (e as Error).message });
  }
});

// ============ POST /api/wechat/scheduler-tick ============
const schedulerTickSchema = z.object({
  dryrun: z.boolean().optional(),
});

wechatRouter.post('/scheduler-tick', async (req: Request, res: Response) => {
  const parse = schedulerTickSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_BODY',
      errors: parse.error.format(),
    });
  }
  // thin stub: WS5 接真调度
  return res.json({
    ok: true,
    picked: 0,
    dryrun: parse.data.dryrun ?? false,
    note: 'thin stub — real scheduler in WS5',
  });
});

// ============ POST /api/wechat/draft-submit ============
const draftSubmitSchema = z.object({
  agent_id:            z.string().regex(UUID_RE, 'agent_id must be uuid'),
  task_type:           z.enum(['moments', 'private_chat']),
  content:             z.string().min(1).max(2000),
  target_friend_alias: z.string().optional(),
  scheduled_at:        z.string().datetime().optional(),
});

wechatRouter.post('/draft-submit', async (req: Request, res: Response) => {
  const parse = draftSubmitSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ ok: false, code: 'INVALID_BODY', errors: parse.error.format() });
  }
  const { agent_id, task_type, content, target_friend_alias, scheduled_at } = parse.data;

  // 查 agent → tenant_id
  const agentRow = await pool.query(
    `SELECT tenant_id FROM zenithjoy.agents WHERE id = $1`,
    [agent_id]
  ).catch(() => ({ rows: [] as { tenant_id: string }[] }));
  const tenantId: string | null = agentRow.rows[0]?.tenant_id ?? null;

  // INSERT wechat_publish_task
  let taskId: string;
  try {
    const insertResult = await pool.query(
      `INSERT INTO zenithjoy.wechat_publish_task
         (agent_id, task_type, content, target_friend_alias, scheduled_at, status, approval_source)
       VALUES ($1, $2, $3, $4, $5, 'draft', 'feishu_user')
       RETURNING id`,
      [agent_id, task_type, content, target_friend_alias ?? null,
       scheduled_at ?? new Date().toISOString()]
    );
    taskId = insertResult.rows[0].id;
  } catch (e) {
    return res.status(500).json({ ok: false, code: 'DB_ERROR', message: (e as Error).message });
  }

  // 异步推飞书（不 await，不阻塞响应）
  if (tenantId) {
    void pushWechatTaskToFeishu(taskId, tenantId).catch((e: Error) =>
      console.error('[draft-submit] pushWechatTaskToFeishu failed:', e.message)
    );
  }

  return res.status(201).json({ ok: true, task_id: taskId, status: 'pending_approval' });
});
