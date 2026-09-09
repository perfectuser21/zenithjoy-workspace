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
  NON_TERMINAL_TASK_STATUSES,
} from '../services/content-publish-dispatch';

// 向后兼容：既有测试/消费方从本模块 import 白名单
export { PUBLISH_PLATFORMS };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 非终态判定：单一来源见 services/content-publish-dispatch.ts 的 NON_TERMINAL_TASK_STATUSES
// （与 notion-orchestrator.ts 共用同一份，不再各自手抄）。
const RECEIPT_NON_TERMINAL = NON_TERMINAL_TASK_STATUSES;

/** 回执 detail 截断长度：避免执行器把整段 stacktrace/日志灌进 result jsonb。 */
const RECEIPT_DETAIL_MAX_LEN = 2000;

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

export interface ContentsPublishRouterDeps {
  storage?: MaterialStorage;
}

/** 我的作品列表分页：默认 30 条，硬上限 100（同 materials.ts 口径，防止拖垮 DB/签几百个 URL）。 */
const DEFAULT_LIST_PAGE_SIZE = 30;
const MAX_LIST_PAGE_SIZE = 100;

export function createContentsPublishRouter(deps: ContentsPublishRouterDeps = {}): Router {
  const router = Router();
  const storage = deps.storage ?? createMaterialStorage();

  // CodeQL js/missing-rate-limiting：端点既做鉴权又写 DB，不限流就是现成的 DoS 面。
  // 与 materials.ts 同口径：限流放鉴权前、每 router 建一次复用同一实例。
  router.use(simpleRateLimit({ windowMs: 60_000, max: 60, keyFn: ipKeyFn }));

  // 我的作品列表（line01 刀5a）：contents + 首图（一次 DISTINCT ON 查询）+ 回执聚合
  // （一次 payload->>content_id = ANY 查询，JS group）——30 条列表全程只 3 条 SQL，
  // 逐条网络调用只剩「签名」，且签名失败单条降级不拖垮整页（照 materials.ts 惯例）。
  router.get('/', async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;
    const { tenantId } = auth;

    // 客户端输入一律当敌意：就地收窄，不藏进 helper（CodeQL 不做跨函数收窄）。
    const rawLimit = req.query?.limit;
    const parsedLimit = Number(typeof rawLimit === 'string' ? rawLimit : NaN);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(Math.floor(parsedLimit), MAX_LIST_PAGE_SIZE)
      : DEFAULT_LIST_PAGE_SIZE;

    const rawOffset = req.query?.offset;
    const parsedOffset = Number(typeof rawOffset === 'string' ? rawOffset : NaN);
    const offset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? Math.floor(parsedOffset) : 0;

    const status = typeof req.query?.status === 'string' ? req.query.status : null;

    try {
      const params: unknown[] = [tenantId];
      let where = 'tenant_id = $1';
      if (status) {
        params.push(status);
        where += ` AND status = $${params.length}`;
      }
      params.push(limit);
      const limitIdx = params.length;
      params.push(offset);
      const offsetIdx = params.length;

      const { rows: contentRows } = await pool.query(
        `SELECT id, title, body, type, platforms, status, created_at
           FROM zenithjoy.contents
          WHERE ${where}
          ORDER BY created_at DESC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params,
      );

      const ids = contentRows.map((r: { id: string }) => r.id);
      const imageByContentId = new Map<string, { file_name: string; storage_key: string }>();
      const receiptsByContentId = new Map<string, Array<{ platform: string; status: string }>>();

      if (ids.length > 0) {
        const [{ rows: imageRows }, { rows: receiptRows }] = await Promise.all([
          // DISTINCT ON：每个作品只要首图（sort_order 最小的那条素材）。
          pool.query(
            `SELECT DISTINCT ON (cm.content_id) cm.content_id, m.file_name, m.storage_key
               FROM zenithjoy.content_materials cm
               JOIN zenithjoy.materials m ON m.id = cm.material_id
              WHERE cm.content_id = ANY($1)
              ORDER BY cm.content_id, cm.sort_order ASC`,
            [ids],
          ),
          // 回执聚合：一次查出这页所有作品的所有平台任务，JS 侧 group——避免 N+1。
          pool.query(
            `SELECT payload->>'content_id' AS cid, platform, status
               FROM zenithjoy.publish_tasks
              WHERE tenant_id = $1 AND task_type = 'content_publish'
                AND payload->>'content_id' = ANY($2)`,
            [tenantId, ids],
          ),
        ]);
        for (const row of imageRows as Array<{ content_id: string; file_name: string; storage_key: string }>) {
          imageByContentId.set(row.content_id, { file_name: row.file_name, storage_key: row.storage_key });
        }
        for (const row of receiptRows as Array<{ cid: string; platform: string; status: string }>) {
          const list = receiptsByContentId.get(row.cid) ?? [];
          list.push({ platform: row.platform, status: row.status });
          receiptsByContentId.set(row.cid, list);
        }
      }

      const items = await Promise.all(
        contentRows.map(async (c: {
          id: string; title: string | null; body: string | null; type: string;
          platforms: string[]; status: string; created_at: string;
        }) => {
          const img = imageByContentId.get(c.id);
          let materials: Array<{ file_name: string; preview_url: string | null }> = [];
          if (img) {
            let previewUrl: string | null = null;
            try {
              previewUrl = await storage.getSignedUrl(img.storage_key);
            } catch (err) {
              // 单条签名失败绝不拖垮整页——照 materials.ts 列表端点惯例，降级为 null。
              console.warn('[contents/list] 预览签名失败，该条返回 null:', c.id, err);
            }
            materials = [{ file_name: img.file_name, preview_url: previewUrl }];
          }
          return {
            id: c.id,
            title: c.title,
            body: c.body,
            type: c.type,
            platforms: c.platforms,
            status: c.status,
            created_at: c.created_at,
            materials,
            receipts: receiptsByContentId.get(c.id) ?? [],
          };
        }),
      );

      ok(res, { items });
    } catch (err) {
      fail(res, 500, 'LIST_FAILED', err instanceof Error ? err.message : 'unknown');
    }
  });

  // 编辑作品（line01 刀5a）：queued（排队中）锁编辑，platforms 过白名单，
  // 只 UPDATE 客户端给到的字段（参数化，绝不拼接值进 SQL 字符串）。
  router.patch('/:id', async (req: Request, res: Response) => {
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
        `SELECT status FROM zenithjoy.contents WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [contentId, tenantId],
      );
      const current = rows[0];
      if (!current) {
        fail(res, 404, 'NOT_FOUND', '作品不存在');
        return;
      }
      if (current.status === 'queued') {
        fail(res, 409, 'EDIT_LOCKED', '作品正在排队发布中，暂不可编辑');
        return;
      }

      const bodyPlatforms: unknown = req.body?.platforms;
      if (bodyPlatforms !== undefined) {
        const illegal =
          !Array.isArray(bodyPlatforms) ||
          bodyPlatforms.some((p) => !(PUBLISH_PLATFORMS as readonly string[]).includes(p));
        if (illegal) {
          fail(res, 400, 'INVALID_PLATFORMS', 'platforms 含未知平台或格式非法');
          return;
        }
      }

      const setClauses: string[] = [];
      const params: unknown[] = [];
      if (typeof req.body?.title === 'string') {
        params.push(req.body.title);
        setClauses.push(`title = $${params.length}`);
      }
      if (typeof req.body?.body === 'string') {
        params.push(req.body.body);
        setClauses.push(`body = $${params.length}`);
      }
      if (Array.isArray(bodyPlatforms)) {
        params.push(bodyPlatforms);
        setClauses.push(`platforms = $${params.length}`);
      }

      if (setClauses.length === 0) {
        // 什么都没给：不发 UPDATE，直接幂等返回成功。
        ok(res, { id: contentId, updated: true });
        return;
      }

      setClauses.push('updated_at = now()');
      params.push(contentId);
      const idIdx = params.length;
      params.push(tenantId);
      const tenantIdx = params.length;

      await pool.query(
        `UPDATE zenithjoy.contents SET ${setClauses.join(', ')} WHERE id = $${idIdx} AND tenant_id = $${tenantIdx}`,
        params,
      );
      ok(res, { id: contentId, updated: true });
    } catch (err) {
      fail(res, 500, 'UPDATE_FAILED', err instanceof Error ? err.message : 'unknown');
    }
  });

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

  // 执行器发完回执：发布结果写回，编排台（notion-orchestrator）轮询到终态后自动回写 Notion。
  router.patch('/:id/receipt', async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;
    const taskId = req.params.id;
    if (!UUID_RE.test(taskId)) {
      fail(res, 404, 'NOT_FOUND', '任务不存在');
      return;
    }
    const result: unknown = req.body?.result;
    if (result !== 'success' && result !== 'failed') {
      fail(res, 400, 'INVALID_RESULT', "result 必须是 'success' 或 'failed'");
      return;
    }
    const detailRaw: unknown = req.body?.detail;
    const detail =
      typeof detailRaw === 'string' ? detailRaw.slice(0, RECEIPT_DETAIL_MAX_LEN) : null;

    try {
      const { rows } = await pool.query(
        `SELECT status FROM zenithjoy.publish_tasks
          WHERE id = $1 AND tenant_id = $2 AND task_type = 'content_publish'
          LIMIT 1`,
        [taskId, auth.tenantId],
      );
      const task = rows[0];
      if (!task) {
        fail(res, 404, 'NOT_FOUND', '任务不存在');
        return;
      }
      // 已终态：幂等返回当前 status，不改写（防止执行器重试回执把已回写 Notion 的结果覆盖）。
      if (!RECEIPT_NON_TERMINAL.includes(task.status)) {
        ok(res, { task_id: taskId, status: task.status });
        return;
      }

      const newStatus = result === 'success' ? 'done' : 'failed';
      const receipt = { result, detail, at: new Date().toISOString() };
      // CAS：UPDATE 必须带非终态谓词，否则并发重试（重复回执/竞态重放）会在两次
      // SELECT 之后都判定为"非终态"，谁后写谁赢——已终态可能被翻转、回执被覆盖。
      // 把"仍是非终态"钉进 WHERE，谁先落库谁定局，后来者 rowCount=0。
      const { rows: updated } = await pool.query(
        `UPDATE zenithjoy.publish_tasks
            SET status = $1,
                result = COALESCE(result, '{}'::jsonb) || $2::jsonb,
                receipt_at = now(),
                updated_at = now()
          WHERE id = $3 AND tenant_id = $4 AND status = ANY($5)
          RETURNING status`,
        [newStatus, JSON.stringify({ receipt }), taskId, auth.tenantId, RECEIPT_NON_TERMINAL],
      );
      if (updated.length === 0) {
        // 并发对手已抢先把任务写成终态：重读当前 status 走幂等返回分支，不二次改写。
        const { rows: current } = await pool.query(
          `SELECT status FROM zenithjoy.publish_tasks
            WHERE id = $1 AND tenant_id = $2 AND task_type = 'content_publish'
            LIMIT 1`,
          [taskId, auth.tenantId],
        );
        ok(res, { task_id: taskId, status: current[0]?.status ?? task.status });
        return;
      }
      ok(res, { task_id: taskId, status: updated[0].status });
    } catch (err) {
      fail(res, 500, 'RECEIPT_FAILED', err instanceof Error ? err.message : 'unknown');
    }
  });

  return router;
}
