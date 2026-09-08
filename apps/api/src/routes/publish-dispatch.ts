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
  findActiveAgentByTenantId,
} from '../services/walking-skeleton.service';
import {
  createMaterialStorage,
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  type MaterialStorage,
} from '../services/material-storage';

/** 平台白名单——与安卓真机/网页两条执行通道当前覆盖一致。 */
export const PUBLISH_PLATFORMS = [
  'douyin', 'xiaohongshu', 'kuaishou', 'toutiao', 'weibo',
  'bilibili', 'shipinhao', 'zhihu', 'wechat',
] as const;

/** publish_tasks.type 有 CHECK IN ('video','image','article')——写库前拦住，别让 CHECK 违约以 500 暴露。 */
const CONTENT_TYPES = ['video', 'image', 'article'];

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

async function loadMaterials(contentId: string): Promise<PublishPackageMaterial[]> {
  const { rows } = await pool.query<PublishPackageMaterial>(
    `SELECT m.id, m.storage_key, m.file_name, m.mime_type
       FROM zenithjoy.content_materials cm
       JOIN zenithjoy.materials m ON m.id = cm.material_id
      WHERE cm.content_id = $1
      ORDER BY cm.sort_order ASC`,
    [contentId],
  );
  return rows;
}

export function createContentsPublishRouter(): Router {
  const router = Router();

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
      const { rows } = await pool.query(
        `SELECT id, title, body, type, platforms, status
           FROM zenithjoy.contents
          WHERE id = $1 AND tenant_id = $2
          LIMIT 1`,
        [contentId, tenantId],
      );
      const content = rows[0];
      if (!content) {
        fail(res, 404, 'NOT_FOUND', '作品不存在');
        return;
      }

      const bodyPlatforms: unknown = req.body?.platforms;
      const platforms: string[] =
        Array.isArray(bodyPlatforms) && bodyPlatforms.length > 0
          ? bodyPlatforms.map(String)
          : (content.platforms as string[] | null) ?? [];
      if (platforms.length === 0) {
        fail(res, 400, 'INVALID_PLATFORMS', '未指定发布平台：作品没带 platforms，请求体也没给');
        return;
      }
      const illegal = platforms.filter(
        (p) => !(PUBLISH_PLATFORMS as readonly string[]).includes(p),
      );
      if (illegal.length > 0) {
        fail(res, 400, 'INVALID_PLATFORMS', `不认识的平台：${illegal.join('、')}`);
        return;
      }

      // 去重：同一请求重复平台只拆一条任务
      const uniquePlatforms = [...new Set(platforms)];

      if (!CONTENT_TYPES.includes(content.type)) {
        fail(res, 400, 'INVALID_CONTENT_TYPE', `作品形态 ${content.type} 不可派发`);
        return;
      }
      if (content.status === 'queued') {
        fail(res, 409, 'ALREADY_QUEUED', '作品已在发布队列中，勿重复派发');
        return;
      }

      const agent = await findActiveAgentByTenantId(tenantId);
      if (!agent) {
        fail(res, 409, 'NO_AGENT', '租户下没有 10 分钟内活跃的 agent，无法派发');
        return;
      }

      const materials = await loadMaterials(contentId);
      if (content.type !== 'article' && materials.length === 0) {
        fail(res, 400, 'NO_MATERIALS', '作品没有任何素材，无法发布');
        return;
      }

      const client = await pool.connect();
      const tasks: Array<{ id: string; platform: string }> = [];
      let alreadyQueued = false;
      try {
        await client.query('BEGIN');
        // 原子 CAS：事务外的 status === 'queued' 检查只是省一次事务的礼貌拦截，
        // 真正的并发防线在这里——两个并发请求同时读到 draft 时，只有一个能把
        // status 从非 queued 改成 queued，rowCount === 0 说明被对手抢先了。
        const cas = await client.query(
          `UPDATE zenithjoy.contents
              SET status = 'queued', updated_at = now()
            WHERE id = $1 AND tenant_id = $2 AND status <> 'queued'
            RETURNING id`,
          [contentId, tenantId],
        );
        if (cas.rowCount === 0) {
          await client.query('ROLLBACK');
          alreadyQueued = true;
        } else {
          for (const platform of uniquePlatforms) {
            const payload = JSON.stringify({
              content_id: contentId,
              title: content.title,
              body: content.body,
              content_type: content.type,
              platform,
              materials,
            });
            const ins = await client.query<{ id: string }>(
              `INSERT INTO zenithjoy.publish_tasks
                 (agent_id, platform, type, status, task_type, tenant_id, payload)
               VALUES ($1, $2, $3, 'queued', 'content_publish', $4, $5::jsonb)
               RETURNING id`,
              [agent.id, platform, content.type, tenantId, payload],
            );
            tasks.push({ id: ins.rows[0].id, platform });
          }
          await client.query('COMMIT');
        }
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }

      if (alreadyQueued) {
        fail(res, 409, 'ALREADY_QUEUED', '作品已在发布队列中，勿重复派发');
        return;
      }

      ok(res, { content_id: contentId, tasks });
    } catch (err) {
      fail(res, 500, 'DISPATCH_FAILED', err instanceof Error ? err.message : 'unknown');
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
