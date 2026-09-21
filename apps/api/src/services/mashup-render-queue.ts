// apps/api/src/services/mashup-render-queue.ts
//
// 批量混剪加厚（GP line05/batch_mashup step4）：按需渲染队列，并发上限=1。
//
// 决策 d6bedf80：hk-vps 单机 4 核，真实 ffmpeg 渲染并发上限=1，第 2 个请求进排队。
// 单进程内存信号量（渲染 worker 单例）+ DB render_status 落态供前端呈现「排队第 N
// 位 / 渲染中 / 渲染失败可重试」。跨请求态以 DB 为准（INV-3 单 slot 串行）。
//
// 状态机（落在 mashup_candidates.render_status）：
//   pending / render_failed →（入队）→ queued →（占到唯一 slot）→ rendering
//     → rendered（真实成片，contents.export_url 非空）
//     → render_failed（渲染抛错，fail-closed，可重新入队非死路）
//
// 幂等 / 防重复渲染：
//   - 'rendering'：已在跑，直接回当前态，不重复触发（B-07 轮询期间不重启）。
//   - 'queued'：已排队，回队列位次。
//   - 'rendered' 且已有真实成片（contents.export_url 非空）：回 rendered（B-07 轮询
//     命中终态即退出，不再重复渲染）。
//   - 'rendered' 但无真实成片（例如注入 renderFn 只落态未产片）/ 'render_failed' /
//     'pending'：重新入队渲染（INV-6：render_failed 非死路，可重试）。

import pool from '../db/connection';
import { renderCandidate } from './mashup-render';
import { createMaterialStorage } from './material-storage';

/** 单进程渲染并发上限=1（hk-vps 4 核硬约束，决策 d6bedf80）。 */
const CONCURRENCY = 1;

export type RenderStatus = 'pending' | 'queued' | 'rendering' | 'rendered' | 'render_failed';

export interface EnqueueRenderInput {
  tenantId: string;
  candidateId: string;
}

/** 渲染叶子返回：renderStatus 指示是否真实产出成片；exportUrl 存在也视为成功。 */
export interface RenderOutcome {
  contentId?: string;
  renderStatus?: 'rendered' | 'render_failed';
  exportUrl?: string;
}

export type RenderFn = (input: EnqueueRenderInput) => Promise<RenderOutcome>;

export interface EnqueueRenderDeps {
  /** 真实渲染叶子（可注入）。缺省 = 走 mashup-render.ts renderCandidate + 真实 storage。 */
  render?: RenderFn;
}

export interface EnqueueRenderResult {
  candidateId: string;
  renderStatus: RenderStatus;
  queuePosition: number;
  contentId: string | null;
}

interface QueueItem extends EnqueueRenderInput {
  render: RenderFn;
}

// 单进程内存信号量 + FIFO 等待队列（模块级单例——整个 API 进程共享一份，
// 保证跨请求真实并发=1）。
let active = 0;
const waiting: QueueItem[] = [];

async function setRenderStatus(candidateId: string, tenantId: string, status: RenderStatus): Promise<void> {
  await pool.query(
    `UPDATE zenithjoy.mashup_candidates SET render_status = $3 WHERE id = $1 AND tenant_id = $2`,
    [candidateId, tenantId, status],
  );
}

/** 该候选是否已产出真实成片（contents.export_url 非空）——B-07 轮询幂等判据。 */
async function hasRealContent(candidateId: string): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT id FROM zenithjoy.contents
      WHERE source_candidate_id = $1 AND export_url IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`,
    [candidateId],
  );
  return rows[0]?.id ?? null;
}

/** 缺省真实渲染叶子：走 S4 renderCandidate（含内容安全 Gate），export_url 非空即成功。 */
const defaultRender: RenderFn = async (input) => {
  const res = await renderCandidate(
    { tenantId: input.tenantId, candidateId: input.candidateId },
    { storage: createMaterialStorage() },
  );
  return {
    contentId: res.contentId,
    exportUrl: res.exportUrl,
    renderStatus: res.exportUrl ? 'rendered' : 'render_failed',
  };
};

function pumpNext(): void {
  const next = waiting.shift();
  if (!next) return;
  active += 1;
  // 出队占 slot：先落 rendering 态，再后台跑，不阻塞当前调用链。
  void setRenderStatus(next.candidateId, next.tenantId, 'rendering')
    .catch(() => {})
    .finally(() => runItem(next));
}

function runItem(item: QueueItem): void {
  void (async () => {
    try {
      const res = await item.render({ tenantId: item.tenantId, candidateId: item.candidateId });
      const ok = res?.renderStatus === 'rendered' || Boolean(res?.exportUrl);
      await setRenderStatus(item.candidateId, item.tenantId, ok ? 'rendered' : 'render_failed');
    } catch {
      // fail-closed：渲染抛错落 render_failed（INV-6 防假成功，非死路可重试）。
      await setRenderStatus(item.candidateId, item.tenantId, 'render_failed').catch(() => {});
    } finally {
      active -= 1;
      pumpNext();
    }
  })();
}

export async function enqueueRender(
  input: EnqueueRenderInput,
  deps: EnqueueRenderDeps = {},
): Promise<EnqueueRenderResult> {
  const render = deps.render ?? defaultRender;

  const { rows } = await pool.query(
    `SELECT id, render_status FROM zenithjoy.mashup_candidates WHERE id = $1 AND tenant_id = $2`,
    [input.candidateId, input.tenantId],
  );
  const candidate = rows[0];
  if (!candidate) {
    throw new Error(`candidate not found: ${input.candidateId}`);
  }
  const status: RenderStatus = candidate.render_status ?? 'pending';

  // 已在渲染中：回当前态，不重复触发。
  if (status === 'rendering') {
    return { candidateId: input.candidateId, renderStatus: 'rendering', queuePosition: 0, contentId: null };
  }
  // 已排队：回队列位次。
  if (status === 'queued') {
    const idx = waiting.findIndex((w) => w.candidateId === input.candidateId);
    return {
      candidateId: input.candidateId,
      renderStatus: 'queued',
      queuePosition: idx >= 0 ? idx + 1 : Math.max(waiting.length, 1),
      contentId: null,
    };
  }
  // 已有真实成片：幂等回 rendered（B-07 轮询命中终态退出，不重复渲染）。
  if (status === 'rendered') {
    const contentId = await hasRealContent(input.candidateId);
    if (contentId) {
      return { candidateId: input.candidateId, renderStatus: 'rendered', queuePosition: 0, contentId };
    }
    // 无真实成片（如注入 renderFn 只落态）→ 落到下方重新入队。
  }

  // pending / render_failed / rendered-无成片：入队渲染。
  if (active < CONCURRENCY) {
    active += 1;
    await setRenderStatus(input.candidateId, input.tenantId, 'rendering');
    runItem({ ...input, render });
    return { candidateId: input.candidateId, renderStatus: 'rendering', queuePosition: 0, contentId: null };
  }

  waiting.push({ ...input, render });
  await setRenderStatus(input.candidateId, input.tenantId, 'queued');
  return { candidateId: input.candidateId, renderStatus: 'queued', queuePosition: waiting.length, contentId: null };
}
