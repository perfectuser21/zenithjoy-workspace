// services/agent/src/__tests__/bootstrap-convergence-no-selfkill.test.ts
//
// 2.0.75 生产自杀 bug（2026-07-04 13:31 rog 实锤，停机 45 分钟）：
// 旧版本目录的 start.bat supervise 循环每轮重读 .active-core 指针，是它把新核心拉起来的
// ——bat 路径版本旧 ≠ 僵尸。但 planConvergence 只按"bat 路径含不含 activeCoreName"判僵尸，
// 把拉起自己的 v2.0.71 循环判成 stale → executeConvergence taskkill /t 连进程树带【自己】
// 一起杀 → 新核心启动即死，全机停摆。
//
// 守护：收敛绝不杀 selfAncestorPids（自己的祖先进程链）里的启动循环——不管它路径多旧。
// 祖先链之外的旧版循环照杀（那才是真僵尸）。删掉祖先排除逻辑 → 本测试立即红。

import { describe, it, expect } from 'vitest';
import { planConvergence, type EnvState } from '../bootstrap-convergence';

const BASE: EnvState = {
  selfPid: 100,
  selfAncestorPids: [],
  agentProcesses: [{ pid: 100, imageName: 'zenithjoy-agent.exe' }],
  launcherLoops: [],
  activeCoreName: 'zenithjoy-agent-v2.0.75',
  scheduledTask: { exists: true, targetPath: 'C:\\u\\v2.0.75\\start.vbs', targetExists: true },
  licensePresent: true,
};

describe('planConvergence — 绝不杀自己的祖先启动链（2.0.75 自杀回归）', () => {
  it('旧版本 bat 循环是自己的祖先 → 不产出 kill_stale_launcher（rog 13:31 场景）', () => {
    const state: EnvState = {
      ...BASE,
      // v2.0.71 的循环把 2.0.75 核心拉起来了：路径旧，但它是爹
      selfAncestorPids: [201, 50],
      launcherLoops: [{ pid: 201, batPath: 'C:\\u\\Desktop\\zenithjoy-agent-v2.0.71\\start.bat' }],
    };
    const kills = planConvergence(state).filter((a) => a.type === 'kill_stale_launcher');
    expect(kills).toEqual([]);
  });

  it('祖先之外的旧版循环照杀（真僵尸不放过）', () => {
    const state: EnvState = {
      ...BASE,
      selfAncestorPids: [201],
      launcherLoops: [
        { pid: 201, batPath: 'C:\\u\\Desktop\\zenithjoy-agent-v2.0.71\\start.bat' },
        { pid: 300, batPath: 'C:\\u\\Desktop\\zenithjoy-agent-v2.0.69\\start.bat' },
      ],
    };
    const kills = planConvergence(state).filter((a) => a.type === 'kill_stale_launcher');
    expect(kills.map((a) => (a as { pid: number }).pid)).toEqual([300]);
  });

  it('祖先链采集失败（空数组）→ 保守：一个循环都不杀（宁可漏杀不可自杀）', () => {
    const state: EnvState = {
      ...BASE,
      selfAncestorPids: [],
      launcherLoops: [{ pid: 300, batPath: 'C:\\u\\Desktop\\zenithjoy-agent-v2.0.69\\start.bat' }],
    };
    const kills = planConvergence(state).filter((a) => a.type === 'kill_stale_launcher');
    expect(kills).toEqual([]);
  });

  it('祖先链有值且存在真僵尸 → 只杀非祖先（组合场景完整性）', () => {
    const state: EnvState = {
      ...BASE,
      selfAncestorPids: [201, 50, 4],
      launcherLoops: [
        { pid: 201, batPath: 'C:\\u\\Desktop\\zenithjoy-agent-v2.0.71\\start.bat' },
        { pid: 301, batPath: 'C:\\u\\Desktop\\zenithjoy-agent-v2.0.52\\start.bat' },
        { pid: 302, batPath: 'C:\\u\\Desktop\\zenithjoy-agent-v2.0.75\\start.bat' },
      ],
    };
    const kills = planConvergence(state).filter((a) => a.type === 'kill_stale_launcher');
    // 201=祖先不杀；302=活跃版本不杀；只有 301 是真僵尸
    expect(kills.map((a) => (a as { pid: number }).pid)).toEqual([301]);
  });
});
