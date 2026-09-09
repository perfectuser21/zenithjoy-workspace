// apps/api/src/services/content-publish-dispatch.ts
//
// 作品→发布任务派发核心（刀2 从 routes/publish-dispatch.ts 抽出，置换零行为变化）。
// route（HTTP 入口）与 notion-orchestrator（编排台 worker）共用这一份——复用即引用。
//
// 错误全部类型化、本模块自有（不 import walking-skeleton 的错误类：
// 既有测试对该模块做了整体 mock，跨模块类会变 undefined 令 instanceof 失效）。

import pool from '../db/connection';
import { findActiveAgentByTenantId } from './walking-skeleton.service';

/** 平台白名单——与安卓真机/网页两条执行通道当前覆盖一致。 */
export const PUBLISH_PLATFORMS = [
  'douyin', 'xiaohongshu', 'kuaishou', 'toutiao', 'weibo',
  'bilibili', 'shipinhao', 'zhihu', 'wechat',
] as const;

/**
 * publish_tasks.status 非终态集合——单一来源（route 与 notion-orchestrator 共用）。
 * 对照 20260511_102431_publish_tasks_status_enum_full.sql 的 9 值枚举核准：
 * canonical 非终态 = pending/queued/dispatched/in_progress；deprecated 兼容期非终态 = running。
 * 终态（不在此集合里的）= completed/success/done（均等价"成功"）与 failed。
 */
export const NON_TERMINAL_TASK_STATUSES = [
  'pending', 'queued', 'dispatched', 'in_progress', 'running',
];

/** publish_tasks.type 有 CHECK IN ('video','image','article')——写库前拦住。 */
const CONTENT_TYPES = ['video', 'image', 'article'];

export class AlreadyQueuedError extends Error {
  code = 'ALREADY_QUEUED' as const;
  constructor() {
    super('作品已在发布队列中，勿重复派发');
    this.name = 'AlreadyQueuedError';
  }
}

export class NoActiveAgentError extends Error {
  code = 'NO_AGENT' as const;
  constructor() {
    super('租户下没有 10 分钟内活跃的 agent，无法派发');
    this.name = 'NoActiveAgentError';
  }
}

export class DispatchValidationError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'DispatchValidationError';
  }
}

export interface DispatchResult {
  content_id: string;
  tasks: Array<{ id: string; platform: string }>;
}

interface PublishPackageMaterial {
  id: string;
  storage_key: string;
  file_name: string;
  mime_type: string | null;
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

/**
 * 作品按平台拆发布任务。返回 null = 作品不存在或跨租户（调用方各自翻译）。
 * 抛：DispatchValidationError（INVALID_PLATFORMS/INVALID_CONTENT_TYPE/NO_MATERIALS）
 *   / AlreadyQueuedError（事务外礼貌拦截 + 事务内 CAS 两层，都收敛到它）
 *   / NoActiveAgentError。
 */
export async function dispatchContentPublish(args: {
  contentId: string;
  tenantId: string;
  platformsOverride?: string[];
}): Promise<DispatchResult | null> {
  const { contentId, tenantId, platformsOverride } = args;

  const { rows } = await pool.query(
    `SELECT id, title, body, type, platforms, status
       FROM zenithjoy.contents
      WHERE id = $1 AND tenant_id = $2
      LIMIT 1`,
    [contentId, tenantId],
  );
  const content = rows[0];
  if (!content) return null;

  const platforms: string[] =
    Array.isArray(platformsOverride) && platformsOverride.length > 0
      ? platformsOverride.map(String)
      : (content.platforms as string[] | null) ?? [];
  if (platforms.length === 0) {
    throw new DispatchValidationError('INVALID_PLATFORMS', '未指定发布平台：作品没带 platforms，请求体也没给');
  }
  const illegal = platforms.filter(
    (p) => !(PUBLISH_PLATFORMS as readonly string[]).includes(p),
  );
  if (illegal.length > 0) {
    throw new DispatchValidationError('INVALID_PLATFORMS', `不认识的平台：${illegal.join('、')}`);
  }

  // 去重：同一请求重复平台只拆一条任务
  const uniquePlatforms = [...new Set(platforms)];

  if (!CONTENT_TYPES.includes(content.type)) {
    throw new DispatchValidationError('INVALID_CONTENT_TYPE', `作品形态 ${content.type} 不可派发`);
  }
  // 事务外礼貌拦截（省一次事务）；真防线是下面事务内 CAS
  if (content.status === 'queued') {
    throw new AlreadyQueuedError();
  }

  const agent = await findActiveAgentByTenantId(tenantId);
  if (!agent) {
    throw new NoActiveAgentError();
  }

  const materials = await loadMaterials(contentId);
  if (content.type !== 'article' && materials.length === 0) {
    throw new DispatchValidationError('NO_MATERIALS', '作品没有任何素材，无法发布');
  }

  const client = await pool.connect();
  const tasks: Array<{ id: string; platform: string }> = [];
  let alreadyQueued = false;
  try {
    await client.query('BEGIN');
    // 原子 CAS：两个并发派发同时读到 draft 时，只有一个能把 status 改成 queued。
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

  if (alreadyQueued) throw new AlreadyQueuedError();
  return { content_id: contentId, tasks };
}
