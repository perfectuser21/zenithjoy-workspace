// services/agent/src/startup-reset.ts
//
// 启动归零（startup-reset，decision 0f0368cf，2026-07-17 rog 深度审计后用户拍板）。
// agent 一启动必须瞬间把机子归零到零状态再启动所有东西，要有 checklist。
//
// 5 步 checklist（全部 best-effort，单步失败不阻断其余，整体不阻断启动）：
//   ① orphan_rpa      — 杀孤儿 RPA python 进程（listen_chat.py / overlay_window.py）
//   ② weixin_converge — 顶层 Weixin.exe 树 > 1 → 杀全部（由后续 launch_weixin 按需重拉）
//   ③ env_check       — python-embedded 存在性 + .env/config.json apiUrl 一致性
//   ④ wreckage_cleanup— Public/zj-* >7 天 + 一次性 ZJ* 计划任务 + 陈旧锁文件
//
// CI 护栏：isCI=true 时 kill/delete 类降级为 plan-only（actionsExecuted=0），
//   避免 GHA runner 归零杀掉常驻 staging agent（A3 互搅缓解措施）。
//
// planStartupReset 是纯函数（CI 锚点），gatherStartupResetState 是 Windows 采集层，
// executeStartupReset 是执行层。与 bootstrap-convergence.ts 同纪律。

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';

// ─── 类型定义 ────────────────────────────────────────────────────────────────

export interface OrphanRpaProc {
  pid: number;
  cmdline: string;
}

export interface StartupResetState {
  selfPid: number;
  isCI: boolean;
  // ① 孤儿 RPA python 进程（命令行匹配 wechat-rpa 脚本，且非本进程树后代）
  orphanRpaProcs: OrphanRpaProc[];
  // ② 顶层 Weixin.exe 树数量（父进程非 Weixin.exe 的计数）
  weixinTopLevelCount: number;
  // ③ 环境自检
  pythonEmbeddedExists: boolean;
  configConsistencyOk: boolean;
  configConsistencyDetail: string;
  // ④ 残骸
  wreckageFiles: string[];          // Public/zj-* / test_* / send_* mtime>7天
  staleScheduledTasks: string[];   // ZJDbg* / ZJDiag* / ZJClick* 一次性任务名
  staleLockFiles: string[];        // 持有 PID 已死的锁文件路径
}

export type StartupResetAction =
  | { type: 'kill_orphan_rpa'; pid: number; cmdline: string }
  | { type: 'kill_extra_weixin_tree' }
  | { type: 'report_env_gap'; gaps: string[] }
  | { type: 'delete_wreckage_file'; path: string }
  | { type: 'delete_stale_task'; taskName: string }
  | { type: 'delete_stale_lock'; path: string };

export interface StartupChecklistItem {
  step: 'orphan_rpa' | 'weixin_converge' | 'env_check' | 'wreckage_cleanup';
  status: 'pass' | 'fail' | 'skipped';
  actionsPlanned: number;
  actionsExecuted: number;
  detail?: string;
}

export interface StartupChecklistResult {
  items: StartupChecklistItem[];
  durationMs: number;
  ciMode: boolean;
  timedOut: boolean;
}

export interface StartupResetDeps {
  killPid?: (pid: number) => void;
  killWeixinTrees?: () => void;
  deleteFile?: (p: string) => void;
  deleteScheduledTask?: (name: string) => void;
  log?: (msg: string) => void;
  nowMs?: () => number;
  timeoutMs?: number;
}

// ─── 纯函数：脏状态 → 动作清单 ──────────────────────────────────────────────

export function planStartupReset(state: StartupResetState): StartupResetAction[] {
  const actions: StartupResetAction[] = [];

  // ① 孤儿 RPA 进程
  for (const proc of state.orphanRpaProcs) {
    actions.push({ type: 'kill_orphan_rpa', pid: proc.pid, cmdline: proc.cmdline });
  }

  // ② 微信顶层树堆积（> 1 才杀，0 或 1 不动）
  if (state.weixinTopLevelCount > 1) {
    actions.push({ type: 'kill_extra_weixin_tree' });
  }

  // ③ 环境自检——收集所有 gap，合并成一条 report_env_gap（避免多条重复上报）
  const gaps: string[] = [];
  if (!state.pythonEmbeddedExists) {
    gaps.push('python-embedded/python.exe 不存在（A2 MS Store Python 弹窗根因）');
  }
  if (!state.configConsistencyOk && state.configConsistencyDetail) {
    gaps.push(state.configConsistencyDetail);
  }
  if (gaps.length > 0) {
    actions.push({ type: 'report_env_gap', gaps });
  }

  // ④ 残骸清理
  for (const f of state.wreckageFiles) {
    actions.push({ type: 'delete_wreckage_file', path: f });
  }
  for (const t of state.staleScheduledTasks) {
    actions.push({ type: 'delete_stale_task', taskName: t });
  }
  for (const l of state.staleLockFiles) {
    actions.push({ type: 'delete_stale_lock', path: l });
  }

  return actions;
}

// ─── 执行层 ──────────────────────────────────────────────────────────────────

function isTimedOut(startMs: number, nowMs: () => number, timeoutMs: number): boolean {
  return nowMs() - startMs >= timeoutMs;
}

export function executeStartupReset(
  state: StartupResetState,
  deps: StartupResetDeps = {},
): StartupChecklistResult {
  const nowMs = deps.nowMs ?? (() => Date.now());
  const startMs = nowMs();
  const timeoutMs = deps.timeoutMs ?? 30_000;
  const log = deps.log ?? console.log;
  const ciMode = state.isCI;

  const actions = planStartupReset(state);
  const items: StartupChecklistItem[] = [];
  let timedOut = false;

  // 按 step 分组
  const orphanActions = actions.filter((a): a is Extract<StartupResetAction, { type: 'kill_orphan_rpa' }> =>
    a.type === 'kill_orphan_rpa');
  const weixinActions = actions.filter((a) => a.type === 'kill_extra_weixin_tree');
  const envGapActions = actions.filter((a): a is Extract<StartupResetAction, { type: 'report_env_gap' }> =>
    a.type === 'report_env_gap');
  const wreckageActions = actions.filter((a) =>
    a.type === 'delete_wreckage_file' ||
    a.type === 'delete_stale_task' ||
    a.type === 'delete_stale_lock');

  // ① orphan_rpa
  {
    let executed = 0;
    let failed = false;
    let detail: string | undefined;
    const planned = orphanActions.length;

    if (!isTimedOut(startMs, nowMs, timeoutMs)) {
      for (const a of orphanActions) {
        if (isTimedOut(startMs, nowMs, timeoutMs)) { timedOut = true; break; }
        if (ciMode) {
          log(`[startup-reset/plan-only] kill_orphan_rpa PID ${a.pid} "${a.cmdline}"`);
          continue; // CI: plan-only, no execution
        }
        try {
          log(`[startup-reset] ① 杀孤儿 RPA PID ${a.pid} "${a.cmdline}"`);
          if (deps.killPid) deps.killPid(a.pid);
          executed++;
        } catch (e) {
          failed = true;
          detail = `杀 PID ${a.pid} 失败：${(e as Error).message}`;
          log(`[startup-reset] ① 失败：${detail}`);
        }
      }
    } else {
      timedOut = true;
    }

    items.push({
      step: 'orphan_rpa',
      status: timedOut && planned > 0 ? 'skipped' : (failed ? 'fail' : 'pass'),
      actionsPlanned: planned,
      actionsExecuted: ciMode ? 0 : executed,
      detail,
    });
  }

  // ② weixin_converge
  {
    let executed = 0;
    let failed = false;
    let detail: string | undefined;
    const planned = weixinActions.length;

    if (!isTimedOut(startMs, nowMs, timeoutMs) && planned > 0) {
      if (ciMode) {
        log('[startup-reset/plan-only] kill_extra_weixin_tree');
      } else {
        try {
          log(`[startup-reset] ② 微信归一（顶层树 ${state.weixinTopLevelCount} → 0，由后续按需重拉）`);
          if (deps.killWeixinTrees) {
            deps.killWeixinTrees();
          } else {
            // 默认：taskkill /f /t /im Weixin.exe
            execFileSync('taskkill', ['/f', '/t', '/im', 'Weixin.exe'], { windowsHide: true, timeout: 15_000 });
          }
          executed = 1;
        } catch (e) {
          failed = true;
          detail = `杀 Weixin.exe 失败：${(e as Error).message}`;
          log(`[startup-reset] ② 失败：${detail}`);
        }
      }
    } else if (isTimedOut(startMs, nowMs, timeoutMs) && planned > 0) {
      timedOut = true;
    }

    items.push({
      step: 'weixin_converge',
      status: timedOut && planned > 0 ? 'skipped' : (failed ? 'fail' : 'pass'),
      actionsPlanned: planned,
      actionsExecuted: ciMode ? 0 : executed,
      detail,
    });
  }

  // ③ env_check（report_env_gap 是纯上报，不受 CI 模式影响，不受 kill/delete 限制）
  {
    const planned = envGapActions.length;
    let detail: string | undefined;
    let status: 'pass' | 'fail' = 'pass';

    if (planned > 0) {
      const allGaps = envGapActions.flatMap((a) => a.gaps);
      detail = allGaps.join('; ');
      status = 'fail';
      log(`[startup-reset] ③ 环境缺项（${allGaps.length} 项）：${detail}`);
    } else {
      log('[startup-reset] ③ 环境自检：正常');
    }

    items.push({
      step: 'env_check',
      status,
      actionsPlanned: planned,
      actionsExecuted: planned, // 上报不需执行，计为已执行
      detail,
    });
  }

  // ④ wreckage_cleanup
  {
    let executed = 0;
    let failed = false;
    let detail: string | undefined;
    const planned = wreckageActions.length;

    if (!isTimedOut(startMs, nowMs, timeoutMs)) {
      for (const a of wreckageActions) {
        if (isTimedOut(startMs, nowMs, timeoutMs)) { timedOut = true; break; }
        if (ciMode) {
          log(`[startup-reset/plan-only] ${a.type} ${'path' in a ? a.path : ('taskName' in a ? a.taskName : '')}`);
          continue;
        }
        try {
          if (a.type === 'delete_wreckage_file') {
            log(`[startup-reset] ④ 删残骸文件 ${a.path}`);
            if (deps.deleteFile) {
              deps.deleteFile(a.path);
            } else {
              fs.rmSync(a.path, { force: true });
            }
            executed++;
          } else if (a.type === 'delete_stale_task') {
            log(`[startup-reset] ④ 删一次性计划任务 ${a.taskName}`);
            if (deps.deleteScheduledTask) {
              deps.deleteScheduledTask(a.taskName);
            } else {
              execFileSync('schtasks', ['/delete', '/tn', a.taskName, '/f'], { windowsHide: true, timeout: 15_000 });
            }
            executed++;
          } else if (a.type === 'delete_stale_lock') {
            log(`[startup-reset] ④ 删陈旧锁文件 ${a.path}`);
            if (deps.deleteFile) {
              deps.deleteFile(a.path);
            } else {
              fs.rmSync(a.path, { force: true });
            }
            executed++;
          }
        } catch (e) {
          failed = true;
          detail = detail
            ? `${detail}; ${(e as Error).message}`
            : `残骸清理失败：${(e as Error).message}`;
          log(`[startup-reset] ④ 失败：${(e as Error).message}（继续其余）`);
        }
      }
    } else if (planned > 0) {
      timedOut = true;
    }

    items.push({
      step: 'wreckage_cleanup',
      status: timedOut && planned > 0 ? 'skipped' : (failed ? 'fail' : 'pass'),
      actionsPlanned: planned,
      actionsExecuted: ciMode ? 0 : executed,
      detail,
    });
  }

  return {
    items,
    durationMs: nowMs() - startMs,
    ciMode,
    timedOut,
  };
}

// ─── Windows 采集层 ──────────────────────────────────────────────────────────

// RPA python 脚本名白名单（命令行匹配这些脚本的 python 进程 = RPA worker）
const RPA_SCRIPT_PATTERNS = ['listen_chat.py', 'overlay_window.py', 'reset_stage.py', 'click_button.py'];

// 一次性计划任务前缀白名单（排除正式自启任务名 ZenithJoyAgent）
const STALE_TASK_PREFIXES = ['ZJDbg', 'ZJDiag', 'ZJClick', 'ZJTest'];
const OFFICIAL_TASK_NAMES = ['ZenithJoyAgent'];

// 7 天（ms）
const WRECKAGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// 残骸文件匹配前缀
const WRECKAGE_PREFIXES = ['zj-', 'test_', 'send_'];

function powershell(cmd: string): string {
  return execFileSync('powershell', ['-NoProfile', '-Command', cmd], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000,
  });
}

export function gatherStartupResetState(opts: {
  selfPid: number;
  selfDescendantPids?: Set<number>;
  coreDir?: string;
  configDir?: string;
  isCI?: boolean;
}): StartupResetState {
  const isCI = opts.isCI ?? (process.env.CI === 'true' || process.env.CI === '1');
  const state: StartupResetState = {
    selfPid: opts.selfPid,
    isCI,
    orphanRpaProcs: [],
    weixinTopLevelCount: 0,
    pythonEmbeddedExists: false,
    configConsistencyOk: true,
    configConsistencyDetail: '',
    wreckageFiles: [],
    staleScheduledTasks: [],
    staleLockFiles: [],
  };

  // 非 Windows 跳过（含 Linux CI）— 只做非 kill 检查
  if (process.platform !== 'win32') {
    // python-embedded 在 macOS/Linux 不存在，但非产品环境，不报缺
    state.pythonEmbeddedExists = true;
    state.configConsistencyOk = true;
    return state;
  }

  // ① 孤儿 RPA 进程
  try {
    const descendantPids = opts.selfDescendantPids ?? new Set<number>();
    const out = powershell(
      "Get-CimInstance Win32_Process -Filter \"Name='python.exe' OR Name='python3.exe'\" | ForEach-Object { \"$($_.ProcessId)|$($_.CommandLine)\" }",
    );
    for (const line of out.split(/\r?\n/)) {
      const idx = line.indexOf('|');
      if (idx < 0) continue;
      const pid = parseInt(line.slice(0, idx).trim(), 10);
      const cmdline = line.slice(idx + 1).trim();
      if (isNaN(pid) || pid <= 0) continue;
      if (pid === opts.selfPid || descendantPids.has(pid)) continue;
      if (RPA_SCRIPT_PATTERNS.some((p) => cmdline.includes(p))) {
        state.orphanRpaProcs.push({ pid, cmdline });
      }
    }
  } catch { /* best-effort */ }

  // ② 顶层 Weixin.exe 树（父进程非 Weixin.exe）
  try {
    const out = powershell(
      "Get-CimInstance Win32_Process -Filter \"Name='Weixin.exe'\" | ForEach-Object { \"$($_.ProcessId)|$($_.ParentProcessId)\" }",
    );
    const weixinPids = new Set<number>();
    const parentMap = new Map<number, number>();
    for (const line of out.split(/\r?\n/)) {
      const parts = line.trim().split('|');
      if (parts.length < 2) continue;
      const pid = parseInt(parts[0], 10);
      const ppid = parseInt(parts[1], 10);
      if (!isNaN(pid) && pid > 0) {
        weixinPids.add(pid);
        if (!isNaN(ppid)) parentMap.set(pid, ppid);
      }
    }
    let topLevelCount = 0;
    for (const pid of weixinPids) {
      const ppid = parentMap.get(pid);
      if (ppid === undefined || !weixinPids.has(ppid)) {
        topLevelCount++;
      }
    }
    state.weixinTopLevelCount = topLevelCount;
  } catch { /* best-effort */ }

  // ③ python-embedded 存在性
  try {
    const coreDir = opts.coreDir ?? path.dirname(process.execPath);
    const pyExe = path.join(coreDir, 'python-embedded', 'python.exe');
    state.pythonEmbeddedExists = fs.existsSync(pyExe);
  } catch { state.pythonEmbeddedExists = false; }

  // ③ .env / config.json apiUrl 一致性
  try {
    const configDir = opts.configDir ?? path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'zenithjoy-agent',
    );
    const envPath = path.join(configDir, '.env');
    const configPath = path.join(configDir, 'config.json');

    let envApiUrl: string | null = null;
    let cfgApiUrl: string | null = null;

    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
      for (const l of lines) {
        const m = l.match(/^ZENITHJOY_API_URL\s*=\s*(.+)/);
        if (m) { envApiUrl = m[1].trim(); break; }
      }
    }
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { apiUrl?: string };
      cfgApiUrl = cfg.apiUrl ?? null;
    }

    if (envApiUrl && cfgApiUrl && envApiUrl !== cfgApiUrl) {
      state.configConsistencyOk = false;
      state.configConsistencyDetail = `apiUrl mismatch: .env=${envApiUrl} config.json=${cfgApiUrl}`;
    }
  } catch { /* best-effort，无文件 = 一致 */ }

  // ④ 残骸文件（C:\Users\Public 下 zj-* / test_* / send_* mtime>7天）
  try {
    const publicDir = process.env.PUBLIC || 'C:\\Users\\Public';
    const now = Date.now();
    for (const entry of fs.readdirSync(publicDir)) {
      if (!WRECKAGE_PREFIXES.some((pfx) => entry.startsWith(pfx))) continue;
      try {
        const full = path.join(publicDir, entry);
        const stat = fs.statSync(full);
        if (stat.isFile() && now - stat.mtimeMs > WRECKAGE_MAX_AGE_MS) {
          state.wreckageFiles.push(full);
        }
      } catch { /* skip */ }
    }
  } catch { /* best-effort */ }

  // ④ 一次性计划任务（ZJDbg* / ZJDiag* / ZJClick* 等）
  try {
    const out = execFileSync('schtasks', ['/query', '/fo', 'csv', '/nh'], {
      encoding: 'utf8', windowsHide: true, timeout: 20_000,
    });
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^"([^"]+)"/);
      if (!m) continue;
      const name = m[1];
      if (OFFICIAL_TASK_NAMES.some((n) => name === n)) continue;
      if (STALE_TASK_PREFIXES.some((pfx) => name.startsWith(pfx))) {
        state.staleScheduledTasks.push(name);
      }
    }
  } catch { /* best-effort */ }

  // ④ 陈旧锁文件（.zenithjoy-agent/*.lock 且 PID 已死）
  try {
    const lockDir = path.join(os.homedir(), '.zenithjoy-agent');
    if (fs.existsSync(lockDir)) {
      for (const entry of fs.readdirSync(lockDir)) {
        if (!entry.endsWith('.lock')) continue;
        const full = path.join(lockDir, entry);
        try {
          const raw = fs.readFileSync(full, 'utf8').trim();
          const pid = parseInt(raw.split('|')[0], 10);
          if (!isNaN(pid) && pid > 0) {
            try {
              process.kill(pid, 0);
              // PID 存活，不是陈旧锁
            } catch {
              state.staleLockFiles.push(full);
            }
          }
        } catch { /* skip */ }
      }
    }
  } catch { /* best-effort */ }

  return state;
}
