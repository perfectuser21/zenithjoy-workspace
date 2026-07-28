import { Router, Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import axios from 'axios';
import pool from '../db/connection';
import {
  SWEEP_TIMEOUT_MS,
  profileUrlForSecUid,
  settleCollectTask,
  TERMINAL_COLLECT_STATUSES,
} from '../services/acquisition-collect';
import { tenantContextOptional } from '../middleware/tenant-context';
import { licenseAuth } from '../middleware/license-auth';
import { simpleRateLimit, ipKeyFn } from '../middleware/simple-rate-limit';
import { sseService } from '../services/sse.service';
import { scoreLeads, buildAssignments, dispatchDue, rescoreLead, upsertConfig } from '../services/acquisition-dispatch';
import { resolveShareToMedia, type MediaKind } from '../services/douyin-share-resolver';
import { judgeVideo } from '../services/content-judgment';
import { gradeComments } from '../services/comment-grading';

export const acquisitionRouter = Router();

// FR-2: error_code 白名单（新枚举 + 历史值向后兼容）
// 定义在文件顶部，供 collect/report-videos 和 collect/report 两个 handler 共用。
// 2026-07-28 rescue #1456：PLATFORM_LIMIT/ACCOUNT_OFFLINE 改回 PLATFORM_LIMITED/ACCOUNT_ABNORMAL——
// 与下方 VALID_COLLECT_ERROR_CODES、以及 Android 端 CollectFailureClassifier.kt 实际吐出的值对齐
// （原命名和真机不一致会把真实 PLATFORM_LIMITED/ACCOUNT_ABNORMAL 静默降级成 UNKNOWN，白名单形同虚设）。
const VALID_REPORT_ERROR_CODES = new Set([
  'KEYWORD_NO_RESULT',
  'KEYWORD_BANNED',
  'PLATFORM_LIMITED',
  'NETWORK_ERROR',
  'ACCOUNT_ABNORMAL',
  'UNKNOWN',
  // 历史值向后兼容
  'STAGE2_DISPATCH_EXHAUSTED',
  'COLLECT_TIMEOUT',
  'stage1_empty',
]);

/** 非枚举值强制 normalize 为 UNKNOWN，并写日志。历史值保留原值。空/undefined → null。 */
function normalizeReportErrorCode(code: string | null | undefined): string | null {
  if (!code) return null;
  if (VALID_REPORT_ERROR_CODES.has(code)) return code;
  console.log(`[acquisition] error_code normalized: UNKNOWN (original: ${code})`);
  return 'UNKNOWN';
}

// CodeQL js/missing-rate-limiting：/pending-collect-tasks 碰鉴权(x-agent-id反查tenant)+DB
// 查询，且本次PR改动了这条路由（新增title查询）触发静态分析对"改动过的代码"重新计入告警。
// 按 x-agent-id 限流（不是 tenantId——这条路由用 header 反查 tenant，tenantContext 中间件
// 未接入，鉴权发生在 handler 内部）。轮询正常节奏是30s一次，60次/60s 留足重试余量。
const pendingCollectTasksRateLimit = simpleRateLimit({
  windowMs: 60_000,
  max: 60,
  keyFn: (req) => req.header('x-agent-id') || 'anonymous',
});

// CodeQL js/missing-rate-limiting：/collect/report 碰鉴权(按 task_id 反查 tenant)+DB 查询，
// 本次PR接入 gradeComments（新增2条DB查询：videoInfoRes/gradingConfigRes）触发静态分析对
// "改动过的代码"重新计入告警（同 pendingCollectTasksRateLimit 的既往修法）。按 task_id 限流
// （不是 tenantId——这条路由不走 tenantContext，鉴权发生在 handler 内部按 task_id 反查）。
// Stage2 单个视频多条评论仍是同一次 report 调用，一个采集任务生命周期内可能有多个视频轮流
// report，180次/60s 留足并发余量。
// 采集失败原因五分类（task 3, 2026-07-22 Path2 安卓信号上报 sprint）：Android 端
// CollectFailureClassifier 已把 11+ 个自由字符串错误码归类到这五类，这里做防御性
// 兜底——万一未来 Android 版本传入新增/未同步的错误码，落库前也归一为 UNKNOWN，
// 不让 acquisition_collect_tasks.error_code 列的值域被污染。
const VALID_COLLECT_ERROR_CODES = new Set([
  'KEYWORD_NO_RESULT', 'PLATFORM_LIMITED', 'NETWORK_ERROR', 'ACCOUNT_ABNORMAL', 'UNKNOWN',
]);
function normalizeCollectErrorCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return VALID_COLLECT_ERROR_CODES.has(raw) ? raw : 'UNKNOWN';
}

const collectReportRateLimit = simpleRateLimit({
  windowMs: 60_000,
  max: 180,
  keyFn: (req) => (req.body && req.body.task_id) || 'anonymous',
});

// Path2 账号扫描手动触发限流：同租户 60 秒内只允许触发一次，防止连点把
// DeviceAccountScanService（无障碍面板读取）打崩（sprint 07192358）。
const accountScanTriggerRateLimit = simpleRateLimit({
  windowMs: 60_000,
  max: 1,
});

// CodeQL js/missing-rate-limiting：/leads/:id/signal-status 碰鉴权(tenantContextOptional
// 反查tenant)+DB查询（2026-07-22 Path2 安卓信号上报 sprint Task5 新增路由触发静态分析）。
// 必须排在 tenantContextOptional 之前——CodeQL 追踪的是"鉴权节点执行前有没有先经过限流"，
// 放在鉴权之后不算数。因此不能用默认 tenantKeyFn（此时 req.tenantId 还没被
// tenantContextOptional 解析出来）——按 IP 限流，诊断端点允许较宽松轮询节奏。
const signalStatusRateLimit = simpleRateLimit({
  windowMs: 60_000,
  max: 60,
  keyFn: ipKeyFn,
});

const VALID_GRADES = ['感兴趣', '精准', '高意向'] as const;

/** 一条评论上报映射出的 lead 字段。 */
export interface LeadFieldsFromComment {
  secUid: string | null;
  nickname: string;
  profileUrl: string | null;
  /** 评论人真实抖音号（Seg3 设备点头像进主页读出）。读不到 = null。 */
  douyinId: string | null;
  commentText: string | null;
}

/**
 * 评论上报 → lead 字段映射（纯函数，落库 SQL 之外的全部归一规则都在这）。
 *
 * 「宁可空，不可猜」（PR #1306）：douyin_id 读不到 / 是空白 → null，**绝不**回退成
 * nickname 或 profile_url 顶替。回退正是设备端 NO_MATCH 的根源——设备把拿到的字段
 * 当抖音号往搜索框里搜，塞个昵称或 URL 进去只会零匹配，还会让"没读到号"这个真问题
 * 被伪装成"派了但没送达"。
 */
export function buildLeadFieldsFromComment(c: {
  commenter_id?: string;
  text?: string;
  douyin_id?: string | null;
}): LeadFieldsFromComment {
  const rawId = String(c.commenter_id || '').trim();
  const secUidMatch = rawId.match(/\/user\/([^/?#]+)/);
  const secUid = secUidMatch ? secUidMatch[1] : null;
  const douyinId = String(c.douyin_id ?? '').trim() || null;
  return {
    secUid,
    nickname: rawId || '未知',
    profileUrl: secUid ? `https://www.douyin.com/user/${secUid}` : null,
    douyinId,
    commentText: String(c.text || '').trim() || null,
  };
}

// Stage2 每个视频最多派发次数：超限视为该视频不可采（下架/打不开），强制落章跳过
const MAX_STAGE2_DISPATCHES_PER_VIDEO = 10;
type Grade = (typeof VALID_GRADES)[number];

acquisitionRouter.get('/overview', (_req: Request, res: Response) => {
  res.json({
    enabled: true,
    feature: 'smart-acquisition',
    capabilities: ['overview'],
    version: '1.0.0',
  });
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
    const taskRes = await pool.query<{
      id: string;
      status: string;
      error_code: string | null;
      video_count: number;
    }>(
      `SELECT id, status, error_code, video_count FROM zenithjoy.acquisition_collect_tasks WHERE id = $1 AND tenant_id = $2`,
      [taskId, tenantId]
    );
    if (taskRes.rows.length === 0) return fail(res, 404, 'TASK_NOT_FOUND', '采集任务不存在');
    const taskRow = taskRes.rows[0];

    const { rows } = await pool.query<{
      video_id: string;
      task_id: string;
      title: string | null;
      thumbnail_url: string | null;
      publish_date: Date | null;
      comment_count: number;
      judgment_status: string;
      judgment_reason: string | null;
    }>(
      `SELECT video_id, task_id, title, thumbnail_url, publish_date, comment_count, judgment_status, judgment_reason
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
      judgment_status: r.judgment_status,
      judgment_reason: r.judgment_reason,
    }));

    return ok(res, {
      videos,
      total: videos.length,
      task: {
        status: taskRow.status,
        error_code: taskRow.error_code,
        video_count: taskRow.video_count ?? 0,
      },
    });
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

// GET /api/acquisition/leads/:id/signal-status — 最小消费验证端点（2026-07-22 Path2 安卓信号上报 sprint）：
// 跨表拼装账号在线状态（Task1）+采集失败原因（Task3）+评论同步回复（Task4），证明本次上报的
// 信号真实有效，不是"写了没人读"的哑数据（decision 8dbe91ee 教训）。完整 UI 展示留给下一个 sprint。
acquisitionRouter.get('/leads/:id/signal-status', signalStatusRateLimit, tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;
  const leadId = req.params.id;
  if (!UUID_RE.test(leadId)) return fail(res, 404, 'LEAD_NOT_FOUND', '线索不存在');

  try {
    const leadRes = await pool.query<{ latest_reply: string | null; latest_reply_at: string | null }>(
      `SELECT latest_reply, latest_reply_at
         FROM zenithjoy.acquisition_leads WHERE id = $1 AND tenant_id = $2`,
      [leadId, tenantId]
    );
    if (leadRes.rows.length === 0) return fail(res, 404, 'LEAD_NOT_FOUND', '线索不存在');
    const lead = leadRes.rows[0];

    const onlineRes = await pool.query<{ account_label: string; status: string; last_heartbeat_at: string | null }>(
      `SELECT s.account_label, s.status, a.last_heartbeat_at
         FROM zenithjoy.agent_platform_sessions s
         JOIN zenithjoy.agents a ON a.id = s.agent_id AND a.tenant_id::text = $1
        WHERE s.role = 'burner' AND s.platform = 'douyin'`,
      [tenantId]
    );
    const accountOnline = onlineRes.rows.map((r) => ({
      account_label: r.account_label,
      status: r.status,
      heartbeat_fresh: r.last_heartbeat_at
        ? Date.now() - new Date(r.last_heartbeat_at).getTime() < 2 * 60 * 1000
        : false,
    }));

    const taskRes = await pool.query<{ error_code: string | null }>(
      `SELECT error_code FROM zenithjoy.acquisition_collect_tasks
        WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [tenantId]
    );

    return ok(res, {
      account_online: accountOnline,
      last_collect_error_code: taskRes.rows[0]?.error_code ?? null,
      latest_reply: lead.latest_reply,
      latest_reply_at: lead.latest_reply_at,
    });
  } catch (err) {
    return fail(res, 500, 'DB_ERROR', (err as Error).message);
  }
});

// Agent 轮询端点 — 返回待处理的 collect 任务（来自 collect/start 写入的 acquisition_collect_tasks）
// stage_1_done 任务也返回（Stage 2 重试，含视频 URL 列表）
// 用 x-agent-id 解析出请求方自己的 tenant_id + agent_id，只返回本租户内、
// 未绑机器或绑给自己的任务，防跨租户/跨机器抢占。
acquisitionRouter.get('/pending-collect-tasks', pendingCollectTasksRateLimit, async (req: Request, res: Response) => {
  try {
    const pool = (await import('../db/connection')).default;

    const xAgentId = req.header('x-agent-id') ?? '';
    if (!xAgentId) {
      return res.status(200).json({ tasks: [], total: 0 });
    }

    const agentRes = await pool.query<{ tenant_id: string; agent_id: string | null; id: string }>(
      `SELECT tenant_id, agent_id, id::text AS id FROM zenithjoy.agents WHERE agent_id = $1 OR id::text = $1 LIMIT 1`,
      [xAgentId]
    );
    const tenantId = agentRes.rows[0]?.tenant_id;
    if (!tenantId) {
      return res.status(200).json({ tasks: [], total: 0 });
    }
    // 真机复现(2026-07-17)：/collect/start 用 account_label 绑定小号时把 agents.agent_id
    // (文本slug) 写进 acquisition_collect_tasks.agent_id 列，但设备轮询这里发的是
    // agents.id(UUID)。任务表过滤必须同时认这两种形式，否则文本形式的 agent_id 列永远
    // 匹配不上 UUID header，接口静默返回空、真机采集任务永远卡在 pending。
    const canonicalTextAgentId = agentRes.rows[0]?.agent_id ?? xAgentId;
    const canonicalUuidId = agentRes.rows[0]?.id ?? xAgentId;

    const { rows } = await pool.query<{
      id: string;
      keywords: string[];
      tenant_id: string;
      status: string;
      checkpoint: {
        stage2_dispatch_counts?: Record<string, number>;
        media_kinds?: Record<string, string>;
      } | null;
    }>(
      `SELECT id, keywords, tenant_id, status, checkpoint
         FROM zenithjoy.acquisition_collect_tasks
        WHERE status IN ('pending', 'stage_1_done')
          AND tenant_id = $1
          AND (agent_id IS NULL OR agent_id = $2 OR agent_id = $3)
        ORDER BY created_at ASC
        LIMIT 5`,
      [tenantId, canonicalTextAgentId, canonicalUuidId]
    );

    // 只把 pending 任务标为 running；stage_1_done 保持不动（等 Stage 2 回报 terminal=done 后才转 done）
    const pendingIds = rows.filter((r) => r.status === 'pending').map((r) => r.id);
    if (pendingIds.length > 0) {
      await pool.query(
        `UPDATE zenithjoy.acquisition_collect_tasks
            SET status = 'running', agent_id = $2, updated_at = NOW()
          WHERE id = ANY($1::uuid[])`,
        [pendingIds, xAgentId]
      );
    }

    // 对 stage_1_done 的任务，补充已存视频 URL（agent 直接跑 Stage 2）。
    // 每视频派发计数存 checkpoint.stage2_dispatch_counts：超上限强制落章不再下发，
    // 全部耗尽 → 任务诚实结算 partial（防单个打不开的视频把任务拖进无限重发风暴）。
    const stage1DoneRows = rows.filter((r) => r.status === 'stage_1_done');
    const videoMap: Record<string, string[]> = {};
    const videoTitlesMap: Record<string, Record<string, string>> = {};
    const exhaustedTaskIds = new Set<string>();
    if (stage1DoneRows.length > 0) {
      // 只排除已明确 rejected 的视频；pending（默认值，client 尚未调 judge-video 前的
      // 常态）仍放行，避免在判决闸客户端接线完成前把 Stage2 主链路整体打断。
      const vRes = await pool.query<{ task_id: string; video_id: string; title: string | null }>(
        `SELECT task_id, video_id, title FROM zenithjoy.acquisition_collect_videos
          WHERE task_id = ANY($1::uuid[])
            AND comments_reported_at IS NULL
            AND judgment_status != 'rejected'
          ORDER BY created_at ASC`,
        [stage1DoneRows.map((r) => r.id)]
      );
      const pendingByTask: Record<string, string[]> = {};
      // 表主键是 (task_id, video_id)（2026-07-10 迁移改的，同一 video_id 可能出现在不同
      // task 里且 title 不同）——titleByTaskAndVideo 必须按 task_id 分桶，不能用全局
      // Record<videoId, title> 扁平存（会导致跨任务串 title）。
      const titleByTaskAndVideo: Record<string, Record<string, string>> = {};
      for (const v of vRes.rows) {
        (pendingByTask[v.task_id] ??= []).push(v.video_id);
        if (v.title) (titleByTaskAndVideo[v.task_id] ??= {})[v.video_id] = v.title;
      }
      for (const r of stage1DoneRows) {
        const pending = pendingByTask[r.id] ?? [];
        const counts: Record<string, number> = { ...(r.checkpoint?.stage2_dispatch_counts ?? {}) };
        const dispatchable = pending.filter((vid) => (counts[vid] ?? 0) < MAX_STAGE2_DISPATCHES_PER_VIDEO);
        const exhausted = pending.filter((vid) => (counts[vid] ?? 0) >= MAX_STAGE2_DISPATCHES_PER_VIDEO);
        if (exhausted.length > 0) {
          await pool.query(
            `UPDATE zenithjoy.acquisition_collect_videos
                SET comments_reported_at = NOW(), updated_at = NOW()
              WHERE task_id = $1 AND video_id = ANY($2::text[])`,
            [r.id, exhausted]
          );
        }
        if (dispatchable.length === 0) {
          if (exhausted.length > 0) {
            await pool.query(
              `UPDATE zenithjoy.acquisition_collect_tasks
                  SET status = 'partial', error_code = 'STAGE2_DISPATCH_EXHAUSTED',
                      ended_at = COALESCE(ended_at, NOW()), updated_at = NOW()
                WHERE id = $1`,
              [r.id]
            );
            exhaustedTaskIds.add(r.id);
          }
          continue;
        }
        for (const vid of dispatchable) counts[vid] = (counts[vid] ?? 0) + 1;
        await pool.query(
          `UPDATE zenithjoy.acquisition_collect_tasks
              SET checkpoint = jsonb_set(COALESCE(checkpoint, '{}'::jsonb), '{stage2_dispatch_counts}', $2::jsonb),
                  updated_at = NOW()
            WHERE id = $1`,
          [r.id, counts]
        );
        // Bug C：note 图文类型走 /note/ 深链，其余默认 /video/
        const mediaKinds = r.checkpoint?.media_kinds ?? {};
        videoMap[r.id] = dispatchable.map((vid) =>
          mediaKinds[vid] === 'note'
            ? `https://www.douyin.com/note/${vid}`
            : `https://www.douyin.com/video/${vid}`,
        );
        // title 随 URL 并列回传（videoId → title），Android AcquisitionCollectPollLoop
        // 靠它把 title 透传进 /judge-video——title 是"转写文案+title判定"(判定点1d078987)
        // 的第二个信号，2026-07-19 前 Stage2 判定时 Android 完全拿不到这个字段。
        const taskTitles = titleByTaskAndVideo[r.id] ?? {};
        const titles: Record<string, string> = {};
        for (const vid of dispatchable) {
          if (taskTitles[vid]) titles[vid] = taskTitles[vid];
        }
        videoTitlesMap[r.id] = titles;
      }
    }

    const tasks = rows.filter((r) => !exhaustedTaskIds.has(r.id)).map((r) => ({
      task_id: r.id,
      tenant_id: r.tenant_id,
      keywords: Array.isArray(r.keywords) ? r.keywords : [],
      stage: r.status === 'stage_1_done' ? ('stage_2' as const) : ('stage_1' as const),
      video_urls: r.status === 'stage_1_done' ? (videoMap[r.id] ?? []) : undefined,
      video_titles: r.status === 'stage_1_done' ? (videoTitlesMap[r.id] ?? {}) : undefined,
    }));

    return res.status(200).json({ tasks, total: tasks.length });
  } catch (err) {
    console.error('[acquisition] pending-collect-tasks error:', (err as Error).message);
    return res.status(200).json({ tasks: [], total: 0 });
  }
});

acquisitionRouter.get('/leads', tenantContextOptional, async (req: Request, res: Response) => {
  const { grade } = req.query;

  if (grade !== undefined && grade !== '') {
    if (!VALID_GRADES.includes(grade as Grade)) {
      return res.status(400).json({ error: 'INVALID_GRADE' });
    }
  }

  if (process.env.VITEST) {
    return res.status(200).json({ leads: [], total: 0 });
  }

  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(401).json({ error: 'NO_TENANT', message: '缺租户上下文（未登录或无 X-Tenant-Id）' });
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
      latest_reply: string | null;
      latest_reply_at: string | null;
      assignee: string | null;
      outreach_eligible: boolean | null;
    }

    const gradeClause = grade && typeof grade === 'string' ? `AND l.grade = $2` : '';
    const params: string[] = grade && typeof grade === 'string' ? [tenantId, grade] : [tenantId];

    const result = await pool.query<LeadRow>(
      `SELECT l.sec_uid, l.nickname, l.comment_text,
              l.source_video_ids, l.created_at, l.grade, l.keyword,
              l.latest_reply, l.latest_reply_at, l.assignee,
              l.outreach_eligible,
              t.keywords AS task_keywords
         FROM zenithjoy.acquisition_leads l
         LEFT JOIN zenithjoy.acquisition_collect_tasks t ON t.id = l.collect_task_id
        WHERE l.tenant_id = $1
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
        latest_reply: r.latest_reply ?? null,
        latest_reply_at: r.latest_reply_at ?? null,
        assignee: r.assignee ?? null,
        outreach_eligible: r.outreach_eligible ?? null,
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
  let agentId = typeof req.body?.agent_id === 'string' && req.body.agent_id.trim()
    ? req.body.agent_id.trim()
    : null;
  const accountLabel = typeof req.body?.account_label === 'string' && req.body.account_label.trim()
    ? req.body.account_label.trim()
    : null;

  try {
    if (!Array.isArray(keywords) || keywords.length === 0)
      return fail(res, 400, 'MISSING_KEYWORDS', 'keywords 不能为空');

    // 方案 D：选了抖音小号 → 任务必须派到持有该 session 的机器（物理约束，覆盖手选的 agent_id）
    if (accountLabel) {
      // TODO(follow-up，见 sprints/07212205-fix-dispatch-dedup-crosstenant)：LIMIT 1 无
      // ORDER BY，若同租户下同一 account_label 绑了两条 active session，取哪条不确定。
      // 跟 acquisition-dispatch.ts dispatchDue 那次 P0 修复是同一类问题（那边加了
      // ORDER BY s.bound_at DESC NULLS LAST 保证确定性），这里租户隔离本身没问题（INNER
      // JOIN + WHERE 天然排除跨租户），但确定性这半个问题还没堵，留着下次一起处理。
      const sessionRes = await pool.query<{ agent_id: string }>(
        `SELECT a.agent_id AS agent_id
           FROM zenithjoy.agent_platform_sessions s
           JOIN zenithjoy.agents a ON a.id = s.agent_id
          WHERE a.tenant_id = $1
            AND s.account_label = $2
            AND s.role = 'burner'
            AND s.status = 'active'
          LIMIT 1`,
        [tenantId, accountLabel]
      );
      const boundAgentId = sessionRes.rows[0]?.agent_id;
      if (!boundAgentId) {
        return fail(res, 400, 'BURNER_SESSION_NOT_FOUND', '该小号未绑定或 session 已过期，请重新扫码绑定');
      }
      agentId = boundAgentId;
    }

    // 异步检查主号 session（不阻塞采集任务创建）
    pool.query(
      `SELECT id FROM zenithjoy.line02_account_sessions WHERE tenant_id = $1 AND role = 'main' AND health = 'ok' LIMIT 1`,
      [tenantId]
    ).catch(() => {});

    const r = await pool.query(
      `INSERT INTO zenithjoy.acquisition_collect_tasks (tenant_id, keywords, source, status, agent_id)
       VALUES ($1, $2::jsonb, 'ai', 'pending', $3)
       RETURNING id`,
      [tenantId, JSON.stringify(keywords), agentId]
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

// POST /api/acquisition/account-scan/trigger — 手动触发账号扫描（sprint 07192358）
// 治根：DeviceAccountScanService 唯一触发路径是客户端 30-60 分钟随机被动定时器，
// 服务端此前完全没有主动催促通道。照抄 dispatchDue 的"写 publish_task + ws1 心跳
// 拉取"机制，延迟从最长一小时降到最坏约30秒。
acquisitionRouter.post(
  '/account-scan/trigger',
  tenantContextOptional,
  accountScanTriggerRateLimit,
  async (req: Request, res: Response) => {
    const tenantId = tenantOf(req, res);
    if (!tenantId) return;

    const agentRes = await pool.query<{ id: string }>(
      `SELECT id FROM zenithjoy.agents
        WHERE tenant_id = $1
          AND capabilities @> ARRAY['android']::text[]
          AND last_heartbeat_at > now() - interval '2 minutes'
        ORDER BY last_heartbeat_at DESC
        LIMIT 1`,
      [tenantId]
    );
    const agentId = agentRes.rows[0]?.id;
    if (!agentId) {
      return fail(res, 400, 'NO_ONLINE_ANDROID_AGENT', '未检测到在线的安卓设备，请先确认手机 App 在运行');
    }

    // payload JSON 必须自带 task_type：walking-skeleton.ts 心跳拉取端点下发给设备的
    // task.payload 只来自本列，DB COLUMN task_type 从不透传给设备（对照 agent-burner.ts
    // 的 dm_outreach 写法）。只设 COLUMN 不设 payload 会导致任务写进库但设备永远读不到、
    // 静默不执行。
    const taskRes = await pool.query<{ id: string }>(
      `INSERT INTO zenithjoy.publish_tasks
         (agent_id, platform, status, task_type, payload, tenant_id, created_at, updated_at)
       VALUES ($1, 'douyin', 'queued', 'account_scan', $2, $3, NOW(), NOW())
       RETURNING id`,
      [agentId, JSON.stringify({ task_type: 'account_scan' }), tenantId]
    );

    return ok(res, { task_id: taskRes.rows[0].id });
  }
);

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

// POST /api/acquisition/collect/report-videos — Stage1 视频清单回报（幂等可重入）
// 鉴权：x-agent-id 反查 tenant → 任务按 (id, tenant_id) 查 → agent 绑定校验。
// 幂等：ON CONFLICT (task_id, video_id) + video_count 按 distinct 重算，重复回报同结果不重计数。
acquisitionRouter.post('/collect/report-videos', async (req: Request, res: Response) => {
  const { task_id: taskId, videos, reason } = req.body || {};
  if (!taskId) return fail(res, 400, 'MISSING_TASK_ID', '缺 task_id');

  const xAgentId = req.header('x-agent-id') ?? '';
  if (!xAgentId) return fail(res, 401, 'MISSING_AGENT_ID', '缺 x-agent-id');
  const agentRes = await pool.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM zenithjoy.agents WHERE agent_id = $1 OR id::text = $1 LIMIT 1`,
    [xAgentId]
  );
  const tenantId = agentRes.rows[0]?.tenant_id;
  if (!tenantId) return fail(res, 403, 'UNKNOWN_AGENT', 'agent 未注册');

  // 原始上报：保留带 video_id（旧 agent 直传）或 share_url（新 agent 经 share-intent 拿短链）的项
  const rawList: Array<{ video_id?: string; share_url?: string; title?: string; thumbnail_url?: string; publish_date?: string }> =
    Array.isArray(videos) ? videos.filter((v) => v && (v.video_id || v.share_url)) : [];
  const searchEmpty = reason?.search_result === 'empty';
  // FR-2: error_code 白名单校验（非枚举值 normalize 为 UNKNOWN）
  const rawReasonErrorCode: string | null = reason?.error_code ?? null;
  const reasonErrorCode: string | null = normalizeReportErrorCode(rawReasonErrorCode);
  if (rawList.length === 0 && !searchEmpty && !reasonErrorCode) {
    return fail(res, 400, 'MISSING_REASON', '空清单必须带 reason（search_result=empty 或 error_code）');
  }

  // Bug C：video_id 非空 → 直接信任旧 agent；否则用 share_url 经服务端跟随 302 解析真实 (kind,id)，
  // 解析失败的卡片跳过不造假。note 图文类型记入 media_kinds，供 Stage2 深链按类型分流。
  const list: Array<{ video_id: string; title?: string; thumbnail_url?: string; publish_date?: string }> = [];
  const mediaKinds: Record<string, MediaKind> = {};
  for (const v of rawList) {
    if (v.video_id) {
      list.push({ video_id: v.video_id, title: v.title, thumbnail_url: v.thumbnail_url, publish_date: v.publish_date });
    } else if (v.share_url) {
      const media = await resolveShareToMedia(v.share_url);
      if (!media) continue; // 死链/登录页/非抖音域名 → 跳过不造假
      list.push({ video_id: media.id, title: v.title, thumbnail_url: v.thumbnail_url, publish_date: v.publish_date });
      if (media.kind === 'note') mediaKinds[media.id] = 'note';
    }
  }

  const client = await pool.connect();
  let sseEvent: { terminal: boolean; payload: Record<string, unknown> } | null = null;
  try {
    await client.query('BEGIN');
    const taskRes = await client.query(
      `SELECT id, tenant_id, status, agent_id, lead_count_raw
         FROM zenithjoy.acquisition_collect_tasks
        WHERE id = $1 AND tenant_id = $2
        FOR UPDATE`,
      [taskId, tenantId]
    );
    if (taskRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return fail(res, 404, 'NO_COLLECT_TASK', '采集任务不存在');
    }
    const task = taskRes.rows[0] as { id: string; status: string; agent_id: string | null; lead_count_raw: number };
    if (task.agent_id && task.agent_id !== xAgentId) {
      await client.query('ROLLBACK');
      return fail(res, 403, 'AGENT_MISMATCH', '任务已绑定其他 agent');
    }
    if ((TERMINAL_COLLECT_STATUSES as readonly string[]).includes(task.status)) {
      await client.query('ROLLBACK');
      return fail(res, 409, 'TASK_TERMINAL', `任务已终态 ${task.status}`);
    }
    if (task.status === 'cancelling') {
      // 唯一落章路径：cancelling → cancelled（settleCollectTask 语义）
      const s = settleCollectTask({ currentStatus: 'cancelling', videoTotal: 0, videoDone: 0, leadCount: task.lead_count_raw });
      await client.query(
        `UPDATE zenithjoy.acquisition_collect_tasks
            SET status = 'cancelled', ended_at = COALESCE(ended_at, NOW()), updated_at = NOW()
          WHERE id = $1`,
        [taskId]
      );
      await client.query('COMMIT');
      sseService.close(taskId, { task_id: taskId, status: s.status });
      return ok(res, { task_id: taskId, status: s.status, video_count: 0, accepted: 0 });
    }

    if (list.length === 0) {
      // 空清单终态：empty → partial(stage1_empty)；error_code / 卡片全解析失败 → failed（checkpoint 保留可重试）
      // 2026-07-28 rescue #1456：用 rawReasonErrorCode（未归一的真实原始值）而非 reasonErrorCode
      // （FR-2 在 L843 已提前 normalize 过一次）——否则下面 rawFailCode !== 'UNKNOWN' 的留证判断
      // 永远拿到已经被归一过的值，非枚举原始错误码（如 ALL_SHARE_FAILED）永远进不了
      // checkpoint.raw_error_code，等于 #1484 的留证机制被 FR-2 的提前归一悄悄短路。
      const rawFailCode = rawReasonErrorCode ?? (rawList.length > 0 ? 'ALL_RESOLVE_FAILED' : null);
      // ALL_RESOLVE_FAILED 是本端点自己合成的已知信号（卡片全解析失败），不是 Android 传来的
      // 未知码，须显式映射到 PLATFORM_LIMITED，不能走 normalizeCollectErrorCode 白名单兜底
      // 被误判成 UNKNOWN（全分支复审 Important finding）。
      const failCode = rawFailCode === 'ALL_RESOLVE_FAILED'
        ? 'PLATFORM_LIMITED'
        : normalizeCollectErrorCode(rawFailCode);
      let rawErrorCheckpoint: string | null = null;
      if (failCode === 'UNKNOWN' && rawFailCode !== 'UNKNOWN') {
        console.warn(`[acquisition] collect/report-videos error_code 归一为 UNKNOWN，原始值：task=${taskId} raw=${rawFailCode}`);
        rawErrorCheckpoint = JSON.stringify({ raw_error_code: rawFailCode });
      }
      const s = settleCollectTask({
        currentStatus: task.status === 'pending' ? 'running' : task.status,
        agentTerminal: searchEmpty
          ? { terminal: 'partial', partial_reason: 'stage1_empty' }
          : { terminal: 'failed', error_code: failCode },
        videoTotal: 0,
        videoDone: 0,
        leadCount: task.lead_count_raw,
      });
      await client.query(
        `UPDATE zenithjoy.acquisition_collect_tasks
            SET status = $2, error_code = $3,
                checkpoint = CASE WHEN $4::jsonb IS NOT NULL
                             THEN COALESCE(checkpoint, '{}'::jsonb) || $4::jsonb
                             ELSE checkpoint END,
                started_at = COALESCE(started_at, NOW()),
                ended_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [taskId, s.status, s.error_code, rawErrorCheckpoint]
      );
      await client.query('COMMIT');
      sseService.close(taskId, { task_id: taskId, status: s.status, video_count: 0 });
      return ok(res, { task_id: taskId, status: s.status, video_count: 0, accepted: 0 });
    }

    for (const v of list) {
      await client.query(
        `INSERT INTO zenithjoy.acquisition_collect_videos
           (video_id, task_id, tenant_id, title, thumbnail_url, publish_date, comment_count)
         VALUES ($1, $2, $3, $4, $5, $6, 0)
         ON CONFLICT (task_id, video_id) DO UPDATE
           SET title         = COALESCE(EXCLUDED.title, zenithjoy.acquisition_collect_videos.title),
               thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, zenithjoy.acquisition_collect_videos.thumbnail_url),
               publish_date  = COALESCE(EXCLUDED.publish_date, zenithjoy.acquisition_collect_videos.publish_date),
               updated_at    = NOW()`,
        [v.video_id, taskId, tenantId, v.title ?? null, v.thumbnail_url ?? null, v.publish_date ?? null]
      );
    }
    const vcRes = await client.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM zenithjoy.acquisition_collect_videos WHERE task_id = $1`,
      [taskId]
    );
    const total = vcRes.rows[0]?.total ?? list.length;
    if (Object.keys(mediaKinds).length > 0) {
      // note 图文类型合并进 checkpoint.media_kinds，供 pending-collect-tasks 分流 Stage2 深链
      await client.query(
        `UPDATE zenithjoy.acquisition_collect_tasks
            SET status = 'stage_1_done', agent_id = COALESCE(agent_id, $2), video_count = $3,
                checkpoint = COALESCE(checkpoint, '{}'::jsonb)
                  || jsonb_build_object('media_kinds',
                       COALESCE(checkpoint->'media_kinds', '{}'::jsonb) || $4::jsonb),
                started_at = COALESCE(started_at, NOW()), updated_at = NOW()
          WHERE id = $1`,
        [taskId, xAgentId, total, JSON.stringify(mediaKinds)]
      );
    } else {
      await client.query(
        `UPDATE zenithjoy.acquisition_collect_tasks
            SET status = 'stage_1_done', agent_id = COALESCE(agent_id, $2), video_count = $3,
                started_at = COALESCE(started_at, NOW()), updated_at = NOW()
          WHERE id = $1`,
        [taskId, xAgentId, total]
      );
    }
    await client.query('COMMIT');
    sseEvent = { terminal: false, payload: { task_id: taskId, status: 'stage_1_done', video_count: total } };
    return ok(res, { task_id: taskId, status: 'stage_1_done', video_count: total, accepted: list.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(res, 500, 'DB_ERROR', (err as Error).message);
  } finally {
    client.release();
    if (sseEvent) sseService.emit(taskId, sseEvent.payload);
  }
});

// POST /api/acquisition/collect/report — 客户机 Agent 增量回报（无需 smoke token，agent 直接调用；
// 不加鉴权：在网旧 agent 会断。终态守卫返回 200+ignored（非 409，防旧 agent 对非 200 死循环重试）。
acquisitionRouter.post('/collect/report', collectReportRateLimit, async (req: Request, res: Response) => {
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
    reason,
    latest_reply: latestReply,
    latest_reply_at: latestReplyAt,
  } = req.body || {};

  if (!taskId) return fail(res, 400, 'MISSING_TASK_ID', '缺 task_id');
  // FR-2/FR-3: video_id 在纯信号上报（reason.error_code / latest_reply / terminal）时可选；
  // 若同时传 commenters/comments 但无 video_id → 仍报错（commenters 需绑定到具体视频）
  const hasSignalOnly = !commenters && !req.body?.comments && (reason?.error_code || latestReply || terminal);
  if (!videoId && !hasSignalOnly) return fail(res, 400, 'MISSING_VIDEO_ID', '缺 video_id');

  const batch: Array<{ sec_uid?: string | null; nickname: string; comment_text?: string; grade?: string; keyword?: string; douyin_id?: string | null }> =
    Array.isArray(commenters) ? commenters : [];

  // ── 评论意向分档判定（decision 4e421ae8）：批量对这一批评论调 LLM 判档，结果覆盖
  // c.grade（客户端从不传这个字段，见 CommentEntry.toCollectReportMap）。
  // ⚠️ 故意放在 pool.connect()/BEGIN 事务之前、用未加锁的 pool 而非事务 client 查询：
  // gradeComments() 是一次外部 HTTP 调用（ToAPIs/DeepSeek），超时上限 20s。如果放在事务内，
  // 会在持有 acquisition_collect_tasks 的 FOR UPDATE 行锁期间干等这次网络往返，把同一
  // collect_task 的并发 /collect/report 请求排队卡最长 20s，还白占一个 DB 连接池连接。
  // 这里的 tenant_id/status 预读只是为了拼判定请求 + 省一次白打的 LLM 调用，不是权威判断——
  // task 是否存在/终态/cancelling 仍然全部在下面事务内的 FOR UPDATE 读上做，未加锁的预读
  // 结果不参与任何分支决策、不影响客户端最终收到的响应，容忍与 tenant_id 预读同等级的
  // 良性竞态（预读之后到权威读之前状态发生变化，最坏结果只是多打/少打一次判定调用）。
  let grades: (string | null)[] = batch.map(() => null);
  if (batch.length > 0) {
    const preTaskRes = await pool.query<{ tenant_id: string; status: string }>(
      `SELECT tenant_id, status FROM zenithjoy.acquisition_collect_tasks WHERE id = $1`,
      [taskId]
    );
    const preTenantId = preTaskRes.rows[0]?.tenant_id ?? null;
    const preStatus = preTaskRes.rows[0]?.status ?? null;
    const preIsTerminalOrCancelling =
      preStatus !== null &&
      ((TERMINAL_COLLECT_STATUSES as readonly string[]).includes(preStatus) || preStatus === 'cancelling');
    if (preTenantId && !preIsTerminalOrCancelling) {
      const videoInfoRes = await pool.query<{ title: string | null; transcript: string | null }>(
        `SELECT title, transcript FROM zenithjoy.acquisition_collect_videos WHERE task_id = $1 AND video_id = $2`,
        [taskId, videoId]
      );
      const videoTitleForGrading = videoInfoRes.rows[0]?.title ?? videoTitle ?? null;
      const videoTranscript = videoInfoRes.rows[0]?.transcript ?? null;
      const gradingConfigRes = await pool.query<{ target_profile_desc: string | null }>(
        `SELECT target_profile_desc FROM zenithjoy.acquisition_config WHERE tenant_id = $1 LIMIT 1`,
        [preTenantId]
      );
      const targetProfileDescForGrading = gradingConfigRes.rows[0]?.target_profile_desc ?? '';
      grades = await gradeComments(
        targetProfileDescForGrading,
        videoTitleForGrading,
        videoTranscript,
        batch.map((c) => ({ commentText: c.comment_text })),
      );
    }
    // preTenantId 为空（任务不存在/竞态）或 preIsTerminalOrCancelling 为真（任务已终态/
    // cancelling，大概率是旧 agent 对本路由的死循环重试，见路由顶部注释）→ 不判定，grades
    // 保持全 null；下面事务内的权威 FOR UPDATE 读会照常做终态/cancelling/404 判断并决定
    // 真正返回给客户端的响应，不受这里跳没跳判定影响。
  }

  const client = await pool.connect();
  // COMMIT 后才发的副作用（SSE / dispatch），事务内只记录不执行
  let afterCommit: (() => void) | null = null;
  try {
    await client.query('BEGIN');
    const taskRes = await client.query(
      `SELECT id, tenant_id, status, error_code, video_count, lead_count_raw, keywords
         FROM zenithjoy.acquisition_collect_tasks WHERE id = $1
         FOR UPDATE`,
      [taskId]
    );
    if (taskRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return fail(res, 404, 'NO_COLLECT_TASK', '采集任务不存在');
    }
    const task = taskRes.rows[0] as {
      id: string; tenant_id: string; status: string; error_code: string | null;
      video_count: number; lead_count_raw: number; keywords: string[] | null;
    };
    const tenantId = task.tenant_id;

    // ── 终态守卫：终态任务回报 → 200 + ignored，零写库 ──
    if ((TERMINAL_COLLECT_STATUSES as readonly string[]).includes(task.status)) {
      await client.query('ROLLBACK');
      return ok(res, { task_id: taskId, ignored: true, status: task.status });
    }
    // ── cancelling → 落章 cancelled（唯一落章路径），不再写数据 ──
    if (task.status === 'cancelling') {
      const s = settleCollectTask({ currentStatus: 'cancelling', videoTotal: 0, videoDone: 0, leadCount: task.lead_count_raw });
      await client.query(
        `UPDATE zenithjoy.acquisition_collect_tasks
            SET status = $2, ended_at = COALESCE(ended_at, NOW()), updated_at = NOW()
          WHERE id = $1`,
        [taskId, s.status]
      );
      await client.query('COMMIT');
      sseService.close(taskId, { task_id: taskId, status: s.status });
      return ok(res, { task_id: taskId, ignored: true, status: s.status });
    }

    // FR-3: latest_reply 留证前先拍一份"本请求开始前"的快照——commenters 循环里
    // rescoreLead 也会把 latest_reply/latest_reply_at 改写成"最新一条公开评论"，
    // 如果 FR-3 的"只前进不回退"判断跟活的列值比，会永远输给 rescoreLead 刚写完的
    // NOW()（2026-07-28 rescue #1456 实测复现：commenters 和 latest_reply 同一请求
    // 一起传时，latest_reply 显式信号被 rescoreLead 的评论文本悄悄覆盖）。改成跟
    // "进这个事务之前"的旧值比，FR-3 信号不再输给同一请求里稍早跑的 rescoreLead。
    const preLatestReplyRes = await client.query<{ max_at: string | null }>(
      `SELECT MAX(latest_reply_at) AS max_at FROM zenithjoy.acquisition_leads WHERE collect_task_id = $1 AND tenant_id = $2`,
      [taskId, tenantId]
    );
    const preExistingLatestReplyAt = preLatestReplyRes.rows[0]?.max_at ?? null;

    // ── 去重落库：先处理 commenters（已抓先落库不丢，即使本次是终态回报）──
    let inserted = 0;
    let deduped = 0;
    const seenSec = new Set<string>();
    const seenNick = new Set<string>();

    for (const [index, c] of batch.entries()) {
      const secUid = c.sec_uid ?? null;
      // 「宁可空，不可猜」（PR #1306 同款规则）：读不到号 / 空白 → null，绝不用昵称/URL 顶替。
      const douyinId = String(c.douyin_id ?? '').trim() || null;
      let matchId: string | null = null;
      if (secUid) {
        if (seenSec.has(secUid)) matchId = 'batch';
        else {
          const found = await client.query(
            `SELECT id FROM zenithjoy.acquisition_leads WHERE tenant_id = $1 AND sec_uid = $2 LIMIT 1`,
            [tenantId, secUid]
          );
          if (found.rows.length > 0) matchId = found.rows[0].id;
        }
      } else {
        if (seenNick.has(c.nickname)) matchId = 'batch';
        else {
          const found = await client.query(
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
          // 重复仅累加来源 video_id（不重复建 lead 行）——但评论内容/grade 仍进历史表，不再丢。
          // douyin_id 用 COALESCE 回填：存量 lead（没有列的年代采的）再次被采到时补号，
          // 但绝不能把已有的号覆盖成 NULL（本次批次没读到号是常态，不是"号被撤销"）。
          await client.query(
            `UPDATE zenithjoy.acquisition_leads
                SET source_video_ids = CASE
                      WHEN source_video_ids ? $2 THEN source_video_ids
                      ELSE source_video_ids || to_jsonb($2::text)
                    END,
                    douyin_id = COALESCE(douyin_id, $3),
                    updated_at = NOW()
              WHERE id = $1`,
            [matchId, videoId, douyinId]
          );
          await client.query(
            `INSERT INTO zenithjoy.acquisition_lead_comments
               (lead_id, video_id, comment_text, grade, commented_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [matchId, videoId, c.comment_text ?? null, grades[index] ?? c.grade ?? null]
          );
          await rescoreLead(client, tenantId, matchId); // 事务内传 client，别传 pool（读不到未提交数据）
        }
        continue;
      }

      inserted += 1;
      if (secUid) seenSec.add(secUid);
      else seenNick.add(c.nickname);
      const insRes = await client.query(
        `INSERT INTO zenithjoy.acquisition_leads
           (tenant_id, collect_task_id, sec_uid, nickname, profile_url, partial, source_video_ids,
            comment_text, grade, keyword, douyin_id, feishu_write_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, 'local_only')
         RETURNING id`,
        [tenantId, taskId, secUid, c.nickname, secUid ? profileUrlForSecUid(secUid) : c.nickname, false,
         JSON.stringify([videoId]), c.comment_text ?? null, grades[index] ?? c.grade ?? null, c.keyword ?? keyword ?? null, douyinId]
      );
      const newLeadId = insRes.rows[0].id as string;
      // 首条留言也进历史表（不只老用户才进），再 rescore 汇总
      await client.query(
        `INSERT INTO zenithjoy.acquisition_lead_comments
           (lead_id, video_id, comment_text, grade, commented_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [newLeadId, videoId, c.comment_text ?? null, grades[index] ?? c.grade ?? null]
      );
      await rescoreLead(client, tenantId, newLeadId);
    }

    // ── 视频维度：只接受 Stage1 登记过的 (task_id, video_id)。agent 对非数字 ID 会
    // hash fallback 出假 video_id，盲 upsert 会污染视频表且原登记行永不落章 → 重发风暴 ──
    // FR-2/FR-3: video_id 为空（纯信号上报）时跳过视频行写入
    if (videoId) {
      const regRes = await client.query(
        `SELECT 1 FROM zenithjoy.acquisition_collect_videos
          WHERE task_id = $1 AND video_id = $2 LIMIT 1`,
        [taskId, videoId]
      );
      if (regRes.rows.length === 0) {
        console.warn(`[acquisition] collect/report 拒绝未登记 video_id：task=${taskId} video=${videoId}（视频行不写，leads 照常）`);
      } else {
        await client.query(
          `INSERT INTO zenithjoy.acquisition_collect_videos
             (video_id, task_id, tenant_id, title, thumbnail_url, publish_date, comment_count, comments_reported_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (task_id, video_id) DO UPDATE
             SET comment_count        = zenithjoy.acquisition_collect_videos.comment_count + EXCLUDED.comment_count,
                 title                = COALESCE(EXCLUDED.title, zenithjoy.acquisition_collect_videos.title),
                 thumbnail_url        = COALESCE(EXCLUDED.thumbnail_url, zenithjoy.acquisition_collect_videos.thumbnail_url),
                 publish_date         = COALESCE(EXCLUDED.publish_date, zenithjoy.acquisition_collect_videos.publish_date),
                 comments_reported_at = NOW(),
                 updated_at           = NOW()`,
          [videoId, taskId, tenantId, videoTitle ?? null, thumbnailUrl ?? null, publishDate ?? null, batch.length]
        );
      }
    }

    // ── 计数重算 + settle 结算（倒推逻辑已删，Stage1 推进只走 report-videos）──
    const vcRes = await client.query<{ total: number; done: number }>(
      `SELECT count(*)::int AS total, count(comments_reported_at)::int AS done
         FROM zenithjoy.acquisition_collect_videos WHERE task_id = $1`,
      [taskId]
    );
    const videoTotal = vcRes.rows[0]?.total ?? 0;
    const videoDone = vcRes.rows[0]?.done ?? 0;
    const leadCountAfter = task.lead_count_raw + batch.length;
    // FR-2: error_code 白名单校验（reason.error_code 或 body.error_code，同名合并处理）
    // reason.error_code 优先（FR-2 测试格式），其次 body 顶层 error_code（历史兼容）
    // 2026-07-28 rescue #1456：与 #1484（已上线）的 raw_error_code 留证行为合并——
    // 归一为 UNKNOWN 时，原始值（不管来自 reason.error_code 还是 body.error_code）写入
    // checkpoint.raw_error_code，不再让真实报错码丢失在 UNKNOWN 兜底里。
    const rawReasonErrorCode = reason?.error_code ?? null;
    const rawBodyErrorCode = typeof errorCode === 'string' ? errorCode : null;
    const rawErrorCodeInput = rawReasonErrorCode ?? rawBodyErrorCode;
    const normalizedErrorCode = normalizeReportErrorCode(rawErrorCodeInput);
    let checkpointToWrite: Record<string, unknown> | null =
      checkpoint && typeof checkpoint === 'object' ? checkpoint : null;
    if (normalizedErrorCode === 'UNKNOWN' && rawErrorCodeInput && rawErrorCodeInput !== 'UNKNOWN') {
      console.warn(`[acquisition] collect/report error_code 归一为 UNKNOWN，原始值：task=${taskId} raw=${rawErrorCodeInput}`);
      checkpointToWrite = { ...(checkpointToWrite ?? {}), raw_error_code: rawErrorCodeInput };
    }

    // FR-3: latest_reply 时间戳只向前不回退——跟"进事务前"的快照 preExistingLatestReplyAt
    // 比，不跟活的列值比（commenters 循环里 rescoreLead 会把 latest_reply_at 改写成
    // NOW()，跟活值比会导致 FR-3 显式信号永远输给同一请求里刚跑完的 rescoreLead）。
    const safeLatestReply = typeof latestReply === 'string' && latestReply.trim() ? latestReply.trim() : null;
    if (safeLatestReply) {
      const safeLatestReplyAt = typeof latestReplyAt === 'string' && latestReplyAt.trim()
        ? latestReplyAt.trim()
        : new Date().toISOString();
      const shouldAdvance = preExistingLatestReplyAt === null
        || new Date(safeLatestReplyAt).getTime() > new Date(preExistingLatestReplyAt).getTime();
      if (shouldAdvance) {
        // 从 acquisition_collect_tasks 反查 lead：按 task_id 找该任务下全部 lead 行
        await client.query(
          `UPDATE zenithjoy.acquisition_leads
              SET latest_reply    = $3,
                  latest_reply_at = $4::timestamptz,
                  updated_at      = NOW()
            WHERE collect_task_id = $1 AND tenant_id = $2`,
          [taskId, tenantId, safeLatestReply, safeLatestReplyAt],
        );
      }
    }

    const s = settleCollectTask({
      currentStatus: task.status === 'pending' ? 'running' : task.status,
      agentTerminal: terminal ? { terminal, error_code: normalizedErrorCode, partial_reason: partialReason } : null,
      videoTotal,
      videoDone,
      leadCount: leadCountAfter,
    });
    const newStatus = s.changed ? s.status : (task.status === 'pending' ? 'running' : task.status);
    const newErrorCode = s.changed ? s.error_code : task.error_code;
    const isTerminal = (TERMINAL_COLLECT_STATUSES as readonly string[]).includes(newStatus);

    await client.query(
      `UPDATE zenithjoy.acquisition_collect_tasks
          SET status         = $2,
              error_code     = $3,
              video_count    = $4,
              lead_count_raw = lead_count_raw + $5,
              checkpoint     = COALESCE($6::jsonb, checkpoint),
              started_at     = COALESCE(started_at, NOW()),
              ended_at       = CASE WHEN $7 THEN COALESCE(ended_at, NOW()) ELSE ended_at END,
              updated_at     = NOW()
        WHERE id = $1`,
      [taskId, newStatus, newErrorCode, videoTotal, batch.length,
       checkpointToWrite ? JSON.stringify(checkpointToWrite) : null, isTerminal]
    );
    await client.query('COMMIT');

    // ── COMMIT 之后：SSE + dispatch（只在本次真进终态且任务有 leads 时点火一次）──
    afterCommit = () => {
      const ssePayload = { task_id: taskId, status: newStatus, video_count: videoTotal, lead_count_raw: leadCountAfter };
      if (isTerminal) sseService.close(taskId, ssePayload);
      else sseService.emit(taskId, ssePayload);
      if (s.changed && isTerminal && leadCountAfter > 0) {
        void scoreLeads(pool, tenantId)
          .then(() => buildAssignments(pool, tenantId))
          .then(() => dispatchDue(pool, tenantId))
          .catch((e: Error) => console.error('[acquisition] collect/report dm-dispatch error:', e.message));
      }
    };

    return ok(res, {
      task_id: taskId,
      inserted,
      deduped,
      lead_write_status: 'local_only',
      status: newStatus,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(res, 500, 'DB_ERROR', (err as Error).message);
  } finally {
    client.release();
    if (afterCommit) afterCommit();
  }
});

// running 基准 COALESCE(started_at, updated_at, created_at)；stage_1_done 基准 updated_at
//（Stage2 每次 report 都 touch updated_at，用 started_at 会误杀正在跑 Stage2 的任务）。
// 2026-07-28 issue：本函数此前只挂在 HTTP 路由下，没有任何调度器调用它——代码写好了但从
// 没上线生效，卡 running/stage_1_done 的任务会无限期挂着不收尾。抽成独立函数供 scheduler.ts
// 定时调用，避免 HTTP self-call 往返（同 dispatchDue 直接 import 调用的既有模式）。
export async function sweepCollectTimeouts(): Promise<{ swept: number }> {
  const cutoffMs = SWEEP_TIMEOUT_MS;
  const { rows } = await pool.query<{ id: string; tenant_id: string; status: string; lead_count: number }>(
    `SELECT t.id, t.tenant_id, t.status,
            (SELECT count(*) FROM zenithjoy.acquisition_leads l WHERE l.collect_task_id = t.id)::int AS lead_count
       FROM zenithjoy.acquisition_collect_tasks t
      WHERE (t.status = 'running'
             AND COALESCE(t.started_at, t.updated_at, t.created_at) < NOW() - ($1::int || ' milliseconds')::interval)
         OR (t.status = 'stage_1_done'
             AND t.updated_at < NOW() - ($1::int || ' milliseconds')::interval)`,
    [cutoffMs]
  );
  let swept = 0;
  const dispatchTenants = new Set<string>();
  for (const t of rows) {
    const s = settleCollectTask({
      currentStatus: t.status,
      agentTerminal: t.lead_count > 0
        ? { terminal: 'partial', partial_reason: 'COLLECT_TIMEOUT' }
        : { terminal: 'failed', error_code: 'COLLECT_TIMEOUT' },
      videoTotal: 0,
      videoDone: 0,
      leadCount: t.lead_count,
    });
    if (!s.changed) continue;
    const r = await pool.query(
      `UPDATE zenithjoy.acquisition_collect_tasks
          SET status = $2, error_code = COALESCE(error_code, $3),
              ended_at = COALESCE(ended_at, NOW()), updated_at = NOW()
        WHERE id = $1 AND status = $4
        RETURNING id`,
      [t.id, s.status, s.error_code, t.status]
    );
    swept += r.rows.length;
    if (r.rows.length > 0 && s.status === 'partial' && t.lead_count > 0 && t.tenant_id) {
      dispatchTenants.add(t.tenant_id);
    }
  }
  // sweep 收尸为 partial 且有 leads 的任务，补一次 dm-dispatch 链（同租户去重只触发一次）
  for (const tenantId of dispatchTenants) {
    void scoreLeads(pool, tenantId)
      .then(() => buildAssignments(pool, tenantId))
      .then(() => dispatchDue(pool, tenantId))
      .catch((e: Error) => console.error('[acquisition] sweep-timeouts dm-dispatch error:', e.message));
  }
  return { swept };
}

// POST /api/acquisition/collect/sweep-timeouts — stale running + stage_1_done 收尸；pending(离线) 保留不丢
acquisitionRouter.post('/collect/sweep-timeouts', smokeOrAgentGate, async (_req: Request, res: Response) => {
  const result = await sweepCollectTimeouts();
  return ok(res, result);
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

// ============================================================================
// content-judgment-gate — 视频内容判决闸（Sprint 07120952）
//   POST /judge-video          视频截图/录音上报 → Gemini 判决 → matched/rejected/pending
//   POST /rescore-lead         重算单个 lead 的 relevance_score + outreach_eligible
//   POST /build-assignments    手动触发 DM 指派（含 outreach_eligible 过滤）
//   PATCH /config              更新配置（含 target_profile_desc）
// ============================================================================

// POST /api/acquisition/judge-video — 内容判决（commit-4）
acquisitionRouter.post('/judge-video', async (req: Request, res: Response) => {
  // 安卓 agent 按设计发 X-Tenant-Id = agentId（设备不持有真 tenant），不能信 header。
  // 与 pending-collect-tasks / report-videos 一致：用 x-agent-id 反查真 tenant_id。
  const xAgentId = req.header('x-agent-id') ?? '';
  if (!xAgentId) return fail(res, 401, 'MISSING_AGENT_ID', '缺 x-agent-id');
  const agentRes = await pool.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM zenithjoy.agents WHERE agent_id = $1 OR id::text = $1 LIMIT 1`,
    [xAgentId]
  );
  const tenantId = agentRes.rows[0]?.tenant_id;
  if (!tenantId) return fail(res, 403, 'AGENT_NOT_FOUND', 'agent 未注册/未知');

  const {
    video_id: videoId,
    capture_type: captureType,
    data_b64: dataB64,
    force_result: forceResult,
    force_timeout: forceTimeout,
    title,
  } = req.body ?? {};

  if (!videoId || typeof videoId !== 'string') {
    return fail(res, 400, 'MISSING_VIDEO_ID', '缺 video_id');
  }
  if (!captureType || typeof captureType !== 'string') {
    return fail(res, 400, 'MISSING_CAPTURE_TYPE', '缺 capture_type');
  }
  if (typeof dataB64 !== 'string') {
    return fail(res, 400, 'MISSING_DATA_B64', '缺 data_b64');
  }

  try {
    const result = await judgeVideo(
      pool,
      tenantId,
      videoId,
      captureType,
      dataB64,
      forceResult,
      forceTimeout === true,
      typeof title === 'string' ? title : undefined,
    );
    return ok(res, result);
  } catch (err) {
    console.error('[acquisition] judge-video error:', (err as Error).message);
    return fail(res, 500, 'JUDGE_ERROR', (err as Error).message);
  }
});

// POST /api/acquisition/rescore-lead — 重算 lead 分数 + outreach_eligible（commit-4/5）
acquisitionRouter.post('/rescore-lead', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;

  const { lead_id: leadId } = req.body ?? {};
  if (!leadId || typeof leadId !== 'string') {
    return fail(res, 400, 'MISSING_LEAD_ID', '缺 lead_id');
  }

  try {
    const result = await rescoreLead(pool, tenantId, leadId);
    return ok(res, result);
  } catch (err) {
    console.error('[acquisition] rescore-lead error:', (err as Error).message);
    return fail(res, 500, 'RESCORE_ERROR', (err as Error).message);
  }
});

// POST /api/acquisition/build-assignments — 手动触发 DM 指派（commit-4/5）
acquisitionRouter.post('/build-assignments', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;

  try {
    const result = await buildAssignments(pool, tenantId);
    return ok(res, result);
  } catch (err) {
    console.error('[acquisition] build-assignments error:', (err as Error).message);
    return fail(res, 500, 'BUILD_ASSIGNMENTS_ERROR', (err as Error).message);
  }
});

// PATCH /api/acquisition/config — 更新配置（含 target_profile_desc）（commit-4）
acquisitionRouter.patch('/config', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;

  const patch = req.body ?? {};
  if (typeof patch !== 'object') {
    return fail(res, 400, 'INVALID_BODY', '请求体应为 JSON 对象');
  }

  try {
    const saved = await upsertConfig(pool, tenantId, patch);
    // upsertConfig 返回 AcquisitionConfig，需要补充 target_profile_desc（不在标准类型里）
    const targetProfileDesc = typeof patch.target_profile_desc === 'string'
      ? patch.target_profile_desc
      : undefined;

    // 如果 patch 包含 target_profile_desc，单独写入（因为 upsertConfig sanitizePatch 可能不含此字段）
    if (targetProfileDesc !== undefined) {
      await pool.query(
        `INSERT INTO zenithjoy.acquisition_config (tenant_id, target_profile_desc, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (tenant_id) DO UPDATE SET
           target_profile_desc = EXCLUDED.target_profile_desc,
           updated_at = now()`,
        [tenantId, targetProfileDesc]
      );
    }

    // 读最新配置返回（含 target_profile_desc）
    const fullConfig = await pool.query(
      `SELECT *, target_profile_desc FROM zenithjoy.acquisition_config WHERE tenant_id = $1`,
      [tenantId]
    );
    const row = fullConfig.rows[0] ?? {};
    return ok(res, { ...saved, target_profile_desc: row.target_profile_desc ?? null });
  } catch (err) {
    console.error('[acquisition] config PATCH error:', (err as Error).message);
    return fail(res, 500, 'CONFIG_ERROR', (err as Error).message);
  }
});

// CodeQL js/missing-rate-limiting：/signal-verify 碰鉴权(tenantContextOptional反查tenant)+DB
// 查询。同 signalStatusRateLimit 的既往修法：必须排在 tenantContextOptional 之前（CodeQL 追踪
// 的是"鉴权节点执行前有没有先经过限流"），按 IP 限流，诊断端点允许较宽松轮询节奏。
const signalVerifyRateLimit = simpleRateLimit({
  windowMs: 60_000,
  max: 60,
  keyFn: ipKeyFn,
});

// GET /api/acquisition/signal-verify — FR-5 信号验证聚合端点（Bearer token 鉴权，tenant 级）
// 返回三组数据（每组最新 10 条）：burner_sessions / recent_collect_errors / recent_lead_replies
acquisitionRouter.get('/signal-verify', signalVerifyRateLimit, tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;

  try {
    // burner_sessions：计算 computed_online_status（三级判定：心跳 > UIA > NULL）
    const sessionsRes = await pool.query(
      `SELECT
         s.account_label,
         s.uia_online,
         s.uia_checked_at,
         s.uia_error,
         (a.last_heartbeat_at >= NOW() - INTERVAL '2 minutes') AS heartbeat_online,
         CASE
           WHEN (a.last_heartbeat_at IS NULL OR a.last_heartbeat_at < NOW() - INTERVAL '2 minutes') THEN 'offline'
           WHEN s.uia_online = false THEN 'offline'
           WHEN s.uia_online = true  THEN 'online'
           ELSE 'unknown'
         END AS computed_online_status
       FROM zenithjoy.agent_platform_sessions s
       LEFT JOIN zenithjoy.agents a ON a.id = s.agent_id
       WHERE s.agent_id IN (
         SELECT id FROM zenithjoy.agents WHERE tenant_id = $1
       )
         AND s.platform = 'douyin'
       ORDER BY s.updated_at DESC NULLS LAST
       LIMIT 10`,
      [tenantId],
    );

    // recent_collect_errors：acquisition_collect_tasks 的 error_code 字段
    const errorsRes = await pool.query(
      `SELECT id AS task_id, error_code, updated_at
         FROM zenithjoy.acquisition_collect_tasks
        WHERE tenant_id = $1 AND error_code IS NOT NULL
        ORDER BY updated_at DESC
        LIMIT 10`,
      [tenantId],
    );

    // recent_lead_replies：acquisition_leads 的 latest_reply / latest_reply_at 字段
    const repliesRes = await pool.query(
      `SELECT id AS lead_id, latest_reply, latest_reply_at
         FROM zenithjoy.acquisition_leads
        WHERE tenant_id = $1 AND latest_reply_at IS NOT NULL
        ORDER BY latest_reply_at DESC
        LIMIT 10`,
      [tenantId],
    );

    return ok(res, {
      burner_sessions: sessionsRes.rows,
      recent_collect_errors: errorsRes.rows,
      recent_lead_replies: repliesRes.rows,
    });
  } catch (err) {
    console.error('[acquisition] signal-verify error:', (err as Error).message);
    return fail(res, 500, 'SIGNAL_VERIFY_ERROR', (err as Error).message);
  }
});
