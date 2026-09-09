// apps/api/src/services/publish-rollup.ts
//
// 通用发布 rollup sweeper（刀5b Task 1，还刀5a 终审 P2-2 债）。
//
// 背景：queued 作品要挪出终态（published/failed）此前只能靠 notion-orchestrator
// 或（Task 3 起的）feishu-orchestrator 的 syncReceipts 方向推一把——但 dashboard
// 直派、从未挂过任何编排台锚（notion_page_id / feishu_record_id 均为空）的客户
// 作品，没有任何 worker 会碰它们，永久卡在 queued。本 sweeper 补上这条路：
// 全租户扫描"无锚"queued 作品，用共享 helper（publish-receipts.ts）的终态聚合
// 把它们收敛掉。
//
// 与 workbench-rollup.service.ts（路③结构化工作台的 rollup/lookup 读时聚合，
// 完全不同的领域：那是"表字段间的聚合计算"，这是"发布任务终态→作品状态"）无关，
// 撞名纯属巧合。
//
// 骨架照 worker-lease-sweeper.ts：setInterval + catch 不逃逸 + unref；
// 额外 running 互斥（一轮跑不完时防 tick 重叠，同 notion-orchestrator 惯例）。
//
// feishu_record_id 列由刀5b Task 2 的 migration 建出，候选 SQL 同时按
// notion_page_id IS NULL 与 feishu_record_id IS NULL 过滤（Task 3 补齐，还清
// Task 1 阶段留的 TODO）——只有两边编排台都没锚的作品才算真正"无锚"。

import pool from '../db/connection';
import { aggregateLatestReceipts, isTerminal, SUCCESS_STATUSES } from './publish-receipts';

const LOG = '[publish-rollup]';

interface AnchorlessRow {
  id: string;
  tenant_id: string;
}

/** 单轮扫描：全租户无锚 queued 作品 → 按租户分组聚合回执 → 全终态才落地状态。 */
export async function runRollupOnce(): Promise<void> {
  const { rows } = await pool.query<AnchorlessRow>(
    `SELECT id, tenant_id
       FROM zenithjoy.contents
      WHERE status = 'queued' AND notion_page_id IS NULL AND feishu_record_id IS NULL
      ORDER BY created_at ASC
      LIMIT 200`,
  );
  if (rows.length === 0) return;

  // 按租户分组批量聚合，避免逐条起查询（N+1）；aggregateLatestReceipts 本身
  // 要求 tenantId 精确匹配（发布任务表按租户隔离）。
  const byTenant = new Map<string, string[]>();
  for (const row of rows) {
    const list = byTenant.get(row.tenant_id) ?? [];
    list.push(row.id);
    byTenant.set(row.tenant_id, list);
  }

  for (const [tenantId, contentIds] of byTenant) {
    try {
      const receiptsMap = await aggregateLatestReceipts(tenantId, contentIds);
      for (const contentId of contentIds) {
        const tasks = receiptsMap.get(contentId) ?? [];
        if (tasks.length === 0) continue; // 派发进行中，任务还没落库

        // 先 latest-wins（helper 已做）再判全终态：重发后最新一条若是
        // pending/queued/dispatched/in_progress/running，必须让它等待，
        // 不能被同平台的历史终态行盖过去。
        const allTerminal = tasks.every((t) => isTerminal(t.status));
        if (!allTerminal) continue;

        const hasFailed = tasks.some((t) => !SUCCESS_STATUSES.includes(t.status));
        await pool.query(
          `UPDATE zenithjoy.contents
              SET status = $1, updated_at = now()
            WHERE id = $2 AND tenant_id = $3`,
          [hasFailed ? 'failed' : 'published', contentId, tenantId],
        );
      }
    } catch (err) {
      console.error(LOG, tenantId, err instanceof Error ? err.message : String(err));
    }
  }
}

/** 启动 rollup sweeper（无 env 依赖，永远启动）。返回 timer（unref 过，不阻止进程退出）。 */
export function startPublishRollup(intervalMs = 60_000): NodeJS.Timeout {
  let running = false;
  const t = setInterval(() => {
    if (running) return; // 上一轮未完，跳过本轮
    running = true;
    runRollupOnce()
      .catch((e) => console.error(`${LOG} tick error:`, e instanceof Error ? e.message : String(e)))
      .finally(() => { running = false; });
  }, intervalMs);
  t.unref();
  console.info(`${LOG} 已启动（间隔 ${intervalMs}ms，全租户无锚 queued 作品 sweeper）`);
  return t;
}

/** 停止 rollup sweeper（测试/优雅关闭用）。 */
export function stopPublishRollup(t: NodeJS.Timeout): void {
  clearInterval(t);
}
