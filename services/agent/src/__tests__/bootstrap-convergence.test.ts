// services/agent/src/__tests__/bootstrap-convergence.test.ts
//
// 用户定的启动纪律（decision 72740815，2026-07-04）：Agent 启动第零阶段 = 幂等环境收敛。
// 在连中台 / 下载任何东西 / 拉任何模块之前，先把机器收敛回干净状态：
//   ① 清场：杀重复 agent 实例、杀不再活跃版本的僵尸启动循环
//   ② 修自启：计划任务指向已删目录 → 当场改正
//   ③ 验配置：缺 license / 缺 .env → 上报具体缺什么，不静默
//
// planConvergence 是纯函数（状态入 → 动作清单出），CI 可测；执行层只是逐条执行动作。
// proven-to-fire：任何一类脏状态不再产出对应收敛动作 → 断言立即红。

import { describe, it, expect } from 'vitest';
import { planConvergence, type EnvState } from '../bootstrap-convergence';

const CLEAN: EnvState = {
  selfPid: 100,
  agentProcesses: [{ pid: 100, imageName: 'zenithjoy-agent.exe' }],
  launcherLoops: [{ pid: 200, batPath: 'C:\\u\\Desktop\\zenithjoy-agent-v2.0.75\\start.bat' }],
  activeCoreName: 'zenithjoy-agent-v2.0.75',
  scheduledTask: { exists: true, targetPath: 'C:\\u\\Desktop\\zenithjoy-agent-v2.0.75\\start.vbs', targetExists: true },
  licensePresent: true,
};

describe('planConvergence — 幂等环境收敛计划（纯函数）', () => {
  it('干净状态 → 空动作清单（幂等）', () => {
    expect(planConvergence(CLEAN)).toEqual([]);
  });

  it('重复 agent 实例 → 对其它实例产出 kill_duplicate_agent，绝不杀自己', () => {
    const state: EnvState = {
      ...CLEAN,
      agentProcesses: [
        { pid: 100, imageName: 'zenithjoy-agent.exe' },
        { pid: 333, imageName: 'zenithjoy-agent.exe' },
        { pid: 444, imageName: 'zenithjoy-agent.exe' },
      ],
    };
    const actions = planConvergence(state);
    const kills = actions.filter((a) => a.type === 'kill_duplicate_agent');
    expect(kills.map((a) => a.pid).sort()).toEqual([333, 444]);
    expect(kills.some((a) => a.pid === 100)).toBe(false);
  });

  it('僵尸启动循环（bat 路径版本 ≠ activeCore）→ kill_stale_launcher', () => {
    const state: EnvState = {
      ...CLEAN,
      launcherLoops: [
        { pid: 200, batPath: 'C:\\u\\Desktop\\zenithjoy-agent-v2.0.75\\start.bat' },
        { pid: 201, batPath: 'C:\\u\\Desktop\\zenithjoy-agent-v2.0.69\\start.bat' },
        { pid: 202, batPath: 'C:\\u\\Desktop\\zenithjoy-agent-v2.0.52\\start.bat' },
      ],
    };
    const actions = planConvergence(state);
    const kills = actions.filter((a) => a.type === 'kill_stale_launcher');
    expect(kills.map((a) => a.pid).sort()).toEqual([201, 202]);
  });

  it('计划任务指向已删目录 → reregister_autostart', () => {
    const state: EnvState = {
      ...CLEAN,
      scheduledTask: { exists: true, targetPath: 'C:\\u\\Desktop\\zenithjoy-agent-v2.0.69\\start.vbs', targetExists: false },
    };
    const actions = planConvergence(state);
    expect(actions.some((a) => a.type === 'reregister_autostart')).toBe(true);
  });

  it('计划任务不存在 → reregister_autostart', () => {
    const state: EnvState = {
      ...CLEAN,
      scheduledTask: { exists: false, targetPath: null, targetExists: false },
    };
    expect(planConvergence(state).some((a) => a.type === 'reregister_autostart')).toBe(true);
  });

  it('缺 license → report_config_gap（上报具体缺什么，不静默）', () => {
    const state: EnvState = { ...CLEAN, licensePresent: false };
    const actions = planConvergence(state);
    const gap = actions.find((a) => a.type === 'report_config_gap');
    expect(gap).toBeDefined();
    expect((gap as { detail: string }).detail).toMatch(/license/i);
  });

  it('多类脏状态并存 → 动作齐全且互不吞并', () => {
    const state: EnvState = {
      selfPid: 100,
      agentProcesses: [
        { pid: 100, imageName: 'zenithjoy-agent.exe' },
        { pid: 333, imageName: 'zenithjoy-agent.exe' },
      ],
      launcherLoops: [{ pid: 201, batPath: 'C:\\u\\Desktop\\zenithjoy-agent-v2.0.69\\start.bat' }],
      activeCoreName: 'zenithjoy-agent-v2.0.75',
      scheduledTask: { exists: true, targetPath: 'C:\\u\\x\\start.vbs', targetExists: false },
      licensePresent: false,
    };
    const types = planConvergence(state).map((a) => a.type);
    expect(types).toContain('kill_duplicate_agent');
    expect(types).toContain('kill_stale_launcher');
    expect(types).toContain('reregister_autostart');
    expect(types).toContain('report_config_gap');
  });
});
