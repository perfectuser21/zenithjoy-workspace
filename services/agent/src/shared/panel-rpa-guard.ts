// RPA 进行中判定守卫 —— fail-closed（判定点，decisions表已登记，用户已确认）
//
// 查 desktop-lease-broker 状态(GET /api/agent/desktop-lease-broker/status)，
// 查询失败/超时/返回不可解析 → 一律当作"RPA 正在进行中"，面板保持贴边穿透，绝不擅自全屏。
// 反面(fail-open)一旦误判会挡住微信/抖音操作区，与历史 cloak/挪窗口 E_ACCESSDENIED 真机事故同型。

export type LeaseStatusFetcher = () => Promise<{ held: boolean } | null>;

export type RpaGuardReason = 'rpa_active' | 'broker_unreachable' | 'no_rpa';

export interface RpaGuardResult {
  /** true = 面板应该退让(贴边穿透，不给全屏) */
  shouldYield: boolean;
  reason: RpaGuardReason;
}

const DEFAULT_TIMEOUT_MS = 3000;

const TIMEOUT_SENTINEL = Symbol('rpa-guard-timeout');

export async function checkRpaGuard(
  fetchStatus: LeaseStatusFetcher,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<RpaGuardResult> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs);
  });

  try {
    const result = await Promise.race([fetchStatus(), timeoutPromise]);
    clearTimeout(timer!);

    if (result === TIMEOUT_SENTINEL || result === null) {
      return { shouldYield: true, reason: 'broker_unreachable' };
    }
    if (result.held) {
      return { shouldYield: true, reason: 'rpa_active' };
    }
    return { shouldYield: false, reason: 'no_rpa' };
  } catch {
    clearTimeout(timer!);
    return { shouldYield: true, reason: 'broker_unreachable' };
  }
}
