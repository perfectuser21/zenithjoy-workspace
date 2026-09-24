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

// S4 客服日报：每天北京 23:55 把当天每客服 4 个数固化进 daily_report（cron: '55 23 * * *' Asia/Shanghai）。
// server 多在美区 → 不按 server 本地时间，用 Asia/Shanghai 实时换算判定那一分钟（防美区算错日界）。
const DAILY_REPORT_SETTLE_PATH = '/api/wechat/cs/daily-report/settle';
const DAILY_REPORT_HOUR_BJ = 23;
const DAILY_REPORT_MINUTE_BJ = 55;

export interface SchedulerHandle {
  timer: NodeJS.Timeout;
  lastFiredYmd: string | null;
  lastReportYmd: string | null;
}

/** 取「北京当前时刻」的 {hour, minute, ymd}（不依赖 server 本地时区）。 */
function beijingNowParts(): { hour: number; minute: number; ymd: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const ymd = `${get('year')}-${get('month')}-${get('day')}`;
  return { hour, minute, ymd };
}

/**
 * 触发一次 scheduler-tick：fetch self-call POST /api/wechat/scheduler-tick {force:false}
 * cron 触发时调用此函数（行为契约：fire = 内部 HTTP 自调）
 */
export async function triggerSchedulerTick(): Promise<void> {
  const port = process.env.PORT || '5200';
  const url = `http://localhost:${port}${SCHEDULER_TICK_PATH}`;
  // 多租户隔离：scheduler-tick 现要求租户上下文（缺租户一律 4xx 拒绝、绝不回退全量）。
  // cron 是非浏览器 caller（无 cookie）→ 沿用 body 显式 tenant_id 范式，从 ENV 配置注入。
  // 未配置 SCHEDULER_TENANT_ID 时不下传 → 路由侧 4xx 拒绝（安全：宁可不生成也不跨租户）。
  const tenantId = process.env.SCHEDULER_TENANT_ID || '';
  const body: Record<string, unknown> = { force: false };
  if (tenantId) body.tenant_id = tenantId;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
 * 触发一次 S4 客服日报结算：fetch self-call POST /api/wechat/cs/daily-report/settle {date:'today'}。
 * 把「北京当天」每客服 4 个数固化进 daily_report（upsert 保幂等，重复触发不翻倍）。
 * 全程容错：non-2xx / 网络错只 warn 不抛（不拖垮 scheduler 主循环）。
 */
export async function triggerDailyReportSettlement(): Promise<void> {
  const port = process.env.PORT || '5200';
  const url = `http://localhost:${port}${DAILY_REPORT_SETTLE_PATH}`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: 'today' }),
    });
    if (!resp.ok) {
      console.warn(`[scheduler] ${DAILY_REPORT_SETTLE_PATH} non-2xx: status=${resp.status}`);
      return;
    }
    const data = (await resp.json()) as { settled?: number };
    console.log(`[scheduler] daily-report settled: ${data.settled ?? 0} 客服`);
  } catch (err) {
    console.warn('[scheduler] daily-report settle fetch 失败:', err);
  }
}

/**
 * 启动 cron 轮询：每分钟检查 server 时间是否进入 09:00 那一分钟，进入则 fire。
 * 同一日同一 09:00 分钟只 fire 一次（lastFiredYmd 防抖）。
 * 同一 interval 内还检查「北京 23:55」→ 触发 S4 客服日报结算（lastReportYmd 防抖，按北京自然日去重）。
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
      // 严格：cron '0 9 * * *' = hour=9 minute=0（server 时区，朋友圈草稿）
      if (now.getHours() === 9 && now.getMinutes() === 0) {
        const ymd = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
        if (handle.lastFiredYmd !== ymd) {
          handle.lastFiredYmd = ymd;
          triggerSchedulerTick().catch((err) => {
            console.warn('[scheduler] interval-fired tick 异常:', err);
          });
        }
      }
      // S4：北京 23:55 → 客服日报结算（按北京自然日去重）
      const bj = beijingNowParts();
      if (bj.hour === DAILY_REPORT_HOUR_BJ && bj.minute === DAILY_REPORT_MINUTE_BJ) {
        if (handle.lastReportYmd !== bj.ymd) {
          handle.lastReportYmd = bj.ymd;
          triggerDailyReportSettlement().catch((err) => {
            console.warn('[scheduler] interval-fired daily-report 异常:', err);
          });
        }
      }
    }, POLL_INTERVAL_MS),
    lastFiredYmd: null,
    lastReportYmd: null,
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
