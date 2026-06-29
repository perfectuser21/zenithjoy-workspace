// services/agent/src/__tests__/module-manager-cleanup.test.ts
//
// Hand-off 2（微信客服 agent 核心清理）回归测试。覆盖两件事：
//   B（OTA 杀孙进程）：syncModules 检测到新版本 kill 旧模块 fork 时，必须连同它 spawn 的
//     python listen_chat 孙进程一并杀掉（Node child.kill() 杀不到孙进程 → 孤儿 listener
//     再抢微信 24h）。修法：用进程树 kill（Windows taskkill /T /F /PID）。
//   C（preflight 并发不报 ok:false 假"未安装"）：preflight 撞上自己还在跑时，"跳过"不该
//     上报 ok:false 覆盖上次 statusReport（否则中台/前端把"正在跑"显示成"未安装"）。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { ModuleManager } from '../module-manager';

describe('ModuleManager — agent 核心清理（hand-off 2）', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-modclean-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function seedModule(version: string): void {
    const dir = path.join(root, `line04-wechat-cs-${version}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ lineId: 'line04-wechat-cs', version, entry: 'index.js' }),
    );
    fs.writeFileSync(path.join(dir, 'index.js'), '');
  }

  // ── B：OTA 升级杀旧模块时连孙进程（python listen_chat）一起杀 ──
  describe('B — OTA 升级用进程树 kill 旧模块（含 python listen_chat 孙进程）', () => {
    it('检测到新版本终止旧 fork 时，通过 killProcessTreeImpl 按 PID 杀整棵进程树', async () => {
      seedModule('1.0.0');

      const killProcessTreeImpl = vi.fn();
      const downloadImpl = vi.fn(async (_l: string, version: string) => {
        seedModule(version);
      });
      const forkImpl = vi.fn().mockReturnValue({
        pid: 0, kill: vi.fn(), on: vi.fn(), send: vi.fn(), connected: true,
      } as unknown as ChildProcess);
      const preflightImpl = vi.fn().mockResolvedValue({ ok: true });

      const mm = new ModuleManager({
        modulesRoot: root,
        killProcessTreeImpl,
        downloadImpl,
        forkImpl,
        preflightImpl,
      });

      // 模拟旧版本已激活，持有一个真实 pid 的 fork
      const oldChildKill = vi.fn();
      // @ts-expect-error 测试 setup：直接塞进私有 active map
      mm.active.set('line04-wechat-cs', {
        pid: 4242, kill: oldChildKill, on: vi.fn(), send: vi.fn(), connected: true,
      } as unknown as ChildProcess);

      // 心跳给出新版本 1.0.1 → needsUpgrade=true → 走 OTA kill 分支
      await mm.syncModules({
        'line04-wechat-cs': { status: 'active', required_version: '1.0.1' },
      });

      // 核心断言：用进程树 kill（按旧 fork pid），而不是只 child.kill()（杀不到 python 孙进程）
      expect(killProcessTreeImpl).toHaveBeenCalledWith(4242);
    });
  });

  // ── D：OTA 切到 required_version 后清旧版本目录（环境标准化 / 单版本收敛，hand-off PR-B）──
  describe('D — OTA 切到 required_version 后清旧版本目录（只留当前版本）', () => {
    it('OTA 升级到 required_version 后，删所有非当前版本目录，仅保留 required_version', async () => {
      // 模拟客户机堆积：1.0.0 + 1.0.33（旧生产残留示例）
      seedModule('1.0.0');
      seedModule('1.0.33');

      // downloadImpl 必须写进传入的 staging 目录（ModuleManager 校验 staging 完整后原子 rename 落位）
      const downloadImpl = vi.fn(
        async (_l: string, version: string, _u: string, destDir: string) => {
          fs.mkdirSync(destDir, { recursive: true });
          fs.writeFileSync(
            path.join(destDir, 'manifest.json'),
            JSON.stringify({ lineId: 'line04-wechat-cs', version, entry: 'index.js' }),
          );
          fs.writeFileSync(path.join(destDir, 'index.js'), '');
        },
      );
      const forkImpl = vi.fn().mockReturnValue({
        pid: 0, kill: vi.fn(), on: vi.fn(), send: vi.fn(), connected: true,
      } as unknown as ChildProcess);
      const preflightImpl = vi.fn().mockResolvedValue({ ok: true });

      const mm = new ModuleManager({
        modulesRoot: root,
        downloadImpl,
        forkImpl,
        preflightImpl,
      });

      await mm.syncModules({
        'line04-wechat-cs': { status: 'active', required_version: '1.0.78' },
      });

      const dirs = fs
        .readdirSync(root)
        .filter((d) => d.startsWith('line04-wechat-cs-'));
      // 只剩 required_version 这一个版本目录
      expect(dirs).toEqual(['line04-wechat-cs-1.0.78']);
      expect(fs.existsSync(path.join(root, 'line04-wechat-cs-1.0.0'))).toBe(false);
      expect(fs.existsSync(path.join(root, 'line04-wechat-cs-1.0.33'))).toBe(false);
      expect(fs.existsSync(path.join(root, 'line04-wechat-cs-1.0.78'))).toBe(true);
    });

    it('安全闸：当前 required_version 目录残缺（缺 manifest）时不删任何旧版本（绝不删成无模块）', () => {
      seedModule('1.0.0');
      // 当前版本目录残缺（无 manifest）—— 不健康
      fs.mkdirSync(path.join(root, 'line04-wechat-cs-1.0.78'), { recursive: true });

      const mm = new ModuleManager({ modulesRoot: root });
      // @ts-expect-error 私有方法：直接测安全闸
      mm.cleanupOldVersionDirs('line04-wechat-cs', '1.0.78');

      // 旧版本仍在（安全闸生效，宁可留垃圾也不删成空）
      expect(fs.existsSync(path.join(root, 'line04-wechat-cs-1.0.0'))).toBe(true);
    });

    it('只删该 lineId 的纯版本目录，不误删非版本目录（防同前缀误吞）', () => {
      seedModule('1.0.0'); // 旧
      seedModule('1.0.78'); // 当前
      // 非版本号目录（同前缀），绝不能被当成旧版本删掉
      fs.mkdirSync(path.join(root, 'line04-wechat-cs-backup'), { recursive: true });
      fs.writeFileSync(path.join(root, 'line04-wechat-cs-backup', 'keep.txt'), 'x');

      const mm = new ModuleManager({ modulesRoot: root });
      // @ts-expect-error 私有方法
      mm.cleanupOldVersionDirs('line04-wechat-cs', '1.0.78');

      expect(fs.existsSync(path.join(root, 'line04-wechat-cs-1.0.0'))).toBe(false); // 旧版本删
      expect(fs.existsSync(path.join(root, 'line04-wechat-cs-1.0.78'))).toBe(true); // 当前留
      expect(fs.existsSync(path.join(root, 'line04-wechat-cs-backup'))).toBe(true); // 非版本目录不动
    });
  });

  // ── C：preflight 并发"跳过"不上报 ok:false（修假"未安装"）──
  describe('C — preflight 并发跳过保留上次状态，不报 ok:false', () => {
    it('runModulePreflight 并发跳过时返回 skipped=true 并保留上次 ok 状态', async () => {
      seedModule('1.0.0');
      const mm = new ModuleManager({
        modulesRoot: root,
        preflightImpl: vi.fn().mockResolvedValue({ ok: true }),
      });

      // 上一次 preflight 已记录 ok:true
      // @ts-expect-error 测试 setup：直接塞进私有 statusReport
      mm.statusReport.set('line04-wechat-cs', { ok: true });
      // 模拟另一个 preflight 正在跑
      // @ts-expect-error 测试 setup：标记并发中
      mm.preflightRunning.add('line04-wechat-cs');

      const r = await mm.runModulePreflight('line04-wechat-cs');

      // 不该把"正在跑"当失败：skipped 标记 + 保留上次 ok（绝不返回 ok:false 假未安装）
      expect(r.skipped).toBe(true);
      expect(r.ok).toBe(true);
    });

    it('syncModules 并发跳过 preflight 时，不把 statusReport 覆盖成 ok:false（前端不再显示未安装）', async () => {
      seedModule('1.0.0');
      const mm = new ModuleManager({
        modulesRoot: root,
        preflightImpl: vi.fn().mockResolvedValue({ ok: true }),
      });

      // 上一轮已健康
      // @ts-expect-error 测试 setup
      mm.statusReport.set('line04-wechat-cs', { ok: true });
      // 模拟 preflight 正在跑（另一并发心跳触发的）
      // @ts-expect-error 测试 setup
      mm.preflightRunning.add('line04-wechat-cs');

      await mm.syncModules({
        'line04-wechat-cs': { status: 'active', required_version: '1.0.0' },
      });

      // 心跳上报的健康仍是 ok:true（没被并发跳过覆盖成未安装）
      const report = mm.getModuleStatusReport();
      expect(report['line04-wechat-cs']?.ok).toBe(true);
    });
  });
});
