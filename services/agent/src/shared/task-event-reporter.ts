// services/agent/src/shared/task-event-reporter.ts
//
// 任务观测上报薄封装（Sprint cp-06262240）—— 把任务 handler 的开始/失败/成功
// 接进既有 reportEvent 管子（POST /api/agent/events）。
//
// 死规矩：所有上报必须包在 try/catch 里静默吞，绝不因为上报失败影响任务本身。
// 这是观测旁路，挂了不能崩 agent，也不能让任务流程多抛一个错。
//
// reportImpl 注入点：默认走真实 reportEvent；单测注入 mock 断言「失败时被调用且 message 含 error」。

import {
  reportEvent,
  type EventReporterConfig,
  type AgentEvent,
} from './event-reporter';

export type ReportImpl = (cfg: EventReporterConfig, event: AgentEvent) => Promise<void> | void;

/** 默认上报实现（真实 reportEvent）。单测覆写。 */
let reportImpl: ReportImpl = reportEvent;

/** 仅供测试注入 mock；传 undefined 恢复默认。 */
export function __setTaskReportImpl(impl?: ReportImpl): void {
  reportImpl = impl ?? reportEvent;
}

/**
 * 把任意平台名映射成 module（line/平台标识），中台据此分组。
 * 不在映射表里的原样返回（够用即可，不强求全覆盖）。
 */
export function platformToModule(platform: string | undefined): string | undefined {
  if (!platform) return undefined;
  if (platform.startsWith('qr_bind/douyin_burner') || platform === 'qr_bind_douyin_burner') {
    return 'line02';
  }
  if (platform.startsWith('crawl_comments')) return 'line02';
  if (platform === 'douyin' || platform.startsWith('qr_bind/douyin') || platform === 'qr_bind_douyin') {
    return 'line01';
  }
  if (platform.startsWith('qr_bind/')) return 'line00';
  if (platform.startsWith('wechat_')) return 'line04';
  return platform;
}

/**
 * 安全上报：把 reportImpl 包在 try/catch 里静默吞。
 * 任何同步抛 / Promise reject 都不外泄（绝不崩任务）。
 */
async function safeReport(cfg: EventReporterConfig, event: AgentEvent): Promise<void> {
  try {
    await reportImpl(cfg, event);
  } catch {
    // 观测旁路：上报失败静默吞，绝不影响任务本身
  }
}

/** 任务开始：info 级。 */
export async function reportTaskStart(
  cfg: EventReporterConfig,
  args: { platform: string; taskId: string; accountLabel?: string },
): Promise<void> {
  await safeReport(cfg, {
    kind: 'log',
    level: 'info',
    module: platformToModule(args.platform),
    message: `任务开始 ${args.platform} ${args.taskId}`,
    context: { task_id: args.taskId, account_label: args.accountLabel },
  });
}

/**
 * 任务失败：error 级。**error 文本必须原样进 message**
 * （让中台看到 qr-bind 为什么失败 —— playwright 未安装 / Edge 启动失败 / profile 锁等）。
 */
export async function reportTaskFail(
  cfg: EventReporterConfig,
  args: { platform: string; taskId: string; error: string; accountLabel?: string },
): Promise<void> {
  await safeReport(cfg, {
    kind: 'log',
    level: 'error',
    module: platformToModule(args.platform),
    message: `${args.platform} 失败: ${args.error}`,
    context: { task_id: args.taskId, account_label: args.accountLabel },
  });
}

/** 任务成功：info 级（可选，失败必报）。 */
export async function reportTaskOk(
  cfg: EventReporterConfig,
  args: { platform: string; taskId: string; accountLabel?: string },
): Promise<void> {
  await safeReport(cfg, {
    kind: 'log',
    level: 'info',
    module: platformToModule(args.platform),
    message: `${args.platform} 成功`,
    context: { task_id: args.taskId, account_label: args.accountLabel },
  });
}
