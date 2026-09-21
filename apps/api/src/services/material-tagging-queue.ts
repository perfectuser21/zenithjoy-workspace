// apps/api/src/services/material-tagging-queue.ts
//
// 批量混剪 S1「客户传素材 → 系统给素材打标签」链路断点修复（GP f6f96e17/line05）：
// material-tagging.ts 的 tagMaterial() 早就实现好了，但全仓库没有任何地方调用它。
// 本模块是唯一的"什么时候调、调几个"的编排层，接在 materials.ts 的两个上传入口
// （/complete、/upload）之后。
//
// 铁律：
//   ① 不阻塞上传响应——enqueueTagging 从不需要调用方 await，内部也从不同步抛出。
//   ② 不因打标签失败而让上传失败——一切异常（tagMaterial reject、甚至同步 throw）
//      都在本模块内部吞掉，只落地为 tag_status，绝不冒泡回路由层。
//      tagMaterial 内部已经把绝大多数失败路径收敛成 'failed_pending_review'
//      （见 material-tagging.ts markFailed）；这里兜底的是它自身继续抛异常的
//      极端情况（比如素材还没提交事务就被查）。
//   ③ tag_status 的三态（pending/tagged/failed_pending_review）完全由
//      material-tagging.ts 自己的既有约定决定，本模块不发明新状态。
//   ④ 并发上限=2（同 mashup-render-queue.ts/mashup-preview-queue.ts 的模块级
//      内存信号量 + FIFO 等待队列写法）。本仓库刚因 ToAPIs 网关 520 出过事故
//      （见 postToapisWithRetry），批量上传不能一次性打爆网关，所以从源头收窄，
//      比两条渲染队列（各自=1）稍宽——打标签是纯图文小请求，不占 ffmpeg 那种
//      重计算资源，2 是"能并行省时间、又不会一次性打出一堆并发 Gemini 调用"的折中。

import { tagMaterial as defaultTagMaterial, type TagMaterialDeps, type TagMaterialResult } from './material-tagging';

/** 同时最多几个打标签请求在飞。见文件头注释——ToAPIs 网关刚出过 520 事故。 */
const CONCURRENCY = 2;

export type TagMaterialFn = (materialId: string, deps: TagMaterialDeps) => Promise<TagMaterialResult>;

export interface EnqueueTaggingDeps extends TagMaterialDeps {
  /** 可注入，测试用；缺省 = 真实的 tagMaterial（调 Gemini）。 */
  tagMaterial?: TagMaterialFn;
}

interface QueueItem {
  materialId: string;
  tagMaterial: TagMaterialFn;
  deps: TagMaterialDeps;
  resolve: () => void;
}

// 单进程内存信号量 + FIFO 等待队列（模块级单例，同两条渲染队列的写法，
// 各自独立不互相借用名额）。
let active = 0;
const waiting: QueueItem[] = [];

function pumpNext(): void {
  if (active >= CONCURRENCY) return;
  const next = waiting.shift();
  if (!next) return;
  active += 1;
  runItem(next);
}

function runItem(item: QueueItem): void {
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    active -= 1;
    item.resolve();
    pumpNext();
  };

  // Promise.resolve().then(...) 兜住 item.tagMaterial 本身同步抛错的情况——
  // 万一注入的实现没走 async 函数、直接 throw，这里也不能让它冒泡到
  // enqueueTagging 的调用方（上传路由）。
  Promise.resolve()
    .then(() => item.tagMaterial(item.materialId, item.deps))
    .catch((err) => {
      console.error(
        `[material-tagging-queue] materialId=${item.materialId} 打标签异常，已跳过（不影响上传结果，tag_status 保持 tagMaterial 落地的值）:`,
        err instanceof Error ? err.message : err,
      );
    })
    .finally(finish);
}

/**
 * 排队触发一次打标签。
 *
 * 从不同步抛出、从不 reject——返回的 Promise 只在"这一条真的跑完了（不管成败）"
 * 时 resolve，供测试等待用；生产路由不需要 await 它（fire-and-forget 即可）。
 */
export function enqueueTagging(materialId: string, deps: EnqueueTaggingDeps): Promise<void> {
  const tagMaterial = deps.tagMaterial ?? defaultTagMaterial;
  return new Promise((resolve) => {
    waiting.push({ materialId, tagMaterial, deps: { storage: deps.storage }, resolve });
    pumpNext();
  });
}

/** 仅供测试查看当前并发数/排队长度。 */
export function _debugQueueState(): { active: number; waiting: number } {
  return { active, waiting: waiting.length };
}
