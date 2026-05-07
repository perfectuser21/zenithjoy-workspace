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
} from '../services/walking-skeleton.service';

export const heartbeatRouter = Router();   // 挂在 /api/agent
export const publishWsRouter = Router();   // 挂在 /api/publish

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============ POST /api/agent/heartbeat ============
heartbeatRouter.post(
  '/heartbeat',
  licenseAuth,
  async (req: Request, res: Response) => {
    const { version, hostname } = (req.body ?? {}) as {
      version?: unknown;
      hostname?: unknown;
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

    try {
      const agent = await upsertAgentByHeartbeat({
        licenseId: lic.id,
        tenantId: lic.tenant_id,
        hostname: typeof hostname === 'string' ? hostname.slice(0, 200) : null,
        version: typeof version === 'string' ? version.slice(0, 50) : null,
      });
      const queued = await getQueuedTasks(agent.id);
      return res.status(200).json({
        ok: true,
        agent_id: agent.id,
        queued_tasks: queued.map((t) => ({
          id: t.id,
          platform: t.platform,
          status: t.status,
          folder_path: t.folder_path,
          created_at: t.created_at,
        })),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      return res
        .status(500)
        .json({ ok: false, code: 'HEARTBEAT_FAILED', message: msg });
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
    const { agent_id, platform, folder_path } = (req.body ?? {}) as {
      agent_id?: unknown;
      platform?: unknown;
      folder_path?: unknown;
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
        folderPath:
          typeof folder_path === 'string' && folder_path.trim()
            ? folder_path.trim()
            : null,
      });
      return res.status(201).json({ task_id: task.id, status: task.status });
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
