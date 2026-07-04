// services/agent/src/bootstrap-convergence.ts
//
// 启动第零阶段：幂等环境收敛（decision 72740815，2026-07-04）。
// 在连中台 / 下载 / 拉模块之前，把机器收敛回干净状态：
//   ① 清场：杀重复 agent 实例、杀不再活跃版本的僵尸启动循环
//   ② 修自启：计划任务不存在或指向已删目录 → 重注册
//   ③ 验配置：缺 license → 产出上报动作（不静默）
//
// planConvergence 是纯函数（EnvState → ConvergenceAction[]），CI 单测锚点；
// gatherEnvState / executeConvergence 是 Windows 采集/执行层，全部 best-effort 不抛。

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync, execFile } from 'child_process';

export interface AgentProc { pid: number; imageName: string; }
export interface LauncherLoop { pid: number; batPath: string; }
export interface ScheduledTaskState {
  exists: boolean;
  targetPath: string | null;
  targetExists: boolean;
}
export interface EnvState {
  selfPid: number;
  agentProcesses: AgentProc[];
  launcherLoops: LauncherLoop[];
  // .active-core 指针内容（如 zenithjoy-agent-v2.0.75）；无指针 = null
  activeCoreName: string | null;
  scheduledTask: ScheduledTaskState;
  licensePresent: boolean;
}

export type ConvergenceAction =
  | { type: 'kill_duplicate_agent'; pid: number }
  | { type: 'kill_stale_launcher'; pid: number; batPath: string }
  | { type: 'reregister_autostart' }
  | { type: 'report_config_gap'; detail: string };

// 纯函数：脏状态 → 收敛动作清单；干净状态 → []（幂等）。
export function planConvergence(state: EnvState): ConvergenceAction[] {
  const actions: ConvergenceAction[] = [];

  // ① 重复 agent 实例（绝不杀自己）
  for (const p of state.agentProcesses) {
    if (p.pid !== state.selfPid) {
      actions.push({ type: 'kill_duplicate_agent', pid: p.pid });
    }
  }

  // ① 僵尸启动循环：bat 路径所属版本目录 ≠ 活跃核心 → 杀
  //（无指针时不杀任何循环——无法判定谁是正统，宁可保守）
  if (state.activeCoreName) {
    for (const l of state.launcherLoops) {
      if (!l.batPath.toLowerCase().includes(state.activeCoreName.toLowerCase())) {
        actions.push({ type: 'kill_stale_launcher', pid: l.pid, batPath: l.batPath });
      }
    }
  }

  // ② 计划任务：不存在 / 指向已删目标 → 重注册
  if (!state.scheduledTask.exists || !state.scheduledTask.targetExists) {
    actions.push({ type: 'reregister_autostart' });
  }

  // ③ 配置缺口：缺 license → 上报具体缺什么
  if (!state.licensePresent) {
    actions.push({ type: 'report_config_gap', detail: 'license missing (ZENITHJOY_LICENSE / config.json licenseKey 均为空)' });
  }

  return actions;
}

// ---------- Windows 采集层（best-effort，任何一项失败按"干净"处理不阻断启动） ----------

function psList(query: string): string {
  return execFileSync('powershell', ['-NoProfile', '-Command', query], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000,
  });
}

export function gatherEnvState(opts: {
  selfPid: number;
  activeCorePointerPath: string;
  taskName?: string;
  licensePresent: boolean;
}): EnvState {
  const taskName = opts.taskName ?? 'ZenithJoyAgent';
  const state: EnvState = {
    selfPid: opts.selfPid,
    agentProcesses: [],
    launcherLoops: [],
    activeCoreName: null,
    scheduledTask: { exists: false, targetPath: null, targetExists: false },
    licensePresent: opts.licensePresent,
  };
  if (process.platform !== 'win32') return { ...state, scheduledTask: { exists: true, targetPath: null, targetExists: true } };

  try {
    const raw = fs.readFileSync(opts.activeCorePointerPath, 'utf8').trim().split(/\r?\n/)[0];
    if (raw) state.activeCoreName = raw;
  } catch { /* 无指针 */ }

  try {
    const out = psList(
      "Get-CimInstance Win32_Process -Filter \"Name='zenithjoy-agent.exe'\" | ForEach-Object { \"$($_.ProcessId)\" }",
    );
    state.agentProcesses = out.split(/\r?\n/).map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0)
      .map((pid) => ({ pid, imageName: 'zenithjoy-agent.exe' }));
  } catch { /* ignore */ }

  try {
    // 启动循环 = cmd.exe，命令行含 start.bat 且路径含 zenithjoy-agent-v
    const out = psList(
      "Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\" | Where-Object { $_.CommandLine -like '*zenithjoy-agent-v*start.bat*' } | ForEach-Object { \"$($_.ProcessId)|$($_.CommandLine)\" }",
    );
    state.launcherLoops = out.split(/\r?\n/).map((line) => {
      const idx = line.indexOf('|');
      if (idx < 0) return null;
      const pid = parseInt(line.slice(0, idx).trim(), 10);
      const cmd = line.slice(idx + 1).trim();
      const m = cmd.match(/([A-Za-z]:\\[^"]*zenithjoy-agent-v[^"]*start\.bat)/i);
      if (isNaN(pid) || !m) return null;
      return { pid, batPath: m[1] };
    }).filter((x): x is LauncherLoop => x !== null);
  } catch { /* ignore */ }

  try {
    const out = execFileSync('schtasks', ['/query', '/tn', taskName, '/fo', 'list', '/v'], {
      encoding: 'utf8', windowsHide: true, timeout: 15_000,
    });
    state.scheduledTask.exists = true;
    // "要运行的任务:"（中文）/ "Task To Run:"（英文）行里抽 .vbs/.bat 路径
    const m = out.match(/([A-Za-z]:\\[^\r\n"]*\.(?:vbs|bat))/i);
    if (m) {
      state.scheduledTask.targetPath = m[1];
      state.scheduledTask.targetExists = fs.existsSync(m[1]);
    }
  } catch {
    state.scheduledTask = { exists: false, targetPath: null, targetExists: false };
  }

  return state;
}

// ---------- 执行层（逐条执行，单条失败不阻断其余 / 不阻断启动） ----------

export interface ConvergenceDeps {
  killPid?: (pid: number) => void;
  reregisterAutostart?: () => void;
  reportGap?: (detail: string) => void;
  log?: (msg: string) => void;
}

export function executeConvergence(actions: ConvergenceAction[], deps: ConvergenceDeps = {}): void {
  const log = deps.log ?? console.log;
  const killPid = deps.killPid ?? ((pid: number) => {
    execFileSync('taskkill', ['/f', '/t', '/pid', String(pid)], { windowsHide: true, timeout: 15_000 });
  });
  const reregister = deps.reregisterAutostart ?? (() => {
    // 用当前核心目录里的 install-autostart.ps1 幂等重注册（指回本核心 start.vbs）
    const script = path.join(path.dirname(process.execPath), 'install-autostart.ps1');
    if (!fs.existsSync(script)) return;
    execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
      { windowsHide: true, timeout: 30_000 }, () => { /* best-effort */ });
  });
  for (const a of actions) {
    try {
      if (a.type === 'kill_duplicate_agent') {
        log(`[bootstrap] 收敛：杀重复 agent 实例 PID ${a.pid}`);
        killPid(a.pid);
      } else if (a.type === 'kill_stale_launcher') {
        log(`[bootstrap] 收敛：杀僵尸启动循环 PID ${a.pid}（${a.batPath}）`);
        killPid(a.pid);
      } else if (a.type === 'reregister_autostart') {
        log('[bootstrap] 收敛：计划任务缺失/指向已删目录，重注册开机自启');
        reregister();
      } else if (a.type === 'report_config_gap') {
        log(`[bootstrap] 配置缺口：${a.detail}`);
        deps.reportGap?.(a.detail);
      }
    } catch (e) {
      log(`[bootstrap] 收敛动作失败（继续其余）：${a.type} ${(e as Error).message}`);
    }
  }
}
