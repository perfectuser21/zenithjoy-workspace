/**
 * 批量混剪 S1（GP f6f96e17/line05）素材打标签触发队列单测。
 *
 * material-tagging.ts 的 tagMaterial() 本身已经完整实现且有自己的单测，本文件
 * 只测"排队/并发控制"这一层——不重复覆盖 Gemini 调用细节。
 *
 * 覆盖：
 *   ① 并发上限（2）——多条同时入队时，任意时刻真正在跑的 tagMaterial 不超过 2 个。
 *   ② 某一条 tagMaterial 抛异常/reject 不影响其余排队项继续跑完，也不让
 *      enqueueTagging 本身抛出（上传路由不该因为这个 500）。
 *   ③ 即使传入的 tagMaterial 同步抛错，enqueueTagging 调用本身也不同步抛出。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
// 只引类型：import type 在编译期擦除，不会破坏下面 vi.resetModules() + 动态 import 的隔离
import type { MaterialStorage } from '../material-storage';
import type { TagMaterialFn } from '../material-tagging-queue';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

// 用 MaterialStorage 而不是 any：eslint 的 no-explicit-any 是棘轮闸（--max-warnings 40，
// 只许降不许升），测试文件图省事写 any 会把额度吃掉，逼后来的人去动别人的文件。
const fakeStorage: MaterialStorage = {
  getSignedUrl: vi.fn(),
  putObject: vi.fn(),
  deleteObject: vi.fn(),
  presignPut: vi.fn(),
  headObject: vi.fn(),
};

beforeEach(() => {
  vi.resetModules();
});

describe('material-tagging-queue 并发控制', () => {
  it('并发上限=2：第 3、4 条必须等前面让出名额才会真正开始跑', async () => {
    const { enqueueTagging } = await import('../material-tagging-queue');

    let concurrent = 0;
    let maxConcurrent = 0;
    const gates = [deferred<void>(), deferred<void>(), deferred<void>(), deferred<void>()];
    const started: string[] = [];

    const tagMaterial = vi.fn(async (materialId: string) => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      started.push(materialId);
      const idx = Number(materialId.split('-')[1]);
      await gates[idx].promise;
      concurrent -= 1;
      return { status: 'tagged' as const, tags: [], description: undefined };
    });

    const results = [0, 1, 2, 3].map((i) =>
      enqueueTagging(`mat-${i}`, { storage: fakeStorage, tagMaterial }),
    );

    // 给微任务队列一点时间让前两个真正启动
    await new Promise((r) => setTimeout(r, 10));
    expect(tagMaterial).toHaveBeenCalledTimes(2);
    expect(concurrent).toBe(2);

    // 放开第一个，第三个才应该跟着补上
    gates[0].resolve();
    await new Promise((r) => setTimeout(r, 10));
    expect(tagMaterial).toHaveBeenCalledTimes(3);

    gates[1].resolve();
    await new Promise((r) => setTimeout(r, 10));
    expect(tagMaterial).toHaveBeenCalledTimes(4);

    gates[2].resolve();
    gates[3].resolve();
    await Promise.all(results);

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('某一条 tagMaterial reject 不影响其余排队项，也不让 enqueueTagging 拒绝', async () => {
    const { enqueueTagging } = await import('../material-tagging-queue');

    const tagMaterial = vi.fn(async (materialId: string) => {
      if (materialId === 'mat-bad') {
        throw new Error('gemini 挂了');
      }
      return { status: 'tagged' as const, tags: [], description: undefined };
    });

    const okBefore = enqueueTagging('mat-ok-1', { storage: fakeStorage, tagMaterial });
    const bad = enqueueTagging('mat-bad', { storage: fakeStorage, tagMaterial });
    const okAfter = enqueueTagging('mat-ok-2', { storage: fakeStorage, tagMaterial });

    await expect(bad).resolves.toBeUndefined();
    await expect(okBefore).resolves.toBeUndefined();
    await expect(okAfter).resolves.toBeUndefined();
    expect(tagMaterial).toHaveBeenCalledWith('mat-ok-1', expect.anything());
    expect(tagMaterial).toHaveBeenCalledWith('mat-bad', expect.anything());
    expect(tagMaterial).toHaveBeenCalledWith('mat-ok-2', expect.anything());
  });

  it('即使传入的 tagMaterial 函数本身同步抛错，enqueueTagging 调用也不同步抛出', async () => {
    const { enqueueTagging } = await import('../material-tagging-queue');
    const throwingTagMaterial = vi.fn(() => {
      throw new Error('同步炸了');
    });

    expect(() => enqueueTagging('mat-sync-throw', { storage: fakeStorage, tagMaterial: throwingTagMaterial as unknown as TagMaterialFn })).not.toThrow();
  });
});
