/**
 * overlay.ts — Line04 AI 思考浮窗 node 侧接线（第二刀）
 *
 * 覆盖 BEHAVIOR-6（contract-dod.md）：
 *   - preflight 软检测：失败则写 overlay-diag.json 不 spawn
 *   - 互斥体热更杀旧（Global\zenithjoy-line04-overlay）
 *   - spawn overlay_window.py 注入 ZJ_STATE_DIR + ZJ_MODULE_VERSION
 *   - 用户关闭（exit code 0）→ 不重拉
 *   - 熔断：60min 内 8 次存活 <60s → 静默
 *   - 其他退出：30s 后重拉
 *
 * Invariant I7（熔断）/ I8（用户关闭不重拉）/ I9（diag 路径）均覆盖。
 */

import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getPythonExe } from './wechat-rpa';
import { _repairFuncs as preflightRepair } from '../preflight';

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const MUTEX_NAME = 'Global\\zenithjoy-line04-overlay';
const CIRCUIT_WINDOW_SEC = 3600;    // 60min 熔断窗口
const CIRCUIT_THRESHOLD = 8;        // 8 次快速崩溃 → 熔断
const FAST_CRASH_SEC = 60;          // 存活 <60s → 算快速崩溃
const RESPAWN_DELAY_MS = 30_000;    // 正常退出重拉延迟
// 打包进 install pack 后 handlers/ 与 wechat-rpa/ 是 <module-root>/ 下的同级目录，从
// handlers/ 只需上 1 层（不是 repo 源码树里共享 services/agent/wechat-rpa/ 那 3 层）。
const OVERLAY_SCRIPT = path.join(
  __dirname,
  '../wechat-rpa/overlay/overlay_window.py',
);

// Windows 路径反斜杠塞进 python -c 字符串字面量前必须转义，否则 `\U`/`\u`/`\n` 等会被
// Python 当成 unicode/转义序列解析（真机实测：`\Users` 触发
// "SyntaxError: (unicode error) 'unicodeescape' codec ... truncated \UXXXXXXXX escape"）。
function escapePyStrLiteral(p: string): string {
  return p.replace(/\\/g, '\\\\');
}

// 供测试直接验证 -c 命令字符串本身语法合法（不依赖真实 preflight 模块可 import）。
export function buildPreflightCommand(preflightScript: string, stateDir: string): string {
  return (
    `import sys; sys.path.insert(0, '${escapePyStrLiteral(path.dirname(preflightScript))}');` +
    `from preflight import check_preflight; import json; ` +
    `r = check_preflight('${escapePyStrLiteral(stateDir)}'); ` +
    `print(json.dumps(r))`
  );
}

// ─── 诊断 JSON 模板 ──────────────────────────────────────────────────────────

function makeDiag(stateDir: string, opts: {
  lastError?: string;
  attachState?: string;
  circuitOpen?: boolean;
  restartCount?: number;
  overlayPid?: number | null;
} = {}): Record<string, unknown> {
  return {
    agent_id: process.env.ZJ_AGENT_ID ?? 'unknown',
    ts: Math.floor(Date.now() / 1000),
    overlay_pid: opts.overlayPid ?? null,
    rss_mb: 0,
    cpu_pct: 0,
    attach_state: opts.attachState ?? 'idle',
    wechat_hwnd_found: false,
    render_lag_ms_p95: 0,
    events_tail_offset: 0,
    restart_count_60min: opts.restartCount ?? 0,
    circuit_open: opts.circuitOpen ?? false,
    last_error: opts.lastError ?? '',
  };
}

function writeDiag(stateDir: string, diag: Record<string, unknown>): void {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    const diagPath = path.join(stateDir, 'overlay-diag.json');
    fs.writeFileSync(diagPath, JSON.stringify(diag, null, 2), 'utf-8');
  } catch {
    // 写 diag 失败不抛（非致命）
  }
}

// ─── OverlayHandler ──────────────────────────────────────────────────────────

export class OverlayHandler {
  private _proc: ChildProcess | null = null;
  private _spawnTs: number | null = null;
  private _crashTimes: number[] = [];   // 快速崩溃时间戳（秒）
  private _circuitOpen = false;
  private _userClosed = false;
  private _restartCount = 0;
  private _respawnTimer: ReturnType<typeof setTimeout> | null = null;
  // 刀A（框框断供根治）：对外可查询的最新状态红灯，Task 4 上报用。
  private _lastStatus: { ok: boolean; reason?: string } = { ok: false, reason: 'not_started' };

  constructor(
    private readonly stateDir: string,
    private readonly moduleVersion: string = 'unknown',
  ) {}

  // ─── 公共 API ─────────────────────────────────────────────────────────────

  /**
   * 启动浮窗进程。
   * 先 preflight 软检测，失败则写 diag 不 spawn；
   * preflight 通过 → 热更杀旧 → spawn。
   */
  async start(): Promise<{ spawned: boolean; reason?: string }> {
    // 用户已关闭 → 不重拉（I8）
    if (this._userClosed) {
      return { spawned: false, reason: 'user_closed' };
    }

    // 熔断 → 不 spawn（I7）
    if (this._circuitOpen) {
      return { spawned: false, reason: 'circuit_open' };
    }

    // preflight 软检测（调 Python preflight.py）
    let preflight = await this._runPreflight();
    if (!preflight.ok && preflight.reason === 'pywebview_missing') {
      // 刀A：依赖缺失先自修复再判死（覆盖 core 换目录场景导致 pywebview 丢失的混沌 P0-1）。
      // 其他 reason（如 webview2_missing）不触发补装，直接冒泡。
      const repair = await preflightRepair.installPywebview(
        getPythonExe(),
        path.join(os.tmpdir(), 'zenithjoy-setup'),
      );
      preflight = repair.ok
        ? await this._runPreflight()
        : { ok: false, reason: 'pywebview_install_failed' };
    }
    if (!preflight.ok) {
      const reason = preflight.reason ?? 'preflight_failed';
      this._lastStatus = { ok: false, reason };
      const diag = makeDiag(this.stateDir, {
        lastError: reason,
        attachState: 'preflight_failed',
      });
      writeDiag(this.stateDir, diag);
      return { spawned: false, reason };
    }

    // 热更：杀旧进程（互斥体语义）
    this._killExisting();

    // spawn overlay_window.py
    this._spawnOverlay();

    this._lastStatus = { ok: true };
    // 刀A：成功态无条件覆写 diag，根除旧失败文件误导排查（混沌 P2-7）。
    writeDiag(this.stateDir, makeDiag(this.stateDir, {
      attachState: 'spawned',
      overlayPid: this._proc?.pid ?? null,
    }));

    return { spawned: true };
  }

  /**
   * 返回最新一次 start() 的成败状态（供 Task 4 上报用）。
   */
  getStatus(): { ok: boolean; reason?: string } {
    return { ...this._lastStatus };
  }

  /**
   * agent 重启时调用：复位熔断状态。
   */
  resetOnAgentRestart(): void {
    this._circuitOpen = false;
    this._crashTimes = [];
    this._restartCount = 0;
    this._userClosed = false;
    if (this._respawnTimer) {
      clearTimeout(this._respawnTimer);
      this._respawnTimer = null;
    }
  }

  /**
   * 停止浮窗（不触发重拉）。
   */
  stop(): void {
    if (this._respawnTimer) {
      clearTimeout(this._respawnTimer);
      this._respawnTimer = null;
    }
    this._killExisting();
  }

  // ─── 内部方法 ─────────────────────────────────────────────────────────────

  private async _runPreflight(): Promise<{ ok: boolean; reason?: string }> {
    // 在 Windows 以外的环境（CI/Linux）直接返回 ok，避免 winreg 不可用
    if (os.platform() !== 'win32') {
      // 仍检查 Python 和 pywebview 是否可 import
      return this._checkPywebviewAvailable();
    }
    return new Promise((resolve) => {
      const pyExe = getPythonExe();
      const preflightScript = path.join(
        __dirname,
        '../wechat-rpa/overlay/preflight.py',
      );

      if (!fs.existsSync(preflightScript)) {
        resolve({ ok: false, reason: 'preflight_script_missing' });
        return;
      }

      const proc = spawn(pyExe, [
        '-c',
        buildPreflightCommand(preflightScript, this.stateDir),
      ], { timeout: 10_000 });

      let stdout = '';
      proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.on('close', (code) => {
        try {
          const result = JSON.parse(stdout.trim());
          resolve({ ok: Boolean(result.ok), reason: result.reason });
        } catch {
          resolve({ ok: code === 0, reason: code !== 0 ? 'preflight_parse_error' : undefined });
        }
      });
      proc.on('error', () => resolve({ ok: false, reason: 'preflight_spawn_error' }));
    });
  }

  private async _checkPywebviewAvailable(): Promise<{ ok: boolean; reason?: string }> {
    return new Promise((resolve) => {
      const pyExe = getPythonExe();
      const proc = spawn(pyExe, ['-c', 'import webview; print("ok")'], { timeout: 8_000 });
      let stdout = '';
      proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.on('close', (code) => {
        if (code === 0 && stdout.includes('ok')) {
          resolve({ ok: true });
        } else {
          resolve({ ok: false, reason: 'pywebview_missing' });
        }
      });
      proc.on('error', () => resolve({ ok: false, reason: 'pywebview_missing' }));
    });
  }

  private _killExisting(): void {
    if (this._proc && !this._proc.killed) {
      try {
        this._proc.kill('SIGTERM');
      } catch {
        // 忽略杀进程失败
      }
      this._proc = null;
    }
  }

  private _spawnOverlay(): void {
    if (!fs.existsSync(OVERLAY_SCRIPT)) {
      console.warn(`[overlay] overlay_window.py 不存在: ${OVERLAY_SCRIPT}`);
      return;
    }

    const pyExe = getPythonExe();
    this._spawnTs = Date.now() / 1000;

    const env = {
      ...process.env,
      ZJ_STATE_DIR: this.stateDir,
      ZJ_MODULE_VERSION: this.moduleVersion,
      ZJ_AGENT_ID: process.env.ZJ_AGENT_ID ?? 'unknown',
      // Windows 编码
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    };

    const proc = spawn(pyExe, [OVERLAY_SCRIPT], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    this._proc = proc;

    proc.stdout?.on('data', (d: Buffer) => {
      process.stdout.write(`[overlay/py] ${d}`);
    });
    proc.stderr?.on('data', (d: Buffer) => {
      process.stderr.write(`[overlay/py] ${d}`);
    });

    proc.on('close', (code, signal) => {
      const uptime = this._spawnTs ? (Date.now() / 1000 - this._spawnTs) : Infinity;
      this._proc = null;
      this._spawnTs = null;

      console.info(`[overlay] 进程退出 code=${code} signal=${signal} uptime=${uptime.toFixed(1)}s`);

      // 用户关闭（exit code 0）→ 不重拉（I8）
      if (code === 0) {
        this._userClosed = true;
        // 写 overlay-state.json（供测试读取）
        try {
          fs.mkdirSync(this.stateDir, { recursive: true });
          fs.writeFileSync(
            path.join(this.stateDir, 'overlay-state.json'),
            JSON.stringify({ user_closed: true }),
            'utf-8',
          );
        } catch {
          // 非致命
        }
        return;
      }

      // 记录崩溃历史（I7）
      this._recordCrash(uptime);

      if (this._circuitOpen) {
        console.warn('[overlay] 熔断触发，停止重拉');
        const diag = makeDiag(this.stateDir, {
          lastError: 'circuit_breaker_triggered',
          attachState: 'circuit_open',
          circuitOpen: true,
          restartCount: this._restartCount,
        });
        writeDiag(this.stateDir, diag);
        return;
      }

      // 其他退出：30s 后重拉
      console.info(`[overlay] ${RESPAWN_DELAY_MS / 1000}s 后重拉`);
      this._respawnTimer = setTimeout(() => {
        this._respawnTimer = null;
        if (!this._userClosed && !this._circuitOpen) {
          this._spawnOverlay();
        }
      }, RESPAWN_DELAY_MS);
    });

    proc.on('error', (err) => {
      console.error('[overlay] spawn 失败:', err.message);
      this._proc = null;
    });
  }

  private _recordCrash(uptimeSec: number): void {
    if (uptimeSec < FAST_CRASH_SEC) {
      const now = Date.now() / 1000;
      this._crashTimes.push(now);
      this._restartCount++;
      // 清理窗口外记录
      const cutoff = now - CIRCUIT_WINDOW_SEC;
      this._crashTimes = this._crashTimes.filter(t => t >= cutoff);
      if (this._crashTimes.length >= CIRCUIT_THRESHOLD) {
        this._circuitOpen = true;
      }
    }
  }

  // ─── 测试用属性 ─────────────────────────────────────────────────────────────

  get circuitOpen(): boolean { return this._circuitOpen; }
  get userClosed(): boolean { return this._userClosed; }
  get restartCount(): number { return this._restartCount; }
  get isRunning(): boolean { return this._proc !== null && !this._proc.killed; }
}

// ─── 单例工厂 ─────────────────────────────────────────────────────────────────

let _instance: OverlayHandler | null = null;

/**
 * 获取（或创建）全局唯一 OverlayHandler 实例。
 * 互斥体语义：同一 stateDir 只存在一个 handler。
 */
export function getOverlayHandler(stateDir: string, moduleVersion?: string): OverlayHandler {
  if (_instance === null) {
    _instance = new OverlayHandler(stateDir, moduleVersion);
  }
  return _instance;
}

/** 测试用：重置单例（每个 test 独立） */
export function _resetOverlayHandlerForTest(): void {
  _instance = null;
}
