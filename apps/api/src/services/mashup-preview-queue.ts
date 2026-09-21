// apps/api/src/services/mashup-preview-queue.ts
//
// 批量混剪加厚（GP line05/batch_mashup step3）：候选真实轻量预览队列，并发上限=1。
//
// 决策 623a81d7（纠偏 d6bedf80）：候选缩略图拼贴盲选不满足用户诉求，改为"点了才
// 现渲染"的真实轻量预览。与终版渲染队列（mashup-render-queue.ts）各自独立一把
// 并发=1的锁——预览追求秒开体验，不该被终版渲染排队卡住；两把锁合计最坏 2 个
// 并发 ffmpeg 进程，hk-vps 4 核硬约束下可接受（决策 d6bedf80）。
//
// 状态机（落在 mashup_candidates.preview_status）：
//   none / failed →（入队）→ generating →（占到唯一 slot）→
//     → ready（真实预览产物，preview_url 非空）
//     → failed（渲染抛错或无产物，可重新入队非死路）
//
// 幂等：'generating' 直接回当前态不重复触发；'ready' 且已有 preview_url 直接回，
// 不重复渲染（同终版队列 INV-3/INV-6 口径）。

import pool from '../db/connection';
import { renderPreview } from './mashup-preview-render';
import { createMaterialStorage } from './material-storage';

/** 单进程预览并发上限=1（hk-vps 4 核硬约束，决策 d6bedf80/623a81d7）。 */
const CONCURRENCY = 1;

export type PreviewStatus = 'none' | 'generating' | 'ready' | 'failed';

export interface EnqueuePreviewInput {
  tenantId: string;
  candidateId: string;
}

export interface PreviewOutcome {
  previewUrl?: string;
}

export type PreviewFn = (input: EnqueuePreviewInput) => Promise<PreviewOutcome>;

export interface EnqueuePreviewDeps {
  /** 真实预览渲染叶子（可注入）。缺省 = 走 mashup-preview-render.ts renderPreview + 真实 storage。 */
  render?: PreviewFn;
}

export interface EnqueuePreviewResult {
  candidateId: string;
  previewStatus: PreviewStatus;
  queuePosition: number;
  previewUrl: string | null;
}

interface QueueItem extends EnqueuePreviewInput {
  render: PreviewFn;
}

// 单进程内存信号量 + FIFO 等待队列（模块级单例，与终版渲染队列各自独立一份）。
let active = 0;
const waiting: QueueItem[] = [];

async function setPreviewState(candidateId: string, tenantId: string, status: PreviewStatus, previewUrl?: string): Promise<void> {
  await pool.query(
    `UPDATE zenithjoy.mashup_candidates SET preview_status = $3, preview_url = COALESCE($4, preview_url) WHERE id = $1 AND tenant_id = $2`,
    [candidateId, tenantId, status, previewUrl ?? null],
  );
}

const defaultRender: PreviewFn = async (input) => {
  const res = await renderPreview(
    { tenantId: input.tenantId, candidateId: input.candidateId },
    { storage: createMaterialStorage() },
  );
  return { previewUrl: res.previewUrl };
};

function pumpNext(): void {
  const next = waiting.shift();
  if (!next) return;
  active += 1;
  void setPreviewState(next.candidateId, next.tenantId, 'generating')
    .catch(() => {})
    .finally(() => runItem(next));
}

function runItem(item: QueueItem): void {
  void (async () => {
    try {
      const res = await item.render({ tenantId: item.tenantId, candidateId: item.candidateId });
      if (res?.previewUrl) {
        await setPreviewState(item.candidateId, item.tenantId, 'ready', res.previewUrl);
      } else {
        await setPreviewState(item.candidateId, item.tenantId, 'failed');
      }
    } catch {
      await setPreviewState(item.candidateId, item.tenantId, 'failed').catch(() => {});
    } finally {
      active -= 1;
      pumpNext();
    }
  })();
}

export async function enqueuePreview(
  input: EnqueuePreviewInput,
  deps: EnqueuePreviewDeps = {},
): Promise<EnqueuePreviewResult> {
  const render = deps.render ?? defaultRender;

  const { rows } = await pool.query(
    `SELECT id, preview_status, preview_url FROM zenithjoy.mashup_candidates WHERE id = $1 AND tenant_id = $2`,
    [input.candidateId, input.tenantId],
  );
  const candidate = rows[0];
  if (!candidate) {
    throw new Error(`candidate not found: ${input.candidateId}`);
  }
  const status: PreviewStatus = candidate.preview_status ?? 'none';

  if (status === 'generating') {
    const idx = waiting.findIndex((w) => w.candidateId === input.candidateId);
    return {
      candidateId: input.candidateId,
      previewStatus: 'generating',
      queuePosition: idx >= 0 ? idx + 1 : 0,
      previewUrl: null,
    };
  }
  if (status === 'ready' && candidate.preview_url) {
    return { candidateId: input.candidateId, previewStatus: 'ready', queuePosition: 0, previewUrl: candidate.preview_url };
  }

  // none / failed / ready-无产物：入队渲染。
  if (active < CONCURRENCY) {
    active += 1;
    await setPreviewState(input.candidateId, input.tenantId, 'generating');
    runItem({ ...input, render });
    return { candidateId: input.candidateId, previewStatus: 'generating', queuePosition: 0, previewUrl: null };
  }

  waiting.push({ ...input, render });
  await setPreviewState(input.candidateId, input.tenantId, 'generating');
  return { candidateId: input.candidateId, previewStatus: 'generating', queuePosition: waiting.length, previewUrl: null };
}
