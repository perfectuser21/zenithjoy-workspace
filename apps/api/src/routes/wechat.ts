/**
 * /api/wechat/* — Path 4 微信个人号端点
 *
 * 端点：
 *   - POST /api/wechat/qr-bind         {platform, agent_id} → {task_id, status}
 *   - POST /api/wechat/scheduler-tick  {force?, customer?} → {generated, skipped}
 *   - POST /api/wechat/draft-generate  {sender, wechat_id, content, is_group?} → {status, reply?}
 *
 * 去飞书（2026-06-30）：旧飞书审批轮询端点 draft-review-poll 已删（feishu-poll 整条删除）；
 * draft-generate 现为去飞书 + 自动直发（个人未标黑 → 直接返回 reply，群/标黑 → skipped）。
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import pool from '../db/connection';
import { resolveTenantForAgent } from '../services/agent-tenant-resolver';
import { generateChatDraft, generateMomentDraft } from '../services/wechat-draft';
import { recordHeartbeat, listHeartbeats } from '../services/wechat-heartbeat';
import {
  enqueueFailureAlert,
  listPendingOutbound,
  markOutboundReceipt,
} from '../services/wechat/cs-outbound';
import { getCsWorkStats, type StatsDate } from '../services/wechat/cs-work-stats';
import { runDailyReportSettlement, getDailyReports } from '../services/wechat/cs-daily-report';
import { appendTenantMessage } from '../services/wechat/tenant-memory';

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
    // 多租户隔离：客服路径多为 cron / listen_chat 等非浏览器 caller（无 cookie）→
    // 沿用 agent-context 既定的「body 显式 id 向后兼容」范式，显式传 tenant_id。
    // 缺租户上下文一律拒绝（见下方 resolveTenantId），绝不回退全量。
    tenant_id: z.string().optional(),
    // 身份兜底：listen_chat 不知道 tenant_id 但知道自己的 agent_id / machine_id。
    agent_id: z.string().optional(),
    machine_id: z.string().optional(),
  })
  .strict();

const ListenerHeartbeatSchema = z
  .object({
    agent_id: z.string().optional(),
    wechat_id: z.string().optional(),
    ts: z.number().optional(),
    // 扫描诊断（让运营在中台一眼看到监听卡在哪，无需远程进客户桌面）
    diag: z
      .object({
        main_window_found: z.boolean().optional(),
        login_present: z.boolean().optional(),
        sessions_seen: z.number().optional(),
        unread_count: z.number().optional(),
        unread_senders: z.array(z.string()).optional(),
        replied_count: z.number().optional(),
        last_error: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const DraftGenerateSchema = z.object({
  sender: z.string().min(1),
  wechat_id: z.string().min(1),
  content: z.string().min(1),
  // listen_chat.py 自动回模式传 mode='auto'；不声明会被 zod strip 掉 → auto 模式不返回 reply。
  mode: z.enum(['auto', 'review']).optional(),
  // 群消息标志：agent 端读会话右上角标题 "(人数)" 判群后传 true → 中台 gating 直接不回（群不回）。
  is_group: z.boolean().optional(),
  // 多租户隔离：写入必须归属当前租户的 agent（经 agents.tenant_id 校验）。
  // listen_chat 等非浏览器 caller 显式传 tenant_id；缺则拒绝、绝不写入任意 agent。
  tenant_id: z.string().optional(),
  // agent 身份兜底：listen_chat 不知道 tenant_id，但知道自己的 agent_id（绑定时已定）。
  // 缺 tenant_id 时由中台从 agents/license_machines/service_agents 反查，符合「租户在绑定时已定」架构。
  agent_id: z.string().optional(),
  // 机器指纹兜底：命中 service_agents(machine_id) / license_machines(machine_id) 即可反查租户。
  machine_id: z.string().optional(),
  // 直接指定客服微信号（优先于 agent_id 解析链）。供 smoke/测试等已知 cs_wechat_id 的调用方直传。
  cs_wechat_id: z.string().optional(),
});

/**
 * 解析当前请求的租户上下文（客服读写路径多租户隔离）。
 *
 * 沿用 agent-context.ts 既定的「body 显式 id 向后兼容」范式：cron / listen_chat
 * 等非浏览器 caller 显式传 body.tenant_id（或 X-Tenant-Id 头）= 当前租户，仍优先。
 *
 * 兜底反查（防线 2，修 Line04 P0② NO_TENANT_CONTEXT，2026-07-01 rog 铁证）：
 *   listen_chat 用 env 派生 agent_id（agent-env-xxx）POST，该 env-id 只在 license_machines.agent_id、
 *   从没进 agents.agent_id（心跳建行用随机 ws1-<hex>）。旧逻辑只查 agents → 查不到 → NO_TENANT_CONTEXT。
 *   现委托 resolveTenantForAgent 从 agents ∪ service_agents(machine_id) ∪ license_machines(machine_id/agent_id)
 *   稳健反查（详见该模块）。
 *
 * 三者皆无 / 全部查不到 → 返回空串 → 调用方一律 4xx 拒绝，
 * 绝不回退为不带 tenant 过滤的全量查（保持隔离）。
 */
async function resolveTenantId(req: Request): Promise<string> {
  const headerVal = req.header('X-Tenant-Id');
  const bodyVal =
    req.body && typeof req.body.tenant_id === 'string' ? req.body.tenant_id : '';
  const explicit = (headerVal || bodyVal || '').trim();
  if (explicit) return explicit;

  // 兜底：从 agent_id / machine_id 反查 tenant（租户在绑定时已定，符合架构）。
  const agentId =
    req.body && typeof req.body.agent_id === 'string' ? req.body.agent_id.trim() : '';
  const machineId = (
    req.header('X-Machine-Id') ||
    (req.body && typeof req.body.machine_id === 'string' ? req.body.machine_id : '') ||
    ''
  ).trim();
  if (!agentId && !machineId) return '';
  return resolveTenantForAgent(pool, { agentId, machineId });
}

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
      `INSERT INTO zenithjoy.wechat_publish_task
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

// ─── POST /api/wechat/listener-heartbeat（进程守护：监听心跳上报）──────────────
// listen_chat.py 每分钟上报；中台记最后心跳时间。断 3 分钟无心跳由 wechat-heartbeat
// 的 startStaleListenerMonitor 飞书告警。lenient：任何 body 都返回 200，绝不阻塞监听。

wechatRouter.post('/listener-heartbeat', (req: Request, res: Response) => {
  const parsed = ListenerHeartbeatSchema.safeParse(req.body ?? {});
  const data = parsed.success ? parsed.data : {};
  const rec = recordHeartbeat({
    agent_id: data.agent_id,
    wechat_id: data.wechat_id,
    ts: data.ts,
    diag: data.diag,
  });
  return res.status(200).json({ ok: true, recorded_at: rec.ts });
});

// ─── GET /api/wechat/listener-heartbeat（运营在中台看监听健康 + 扫描诊断）──────────
// Dashboard「微信客服监听健康」看板调用：返回每个监听最新一次上报的状态。
wechatRouter.get('/listener-heartbeat', (_req: Request, res: Response) => {
  return res.status(200).json({ listeners: listHeartbeats() });
});

// 去飞书（2026-06-30）：旧 draft-review-poll（飞书 approved 草稿轮询）端点 + handlePoll 已删除。

// ─── POST /api/wechat/scheduler-tick ────────────────────────────────────────

wechatRouter.post('/scheduler-tick', async (req: Request, res: Response) => {
  const parsed = SchedulerTickSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: 'INVALID_BODY',
      issues: parsed.error.issues,
    });
  }

  // 多租户隔离：缺租户上下文一律 4xx 拒绝，绝不回退为不带 tenant 过滤的全量客户枚举/处理。
  const tenantId = await resolveTenantId(req);
  if (!tenantId) {
    return res.status(400).json({
      error: 'NO_TENANT_CONTEXT',
      message:
        '缺租户上下文（body.tenant_id / X-Tenant-Id 皆无）— 拒绝执行客户枚举，绝不回退全量',
    });
  }

  // ws4 真逻辑（已按当前租户 scope）：
  //   1) 若指定 customer → 仅对该客户跑 generateMomentDraft
  //   2) 否则 → 拉 DB 当前租户名下已绑微信（platform='wechat_personal' status='bound'）的所有客户
  //      逐个调 generateMomentDraft，汇总 generated/skipped 返回
  const { customer } = parsed.data;
  let customers: string[] = [];

  if (customer) {
    customers = [customer];
  } else {
    try {
      // 租户 scope：agent_platform_sessions.agent_id ──FK──> zenithjoy.agents.id ──> agents.tenant_id
      // 桥接 agents.tenant_id 过滤当前租户，不改 schema 结构（agent_platform_sessions 无 tenant_id 列）。
      const { rows } = await pool.query<{ customer: string }>(
        `SELECT DISTINCT aps.customer
           FROM zenithjoy.agent_platform_sessions aps
           JOIN zenithjoy.agents a ON a.id = aps.agent_id
          WHERE aps.platform = $1
            AND aps.status = $2
            AND a.tenant_id = $3`,
        ['wechat_personal', 'bound', tenantId],
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

  // 多租户隔离：写入必须归属当前租户 agent，缺租户上下文一律 4xx 拒绝、绝不写入任意 agent。
  const tenantId = await resolveTenantId(req);
  if (!tenantId) {
    return res.status(400).json({
      error: 'NO_TENANT_CONTEXT',
      message:
        '缺租户上下文（body.tenant_id / X-Tenant-Id 皆无）— 拒绝写入草稿，绝不写入任意 agent',
    });
  }

  try {
    // 透传 tenant scope 到写入服务（归属当前租户 agent）
    const result = await generateChatDraft({ ...parsed.data, tenant_id: tenantId });
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

// ─── 关键人出站任务（上下线播报 + 失败告警）：agent 拉取真机发送 + 回执 ─────────────
// agent-facing（与 draft-generate/heartbeat 同 router，不挂 superAdminGuard——listen_chat
// 无 admin 凭据）。真机 UIA 发送是接缝（xian-rog 真验），中台只管「派任务 + 收回执」。

// GET /api/wechat/cs/outbound?agent_id=  → 列出该 agent 待发给关键人的出站任务
wechatRouter.get('/cs/outbound', async (req: Request, res: Response) => {
  const agentId = typeof req.query.agent_id === 'string' ? req.query.agent_id.trim() : '';
  if (!agentId) {
    return res.status(400).json({ error: 'MISSING_AGENT_ID', message: '缺 agent_id' });
  }
  try {
    const tasks = await listPendingOutbound(agentId);
    return res.status(200).json({ ok: true, tasks });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[wechat/cs/outbound] list 失败:', errMsg);
    return res.status(500).json({ error: 'OUTBOUND_LIST_FAILED', message: errMsg });
  }
});

// POST /api/wechat/cs/outbound/:id/receipt  {ok:boolean}  → 真机发送回执，翻 auto_sent/send_failed
const OutboundReceiptSchema = z.object({ ok: z.boolean() });
wechatRouter.post('/cs/outbound/:id/receipt', async (req: Request, res: Response) => {
  const taskId = req.params.id;
  const parsed = OutboundReceiptSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'INVALID_BODY', message: '缺 ok:boolean' });
  }
  try {
    const updated = await markOutboundReceipt(taskId, parsed.data.ok);
    return res.status(200).json({ ok: true, updated });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[wechat/cs/outbound/receipt] 失败:', errMsg);
    return res.status(500).json({ error: 'OUTBOUND_RECEIPT_FAILED', message: errMsg });
  }
});

// POST /api/wechat/cs/alert  {agent_id, key_contact, reason}  → 失败/掉线 → 入告警出站任务（去重）
const AlertSchema = z.object({
  agent_id: z.string().min(1),
  key_contact: z.string().min(1),
  reason: z.string().min(1),
});
wechatRouter.post('/cs/alert', async (req: Request, res: Response) => {
  const parsed = AlertSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'INVALID_BODY', message: '缺 agent_id/key_contact/reason' });
  }
  try {
    const r = await enqueueFailureAlert({
      agentId: parsed.data.agent_id,
      keyContact: parsed.data.key_contact,
      reason: parsed.data.reason,
    });
    return res.status(200).json({ ok: true, ...r });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[wechat/cs/alert] 失败:', errMsg);
    return res.status(500).json({ error: 'ALERT_FAILED', message: errMsg });
  }
});

// ─── GET /api/wechat/cs/stats?date=today|yesterday（S3 客服工作汇总）────────────
// 每台客服机当天 4 个工作数据：接收/回复/接待客人数/工作时长，按 Asia/Shanghai 当天分组每客服微信号。
// date 缺省 today；非法值回落 today。纯 DB 读 + 展示，无外部依赖。
wechatRouter.get('/cs/stats', async (req: Request, res: Response) => {
  const raw = typeof req.query.date === 'string' ? req.query.date : 'today';
  const date: StatsDate = raw === 'yesterday' ? 'yesterday' : 'today';
  try {
    const stats = await getCsWorkStats(date);
    return res.status(200).json({ ok: true, date, stats });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[wechat/cs/stats] 聚合失败:', errMsg);
    return res.status(500).json({ error: 'CS_STATS_FAILED', message: errMsg });
  }
});

// ─── POST /api/wechat/cs/daily-report/settle（S4 结算）─────────────────────────
// 把 date（today/yesterday，缺省 today）的每客服 4 个数固化进 daily_report（upsert 保幂等）。
// 由中台 scheduler 每天北京 23:55 调（结算「today」）；smoke / 手动补算也调它。
const DailyReportSettleSchema = z.object({ date: z.enum(['today', 'yesterday']).optional() });
wechatRouter.post('/cs/daily-report/settle', async (req: Request, res: Response) => {
  const parsed = DailyReportSettleSchema.safeParse(req.body ?? {});
  const date: StatsDate = parsed.success && parsed.data.date === 'yesterday' ? 'yesterday' : 'today';
  try {
    const r = await runDailyReportSettlement(date);
    return res.status(200).json({ ok: true, ...r });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[wechat/cs/daily-report/settle] 结算失败:', errMsg);
    return res.status(500).json({ error: 'DAILY_REPORT_SETTLE_FAILED', message: errMsg });
  }
});

// ─── GET /api/wechat/cs/daily-report?date=YYYY-MM-DD（S4 回看）──────────────────
// 回看任意历史日期的每客服日报（4 个数 + 小结）。date 缺省 = 北京今天。
wechatRouter.get('/cs/daily-report', async (req: Request, res: Response) => {
  const raw = typeof req.query.date === 'string' ? req.query.date.trim() : '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? raw
    : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  try {
    const reports = await getDailyReports(date);
    return res.status(200).json({ ok: true, date, reports });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[wechat/cs/daily-report] 查询失败:', errMsg);
    return res.status(500).json({ error: 'DAILY_REPORT_QUERY_FAILED', message: errMsg });
  }
});

// ─── POST /api/wechat/cs/confirm-delivery（v1.0.108 Bug2修复：UIA 真送达后落出站记忆）──
// listen_chat.py 在 DELIVERED 确认后调此接口，把 AI 回复写入三层记忆 out 记录。
// 草稿生成时不再写 out 记录，防止 UIA 失败时中台出现"假账"（AI 以为发了实则没发）。
const ConfirmDeliverySchema = z.object({
  agent_id: z.string().min(1),
  sender: z.string().min(1),
  reply_text: z.string().min(1),
});
wechatRouter.post('/cs/confirm-delivery', async (req: Request, res: Response) => {
  const parsed = ConfirmDeliverySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'BAD_REQUEST', details: parsed.error.issues });
  }
  const { agent_id, sender, reply_text } = parsed.data;
  try {
    const tenantId = await resolveTenantForAgent(pool, { agentId: agent_id });
    if (!tenantId) {
      console.warn(`[wechat/cs/confirm-delivery] 无法解析租户 agent_id=${agent_id}，跳过写库`);
      return res.status(200).json({ ok: true, skipped: true, reason: 'tenant_unresolved' });
    }
    await appendTenantMessage({ tenantId, contact: sender, role: 'out', text: reply_text });
    return res.status(200).json({ ok: true });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[wechat/cs/confirm-delivery] 落库失败:', errMsg);
    return res.status(500).json({ error: 'CONFIRM_DELIVERY_FAILED', message: errMsg });
  }
});
