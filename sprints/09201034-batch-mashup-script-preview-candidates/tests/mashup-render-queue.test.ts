/**
 * 批量混剪加厚 · Step4 渲染并发上限=1 队列（GP line05/batch_mashup）合同测试（TDD Red）。
 *
 * 禁 mock 边：渲染并发队列这条边就是本 Step 被改的核心接缝——直接对真实队列模块
 * 断言，不 mock 它。ffmpeg 用受控替身（外层算力边界，真调一次在 windows_cloud E2E）。
 *
 * 队列语义（合同）：并发上限=1 的 FIFO 自排空队列。enqueueRender 同步返回本次提交
 * 的**提交态**：拿到并发位 = 'running'；被占用 = 'queued' 且带 queuePosition（第 N 位）；
 * done 为最终结果 Promise（'completed' | 'render_failed'）。队列空后按 FIFO 自动排空。
 *
 * 现在必红：apps/api/src/services/mashup-render-queue.ts 尚不存在。
 */
import { describe, it, expect } from 'vitest';
import {
  enqueueRender,
  RENDER_MAX_CONCURRENCY,
} from '../../../apps/api/src/services/mashup-render-queue';

const defer = () => {
  let resolve!: () => void;
  const p = new Promise<void>((r) => (resolve = r));
  return { p, resolve };
};

describe('mashup-render-queue 并发上限=1 [BEHAVIOR]', () => {
  it('并发上限常量=1（hk-vps 4 核硬约束，决策 d6bedf80）', () => {
    expect(RENDER_MAX_CONCURRENCY).toBe(1);
  });

  it('第一个渲染 running、第二个并发请求进入 queued 且带 queuePosition=1', async () => {
    const gate = defer();
    const first = enqueueRender('cand-A', async () => {
      await gate.p;
      return { contentId: 'c1' };
    });
    expect(first.status).toBe('running');

    // 第二个此刻进来：唯一并发位被占，应 queued 而不是也开跑
    const second = enqueueRender('cand-B', async () => ({ contentId: 'c2' }));
    expect(second.status).toBe('queued');
    expect(second.queuePosition).toBe(1);

    // 放行第一个 → 两个都最终 completed（FIFO 自排空）
    gate.resolve();
    const r1 = await first.done;
    const r2 = await second.done;
    expect(r1.status).toBe('completed');
    expect(r2.status).toBe('completed');
  });

  it('渲染函数失败 → done 结果为 render_failed 态（非死路，可重试）', async () => {
    const r = enqueueRender('cand-fail', async () => {
      throw new Error('ffmpeg exited 1');
    });
    const res = await r.done;
    expect(res.status).toBe('render_failed');
    expect(typeof res.reason).toBe('string');
  });
});
