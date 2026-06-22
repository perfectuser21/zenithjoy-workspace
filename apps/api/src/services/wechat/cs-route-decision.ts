/**
 * cs-route-decision.ts — 微信客服「无审批自动回复闭环」服务端路由决策核心（Line 04）。
 *
 * 与 services/agent/wechat-rpa/auto_reply.py 的 decide_reply_route / within_business_hours
 * 1:1 镜像（同一真值表，两端各一份实现，CI 各自 codify）。
 *
 * 「服务端为主」接线（PR #817 C1 修复）：listen_chat.py 已是「server 返回 reply 才发」，
 * 所以决策真正生效点放在服务端 generateChatDraft(mode:auto)：读 getAutoAgentConfig →
 * 查白名单 → 调本模块 decideReplyRoute 分流，名单外/监控态/营业时间外/超额一律不返回 reply。
 *
 * 纯函数，不碰 DB / HTTP / 时钟，便于单测全覆盖。
 * 契约: sprints/06220821-line04-cs-no-approval-auto-reply/contract-draft.md
 */

// 路由字面量（禁用同义替换词，见 contract「禁用字段名/值」）。
export const ROUTE_AUTO = 'auto' as const;
export const ROUTE_REVIEW = 'review' as const;
export const ROUTE_PENDING_HUMAN = 'pending_human' as const;
export const ROUTE_SKIP_OFFHOURS = 'skip_offhours' as const;

export type ReplyRoute =
  | typeof ROUTE_AUTO
  | typeof ROUTE_REVIEW
  | typeof ROUTE_PENDING_HUMAN
  | typeof ROUTE_SKIP_OFFHOURS;

/**
 * 决定一条来消息的处理路由。返回值 ⊆ 4 字面量。
 *
 * 优先级（与 contract 真值表逐行对齐，与 auto_reply.decide_reply_route 完全一致）：
 *   1. 自动代理 OFF → review（监控态，出草稿不自动发，优先级最高）
 *   2. 名单外 → pending_human（不自动回陌生人）
 *   3. 营业时间外 → skip_offhours（记 pending 待上班）
 *   4. daily_limit>0 且已达上限 → pending_human（当天不再自动回）
 *   5. 全绿 → auto（拟人延迟自动回）
 */
export function decideReplyRoute(
  inWhitelist: boolean,
  businessHoursOk: boolean,
  autoAgentOn: boolean,
  dailyCount: number,
  dailyLimit: number,
): ReplyRoute {
  if (!autoAgentOn) return ROUTE_REVIEW;
  if (!inWhitelist) return ROUTE_PENDING_HUMAN;
  if (!businessHoursOk) return ROUTE_SKIP_OFFHOURS;
  if (dailyLimit > 0 && dailyCount >= dailyLimit) return ROUTE_PENDING_HUMAN;
  return ROUTE_AUTO;
}

/** 'HH:MM' → 当天分钟数；'24:00' → 1440。格式非法抛 Error。 */
function hhmmToMinutes(hhmm: string): number {
  if (typeof hhmm !== 'string') throw new Error(`invalid time literal: ${hhmm}`);
  const parts = hhmm.split(':');
  if (parts.length !== 2) throw new Error(`invalid HH:MM: ${hhmm}`);
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(`invalid HH:MM: ${hhmm}`);
  }
  if (!(hour >= 0 && hour <= 24 && minute >= 0 && minute <= 59)) {
    throw new Error(`out of range HH:MM: ${hhmm}`);
  }
  // 24:00 是唯一合法午夜哨兵；24:01~24:59 非法（防 UI 漏校验写脏值）
  if (hour === 24 && minute !== 0) {
    throw new Error(`24:00 is the only valid 24-hour sentinel: ${hhmm}`);
  }
  return hour * 60 + minute;
}

/**
 * nowMinutes（当天分钟数）是否落在 [start, end) 营业时间窗内。
 *
 * - end='24:00' → 视为当天 1440 分钟（全天到午夜）。
 * - 跨午夜（start > end，如 22:00–02:00）→ now >= start OR now < end。
 * - 非法时间格式抛 Error（由调用方兜，不崩主链路）。
 *
 * 与 auto_reply.within_business_hours 同语义（Python 侧传 dt.time，TS 侧传当天分钟数，
 * 两者都先归一成分钟再比，结果一致）。
 */
export function withinBusinessHours(
  startHhmm: string,
  endHhmm: string,
  nowMinutes: number,
): boolean {
  const start = hhmmToMinutes(startHhmm);
  const end = hhmmToMinutes(endHhmm);
  if (start <= end) {
    // 普通区间（含 end=24:00=1440）：闭开 [start, end)
    return start <= nowMinutes && nowMinutes < end;
  }
  // 跨午夜：例如 22:00–02:00
  return nowMinutes >= start || nowMinutes < end;
}

/** 取本地「现在」的当天分钟数（生产默认）。测试可注入 now_minutes 绕过真实时钟。 */
export function nowMinutesLocal(d: Date = new Date()): number {
  return d.getHours() * 60 + d.getMinutes();
}
