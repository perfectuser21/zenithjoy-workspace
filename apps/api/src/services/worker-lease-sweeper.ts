/**
 * 工作机控制塔 · 任务租约 sweeper（决策 e14297d4 后续 · 2026-08-30 后端审查意见迁出）
 *
 * 原实现内嵌在 app.ts 里（模块加载时机与 vitest mock app.ts 时的 import 顺序耦合），
 * 迁到独立 service 文件后由 index.ts 在 server.listen 之后显式启动，
 * 与 agent-offline-monitor / scheduler 等其它进程守护同一挂法。
 *
 * 每 intervalMs 扫一次：过期 running 任务 → failed/executor_lost；
 * 顺手驱逐闲置帧缓冲（workerLive.evictIdle，无 listener 且超过 maxAgeMs 未推新帧的 agent）。
 */
import { sweepExpiredLeases } from './worker-tasks-service';
import { workerLive } from './worker-live';

/** 启动租约 sweeper，返回 timer（unref 过，不阻止进程退出）。intervalMs 默认 60s。 */
export function startWorkerLeaseSweeper(intervalMs = 60_000): NodeJS.Timeout {
  const t = setInterval(() => {
    sweepExpiredLeases()
      .then((n) => { if (n > 0) console.log(`[workers] sweeper: ${n} 个任务租约过期 → executor_lost`); })
      .catch((e) => console.error('[workers] sweeper error:', e));
    workerLive.evictIdle();
  }, intervalMs);
  t.unref();
  return t;
}

/** 停止租约 sweeper（测试/优雅关闭用）。 */
export function stopWorkerLeaseSweeper(t: NodeJS.Timeout): void {
  clearInterval(t);
}
