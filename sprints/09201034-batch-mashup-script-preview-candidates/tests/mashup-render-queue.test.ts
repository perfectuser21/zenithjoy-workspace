// 批量混剪加厚 Step4：渲染并发上限=1 队列。
// 禁 mock 边：这是"调度/信号量"接缝本体，纯逻辑真跑，不 mock。
import { describe, it, expect } from 'vitest';
// RED：本模块尚未实现 → import 解析失败即为预期红。
import { acquireRenderSlot, RENDER_CONCURRENCY } from '../../../apps/api/src/services/mashup-render-queue';

describe('mashup 渲染队列并发上限=1 [BEHAVIOR]', () => {
  it('RENDER_CONCURRENCY 常量为 1（hk-vps 4 核硬约束，决策 d6bedf80）', () => {
    expect(RENDER_CONCURRENCY).toBe(1);
  });

  it('第二个 acquireRenderSlot 在第一个释放前拿不到槽位（并发串行化）', async () => {
    const order: string[] = [];
    const rel1 = await acquireRenderSlot();
    order.push('a-acquired');

    const second = acquireRenderSlot().then((rel2) => {
      order.push('b-acquired');
      return rel2;
    });

    // 第一个未释放前，b 不应拿到槽位
    await new Promise((r) => setTimeout(r, 40));
    expect(order).toEqual(['a-acquired']);

    rel1();
    const rel2 = await second;
    order.push('done');
    expect(order).toEqual(['a-acquired', 'b-acquired', 'done']);
    rel2();
  });
});
