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

// ── startup-reset 纯判定层（decision 391063ef；判定点 9edc14f2/590031ea/e463d71a/47606e73/b32e83a5）──

export interface ProcRow { pid: number; ppid: number; name: string }

// 常驻 RPA 脚本（会成孤儿的候选）；短命脚本（send_chat 等）不入列——run-to-exit 自然回收
export const RESIDENT_RPA_SCRIPTS = ['listen_chat.py', 'overlay_window.py'] as const;

// 孤儿判据 = 父 PID 已死（不在存活进程表）。父活的一律不碰：
// CI job2 在同机直跑 listen_chat --dryrun（父=bash 活着）；活重复实例的 listener
// 由 kill_duplicate_agent 的 taskkill /t 树杀顺带回收，无需在此判。
export function classifyOrphanRpaPythons(
  pythonProcs: { pid: number; ppid: number; cmd: string }[],
  livePids: Set<number>,
): { pid: number; script: string }[] {
  const out: { pid: number; script: string }[] = [];
  for (const p of pythonProcs) {
    const cmd = (p.cmd || '').toLowerCase();
    const script = RESIDENT_RPA_SCRIPTS.find((s) => cmd.includes(s));
    if (script && !livePids.has(p.ppid)) out.push({ pid: p.pid, script });
  }
  return out;
}

// 顶层 Weixin = 父进程不是 Weixin.exe（父不在表=父死，也按顶层算）；wxocr 等子进程不算
export function listTopLevelWeixinPids(procTable: ProcRow[]): number[] {
  const nameOf = new Map(procTable.map((r) => [r.pid, r.name.toLowerCase()]));
  return procTable
    .filter((r) => r.name.toLowerCase() === 'weixin.exe' && nameOf.get(r.ppid) !== 'weixin.exe')
    .map((r) => r.pid);
}

const DEBRIS_MAX_AGE_MS = 7 * 86_400_000;
const LOCK_STALE_MS = 10 * 60_000; // 两把锁（agent.lock/zj-launch-weixin.lock）持有均为秒级，10min 必为崩溃遗留

export function isDebrisFile(fileName: string, mtimeMs: number, nowMs: number): boolean {
  const n = fileName.toLowerCase();
  if (n.endsWith('.lock')) return false; // 锁文件归 isStaleLockFile 管
  if (!/^(zj-|test_|send_)/.test(n)) return false;
  return nowMs - mtimeMs > DEBRIS_MAX_AGE_MS;
}

export function isStaleLockFile(fileName: string, mtimeMs: number, nowMs: number): boolean {
  const n = fileName.toLowerCase();
  if (!/^zj-.*\.lock$/.test(n)) return false; // agent.lock 由 single-instance 自愈，不碰
  return nowMs - mtimeMs > LOCK_STALE_MS;
}

// 三重判定缺一不删：ZJ 前缀 + 全部触发器为一次性 TimeTrigger（读不到=保守不删）+ 非正式任务名
export function isStaleOnceZjTask(taskName: string, triggerClasses: string[]): boolean {
  const n = taskName.toLowerCase();
  if (!n.startsWith('zj')) return false;
  if (n === 'zenithjoyagent') return false;
  if (triggerClasses.length === 0) return false;
  return triggerClasses.every((c) => c === 'MSFT_TaskTimeTrigger');
}

export function apiPointingConsistent(envUrl: string | null, cfgUrl: string | null): boolean | null {
  if (!envUrl || !cfgUrl) return null;
  try {
    return new URL(envUrl).host.toLowerCase() === new URL(cfgUrl).host.toLowerCase();
  } catch {
    return null;
  }
}
export interface EnvState {
  selfPid: number;
  // 自己的祖先进程链 PID（父/祖父/…）。拉起本核心的启动循环必然在这条链上——
  // 它路径版本再旧也不是僵尸，杀它 = taskkill /t 连树带自己杀（2.0.75 生产自杀实锤）。
  // 采集失败 → []，此时保守不杀任何循环（宁可漏杀不可自杀）。
  selfAncestorPids: number[];
  agentProcesses: AgentProc[];
  launcherLoops: LauncherLoop[];
  // .active-core 指针内容（如 zenithjoy-agent-v2.0.75）；无指针 = null
  activeCoreName: string | null;
  scheduledTask: ScheduledTaskState;
  licensePresent: boolean;
  // ── startup-reset（decision 391063ef）──
  orphanRpaPythons: { pid: number; script: string }[];
  weixinTopLevelPids: number[];
  coreDirEnv: { expectedDir: string | null; persisted: boolean };
  pythonEmbeddedPresent: boolean;
  envConfigConsistent: boolean | null; // null = 判不了（缺一端/解析失败），不产生动作
  debrisFiles: string[];
  staleOnceZjTasks: string[];
  staleLockFiles: string[];
}

export type ConvergenceAction =
  | { type: 'kill_duplicate_agent'; pid: number }
  | { type: 'kill_stale_launcher'; pid: number; batPath: string }
  | { type: 'reregister_autostart' }
  | { type: 'report_config_gap'; detail: string }
  | { type: 'kill_orphan_python'; pid: number; script: string }
  | { type: 'converge_wechat'; pids: number[] }
  | { type: 'persist_core_dir_env'; dir: string }
  | { type: 'delete_debris'; path: string }
  | { type: 'delete_stale_task'; taskName: string }
  | { type: 'delete_stale_lock'; path: string };

// 纯函数：脏状态 → 收敛动作清单；干净状态 → []（幂等）。
export function planConvergence(state: EnvState): ConvergenceAction[] {
  const actions: ConvergenceAction[] = [];

  // ① 重复 agent 实例（绝不杀自己）
  for (const p of state.agentProcesses) {
    if (p.pid !== state.selfPid) {
      actions.push({ type: 'kill_duplicate_agent', pid: p.pid });
    }
  }

  // ① 僵尸启动循环：bat 路径所属版本目录 ≠ 活跃核心 且 不在自己祖先链上 → 杀。
  //   - 祖先链上的循环（把本核心拉起来的那个）路径再旧也不是僵尸——旧 bat 每轮重读
  //     .active-core 指针照样能供养新核心；杀它 = /t 连树带自己杀（2.0.75 自杀实锤）。
  //   - 祖先链采集失败（空数组）→ 保守：一个循环都不杀（宁可漏杀不可自杀）。
  //   - 无指针时同样不杀（无法判定谁是正统）。
  if (state.activeCoreName && state.selfAncestorPids.length > 0) {
    const ancestors = new Set(state.selfAncestorPids);
    for (const l of state.launcherLoops) {
      if (ancestors.has(l.pid)) continue;
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

  // ④ startup-reset：孤儿 RPA python（判据=父死，decision 9edc14f2）
  for (const o of state.orphanRpaPythons) {
    actions.push({ type: 'kill_orphan_python', pid: o.pid, script: o.script });
  }
  // ⑤ 微信归一：顶层树>1 → 全杀，由后续任务经 launch_weixin()（#1358 锁+幂等）按需拉起
  if (state.weixinTopLevelPids.length > 1) {
    actions.push({ type: 'converge_wechat', pids: [...state.weixinTopLevelPids] });
  }
  // ⑥ 环境自检：OS 级 ZENITHJOY_CORE_DIR 幂等自愈（根治 A2 裸 python 弹窗）；缺件只报不修
  if (state.coreDirEnv.expectedDir && !state.coreDirEnv.persisted) {
    actions.push({ type: 'persist_core_dir_env', dir: state.coreDirEnv.expectedDir });
  }
  if (!state.pythonEmbeddedPresent) {
    actions.push({ type: 'report_config_gap', detail: 'python-embedded 缺失（core 目录无 python-embedded/python.exe，RPA 将掉裸 python 兜底弹 MS Store）' });
  }
  if (state.envConfigConsistent === false) {
    actions.push({ type: 'report_config_gap', detail: '.env 与 config.json 的 API 指向不一致（56cacd23 同类病）' });
  }
  // ⑦ 残骸清理
  for (const p of state.debrisFiles) actions.push({ type: 'delete_debris', path: p });
  for (const t of state.staleOnceZjTasks) actions.push({ type: 'delete_stale_task', taskName: t });
  for (const p of state.staleLockFiles) actions.push({ type: 'delete_stale_lock', path: p });

  return actions;
}

// ---------- Windows 采集层（best-effort，任何一项失败按"干净"处理不阻断启动） ----------

function psList(query: string): string {
  return execFileSync('powershell', ['-NoProfile', '-Command', query], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000,
  });
}

// PowerShell "a,b,c..." 逐行输出按前两个逗号切三段：pid/ppid 必不含逗号，第三段（name 或
// CommandLine）可能本身含逗号，因此整体保留不再拆分。空行返回 null。
function splitCsv3(line: string): [string, string, string] | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const c1 = trimmed.indexOf(',');
  const c2 = trimmed.indexOf(',', c1 + 1);
  if (c1 < 0 || c2 < 0) return null;
  return [trimmed.slice(0, c1), trimmed.slice(c1 + 1, c2), trimmed.slice(c2 + 1)];
}

export function gatherEnvState(opts: {
  selfPid: number;
  activeCorePointerPath: string;
  taskName?: string;
  licensePresent: boolean;
  // ── startup-reset 新增（全部可选，默认见下方）──
  envApiBase?: string | null;    // 调用方传 process.env.ZENITHJOY_API_URL || ZENITHJOY_API_BASE
  configApiUrl?: string | null;  // 调用方传 cfg.apiUrl
  publicDir?: string;
  coreDir?: string;
  nowMs?: number;
}): EnvState {
  const taskName = opts.taskName ?? 'ZenithJoyAgent';
  const publicDir = opts.publicDir ?? (process.env.PUBLIC || 'C:\\Users\\Public');
  const coreDir = opts.coreDir ?? path.dirname(process.execPath);
  const nowMs = opts.nowMs ?? Date.now();
  const state: EnvState = {
    selfPid: opts.selfPid,
    selfAncestorPids: [],
    agentProcesses: [],
    launcherLoops: [],
    activeCoreName: null,
    scheduledTask: { exists: false, targetPath: null, targetExists: false },
    licensePresent: opts.licensePresent,
    // ── startup-reset 干净默认值
    orphanRpaPythons: [],
    weixinTopLevelPids: [],
    coreDirEnv: { expectedDir: null, persisted: true },
    pythonEmbeddedPresent: true,
    envConfigConsistent: null,
    debrisFiles: [],
    staleOnceZjTasks: [],
    staleLockFiles: [],
  };
  if (process.platform !== 'win32') return { ...state, scheduledTask: { exists: true, targetPath: null, targetExists: true } };

  // procTable：全进程表（pid/ppid/name），一次查询供祖先链 + 孤儿 python 判父死 + 微信顶层
  // 三处复用，避免重复起 PowerShell 进程。采集失败留空 [] → 三处下游各自回落到"干净"
  // （保守不杀/无孤儿/无顶层）。防父子环/PID 复用死循环：祖先链上限 32 层。
  let procTable: ProcRow[] = [];
  let livePids: Set<number> = new Set();
  try {
    const parentOf = new Map<number, number>();
    const out = psList(
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId),$($_.ParentProcessId),$($_.Name)" }',
    );
    const rows: ProcRow[] = [];
    for (const line of out.split(/\r?\n/)) {
      const parts = splitCsv3(line);
      if (!parts) continue;
      const pid = parseInt(parts[0], 10);
      const ppid = parseInt(parts[1], 10);
      if (isNaN(pid) || isNaN(ppid)) continue;
      rows.push({ pid, ppid, name: parts[2] });
      parentOf.set(pid, ppid);
    }
    procTable = rows;
    livePids = new Set(rows.map((r) => r.pid));

    const chain: number[] = [];
    let cur = parentOf.get(opts.selfPid);
    for (let depth = 0; depth < 32 && cur !== undefined && cur > 0 && !chain.includes(cur); depth++) {
      chain.push(cur);
      cur = parentOf.get(cur);
    }
    state.selfAncestorPids = chain;
  } catch { /* ignore → 保守不杀；procTable/livePids 留空，下游自然按干净处理 */ }

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

  // 孤儿 RPA python：定向查 python.exe/pythonw.exe 带 CommandLine，用 procTable 的存活 pid 判父死。
  // CommandLine 为 $null 时 PowerShell 插值转空串，classifyOrphanRpaPythons 内部按空串安全处理。
  try {
    const out = psList(
      "Get-CimInstance Win32_Process -Filter \"Name='python.exe' OR Name='pythonw.exe'\" | ForEach-Object { \"$($_.ProcessId),$($_.ParentProcessId),$($_.CommandLine)\" }",
    );
    const pyProcs: { pid: number; ppid: number; cmd: string }[] = [];
    for (const line of out.split(/\r?\n/)) {
      const parts = splitCsv3(line);
      if (!parts) continue;
      const pid = parseInt(parts[0], 10);
      const ppid = parseInt(parts[1], 10);
      if (isNaN(pid) || isNaN(ppid)) continue;
      pyProcs.push({ pid, ppid, cmd: parts[2] });
    }
    state.orphanRpaPythons = classifyOrphanRpaPythons(pyProcs, livePids);
  } catch { /* ignore → 干净默认值 [] 已在初始化中 */ }

  // 微信顶层：procTable 已含全进程，直接复用，不加查询（纯函数，procTable 为空时自然返回 []）
  state.weixinTopLevelPids = listTopLevelWeixinPids(procTable);

  // coreDirEnv：OS 级 User 环境变量是否已收敛到当前活跃核心目录（根治裸 python 弹 MS Store，A2 病灶）
  {
    const expectedDir = coreDir;
    let persisted = true; // 读不到时保守当已持久化，不误触发 setx 覆盖一个实际正常的值
    try {
      const stored = psList("[Environment]::GetEnvironmentVariable('ZENITHJOY_CORE_DIR','User')").trim();
      persisted = !!stored && stored.toLowerCase() === expectedDir.toLowerCase();
    } catch { /* 读不到 → 保守 persisted=true */ }
    state.coreDirEnv = { expectedDir, persisted };
  }

  // pythonEmbeddedPresent：core 目录下内嵌 python 是否存在（缺失会导致 RPA 掉裸 python 弹 MS Store）
  try {
    state.pythonEmbeddedPresent = fs.existsSync(path.join(coreDir, 'python-embedded', 'python.exe'));
  } catch { /* 目录不可读 → 保守当作存在，不误报 */ }

  // envConfigConsistent：.env 与 config.json 的 API 指向是否一致（同类病 56cacd23）
  try {
    state.envConfigConsistent = apiPointingConsistent(opts.envApiBase ?? null, opts.configApiUrl ?? null);
  } catch { /* ignore → null（判不了，不产生动作） */ }

  // 残骸文件 + 陈旧锁：扫描 publicDir，单文件 stat 失败跳过（不因单个坏文件拖垮整体扫描）
  try {
    const debris: string[] = [];
    const staleLocks: string[] = [];
    for (const name of fs.readdirSync(publicDir)) {
      const full = path.join(publicDir, name);
      try {
        const st = fs.statSync(full);
        if (!st.isFile()) continue;
        if (isDebrisFile(name, st.mtimeMs, nowMs)) debris.push(full);
        if (isStaleLockFile(name, st.mtimeMs, nowMs)) staleLocks.push(full);
      } catch { /* 单文件 stat 失败 → 跳过，不影响其余文件 */ }
    }
    state.debrisFiles = debris;
    state.staleLockFiles = staleLocks;
  } catch { /* 目录不存在等 → 干净默认值 [] 已在初始化中 */ }

  // 一次性 ZJ 计划任务：ZJ 前缀 + 全部触发器为一次性 TimeTrigger + 非正式任务名 → 可删
  try {
    const out = psList(
      "Get-ScheduledTask | Where-Object { $_.TaskName -like 'ZJ*' } | ForEach-Object { \"$($_.TaskName)|$(($_.Triggers | ForEach-Object { $_.CimClass.CimClassName }) -join ',')\" }",
    );
    const stale: string[] = [];
    for (const line of out.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf('|');
      if (idx < 0) continue;
      const name = trimmed.slice(0, idx);
      const classes = trimmed.slice(idx + 1).split(',').filter(Boolean);
      if (isStaleOnceZjTask(name, classes)) stale.push(name);
    }
    state.staleOnceZjTasks = stale;
  } catch { /* 读不到/空输出 → 干净默认值 [] 已在初始化中 */ }

  return state;
}

// ---------- 执行层（逐条执行，单条失败不阻断其余 / 不阻断启动） ----------

export interface ConvergenceResult { action: ConvergenceAction; executed: boolean; ok: boolean; error?: string }

export interface ConvergenceDeps {
  killPid?: (pid: number) => void;
  reregisterAutostart?: () => void;
  reportGap?: (detail: string) => void;
  log?: (msg: string) => void;
  deleteFile?: (path: string) => void;
  deleteTask?: (taskName: string) => void;
  persistEnv?: (name: string, value: string) => void;
}

export function describeAction(a: ConvergenceAction): string {
  switch (a.type) {
    case 'kill_duplicate_agent': return `kill_duplicate_agent pid=${a.pid}`;
    case 'kill_stale_launcher':  return `kill_stale_launcher pid=${a.pid}`;
    case 'reregister_autostart': return 'reregister_autostart';
    case 'report_config_gap':    return `report_config_gap ${a.detail}`;
    case 'kill_orphan_python':   return `kill_orphan_python pid=${a.pid} ${a.script}`;
    case 'converge_wechat':      return `converge_wechat pids=${a.pids.join(',')}`;
    case 'persist_core_dir_env': return `persist_core_dir_env ${a.dir}`;
    case 'delete_debris':        return `delete_debris ${a.path}`;
    case 'delete_stale_task':    return `delete_stale_task ${a.taskName}`;
    case 'delete_stale_lock':    return `delete_stale_lock ${a.path}`;
  }
}

export function executeConvergence(
  actions: ConvergenceAction[],
  deps: ConvergenceDeps = {},
  opts: { planOnly?: boolean } = {},
): ConvergenceResult[] {
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
  const deleteFile = deps.deleteFile ?? ((p: string) => fs.unlinkSync(p));
  const deleteTask = deps.deleteTask ?? ((t: string) => {
    execFileSync('schtasks', ['/delete', '/tn', t, '/f'], { windowsHide: true, timeout: 15_000 });
  });
  const persistEnv = deps.persistEnv ?? ((name: string, value: string) => {
    execFileSync('setx', [name, value], { windowsHide: true, timeout: 15_000 });
  });

  const results: ConvergenceResult[] = [];
  for (const a of actions) {
    // report_config_gap 是唯一非破坏性动作，plan-only 也照常上报
    if (opts.planOnly && a.type !== 'report_config_gap') {
      log(`[bootstrap][plan-only] 将执行: ${describeAction(a)}`);
      results.push({ action: a, executed: false, ok: true });
      continue;
    }
    try {
      log(`[bootstrap] 收敛：${describeAction(a)}`);
      switch (a.type) {
        case 'kill_duplicate_agent':
        case 'kill_stale_launcher':
        case 'kill_orphan_python':  killPid(a.pid); break;
        case 'converge_wechat':     for (const pid of a.pids) killPid(pid); break;
        case 'reregister_autostart': reregister(); break;
        case 'report_config_gap':   deps.reportGap?.(a.detail); break;
        case 'persist_core_dir_env': persistEnv('ZENITHJOY_CORE_DIR', a.dir); break;
        case 'delete_debris':
        case 'delete_stale_lock':   deleteFile(a.path); break;
        case 'delete_stale_task':   deleteTask(a.taskName); break;
      }
      results.push({ action: a, executed: true, ok: true });
    } catch (e) {
      log(`[bootstrap] 收敛动作失败（继续其余）：${describeAction(a)} ${(e as Error).message}`);
      results.push({ action: a, executed: true, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

// ────────────────────────────────────── startup-reset 汇总上报 ──────────────────────────────────────

export interface StartupResetReport { ok: boolean; reason?: string }

// 5 项 checklist：①进程归零(kill_*) ②微信归一(converge_wechat) ③环境自检(persist/gap)
// ④残骸清理(delete_*) ⑤上报（本函数产物随心跳走）。缺项报红（proven-to-fire）。
export function buildStartupResetReport(
  state: EnvState,
  results: ConvergenceResult[],
  planOnly: boolean,
): StartupResetReport {
  const parts: string[] = [];
  const failures = results.filter((r) => !r.ok);
  for (const f of failures) parts.push(`${describeAction(f.action)} 失败:${f.error ?? '?'}`);
  if (!state.pythonEmbeddedPresent) parts.push('python-embedded 缺失');
  if (state.envConfigConsistent === false) parts.push('.env/config.json API 指向不一致');
  const ok = parts.length === 0;
  const prefix = planOnly ? 'plan-only(ci)｜' : '';
  const summary = ok
    ? (results.length === 0 ? '干净' : `归零完成:${results.length}项动作`)
    : parts.join('｜');
  const reason = (prefix + summary).slice(0, 400);
  return ok ? { ok, reason } : { ok, reason };
}

export function mergeStartupReset<T extends Record<string, unknown>>(
  moduleReport: T,
  startupReset: StartupResetReport,
): T & { startup_reset: StartupResetReport } {
  return { ...moduleReport, startup_reset: startupReset };
}
