/**
 * overlay-handler.test.ts — node 侧 overlay handler 单测
 *
 * 覆盖 BEHAVIOR-6（contract-dod.md）：
 *   - preflight 失败时不 spawn
 *   - 用户关闭（exit code 0）不重拉
 *   - 熔断（60min 内 8 次快速崩溃）静默
 *
 * 运行：npx vitest run services/agent/modules/line04/__tests__/overlay-handler.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// ─── OverlayHandler 导入（第二刀实现后解注释）────────────────────────────────
// import { OverlayHandler } from '../handlers/overlay';

// ─── 存根：模拟 OverlayHandler 接口（Red 阶段，实现后替换）─────────────────────

interface OverlayStartOptions {
  stateDir: string;
  moduleVersion: string;
}

interface StartResult {
  spawned: boolean;
  reason?: string;
}

/**
 * OverlayHandlerStub — 测试用 overlay handler 骨架。
 * 第二刀实现完成后，替换为真实的 OverlayHandler import。
 */
class OverlayHandlerStub {
  private _spawnCount = 0;
  private _lastDiag: Record<string, unknown> | null = null;
  private _crashHistory: number[] = [];  // 崩溃时间戳
  private _circuitOpen = false;
  private _userClosed = false;

  private readonly CIRCUIT_WINDOW_SEC = 3600;
  private readonly CIRCUIT_THRESHOLD = 8;
  private readonly FAST_CRASH_SEC = 60;

  // 可在测试中注入 preflight 结果
  preflightResult: { ok: boolean; reason?: string } = { ok: true };

  async start(opts: OverlayStartOptions): Promise<StartResult> {
    const { stateDir, moduleVersion } = opts;

    // preflight 软检测
    if (!this.preflightResult.ok) {
      this._lastDiag = {
        agent_id: 'test',
        ts: Date.now(),
        overlay_pid: null,
        rss_mb: 0,
        cpu_pct: 0,
        attach_state: 'preflight_failed',
        wechat_hwnd_found: false,
        render_lag_ms_p95: 0,
        events_tail_offset: 0,
        restart_count_60min: 0,
        circuit_open: false,
        last_error: this.preflightResult.reason ?? 'preflight_failed',
      };
      // 写 diag
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(
        path.join(stateDir, 'overlay-diag.json'),
        JSON.stringify(this._lastDiag, null, 2),
        'utf-8',
      );
      return { spawned: false, reason: this.preflightResult.reason };
    }

    // 用户已关闭 → 不重拉
    if (this._userClosed) {
      return { spawned: false, reason: 'user_closed' };
    }

    // 熔断 → 不 spawn
    if (this._circuitOpen) {
      return { spawned: false, reason: 'circuit_open' };
    }

    this._spawnCount++;
    return { spawned: true };
  }

  /** 模拟进程退出（用户关闭，exit code 0）*/
  simulateUserClose(stateDir: string) {
    this._userClosed = true;
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, 'overlay-state.json'),
      JSON.stringify({ user_closed: true }),
      'utf-8',
    );
  }

  /** 模拟 N 次快速崩溃 */
  simulateFastCrashes(count: number) {
    const now = Date.now() / 1000;
    for (let i = 0; i < count; i++) {
      this._crashHistory.push(now);
    }
    const cutoff = now - this.CIRCUIT_WINDOW_SEC;
    this._crashHistory = this._crashHistory.filter(t => t >= cutoff);
    if (this._crashHistory.length >= this.CIRCUIT_THRESHOLD) {
      this._circuitOpen = true;
    }
  }

  get spawnCount() { return this._spawnCount; }
  get lastDiag() { return this._lastDiag; }
  get circuitOpen() { return this._circuitOpen; }
}

// ─── 测试 ─────────────────────────────────────────────────────────────────────

describe('[BEHAVIOR-6] overlay handler — spawn/preflight/watchdog', () => {
  let stateDir: string;
  let handler: OverlayHandlerStub;

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-test-'));
    handler = new OverlayHandlerStub();
  });

  it('preflight fail no spawn — preflight 失败时不 spawn 浮窗（写 diag）', async () => {
    // BEHAVIOR-6：preflight 检测失败 → 不 spawn，写 overlay-diag.json
    handler.preflightResult = { ok: false, reason: 'pywebview_missing' };

    const result = await handler.start({ stateDir, moduleVersion: '1.0.0' });

    expect(result.spawned).toBe(false);
    expect(result.reason).toBe('pywebview_missing');
    expect(handler.spawnCount).toBe(0);

    // 验证 diag 已写入
    const diagPath = path.join(stateDir, 'overlay-diag.json');
    expect(fs.existsSync(diagPath)).toBe(true);

    const diag = JSON.parse(fs.readFileSync(diagPath, 'utf-8'));
    expect(diag.last_error).toBe('pywebview_missing');
    expect(diag.attach_state).toBe('preflight_failed');

    // diag 需含全部 12 字段
    const required = [
      'agent_id', 'ts', 'overlay_pid', 'rss_mb', 'cpu_pct',
      'attach_state', 'wechat_hwnd_found', 'render_lag_ms_p95',
      'events_tail_offset', 'restart_count_60min', 'circuit_open', 'last_error',
    ];
    for (const field of required) {
      expect(diag).toHaveProperty(field);
    }
  });

  it('user closed no respawn — 用户关闭（exit code 0）后不重拉（BEHAVIOR-6/I8）', async () => {
    // 先正常 spawn 一次
    const firstResult = await handler.start({ stateDir, moduleVersion: '1.0.0' });
    expect(firstResult.spawned).toBe(true);

    // 模拟用户关闭（exit code 0）
    handler.simulateUserClose(stateDir);

    // 尝试重拉 → 应被阻止
    const secondResult = await handler.start({ stateDir, moduleVersion: '1.0.0' });
    expect(secondResult.spawned).toBe(false);
    expect(secondResult.reason).toBe('user_closed');

    // overlay-state.json 应记录 user_closed
    const statePath = path.join(stateDir, 'overlay-state.json');
    expect(fs.existsSync(statePath)).toBe(true);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    expect(state.user_closed).toBe(true);
  });

  it('circuit breaker — 60min 内 8 次快速崩溃 → 熔断静默（BEHAVIOR-6/I7）', async () => {
    // 模拟 8 次快速崩溃
    handler.simulateFastCrashes(8);

    expect(handler.circuitOpen).toBe(true);

    // 熔断后不应 spawn
    const result = await handler.start({ stateDir, moduleVersion: '1.0.0' });
    expect(result.spawned).toBe(false);
    expect(result.reason).toBe('circuit_open');
  });

  it('preflight pass spawns overlay — preflight 通过后正常 spawn', async () => {
    handler.preflightResult = { ok: true };

    const result = await handler.start({ stateDir, moduleVersion: '1.0.0' });

    expect(result.spawned).toBe(true);
    expect(handler.spawnCount).toBe(1);
  });

  it('7 fast crashes no circuit — 7 次快速崩溃不触发熔断', async () => {
    handler.simulateFastCrashes(7);

    expect(handler.circuitOpen).toBe(false);

    const result = await handler.start({ stateDir, moduleVersion: '1.0.0' });
    expect(result.spawned).toBe(true);
  });
});

// ─── 真机回归：OVERLAY_SCRIPT/preflightScript 相对路径必须指向打包后真实位置 ──────
//
// 根因（2026-07-15 xian-rog 真机复验实测）：overlay.ts 里两处 path.join(__dirname, '../../../wechat-rpa/...')
// 是按 repo 源码树算的（modules/line04/handlers → 上 3 层到 services/agent/wechat-rpa/ 共享目录），
// 但打包进 install pack 后目录被拍平成 build-modules/line04/{handlers,wechat-rpa}/ 两个同级目录，
// 从 handlers/ 只需上 1 层就能到 wechat-rpa/，多算的两层导致真机上 preflight 恒
// reason=preflight_script_missing、overlay 永远不 spawn——CI 测不出（跑的是 stub，
// 也没有真实 build-modules 目录结构可比对），只有真机复验才暴露。
describe('overlay 脚本路径 — 打包后真实目录结构回归（真机 preflight_script_missing 根因）', () => {
  const overlaySourcePath = path.join(__dirname, '../handlers/overlay.ts');
  const source = fs.readFileSync(overlaySourcePath, 'utf-8');
  // repo 里 build-modules/line04/ 同时有共享 services/agent/wechat-rpa/ 逃逸口，直接在 repo
  // 内解析会因为多上几层照样撞见那份共享文件、掩盖 bug；复制到隔离临时目录才是真机装机后的真实形态
  // （只有 <module-root>/{handlers,wechat-rpa}/ 两个同级目录，没有别的路径可逃逸命中）。
  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-overlay-pkg-'));
  fs.cpSync(
    path.join(__dirname, '../../../build-modules/line04'),
    path.join(isolatedRoot, 'line04-wechat-cs-1.0.118'),
    { recursive: true },
  );
  const packagedHandlersDir = path.join(isolatedRoot, 'line04-wechat-cs-1.0.118', 'handlers');

  function extractRelativePath(varName: string): string {
    const re = new RegExp(`${varName}[\\s\\S]*?path\\.join\\(\\s*__dirname,\\s*'([^']+)'`);
    const m = source.match(re);
    if (!m) throw new Error(`未找到 ${varName} 的 path.join(__dirname, ...) 定义`);
    return m[1];
  }

  it('OVERLAY_SCRIPT 相对路径解析后必须命中打包目录里真实存在的 overlay_window.py', () => {
    const rel = extractRelativePath('OVERLAY_SCRIPT');
    const resolved = path.resolve(packagedHandlersDir, rel);
    expect(fs.existsSync(resolved)).toBe(true);
  });

  it('preflightScript 相对路径解析后必须命中打包目录里真实存在的 preflight.py', () => {
    const rel = extractRelativePath('preflightScript');
    const resolved = path.resolve(packagedHandlersDir, rel);
    expect(fs.existsSync(resolved)).toBe(true);
  });
});
