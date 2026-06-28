/**
 * Walking Skeleton #1 — Agent ↔ 中台 API
 *
 * Endpoints（契约：/tmp/walking-skeleton-1-contract.md 第 2 节）：
 *   POST /api/agent/heartbeat
 *   POST /api/agent/folder/bind
 *   POST /api/publish/task
 *   POST /api/publish/receipt
 *   GET  /api/publish/tasks/:id
 *
 * 鉴权：所有端点用 licenseAuth 中间件。Authorization: Bearer <license_key>
 *      heartbeat 端点支持 body.license 兜底（首次握手 client 还没把 key 放 header）。
 */

import { Router, Request, Response } from 'express';
import { licenseAuth } from '../middleware/license-auth';
import {
  upsertAgentByHeartbeat,
  getQueuedTasks,
  findAgentById,
  bindFolder,
  createPublishTask,
  submitPublishReceipt,
  getPublishTask,
  isValidPublishType,
  ackPublishTask,
  saveModuleStatus,
  getAllModuleHealth,
  HEARTBEAT_MODULES,
  getRequiredAgentVersion,
  TaskNotFoundError,
  TaskForbiddenError,
  type ModuleStatusMap,
  type ModuleStatusEntry,
} from '../services/walking-skeleton.service';

export const heartbeatRouter = Router();   // 挂在 /api/agent
export const publishWsRouter = Router();   // 挂在 /api/publish

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 校验并归一化客户端上报的 module_status。
 * 只接受 { [line]: { ok: boolean, reason?: string } } 结构，非法值丢弃。
 * 返回 null 表示无可持久化内容（字段缺失/全非法）。
 */
function normalizeModuleStatus(raw: unknown): ModuleStatusMap | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: ModuleStatusMap = {};
  for (const [line, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
    const v = val as Record<string, unknown>;
    if (typeof v.ok !== 'boolean') continue;
    const entry: ModuleStatusEntry = { ok: v.ok };
    if (typeof v.reason === 'string') entry.reason = v.reason.slice(0, 500);
    out[line.slice(0, 100)] = entry;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ============ POST /api/agent/heartbeat ============
heartbeatRouter.post(
  '/heartbeat',
  licenseAuth,
  async (req: Request, res: Response) => {
    const { version, hostname, os_type, module_status, agent_uuid, machine_id } = (req.body ?? {}) as {
      version?: unknown;
      hostname?: unknown;
      os_type?: unknown;
      module_status?: unknown;
      agent_uuid?: unknown;
      machine_id?: unknown;
    };
    const lic = req.license!;
    if (!lic.tenant_id) {
      // licenseAuth 已过滤 NO_TENANT，这里 defensive
      return res.status(403).json({
        ok: false,
        code: 'NO_TENANT',
        message: 'license 未关联 tenant',
      });
    }

    const resolvedHostname = typeof hostname === 'string' ? hostname.slice(0, 200) : null;
    const resolvedAgentUuid = typeof agent_uuid === 'string' ? agent_uuid : undefined;

    // start.bat Step4 precheck：machine_id="precheck" 是专属标识（见 install-pack/start.bat）。
    // 只校验 license，不注册/更新机器行，防止 hostname=null 路径复活旧幽灵行。
    if (machine_id === 'precheck') {
      return res.status(200).json({
        ok: true,
        agent_id: null,
        modules: HEARTBEAT_MODULES,
        required_agent_version: getRequiredAgentVersion(),
        queued_tasks: [],
      });
    }

    try {
      const agent = await upsertAgentByHeartbeat({
        licenseId: lic.id,
        tenantId: lic.tenant_id,
        hostname: resolvedHostname,
        version: typeof version === 'string' ? version.slice(0, 50) : null,
        osType: typeof os_type === 'string' ? os_type.slice(0, 20) : null,
        agentUuid: resolvedAgentUuid,
      });
      // 客户端上报的 module_status（per-Line preflight 结果）→ 持久化最新一份
      const normalized = normalizeModuleStatus(module_status);
      if (normalized) {
        await saveModuleStatus(agent.id, normalized);
      }
      const queued = await getQueuedTasks(agent.id);
      return res.status(200).json({
        ok: true,
        agent_id: agent.id,
        // 服务端下发模块清单（第一刀硬编码 active，含 status + required_version）
        modules: HEARTBEAT_MODULES,
        // 核心自升级（Sprint 06222100）：下发 Agent 核心要求版本（含 sha256/size 供下载校验）。
        // 客户端 CoreUpgrader 对比自身 version，> 自身则下载新核心包自换重启。
        required_agent_version: getRequiredAgentVersion(),
        // map to agent's HeartbeatTask shape: { task_id, platform, payload }
        // payload composed from folder_path column (works for both folder_bind.local_path
        // and douyin.folder_path) + account_label default for qr_bind_douyin
        queued_tasks: queued.map((t) => {
          // B-1 burner fix: 优先合并真 task.payload (含 account_label / agent_id / tenant_id)
          // 否则 burner handler 拿 'default' 复用既有 cookie，不真扫码弹码
          const realPayload = (t.payload as Record<string, unknown> | null) ?? {};
          return {
            task_id: t.id,
            platform: t.platform,
            type: t.type,
            payload: {
              local_path: t.folder_path,
              folder_path: t.folder_path,
              ...realPayload,
              account_label:
                (realPayload.account_label as string | undefined) ?? 'default',
            },
            // legacy fields kept for any older agent client
            id: t.id,
            status: t.status,
            folder_path: t.folder_path,
            created_at: t.created_at,
          };
        }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      return res
        .status(500)
        .json({ ok: false, code: 'HEARTBEAT_FAILED', message: msg });
    }
  }
);

// ============ GET /api/agent/module-health ============
// Dashboard 用：拉所有已注册机器的 module_status 矩阵（行=机器，列=各 Line）
heartbeatRouter.get(
  '/module-health',
  licenseAuth,
  async (_req: Request, res: Response) => {
    try {
      const data = await getAllModuleHealth();
      return res.status(200).json({ ok: true, data });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      return res
        .status(500)
        .json({ ok: false, code: 'MODULE_HEALTH_FAILED', message: msg });
    }
  }
);

// ============ GET /api/agent/me/status ============
// Dashboard 用：查当前 license 关联的最新 agent + 心跳新鲜度（客户视角，单 agent）
// 不冲突 v1.1 的 GET /api/agent/status（admin 视角，返所有 agent 列表）
// 60s 内 = connected:true
heartbeatRouter.get(
  '/me/status',
  licenseAuth,
  async (req: Request, res: Response) => {
    const lic = req.license!;
    try {
      const pool = (await import('../db/connection')).default;
      // 直接用 license.pinned_agent_id，不再按心跳排序
      // 兜底（pinned 为空）→ win32 优先 + 心跳最新
      const { rows } = await pool.query<{
        id: string;
        hostname: string | null;
        version: string | null;
        bound_folder_path: string | null;
        last_heartbeat_at: string | null;
      }>(
        `SELECT a.id, a.hostname, a.version, a.bound_folder_path, a.last_heartbeat_at
           FROM zenithjoy.agents a
           JOIN zenithjoy.licenses l ON l.id = $1
          WHERE a.id = COALESCE(
            l.pinned_agent_id,
            (SELECT a2.id FROM zenithjoy.agents a2
              WHERE a2.license_id = $1
              ORDER BY CASE WHEN a2.os_type = 'win32' THEN 0 ELSE 1 END ASC,
                       a2.last_heartbeat_at DESC NULLS LAST
              LIMIT 1)
          )`,
        [lic.id]
      );
      const a = rows[0];
      if (!a) {
        return res.status(200).json({
          connected: false,
          agent_id: null,
          hostname: null,
          version: null,
          last_heartbeat_at: null,
          bound_folder_path: null,
        });
      }
      const last = a.last_heartbeat_at ? new Date(a.last_heartbeat_at).getTime() : 0;
      const fresh = Date.now() - last < 60_000;
      return res.status(200).json({
        connected: fresh,
        agent_id: a.id,
        hostname: a.hostname,
        version: a.version,
        last_heartbeat_at: a.last_heartbeat_at,
        bound_folder_path: a.bound_folder_path,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      return res
        .status(500)
        .json({ ok: false, code: 'STATUS_FAILED', message: msg });
    }
  }
);

// ============ POST /api/agent/repin ============
// 换机器时调：把 license 绑定的 agent 切换到指定 agent_id
heartbeatRouter.post(
  '/repin',
  licenseAuth,
  async (req: Request, res: Response) => {
    const lic = req.license!;
    const { agent_id } = (req.body ?? {}) as { agent_id?: unknown };
    if (typeof agent_id !== 'string' || !UUID_RE.test(agent_id)) {
      return res.status(400).json({ ok: false, code: 'BAD_REQUEST', message: 'agent_id 缺失或不合法' });
    }
    try {
      const pool = (await import('../db/connection')).default;
      const { rowCount } = await pool.query(
        `UPDATE zenithjoy.licenses SET pinned_agent_id = $1
          WHERE id = $2
            AND EXISTS (SELECT 1 FROM zenithjoy.agents WHERE id = $1 AND license_id = $2)`,
        [agent_id, lic.id]
      );
      if (!rowCount) {
        return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'agent_id 不属于此 license' });
      }
      return res.status(200).json({ ok: true, pinned_agent_id: agent_id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      return res.status(500).json({ ok: false, code: 'REPIN_FAILED', message: msg });
    }
  }
);

// ============ POST /api/agent/qr-bind ============
// Dashboard 用：派发 qr_bind_<platform> task 给 agent
heartbeatRouter.post(
  '/qr-bind',
  licenseAuth,
  async (req: Request, res: Response) => {
    const { agent_id, platform } = (req.body ?? {}) as {
      agent_id?: unknown;
      platform?: unknown;
    };
    if (typeof agent_id !== 'string' || !UUID_RE.test(agent_id)) {
      return res
        .status(400)
        .json({ ok: false, code: 'BAD_REQUEST', message: 'agent_id 缺失或不合法' });
    }
    const plat = typeof platform === 'string' && platform.length > 0 ? platform : 'douyin';
    try {
      const pool = (await import('../db/connection')).default;
      // verify agent ownership
      const own = await pool.query<{ license_id: string }>(
        `SELECT license_id FROM zenithjoy.agents WHERE id = $1 LIMIT 1`,
        [agent_id]
      );
      if (own.rows.length === 0) {
        return res.status(404).json({
          ok: false, code: 'AGENT_NOT_FOUND', message: 'agent 不存在',
        });
      }
      if (own.rows[0].license_id !== req.license!.id) {
        return res.status(403).json({
          ok: false, code: 'FORBIDDEN', message: 'agent 不属于该 license',
        });
      }
      // Insert qr_bind_<platform> task. Agent's onTask routes by platform string.
      await pool.query(
        `INSERT INTO zenithjoy.publish_tasks (agent_id, platform, status)
         VALUES ($1, $2, 'pending')`,
        [agent_id, `qr_bind_${plat}`]
      );
      return res.status(200).json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      return res
        .status(500)
        .json({ ok: false, code: 'QR_BIND_FAILED', message: msg });
    }
  }
);

// ============ GET /api/agent/platforms?agent_id= ============
// Dashboard 用：列 agent_platform_sessions
heartbeatRouter.get(
  '/platforms',
  licenseAuth,
  async (req: Request, res: Response) => {
    const agent_id = String(req.query.agent_id ?? '');
    if (!UUID_RE.test(agent_id)) {
      return res
        .status(400)
        .json({ ok: false, code: 'BAD_REQUEST', message: 'agent_id 不合法' });
    }
    try {
      const pool = (await import('../db/connection')).default;
      const own = await pool.query<{ license_id: string }>(
        `SELECT license_id FROM zenithjoy.agents WHERE id = $1 LIMIT 1`,
        [agent_id]
      );
      if (own.rows.length === 0 || own.rows[0].license_id !== req.license!.id) {
        return res.status(403).json({
          ok: false, code: 'FORBIDDEN', message: 'agent 不属于该 license',
        });
      }
      const { rows } = await pool.query(
        `SELECT id, platform, account_label, status, bound_at, created_at
           FROM zenithjoy.agent_platform_sessions
          WHERE agent_id = $1
          ORDER BY created_at DESC`,
        [agent_id]
      );
      return res.status(200).json({ sessions: rows });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      return res
        .status(500)
        .json({ ok: false, code: 'PLATFORMS_FAILED', message: msg });
    }
  }
);

// ============ POST /api/agent/folder/bind ============
heartbeatRouter.post(
  '/folder/bind',
  licenseAuth,
  async (req: Request, res: Response) => {
    const { agent_id, local_path } = (req.body ?? {}) as {
      agent_id?: unknown;
      local_path?: unknown;
    };

    if (typeof agent_id !== 'string' || !UUID_RE.test(agent_id)) {
      return res
        .status(400)
        .json({ ok: false, code: 'BAD_REQUEST', message: 'agent_id 缺失或不合法' });
    }
    if (typeof local_path !== 'string' || local_path.trim().length < 1) {
      return res
        .status(400)
        .json({ ok: false, code: 'BAD_REQUEST', message: 'local_path 不能为空' });
    }

    try {
      const agent = await findAgentById(agent_id);
      if (!agent) {
        return res
          .status(404)
          .json({ ok: false, code: 'AGENT_NOT_FOUND', message: 'agent_id 不存在' });
      }
      if (agent.license_id !== req.license!.id) {
        return res
          .status(403)
          .json({ ok: false, code: 'FORBIDDEN', message: 'agent 不属于该 license' });
      }
      await bindFolder({ agentId: agent.id, localPath: local_path.trim() });
      return res.status(200).json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      return res
        .status(500)
        .json({ ok: false, code: 'BIND_FAILED', message: msg });
    }
  }
);

// ============ POST /api/publish/task ============
publishWsRouter.post(
  '/task',
  licenseAuth,
  async (req: Request, res: Response) => {
    const { agent_id, platform, folder_path, type, payload } = (req.body ?? {}) as {
      agent_id?: unknown;
      platform?: unknown;
      folder_path?: unknown;
      type?: unknown;
      payload?: unknown;
    };

    if (typeof agent_id !== 'string' || !UUID_RE.test(agent_id)) {
      return res
        .status(400)
        .json({ ok: false, code: 'BAD_REQUEST', message: 'agent_id 缺失或不合法' });
    }
    if (typeof platform !== 'string' || platform.trim().length < 1) {
      return res
        .status(400)
        .json({ ok: false, code: 'BAD_REQUEST', message: 'platform 不能为空' });
    }

    // type 字段校验：可缺省（默认 image），但显式给值必须是 video/image/article
    if (type !== undefined && !isValidPublishType(type)) {
      return res
        .status(422)
        .json({
          ok: false,
          code: 'INVALID_TYPE',
          message: `type 必须是 video/image/article 之一，收到: ${String(type)}`,
        });
    }

    try {
      const agent = await findAgentById(agent_id);
      if (!agent) {
        return res
          .status(404)
          .json({ ok: false, code: 'AGENT_NOT_FOUND', message: 'agent_id 不存在' });
      }
      if (agent.license_id !== req.license!.id) {
        return res
          .status(403)
          .json({ ok: false, code: 'FORBIDDEN', message: 'agent 不属于该 license' });
      }

      const task = await createPublishTask({
        agentId: agent.id,
        platform: platform.trim().slice(0, 64),
        type: type as 'video' | 'image' | 'article' | undefined,
        folderPath:
          typeof folder_path === 'string' && folder_path.trim()
            ? folder_path.trim()
            : null,
        payload,
      });
      return res
        .status(201)
        .json({ task_id: task.id, status: task.status, type: (task as { type?: string }).type ?? 'image' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      return res
        .status(500)
        .json({ ok: false, code: 'CREATE_TASK_FAILED', message: msg });
    }
  }
);

// ============ POST /api/publish/receipt ============
publishWsRouter.post(
  '/receipt',
  licenseAuth,
  async (req: Request, res: Response) => {
    const { task_id, status, result } = (req.body ?? {}) as {
      task_id?: unknown;
      status?: unknown;
      result?: unknown;
    };

    if (typeof task_id !== 'string' || !UUID_RE.test(task_id)) {
      return res
        .status(400)
        .json({ ok: false, code: 'BAD_REQUEST', message: 'task_id 缺失或不合法' });
    }
    if (status !== 'success' && status !== 'failed') {
      return res.status(400).json({
        ok: false,
        code: 'BAD_REQUEST',
        message: 'status 必须是 success 或 failed',
      });
    }

    try {
      const task = await getPublishTask(task_id);
      if (!task) {
        return res
          .status(404)
          .json({ ok: false, code: 'TASK_NOT_FOUND', message: 'task_id 不存在' });
      }
      const agent = await findAgentById(task.agent_id);
      if (!agent || agent.license_id !== req.license!.id) {
        return res
          .status(403)
          .json({ ok: false, code: 'FORBIDDEN', message: 'task 不属于该 license' });
      }

      const updated = await submitPublishReceipt({
        taskId: task.id,
        status,
        result: result ?? null,
      });
      if (!updated) {
        return res
          .status(404)
          .json({ ok: false, code: 'TASK_NOT_FOUND', message: 'task 已删除' });
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      return res
        .status(500)
        .json({ ok: false, code: 'RECEIPT_FAILED', message: msg });
    }
  }
);

// ============ GET /api/publish/tasks?agent_id= ============
// Dashboard 用：列出 agent 下的 publish_tasks（最新优先）
publishWsRouter.get(
  '/tasks',
  licenseAuth,
  async (req: Request, res: Response) => {
    const agent_id = String(req.query.agent_id ?? '');
    if (!UUID_RE.test(agent_id)) {
      return res
        .status(400)
        .json({ ok: false, code: 'BAD_REQUEST', message: 'agent_id 不合法' });
    }
    try {
      const pool = (await import('../db/connection')).default;
      const own = await pool.query<{ license_id: string }>(
        `SELECT license_id FROM zenithjoy.agents WHERE id = $1 LIMIT 1`,
        [agent_id]
      );
      if (own.rows.length === 0 || own.rows[0].license_id !== req.license!.id) {
        return res.status(403).json({
          ok: false, code: 'FORBIDDEN', message: 'agent 不属于该 license',
        });
      }
      const PUBLISH_PLATFORMS = ['douyin','kuaishou','xiaohongshu','toutiao','weibo','shipinhao','zhihu','gongzhonghao'];
      const { rows } = await pool.query(
        `SELECT id, agent_id, platform, type, status, folder_path, result, receipt_at, created_at
           FROM zenithjoy.publish_tasks
          WHERE agent_id = $1
            AND platform = ANY($2::text[])
          ORDER BY created_at DESC
          LIMIT 50`,
        [agent_id, PUBLISH_PLATFORMS]
      );
      return res.status(200).json({ tasks: rows });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      return res
        .status(500)
        .json({ ok: false, code: 'LIST_TASKS_FAILED', message: msg });
    }
  }
);

// ============ GET /api/publish/tasks/:id ============
publishWsRouter.get(
  '/tasks/:id',
  licenseAuth,
  async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!id || !UUID_RE.test(id)) {
      return res
        .status(400)
        .json({ ok: false, code: 'BAD_REQUEST', message: 'task id 不合法' });
    }
    try {
      const task = await getPublishTask(id);
      if (!task) {
        return res
          .status(404)
          .json({ ok: false, code: 'TASK_NOT_FOUND', message: 'task 不存在' });
      }
      const agent = await findAgentById(task.agent_id);
      if (!agent || agent.license_id !== req.license!.id) {
        return res
          .status(403)
          .json({ ok: false, code: 'FORBIDDEN', message: 'task 不属于该 license' });
      }
      return res.status(200).json({
        id: task.id,
        status: task.status,
        result: task.result,
        created_at: task.created_at,
        receipt_at: task.receipt_at,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      return res
        .status(500)
        .json({ ok: false, code: 'GET_TASK_FAILED', message: msg });
    }
  }
);

// ============ POST /api/agent/task-ack ============
// Agent 确认任务完成（step 6 ack chain）
// Body: { task_id: string, result: string }
// Auth: x-license-key header
heartbeatRouter.post(
  '/task-ack',
  licenseAuth,
  async (req: Request, res: Response) => {
    const { task_id, result } = (req.body ?? {}) as {
      task_id?: unknown;
      result?: unknown;
    };

    if (typeof task_id !== 'string' || !UUID_RE.test(task_id)) {
      return res
        .status(400)
        .json({ ok: false, code: 'BAD_REQUEST', message: 'task_id 缺失或不合法' });
    }

    try {
      const ackResult = await ackPublishTask({
        taskId: task_id,
        licenseId: req.license!.id,
        result: typeof result === 'string' ? result : String(result ?? ''),
      });
      return res.status(200).json(ackResult);
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        return res.status(404).json({ ok: false, code: 'TASK_NOT_FOUND', message: err.message });
      }
      if (err instanceof TaskForbiddenError) {
        return res.status(403).json({ ok: false, code: 'FORBIDDEN', message: err.message });
      }
      const msg = err instanceof Error ? err.message : 'unknown';
      return res.status(500).json({ ok: false, code: 'ACK_FAILED', message: msg });
    }
  }
);
