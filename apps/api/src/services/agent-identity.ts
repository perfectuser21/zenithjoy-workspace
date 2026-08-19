/**
 * Agent 身份去重键 —— 按机器指纹(machine_id)而非机型名(hostname)。
 *
 * 背景（2026-08-19 办公室机队实证）：安卓端上报的 hostname 是 `android.os.Build.MODEL`
 * ——机型名，不是机器名。小黄与四号机同为荣耀 MAA-AN00，在 `agents` 表按
 * (tenant_id, hostname) 去重时被认成同一台，共用一行、共用 agent_id；派任务给该 id 时
 * 实际哪台执行完全不确定。当天由此产生四次误判（以为小黄被冻结、以为小白搜索失败、
 * 以为四号机 CI 跑的是新包、以为私信闸是人工卡点），全是身份混淆造成的假象。
 *
 * machine_id 早已随心跳/注册上报（MachineFingerprint = SHA-256(ANDROID_ID + 机型) 前 32 位，
 * 同机型不同机必不同），`license_machines` 表也一直在存它——只是 `agents` 表没有该列、
 * 去重没用上。CI 侧早有先例：nightly-android-fleet-pc4.yml 就是「按硬件序列号去重，防同一
 * 物理设备双 entry 并发互踩」。
 *
 * hostname 保留作显示与兜底：桌面 agent 上报的是真机器名，仍可用；未上报指纹的旧版本
 * 安卓 agent 也要能继续工作，故 machine_id 为空时回退 hostname——这是不破坏 2026-07-29
 * 「防裂行」修复的前提。
 */

export type IdentityKind = 'machine_id' | 'hostname' | 'none';

export interface AgentIdentityInput {
  machineId?: string | null;
  hostname?: string | null;
}

export interface AgentIdentityKey {
  /** 用哪个维度去重 */
  by: IdentityKind;
  /** 去重键的值；两者皆空时为 null，调用方必须新建行、不得复用任何既有行 */
  value: string | null;
}

/**
 * 决定这次心跳/注册用哪个维度做身份去重。
 *
 * 优先 machine_id：它对同一物理机稳定、对同机型不同机互异。
 * machine_id 缺失才回退 hostname（旧 agent 兼容）。两者都没有 → 'none'，
 * 调用方必须新建行——绝不能拿 `hostname IS NULL` 去匹配既有行，那会让所有
 * 未上报主机名的设备坍缩成同一行（幽灵行）。
 */
export function resolveAgentIdentityKey(input: AgentIdentityInput): AgentIdentityKey {
  const machineId = typeof input.machineId === 'string' ? input.machineId.trim() : '';
  if (machineId) return { by: 'machine_id', value: machineId };

  const hostname = typeof input.hostname === 'string' ? input.hostname.trim() : '';
  if (hostname) return { by: 'hostname', value: hostname };

  return { by: 'none', value: null };
}
