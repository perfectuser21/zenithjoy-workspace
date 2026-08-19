/**
 * Agent 身份唯一化 — 按机器指纹(machine_id)去重，而非机型名(hostname)
 *
 * 真机实证（2026-08-19，办公室机队）：
 *   小黄  MAA-AN00  序列号 ANGYVB4402004137  安卓16
 *   四号机 MAA-AN00  （同机型，不同物理机）
 * 安卓端上报的 hostname = android.os.Build.MODEL（机型名），中台 agents 表按
 * (tenant_id, hostname) 去重 → 两台物理手机被认成同一台，共用一条 agents 行、
 * 同一个 agent_id。派任务给该 id 时，实际哪台执行不确定。
 *
 * 当天由此产生四次误判：以为小黄被系统冻结、以为小白搜索失败、以为四号机 CI 跑的是新包、
 * 以为私信闸是人工卡点——追根都是身份混淆造成的假象。
 *
 * 修法：machine_id（MachineFingerprint = SHA-256(ANDROID_ID + 机型) 前 32 位，同型号不同机
 * 必不同）早已随心跳/注册上报，且 license_machines 表已在存它，只是 agents 表没有该列、
 * 去重没用它。本次给 agents 加 machine_id 列并改为按它去重，hostname 仅作显示与兜底。
 *
 * CI 侧早有先例：nightly-android-fleet-pc4.yml 就是「按硬件序列号去重，防同一物理设备双
 * entry 并发互踩」，中台照搬即可。
 */
import { describe, it, expect } from 'vitest';
import { resolveAgentIdentityKey } from '../agent-identity';

describe('resolveAgentIdentityKey — 身份去重键选择', () => {
  it('[IDENTITY] machine_id 非空 → 按 machine_id 去重（同机型不同机不再撞）', () => {
    const a = resolveAgentIdentityKey({ machineId: 'fp-huang-0001', hostname: 'MAA-AN00' });
    const b = resolveAgentIdentityKey({ machineId: 'fp-no4-0002', hostname: 'MAA-AN00' });
    expect(a.by).toBe('machine_id');
    expect(b.by).toBe('machine_id');
    expect(a.value).not.toBe(b.value);
  });

  it('[IDENTITY] machine_id 为空 → 回退 hostname（兼容未上报指纹的旧 agent）', () => {
    const r = resolveAgentIdentityKey({ machineId: '', hostname: 'XX-ROG' });
    expect(r.by).toBe('hostname');
    expect(r.value).toBe('XX-ROG');
  });

  it('[IDENTITY] machine_id 与 hostname 都为空 → 无去重键，调用方须新建行不得复用', () => {
    const r = resolveAgentIdentityKey({ machineId: '   ', hostname: null });
    expect(r.by).toBe('none');
    expect(r.value).toBeNull();
  });

  it('[IDENTITY] machine_id 两端空白被裁剪，不因空格分裂身份', () => {
    const r = resolveAgentIdentityKey({ machineId: '  fp-x  ', hostname: 'M' });
    expect(r.by).toBe('machine_id');
    expect(r.value).toBe('fp-x');
  });

  it('[IDENTITY] 同一台机器换 license/租户，machine_id 不变则仍是同一身份键', () => {
    const x = resolveAgentIdentityKey({ machineId: 'fp-same', hostname: 'A' });
    const y = resolveAgentIdentityKey({ machineId: 'fp-same', hostname: 'B-改名了' });
    expect(x.value).toBe(y.value);
  });
});
