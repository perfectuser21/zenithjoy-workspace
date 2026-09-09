// apps/api/src/routes/publish-dispatch.ts
//
// 作品→发布任务派发接缝（line01 刀1）。
//
// 作品（contents：title/body/type/platforms + 关联 materials）在这里拆成
// 每平台一条 publish_tasks，任务 payload 里带统一「发布包」——执行器
// （AI+skill 驱动安卓真机，未来 agent-android）领任务时按发布包拿到
// 标题/文案/素材，从此发布内容不再由执行器现编。
//
// 发布包里存 storage_key 不存签名 URL：签名 2 小时过期，派发到领取之间
// 可能隔天，领取时（GET /:id/package）现签才永远有效。

import { Router, type Request, type Response } from 'express';
import pool from '../db/connection';
import {
  validateLicense,
} from '../services/walking-skeleton.service';
import {
  createMaterialStorage,
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  type MaterialStorage,
} from '../services/material-storage';
import { simpleRateLimit, ipKeyFn } from '../middleware/simple-rate-limit';
import {
  dispatchContentPublish,
  AlreadyQueuedError,
  DispatchValidationError,
  NoActiveAgentError,
  PUBLISH_PLATFORMS,
} from '../services/content-publish-dispatch';

// 向后兼容：既有测试/消费方从本模块 import 白名单
export { PUBLISH_PLATFORMS };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PublishPackageMaterial {
  id: string;
  storage_key: string;
  file_name: string;
  mime_type: string | null;
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({
    success: false,
    data: null,
    error: { code, message },
    timestamp: new Date().toISOString(),
  });
}

function ok(res: Response, data: unknown): void {
  res.json({ success: true, data, timestamp: new Date().toISOString() });
}

/** 鉴权同 materials.ts：租户从凭据反查，绝不信客户端自报 tenant_id。 */
async function authenticate(
  req: Request,
  res: Response,
): Promise<{ tenantId: string } | null> {
  const token =
    (req.headers['x-upload-token'] as string | undefined)?.trim() || null;
  if (!token) {
    fail(res, 401, 'UNAUTHORIZED', '缺少凭据。请在请求头加 X-Upload-Token: <token>');
    return null;
  }
  let r;
  try {
    r = await validateLicense(token);
  } catch (err) {
    fail(res, 500, 'LICENSE_LOOKUP_FAILED', err instanceof Error ? err.message : 'unknown');
    return null;
  }
  if (!r.ok) {
    fail(res, r.code === 'INVALID_LICENSE' ? 401 : 403, r.code, r.message);
    return null;
  }
  return { tenantId: r.license.tenant_id as string };
}

export function createContentsPublishRouter(): Router {
  const router = Router();

  // CodeQL js/missing-rate-limiting：端点既做鉴权又写 DB，不限流就是现成的 DoS 面。
  // 与 materials.ts 同口径：限流放鉴权前、每 router 建一次复用同一实例。
  router.use(simpleRateLimit({ windowMs: 60_000, max: 60, keyFn: ipKeyFn }));

  router.post('/:id/publish', async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;
    const { tenantId } = auth;
    const contentId = req.params.id;
    if (!UUID_RE.test(contentId)) {
      fail(res, 404, 'NOT_FOUND', '作品不存在');
      return;
    }

    try {
      const bodyPlatforms: unknown = req.body?.platforms;
      const platformsOverride =
        Array.isArray(bodyPlatforms) && bodyPlatforms.length > 0
          ? bodyPlatforms.map(String)
          : undefined;
      const result = await dispatchContentPublish({ contentId, tenantId, platformsOverride });
      if (result === null) {
        fail(res, 404, 'NOT_FOUND', '作品不存在');
        return;
      }
      ok(res, result);
    } catch (err) {
      if (err instanceof AlreadyQueuedError) {
        fail(res, 409, err.code, err.message);
      } else if (err instanceof NoActiveAgentError) {
        fail(res, 409, err.code, err.message);
      } else if (err instanceof DispatchValidationError) {
        fail(res, 400, err.code, err.message);
      } else {
        fail(res, 500, 'DISPATCH_FAILED', err instanceof Error ? err.message : 'unknown');
      }
    }
  });

  return router;
}

export interface PublishTasksRouterDeps {
  storage?: MaterialStorage;
}

export function createPublishTasksRouter(deps: PublishTasksRouterDeps = {}): Router {
  const router = Router();
  const storage = deps.storage ?? createMaterialStorage();

  // 同上：鉴权+DB 访问端点必须限流（CodeQL js/missing-rate-limiting）。
  router.use(simpleRateLimit({ windowMs: 60_000, max: 60, keyFn: ipKeyFn }));

  // 执行器发现作业单：只看本租户的 content_publish 任务
  router.get('/', async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : null;
      const params: unknown[] = [auth.tenantId];
      let where = `tenant_id = $1 AND task_type = 'content_publish'`;
      if (status) {
        params.push(status);
        where += ` AND status = $2`;
      }
      const { rows } = await pool.query(
        `SELECT id, platform, type, status, created_at
           FROM zenithjoy.publish_tasks
          WHERE ${where}
          ORDER BY created_at DESC
          LIMIT 100`,
        params,
      );
      ok(res, { items: rows });
    } catch (err) {
      fail(res, 500, 'LIST_FAILED', err instanceof Error ? err.message : 'unknown');
    }
  });

  // 执行器领作业单：领取时现签素材 URL（签名 1 小时，够下载）
  router.get('/:id/package', async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;
    const taskId = req.params.id;
    if (!UUID_RE.test(taskId)) {
      fail(res, 404, 'NOT_FOUND', '任务不存在');
      return;
    }
    try {
      const { rows } = await pool.query(
        `SELECT id, payload
           FROM zenithjoy.publish_tasks
          WHERE id = $1 AND tenant_id = $2 AND task_type = 'content_publish'
          LIMIT 1`,
        [taskId, auth.tenantId],
      );
      const task = rows[0];
      if (!task || !task.payload) {
        fail(res, 404, 'NOT_FOUND', '任务不存在');
        return;
      }
      const p = task.payload as {
        content_id: string; title: string | null; body: string | null;
        content_type: string; platform: string; materials: PublishPackageMaterial[];
      };
      const media = await Promise.all(
        (p.materials ?? []).map(async (m) => ({
          url: await storage.getSignedUrl(m.storage_key, DEFAULT_SIGNED_URL_TTL_SECONDS),
          file_name: m.file_name,
          mime_type: m.mime_type,
        })),
      );
      ok(res, {
        content_id: p.content_id,
        title: p.title,
        body: p.body,
        content_type: p.content_type,
        platform: p.platform,
        media,
      });
    } catch (err) {
      fail(res, 500, 'PACKAGE_FAILED', err instanceof Error ? err.message : 'unknown');
    }
  });

  return router;
}
