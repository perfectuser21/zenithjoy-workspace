/**
 * apps/api/src/services/scheduler.ts — Path 4 Sprint 1 ws4
 *
 * 中台定时调度器（thin 阶段）：每日 09:00 触发 /api/wechat/scheduler-tick，
 * 让飞书"营销画像"齐全的客户自动生成朋友圈草稿（pending_review，approval_source NULL）。
 *
 * cron 表达式: '0 9 * * *' （server 时区）
 * // thin: server 时区，加厚后改客户机时区（client_timezone 字段下推到 wechat_publish_task 表）
 *
 * 实现选型：
 *   不引第三方 node-cron 依赖，用 setInterval 每分钟轮询一次（开销可忽略）。
 *   每分钟检查 server 时间是否进入 09:00 那一分钟 → fire 一次（同一分钟内防抖只 fire 1 次）。
 *
 * 入口：
 *   startScheduler() → 启动 timer，返回 SchedulerHandle 用于 stopScheduler 关掉
 *   stopScheduler(handle) → clearInterval
 *   triggerSchedulerTick() → 手动触发一次（调 fetch /api/wechat/scheduler-tick）
 *
 * 内部 fetch self-call：用 PORT env 或默认 5200。
 */

const CRON_EXPRESSION = '0 9 * * *'; // cron: '0 9 * * *' — 每日 09:00（server 时区）
const POLL_INTERVAL_MS = 60_000; // 每分钟检查一次
const SCHEDULER_TICK_PATH = '/api/wechat/scheduler-tick';

export interface SchedulerHandle {
  timer: NodeJS.Timeout;
  lastFiredYmd: string | null;
}

/**
 * 触发一次 scheduler-tick：fetch self-call POST /api/wechat/scheduler-tick {force:false}
 * cron 触发时调用此函数（行为契约：fire = 内部 HTTP 自调）
 */
export async function triggerSchedulerTick(): Promise<void> {
  const port = process.env.PORT || '5200';
  const url = `http://localhost:${port}${SCHEDULER_TICK_PATH}`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: false }),
    });
    if (!resp.ok) {
      console.warn(
        `[scheduler] /api/wechat/scheduler-tick non-2xx: status=${resp.status}`,
      );
      return;
    }
    const data = (await resp.json()) as { generated?: number; skipped?: unknown[] };
    console.log(
      `[scheduler] tick fired: generated=${data.generated ?? 0} skipped=${(data.skipped ?? []).length}`,
    );
  } catch (err) {
    console.warn('[scheduler] tick fetch 失败:', err);
  }
}

/**
 * 启动 cron 轮询：每分钟检查 server 时间是否进入 09:00 那一分钟，进入则 fire。
 * 同一日同一 09:00 分钟只 fire 一次（lastFiredYmd 防抖）。
 *
 * 加厚 hint：换成 node-cron 库后可直接 cron.schedule(CRON_EXPRESSION, triggerSchedulerTick)
 */
export function startScheduler(): SchedulerHandle {
  console.log(
    `[scheduler] start with cron='${CRON_EXPRESSION}' (thin: server 时区，加厚后改客户机时区)`,
  );
  const handle: SchedulerHandle = {
    timer: setInterval(() => {
      const now = new Date();
      // 严格：cron '0 9 * * *' = hour=9 minute=0
      if (now.getHours() !== 9 || now.getMinutes() !== 0) return;
      const ymd = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      if (handle.lastFiredYmd === ymd) return; // 同日同分钟去重
      handle.lastFiredYmd = ymd;
      triggerSchedulerTick().catch((err) => {
        console.warn('[scheduler] interval-fired tick 异常:', err);
      });
    }, POLL_INTERVAL_MS),
    lastFiredYmd: null,
  };
  return handle;
}

/**
 * 停止 cron 轮询。idempotent（重复调用安全）。
 */
export function stopScheduler(handle: SchedulerHandle | null | undefined): void {
  if (!handle) return;
  if (handle.timer) {
    clearInterval(handle.timer);
  }
}
