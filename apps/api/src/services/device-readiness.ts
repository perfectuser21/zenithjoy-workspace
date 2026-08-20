/**
 * 设备就绪度（客户安卓手机准备好了没有）。
 *
 * 客服要能在中台看到「这台客户手机卡在哪一项」，而不是等客户打电话说"你们软件不好使"。
 *
 * 形态沿用已有的 `module_status`（客户端上报 → 归一 → jsonb 落库 → 矩阵读出），
 * 但**不共用同一个字段**：module_status 是 per-Line 模块 preflight，本件是设备级权限就绪，
 * 语义不同，混在一起以后谁都读不懂。
 */

export type ReadinessItem = { ok: boolean; detail?: string };
export type ReadinessMap = Record<string, ReadinessItem>;

/**
 * 三态。**只有 `not_ready` 挡派单**（决策 3a826c45，主理人 2026-08-20 拍板 fail-open）。
 * - `ready`      设备明确说准备好了
 * - `not_ready`  设备明确说没好，**或**服务端确知 license 没绑上
 * - `unknown`    拿不到（旧版本 agent 没这个字段 / 上报丢包）→ 照派
 */
export type ReadinessVerdict = 'ready' | 'not_ready' | 'unknown';

const MAX_DETAIL_LEN = 500;
const MAX_KEY_LEN = 100;

/**
 * 校验并归一化客户端上报的 readiness。
 * 只接受 `{ [key]: { ok: boolean, detail?: string } }`，非法条目丢弃（不猜）。
 * 返回 null 表示无可持久化内容——绝不写半个空对象进库，否则读出来分不清
 * 「设备说它没有任何项」和「设备根本没上报」。
 */
export function normalizeDeviceReadiness(raw: unknown): ReadinessMap | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: ReadinessMap = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
    const v = val as Record<string, unknown>;
    if (typeof v.ok !== 'boolean') continue;
    const entry: ReadinessItem = { ok: v.ok };
    if (typeof v.detail === 'string') entry.detail = v.detail.slice(0, MAX_DETAIL_LEN);
    out[key.slice(0, MAX_KEY_LEN)] = entry;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * 合成总判定。**设备端不许自己算总账**——小白此刻正在发生的
 * 「license 配额已满(1/1)，license_machines 绑不上」设备端根本不知道，
 * 只有服务端知道，所以总判定必须在这里合成。
 *
 * @param licenseBound true=确认已绑 / false=确认没绑 / null=查不到（不算坏消息）
 */
export function computeReadinessVerdict(args: {
  deviceItems: ReadinessMap | null;
  licenseBound: boolean | null;
}): ReadinessVerdict {
  const { deviceItems, licenseBound } = args;

  // 服务端确知的坏消息压过一切：绑不上 license 就是干不了活，设备自报再好也没用
  if (licenseBound === false) return 'not_ready';

  // 服务端确知的坏消息压过一切：绑不上 license 就是干不了活，设备自报再好也没用


  if (!deviceItems || Object.keys(deviceItems).length === 0) return 'unknown';

  const anyBad = Object.values(deviceItems).some((item) => !item.ok);
  return anyBad ? 'not_ready' : 'ready';
}

/**
 * 派单闸。**fail-open**：只有明确的 `not_ready` 才挡。
 *
 * 为什么不 fail-closed（决策 3a826c45 的理由，改这里前先读）：新字段上线初期机队里
 * 新旧版本共存，未知一律不派会把一堆正常设备全停掉；而且 readiness 链路一旦有 bug，
 * fail-closed 会把整个机队判死且没有逃生口——守卫比它要防的 bug 更危险。
 * 现状本来就是全部照派，fail-open 不会比现状更差。
 */
export function isDispatchable(verdict: ReadinessVerdict): boolean {
  return verdict !== 'not_ready';
}
