/**
 * Sprint 07052218 — 抖音私信主动触达 Android 执行路径
 *
 * 派单执行通道判定 + /dm-outreach-result 幂等判定的两个纯函数。
 * 不依赖 agents.os_type（那是设备操作系统上报，语义独立，详见
 * sprints/07052218-douyin-dm-outreach-android/contract-draft.md "device_platform 与
 * 既有 agents.os_type 关系澄清" 段），只按派单当下的 agents.capabilities 判定。
 */

export type DevicePlatform = 'android' | 'windows';

/**
 * 按 agent.capabilities 判定本次派单的执行通道。
 * 含 'android' → 'android'；不含（含空数组/null/undefined）→ 'windows'（默认执行通道，向后兼容）。
 */
export function resolveDevicePlatform(capabilities: string[] | null | undefined): DevicePlatform {
  if (Array.isArray(capabilities) && capabilities.includes('android')) {
    return 'android';
  }
  return 'windows';
}

/**
 * /dm-outreach-result 幂等判定：dm_assignment 当前状态是否已是终态。
 * 终态（sent/limited/failed）→ true（重复回传，不应再计数/不应再触发下游）。
 * 非终态（queued/dispatched）或未找到该 assignment（null）→ false（正常处理）。
 */
export function isDuplicateDmOutreachResult(currentAssignmentStatus: string | null): boolean {
  return (
    currentAssignmentStatus === 'sent' ||
    currentAssignmentStatus === 'limited' ||
    currentAssignmentStatus === 'failed'
  );
}
