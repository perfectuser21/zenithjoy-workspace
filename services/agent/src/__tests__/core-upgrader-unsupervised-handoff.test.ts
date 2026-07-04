// services/agent/src/__tests__/core-upgrader-unsupervised-handoff.test.ts
//
// 根因①（2026-07-04 08:46→12:00 实锤 3.5h 停机）：CoreUpgrader 写完 .active-core 指针后
// 无条件 process.exit(0)"等启动器拉起新核心"。但核心可能根本不是被 supervise 循环启动的
// （计划任务指死已删目录后人工拉起 / 调试方式直启 / 循环进程被杀）→ 退出即停机，无人拉起。
//
// 守护（先立后破）：
//   - 被 supervise（ZJ_SUPERVISED=1 / supervised:true）→ 维持现状：退出，循环重读指针拉起。
//   - 未被 supervise → 退出前必须自己 spawn（detached）新核心的启动入口；
//     spawn 失败 → 回滚 .active-core 指针 + 不退出（旧核心继续跑，绝不留真空）。
//
// proven-to-fire：把 spawnNewCoreImpl 调用删掉或把失败回滚删掉 → 对应断言立即红。

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CoreUpgrader } from '../core-upgrader';

function mkRoot(): { root: string; coreDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-upg-'));
  const coreDir = path.join(root, 'extracted', 'zenithjoy-agent-v2.0.74');
  fs.mkdirSync(coreDir, { recursive: true });
  return { root, coreDir };
}

function mkUpgrader(opts: {
  coreDir: string;
  supervised: boolean;
  exitImpl: () => void;
  spawnNewCoreImpl?: (newCoreDir: string) => void;
}) {
  return new CoreUpgrader({
    currentVersion: '2.0.74',
    coreDir: opts.coreDir,
    supervised: opts.supervised,
    exitImpl: opts.exitImpl,
    spawnNewCoreImpl: opts.spawnNewCoreImpl,
    downloadImpl: async (_v, _url, destDir) => {
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(path.join(destDir, 'zenithjoy-agent.exe'), 'stub');
    },
    logger: () => {},
  });
}

describe('CoreUpgrader — 未被 supervise 时的先立后破交接', () => {
  it('supervised=true：不 spawn，走原有"退出等启动器"路径', async () => {
    const { coreDir } = mkRoot();
    const exitImpl = vi.fn();
    const spawn = vi.fn();
    const u = mkUpgrader({ coreDir, supervised: true, exitImpl, spawnNewCoreImpl: spawn });
    const r = await u.upgradeIfNeeded('2.0.75');
    expect(r.upgraded).toBe(true);
    expect(exitImpl).toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('supervised=false：退出前必须先 spawn 新核心（先立后破）', async () => {
    const { root, coreDir } = mkRoot();
    const calls: string[] = [];
    const exitImpl = vi.fn(() => calls.push('exit'));
    const spawn = vi.fn((_d: string) => calls.push('spawn'));
    const u = mkUpgrader({ coreDir, supervised: false, exitImpl, spawnNewCoreImpl: spawn });
    const r = await u.upgradeIfNeeded('2.0.75');
    expect(r.upgraded).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      expect.stringContaining('zenithjoy-agent-v2.0.75'),
    );
    // 顺序：先立（spawn）后破（exit）
    expect(calls.indexOf('spawn')).toBeLessThan(calls.indexOf('exit'));
    // 指针已指向新核心
    const pointer = fs.readFileSync(path.join(root, '.active-core'), 'utf-8').trim();
    expect(pointer).toBe('zenithjoy-agent-v2.0.75');
  });

  it('supervised=false 且 spawn 失败：回滚指针 + 不退出（绝不留真空）', async () => {
    const { root, coreDir } = mkRoot();
    const exitImpl = vi.fn();
    const spawn = vi.fn(() => {
      throw new Error('spawn blew up');
    });
    const u = mkUpgrader({ coreDir, supervised: false, exitImpl, spawnNewCoreImpl: spawn });
    const r = await u.upgradeIfNeeded('2.0.75');
    expect(r.upgraded).toBe(false);
    expect(r.reason).toMatch(/spawn|拉起/);
    expect(exitImpl).not.toHaveBeenCalled();
    // 指针必须被回滚（删除或指回旧核心，二者取一；绝不能留在新核心）
    const pointerPath = path.join(root, '.active-core');
    if (fs.existsSync(pointerPath)) {
      expect(fs.readFileSync(pointerPath, 'utf-8').trim()).toBe('zenithjoy-agent-v2.0.74');
    }
  });
});
