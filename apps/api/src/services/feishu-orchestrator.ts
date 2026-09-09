// apps/api/src/services/feishu-orchestrator.ts
//
// 飞书发布编排台同步器（line01 刀5b Task 3）。镜像 notion-orchestrator.ts 的三方向
// 结构与日志纪律，只换目标端为飞书 Bitable——真相仍在中台 DB，飞书行只是主理人的
// 私人写作台视图：锚失效跳过不猜；平台读回必过白名单（不信飞书手加 option）；
// 回执写完必须把 contents 挪出 queued（否则每轮重写且作品被 CAS 永锁）。
//
// Bitable 值形态是这次镜像最大的错误面（与 Notion 的属性包裹形态完全不同）：
//   写：多选=裸字符串数组 ['douyin']；单选=裸字符串 '草稿'；
//       超链接(type 15)={text, link}；文本=裸字符串。
//   读：文本字段可能是 segment 数组 [{type,text}]，也可能直接是裸字符串
//       （不同飞书 SDK/版本行为不一致）——plainText() 两形态都兼容；
//       单选=裸字符串；多选=裸字符串数组。
//
// 骨架照 worker-lease-sweeper：setInterval + catch 不逃逸 + unref；
// 额外 running 互斥（飞书慢时一轮 >60s 防 tick 重叠）。
// 与 Notion 编排台的租户互斥：同一租户绝不能被两边同时推行/派发，否则会重复建行、
// 重复派发。单边拒启（本文件检查，Notion 侧不加检查）防止两边互相拒启死锁。
// 日志纪律：绝不打整个错误对象（AxiosError.config.headers 带 token），
// feishu-client 已收敛错误，本文件 catch 只打 err.message。
// 频控（FeishuRateLimitError）：跳过本轮剩余处理，不当普通错误重试打满配额。

import pool from '../db/connection';
import { feishuRequest, FeishuRateLimitError } from './feishu-client';
import {
  dispatchContentPublish,
  AlreadyQueuedError,
  NoActiveAgentError,
  DispatchValidationError,
  PUBLISH_PLATFORMS,
} from './content-publish-dispatch';
import { aggregateLatestReceipts, isTerminal, SUCCESS_STATUSES } from './publish-receipts';
import { createMaterialStorage, type MaterialStorage } from './material-storage';

const LOG = '[feishu-orch]';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RT_LIMIT = 1900;

export interface FeishuOrchEnv { appToken: string; tableId: string; tenantId: string; }
export interface FeishuOrchDeps { storage?: MaterialStorage; }

// --- 飞书 Bitable 返回形状（最小接口，只声明本文件用到的字段） ---
type FeishuTextValue = string | Array<{ type?: string; text?: string }>;
interface FeishuRecordFields {
  '标题'?: FeishuTextValue;
  '文案'?: FeishuTextValue;
  'content_id'?: FeishuTextValue;
  '平台'?: string[];
  [key: string]: unknown;
}
interface FeishuRecord {
  record_id: string;
  fields: FeishuRecordFields;
}
interface FeishuSearchResponse {
  data: { items?: FeishuRecord[]; has_more?: boolean; page_token?: string };
}
interface FeishuCreateRecordResponse {
  data: { record: { record_id: string } };
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
  feishu_record_id: string;
}

/** 文本字段两形态兼容拼接：segment 数组 [{type,text}] 或裸字符串。 */
function plainText(v: FeishuTextValue | undefined): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((seg) => seg?.text ?? '').join('');
  return '';
}
function whitelistedPlatforms(v: string[] | undefined): string[] {
  return (v ?? []).filter((p) => (PUBLISH_PLATFORMS as readonly string[]).includes(p));
}
async function markRow(env: FeishuOrchEnv, recordId: string, status: string, receipt?: string) {
  const fields: Record<string, unknown> = { '状态': status };
  if (receipt !== undefined) fields['回执'] = receipt.slice(0, RT_LIMIT);
  await feishuRequest(
    'put',
    `/open-apis/bitable/v1/apps/${env.appToken}/tables/${env.tableId}/records/${recordId}`,
    { fields },
  );
}

// 方向A：draft 且未推送的作品 → 建飞书行
async function pushNewContents(env: FeishuOrchEnv, storage: MaterialStorage) {
  const { rows } = await pool.query<ContentDraftRow>(
    `SELECT id, title, body, type, platforms
       FROM zenithjoy.contents
      WHERE tenant_id = $1 AND feishu_record_id IS NULL AND status = 'draft'
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

      // Bitable 值形态：多选=裸字符串数组、单选=裸字符串、文本=裸字符串——
      // 与 Notion 版的属性包裹（{select:{name}}/{rich_text:[...]}）完全不同。
      const fields: Record<string, unknown> = {
        '标题': content.title ?? '',
        '文案': content.body ?? '',
        '平台': ((content.platforms as string[] | null) ?? []).filter((p) =>
          (PUBLISH_PLATFORMS as readonly string[]).includes(p),
        ),
        '形态': content.type,
        '状态': '草稿',
        '素材': materials.map((m) => m.file_name).join('、'),
        'content_id': content.id,
      };

      if (materials.length > 0) {
        const previewUrl = await storage.getSignedUrl(materials[0].storage_key);
        fields['预览'] = { text: '预览', link: previewUrl };
      }

      const resp = await feishuRequest<FeishuCreateRecordResponse>(
        'post',
        `/open-apis/bitable/v1/apps/${env.appToken}/tables/${env.tableId}/records`,
        { fields },
      );
      const recordId = resp.data.record.record_id;

      await pool.query(
        `UPDATE zenithjoy.contents
            SET feishu_record_id = $1, updated_at = now()
          WHERE id = $2 AND tenant_id = $3`,
        [recordId, content.id, env.tenantId],
      );
    } catch (err) {
      if (err instanceof FeishuRateLimitError) {
        console.error(`${LOG} 飞书频控，本轮推行跳过剩余:`, err.message);
        return;
      }
      console.error(LOG, content.id, err instanceof Error ? err.message : String(err));
    }
  }
}

// 方向B：状态='发' 的行（records/search 分页 while has_more）→ 回写+派发
async function pullFireRows(env: FeishuOrchEnv) {
  let pageToken: string | undefined;
  do {
    const body: Record<string, unknown> = {
      filter: {
        conjunction: 'and',
        conditions: [{ field_name: '状态', operator: 'is', value: ['发'] }],
      },
      page_size: 100,
    };
    if (pageToken) body.page_token = pageToken;

    let resp: FeishuSearchResponse;
    try {
      resp = await feishuRequest<FeishuSearchResponse>(
        'post',
        `/open-apis/bitable/v1/apps/${env.appToken}/tables/${env.tableId}/records/search`,
        body,
      );
    } catch (err) {
      if (err instanceof FeishuRateLimitError) {
        console.error(`${LOG} 飞书频控，本轮拉发跳过:`, err.message);
      } else {
        console.error(LOG, 'search', err instanceof Error ? err.message : String(err));
      }
      return;
    }

    const items = resp.data.items ?? [];
    for (const record of items) {
      try {
        const f = record.fields;
        const title = plainText(f['标题']);
        const body_ = plainText(f['文案']);
        const contentId = plainText(f['content_id']).trim();
        const platforms = whitelistedPlatforms(f['平台']);

        if (!UUID_RE.test(contentId)) {
          console.error(`${LOG} 锚失效跳过 record=${record.record_id}: content_id 不是合法 UUID`);
          await markRow(env, record.record_id, '派发失败', '锚失效：content_id 不是合法 UUID');
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
            `${LOG} 拒绝重派 record=${record.record_id}: 作品已终态(${existingStatus})，重试会导致已成功平台重复发帖 content_id=${contentId}`,
          );
          await markRow(
            env,
            record.record_id,
            '派发失败',
            '该作品已完成一轮发布，重试会导致已成功平台重复发帖——如需再发请重新上传素材',
          );
          continue;
        }

        // 拉发回写 contents 的文案不截断——Bitable 无 2000 字限制，别毁长文案。
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
            console.error(`${LOG} 锚失效跳过 record=${record.record_id}: 作品不存在或不属于本租户 content_id=${contentId}`);
            await markRow(env, record.record_id, '派发失败', '锚失效：作品不存在或不属于本租户');
          } else {
            await markRow(env, record.record_id, '排队中');
          }
        } catch (err) {
          if (err instanceof AlreadyQueuedError) {
            await markRow(env, record.record_id, '排队中');
          } else if (err instanceof NoActiveAgentError || err instanceof DispatchValidationError) {
            await markRow(env, record.record_id, '派发失败', err.message);
          } else if (err instanceof FeishuRateLimitError) {
            throw err;
          } else {
            console.error(LOG, record.record_id, err instanceof Error ? err.message : String(err));
          }
        }
      } catch (err) {
        if (err instanceof FeishuRateLimitError) {
          console.error(`${LOG} 飞书频控，本轮拉发跳过剩余:`, err.message);
          return;
        }
        console.error(LOG, record.record_id, err instanceof Error ? err.message : String(err));
      }
    }

    pageToken = resp.data.has_more ? resp.data.page_token : undefined;
  } while (pageToken);
}

// 方向C：queued 且有行锚的作品 → 全任务终态才写回执 + contents 挪出 queued
async function syncReceipts(env: FeishuOrchEnv) {
  const { rows } = await pool.query<QueuedContentRow>(
    `SELECT id, feishu_record_id
       FROM zenithjoy.contents
      WHERE tenant_id = $1 AND status = 'queued' AND feishu_record_id IS NOT NULL`,
    [env.tenantId],
  );
  if (rows.length === 0) return;

  const receiptsMap = await aggregateLatestReceipts(env.tenantId, rows.map((r) => r.id));

  for (const content of rows) {
    try {
      const tasks = receiptsMap.get(content.id) ?? [];

      if (tasks.length === 0) continue; // 派发进行中，任务还没落库
      const allTerminal = tasks.every((t) => isTerminal(t.status));
      if (!allTerminal) continue;

      const hasFailed = tasks.some((t) => !SUCCESS_STATUSES.includes(t.status));
      const receipt = tasks
        .map((t) => `${t.platform} ${SUCCESS_STATUSES.includes(t.status) ? '✅' : '❌ ' + JSON.stringify(t.result ?? '')}`)
        .join(' / ');

      // 回执文本截 1900（与 Notion 版统一口径，写库前在 markRow 里做）。
      await markRow(env, content.feishu_record_id, hasFailed ? '部分失败' : '已发', receipt);

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
      if (err instanceof FeishuRateLimitError) {
        console.error(`${LOG} 飞书频控，本轮回执跳过剩余:`, err.message);
        return;
      }
      console.error(LOG, content.id, err instanceof Error ? err.message : String(err));
    }
  }
}

export async function runOnce(env: FeishuOrchEnv, deps: FeishuOrchDeps = {}) {
  const storage = deps.storage ?? createMaterialStorage();
  await pushNewContents(env, storage);
  await pullFireRows(env);
  await syncReceipts(env);
}

export function startFeishuOrchestrator(intervalMs = 60_000): NodeJS.Timeout | null {
  const appToken = process.env.FEISHU_ORCH_APP_TOKEN;
  const tableId = process.env.FEISHU_ORCH_TABLE_ID;
  const tenantId = process.env.FEISHU_ORCH_TENANT_ID;
  const missing = [
    !appToken && 'FEISHU_ORCH_APP_TOKEN',
    !tableId && 'FEISHU_ORCH_TABLE_ID',
    !tenantId && 'FEISHU_ORCH_TENANT_ID',
  ].filter(Boolean);
  if (missing.length > 0) {
    console.error(`${LOG} 未配置(${missing.join('/')})，跳过启动——编排台同步不可用`);
    return null;
  }

  // 互斥（单边拒启）：同一租户绝不能被 Notion 与飞书两边编排台同时推行/派发，
  // 否则同一作品会被两边各建一行、各派一次发，重复发帖。Notion 侧不加对称检查，
  // 防止两边互相拒启形成死局（谁先启动谁占位，后来者让路）。
  const notionTenantId = process.env.NOTION_ORCH_TENANT_ID;
  if (notionTenantId && notionTenantId === tenantId) {
    console.error(
      `${LOG} 与 Notion 编排台租户冲突(tenant=${(tenantId as string).slice(0, 8)})，拒绝启动`,
    );
    return null;
  }

  const env: FeishuOrchEnv = {
    appToken: appToken as string,
    tableId: tableId as string,
    tenantId: tenantId as string,
  };
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

export function stopFeishuOrchestrator(t: NodeJS.Timeout): void {
  clearInterval(t);
}
