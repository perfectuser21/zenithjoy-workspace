// apps/api/src/services/notion-orchestrator.ts
//
// Notion 发布编排台同步器（line01 刀2）。真相在中台 DB，Notion 只是主理人
// 的私人写作台视图——所以：锚失效跳过不猜；平台读回必过白名单（不信
// Notion 手加 option）；回执写完必须把 contents 挪出 queued（否则每轮重写
// 且作品被 CAS 永锁）。
//
// 骨架照 worker-lease-sweeper：setInterval + catch 不逃逸 + unref；
// 额外 running 互斥（Notion 慢时一轮 >60s 防 tick 重叠）。
// 日志纪律：绝不打整个错误对象（AxiosError.config.headers 带 token），
// notion-client 已收敛错误，本文件 catch 只打 err.message。

import pool from '../db/connection';
import { notionRequest } from './notion-client';
import {
  dispatchContentPublish,
  AlreadyQueuedError,
  NoActiveAgentError,
  DispatchValidationError,
  PUBLISH_PLATFORMS,
} from './content-publish-dispatch';
import { aggregateLatestReceipts, isTerminal, SUCCESS_STATUSES } from './publish-receipts';
import { createMaterialStorage, type MaterialStorage } from './material-storage';

const LOG = '[notion-orch]';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RT_LIMIT = 1900;

export interface OrchEnv { dbId: string; tenantId: string; }
export interface OrchDeps { storage?: MaterialStorage; }

// --- Notion API 返回形状（最小接口，只声明本文件用到的字段） ---
interface NotionRichTextItem {
  plain_text?: string;
  text?: { content?: string };
}
interface NotionSelectOption {
  name: string;
}
interface NotionProperty {
  title?: NotionRichTextItem[];
  rich_text?: NotionRichTextItem[];
  multi_select?: NotionSelectOption[];
}
interface NotionPage {
  id: string;
  properties: Record<string, NotionProperty>;
}
interface NotionQueryResponse {
  results: NotionPage[];
  has_more: boolean;
  next_cursor?: string;
}

// --- DB 行形状 ---
interface ContentDraftRow {
  id: string;
  title: string | null;
  body: string | null;
  type: string;
  platforms: string[] | null;
}
interface MaterialRow {
  file_name: string;
  storage_key: string;
}
interface ContentStatusRow {
  status: string;
}
interface QueuedContentRow {
  id: string;
  notion_page_id: string;
}

function rt(s: string) {
  return [{ type: 'text', text: { content: s.slice(0, RT_LIMIT) } }];
}
function plain(prop: NotionProperty | undefined): string {
  const arr = prop?.title ?? prop?.rich_text ?? [];
  return arr.map((x: NotionRichTextItem) => x.plain_text ?? x?.text?.content ?? '').join('');
}
function whitelistedPlatforms(prop: NotionProperty | undefined): string[] {
  const names: string[] = (prop?.multi_select ?? []).map((o: NotionSelectOption) => o.name);
  return names.filter((p) => (PUBLISH_PLATFORMS as readonly string[]).includes(p));
}
async function markRow(pageId: string, status: string, receipt?: string) {
  const properties: Record<string, unknown> = { '状态': { select: { name: status } } };
  if (receipt !== undefined) properties['回执'] = { rich_text: rt(receipt) };
  await notionRequest('patch', `/pages/${pageId}`, { properties });
}

// 方向A：draft 且未推送的作品 → 建 Notion 行
async function pushNewContents(env: OrchEnv, storage: MaterialStorage) {
  const { rows } = await pool.query<ContentDraftRow>(
    `SELECT id, title, body, type, platforms
       FROM zenithjoy.contents
      WHERE tenant_id = $1 AND notion_page_id IS NULL AND status = 'draft'
      ORDER BY created_at ASC
      LIMIT 20`,
    [env.tenantId],
  );

  for (const content of rows) {
    try {
      const { rows: materials } = await pool.query<MaterialRow>(
        `SELECT m.file_name, m.storage_key
           FROM zenithjoy.content_materials cm
           JOIN zenithjoy.materials m ON m.id = cm.material_id
          WHERE cm.content_id = $1
          ORDER BY cm.sort_order ASC`,
        [content.id],
      );

      const properties: Record<string, unknown> = {
        '标题': { title: rt(content.title ?? '') },
        '文案': { rich_text: rt(content.body ?? '') },
        '平台': {
          multi_select: ((content.platforms as string[] | null) ?? [])
            .filter((p) => (PUBLISH_PLATFORMS as readonly string[]).includes(p))
            .map((name) => ({ name })),
        },
        '形态': { select: { name: content.type } },
        '状态': { select: { name: '草稿' } },
        '素材': { rich_text: rt(materials.map((m) => m.file_name).join('、')) },
        'content_id': { rich_text: rt(content.id) },
      };

      if (materials.length > 0) {
        const previewUrl = await storage.getSignedUrl(materials[0].storage_key);
        properties['预览'] = { url: previewUrl };
      }

      const page = await notionRequest<{ id: string }>('post', '/pages', {
        parent: { database_id: env.dbId },
        properties,
      });

      await pool.query(
        `UPDATE zenithjoy.contents
            SET notion_page_id = $1, updated_at = now()
          WHERE id = $2 AND tenant_id = $3`,
        [page.id, content.id, env.tenantId],
      );
    } catch (err) {
      console.error(LOG, content.id, err instanceof Error ? err.message : String(err));
    }
  }
}

// 方向B：状态='发' 的行（databases/{id}/query 分页 while has_more）→ 回写+派发
async function pullFireRows(env: OrchEnv) {
  let cursor: string | undefined;
  do {
    const body: Record<string, unknown> = {
      filter: { property: '状态', select: { equals: '发' } },
      page_size: 100,
    };
    if (cursor) body.start_cursor = cursor;
    const resp = await notionRequest<NotionQueryResponse>(
      'post',
      `/databases/${env.dbId}/query`,
      body,
    );

    for (const page of resp.results) {
      try {
        const props = page.properties;
        const title = plain(props['标题']);
        const body_ = plain(props['文案']);
        const contentId = plain(props['content_id']).trim();
        const platforms = whitelistedPlatforms(props['平台']);

        if (!UUID_RE.test(contentId)) {
          console.error(`${LOG} 锚失效跳过 page=${page.id}: content_id 不是合法 UUID`);
          await markRow(page.id, '派发失败', '锚失效：content_id 不是合法 UUID');
          continue;
        }

        const { rows: existing } = await pool.query<ContentStatusRow>(
          `SELECT id, status
             FROM zenithjoy.contents
            WHERE id = $1 AND tenant_id = $2`,
          [contentId, env.tenantId],
        );
        const existingStatus = existing[0]?.status;
        if (existingStatus === 'published' || existingStatus === 'failed') {
          console.error(
            `${LOG} 拒绝重派 page=${page.id}: 作品已终态(${existingStatus})，重试会导致已成功平台重复发帖 content_id=${contentId}`,
          );
          await markRow(
            page.id,
            '派发失败',
            '该作品已完成一轮发布，重试会导致已成功平台重复发帖——如需再发请重新上传素材',
          );
          continue;
        }

        await pool.query(
          `UPDATE zenithjoy.contents
              SET title = $1, body = $2, platforms = $3, updated_at = now()
            WHERE id = $4 AND tenant_id = $5`,
          [title, body_, platforms, contentId, env.tenantId],
        );

        try {
          const result = await dispatchContentPublish({
            contentId,
            tenantId: env.tenantId,
            platformsOverride: platforms,
          });
          if (!result) {
            console.error(`${LOG} 锚失效跳过 page=${page.id}: 作品不存在或不属于本租户 content_id=${contentId}`);
            await markRow(page.id, '派发失败', '锚失效：作品不存在或不属于本租户');
          } else {
            await markRow(page.id, '排队中');
          }
        } catch (err) {
          if (err instanceof AlreadyQueuedError) {
            await markRow(page.id, '排队中');
          } else if (err instanceof NoActiveAgentError || err instanceof DispatchValidationError) {
            await markRow(page.id, '派发失败', err.message);
          } else {
            console.error(LOG, page.id, err instanceof Error ? err.message : String(err));
          }
        }
      } catch (err) {
        console.error(LOG, page.id, err instanceof Error ? err.message : String(err));
      }
    }

    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);
}

// 方向C：queued 且有行锚的作品 → 全任务终态才写回执 + contents 挪出 queued
async function syncReceipts(env: OrchEnv) {
  const { rows } = await pool.query<QueuedContentRow>(
    `SELECT id, notion_page_id
       FROM zenithjoy.contents
      WHERE tenant_id = $1 AND status = 'queued' AND notion_page_id IS NOT NULL`,
    [env.tenantId],
  );
  if (rows.length === 0) return;

  // 共享 helper 批量聚合（P2-3 修复点）：此前这里逐条查 publish_tasks 且没做
  // latest-wins，同一平台的历史 failed 行会和重发后的新 done 行一起进 hasFailed
  // 判定，永久把"已经成功"的作品判成"部分失败"。helper 按 (content_id, platform)
  // 收敛到最新一条，历史行不再污染判定。
  const receiptsMap = await aggregateLatestReceipts(env.tenantId, rows.map((r) => r.id));

  for (const content of rows) {
    try {
      const tasks = receiptsMap.get(content.id) ?? [];

      if (tasks.length === 0) continue; // 派发进行中，任务还没落库
      const allTerminal = tasks.every((t) => isTerminal(t.status));
      if (!allTerminal) continue;

      const hasFailed = tasks.some((t) => !SUCCESS_STATUSES.includes(t.status));
      const receipt = tasks
        .map((t) => `${t.platform} ${t.status === 'done' ? '✅' : '❌ ' + JSON.stringify(t.result ?? '')}`)
        .join(' / ');

      await markRow(content.notion_page_id, hasFailed ? '部分失败' : '已发', receipt);

      await pool.query(
        hasFailed
          ? `UPDATE zenithjoy.contents
                SET status = 'failed', updated_at = now()
              WHERE id = $1 AND tenant_id = $2`
          : `UPDATE zenithjoy.contents
                SET status = 'published', updated_at = now()
              WHERE id = $1 AND tenant_id = $2`,
        [content.id, env.tenantId],
      );
    } catch (err) {
      console.error(LOG, content.id, err instanceof Error ? err.message : String(err));
    }
  }
}

export async function runOnce(env: OrchEnv, deps: OrchDeps = {}) {
  const storage = deps.storage ?? createMaterialStorage();
  await pushNewContents(env, storage);
  await pullFireRows(env);
  await syncReceipts(env);
}

export function startNotionOrchestrator(intervalMs = 60_000): NodeJS.Timeout | null {
  const token = process.env.NOTION_INTEGRATION_TOKEN;
  const dbId = process.env.NOTION_PUBLISH_ORCH_DB_ID;
  const tenantId = process.env.NOTION_ORCH_TENANT_ID;
  const missing = [
    !token && 'NOTION_INTEGRATION_TOKEN',
    !dbId && 'NOTION_PUBLISH_ORCH_DB_ID',
    !tenantId && 'NOTION_ORCH_TENANT_ID',
  ].filter(Boolean);
  if (missing.length > 0) {
    console.error(`${LOG} 未配置(${missing.join('/')})，跳过启动——编排台同步不可用`);
    return null;
  }
  const env: OrchEnv = { dbId: dbId as string, tenantId: tenantId as string };
  let running = false;
  const t = setInterval(() => {
    if (running) return; // 上一轮未完，跳过本轮
    running = true;
    runOnce(env)
      .catch((e) => console.error(`${LOG} tick error:`, e instanceof Error ? e.message : String(e)))
      .finally(() => { running = false; });
  }, intervalMs);
  t.unref();
  console.info(`${LOG} 已启动（间隔 ${intervalMs}ms，tenant ${env.tenantId.slice(0, 8)}）`);
  return t;
}

export function stopNotionOrchestrator(t: NodeJS.Timeout): void {
  clearInterval(t);
}
