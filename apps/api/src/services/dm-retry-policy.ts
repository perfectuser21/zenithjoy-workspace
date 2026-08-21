/**
 * 失败线索要不要重投 —— 抽成纯决策，便于钉住且不必连库。
 *
 * 为什么需要（0821 真机数据）：私信单次成功率 32%，但**失败是随机的**——
 * 试过多次的 13 条线索里 6 条是"先失败、后成功"，同一个人换一次尝试就成了。
 * 而产能严重过剩：3 个小号 × 30 条/天 = 90 次配额，当天只用了 30 次，
 * 新增可触达线索才 15 条。
 *
 * 旧去重却把重投堵死了：`dm_assignments` 那半边**没有状态过滤也没有时间窗**，
 * 某个号派过一次（哪怕失败）就永远不能再试它 → 一条线索一辈子最多 3 次尝试。
 *
 * 按 32% 单次成功率：3 次累计 69%，6 次累计 90%。这一刀不碰 RPA、不发版、
 * 不动手机，只是把已经买好却没用的产能兑现成送达。
 */

export const DmRetryPolicy = {
  /**
   * 一条线索最多失败几次就放弃。
   * 上限存在的意义：别把配额烧在一条真的发不出去的线索上（比如对方账号已注销），
   * 挤掉后面新线索的机会。6 次 ≈ 90% 累计送达，同时最多占 6/90 的日配额。
   */
  MAX_FAILED_ATTEMPTS: 6,

  /**
   * 两次尝试之间至少间隔多久。贴着重试没有意义——失败常常是页面/前台的瞬时状态，
   * 隔一会儿再来命中率更高，也更像真人行为。
   */
  COOLDOWN_MINUTES: 20,
} as const;

export interface LeadAttemptStats {
  /** 这个小号是否已经**成功**发给过这条线索 */
  sentByThisAccount: boolean;
  /** 是否已有在跑的派单（queued / dispatched / pending_dispatch） */
  hasActiveAssignment: boolean;
  /** 该线索累计失败次数（跨所有小号） */
  failedAttempts: number;
  /** 距最近一次失败多少分钟；从没失败过为 null */
  minutesSinceLastFailure: number | null;
}

export interface AssignDecision {
  assign: boolean;
  reason: string;
}

export function shouldAssignLead(stats: LeadAttemptStats): AssignDecision {
  // 已成功优先于一切——绝不给同一个人重复发第二条
  if (stats.sentByThisAccount) return { assign: false, reason: 'already_sent' };
  if (stats.hasActiveAssignment) return { assign: false, reason: 'already_queued' };
  if (stats.failedAttempts >= DmRetryPolicy.MAX_FAILED_ATTEMPTS) {
    return { assign: false, reason: 'max_attempts' };
  }
  if (
    stats.minutesSinceLastFailure !== null &&
    stats.minutesSinceLastFailure < DmRetryPolicy.COOLDOWN_MINUTES
  ) {
    return { assign: false, reason: 'cooling' };
  }
  return { assign: true, reason: 'ok' };
}
