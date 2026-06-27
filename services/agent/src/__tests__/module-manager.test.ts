// services/agent/src/__tests__/module-manager.test.ts
//
// Sprint 06081700 — ModuleManager 单测（TDD commit-1 红）

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ModuleManager } from '../module-manager';

describe('ModuleManager', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-modtest-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('getActiveModules 初始状态返回空数组', () => {
    const mm = new ModuleManager({ modulesRoot: root });
    expect(mm.getActiveModules()).toEqual([]);
  });

  it('runModulePreflight 在模块目录不存在时返回 {ok:false, reason:"module_not_installed"}', async () => {
    const mm = new ModuleManager({ modulesRoot: root });
    const r = await mm.runModulePreflight('line04-wechat-cs');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('module_not_installed');
  });

  it('syncModules 检测到版本差异（未安装）时触发下载', async () => {
    const downloadImpl = vi.fn().mockResolvedValue(undefined);
    const mm = new ModuleManager({ modulesRoot: root, downloadImpl });

    await mm.syncModules({
      'line04-wechat-cs': { status: 'active', required_version: '1.0.0' },
    });

    expect(downloadImpl).toHaveBeenCalledTimes(1);
    expect(downloadImpl).toHaveBeenCalledWith(
      'line04-wechat-cs',
      '1.0.0',
      expect.stringContaining('line04-wechat-cs-v1.0.0.tar.gz'),
      expect.any(String),
    );
    // mock 没真写文件 → 仍判定未安装 → needsDownload 仍为 true
    expect(mm.needsDownload('line04-wechat-cs', '1.0.0')).toBe(true);
  });

  it('syncModules 已安装且版本一致时不下载', async () => {
    const dir = path.join(root, 'line01-publish-1.0.0');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ lineId: 'line01-publish', version: '1.0.0', entry: 'index.js' }),
    );

    const downloadImpl = vi.fn();
    // 注入 preflight（避免真 spawn）；返回 ok:false 以免触发真 fork
    const preflightImpl = vi.fn().mockResolvedValue({ ok: false, reason: 'stub' });
    const mm = new ModuleManager({ modulesRoot: root, downloadImpl, preflightImpl });

    await mm.syncModules({
      'line01-publish': { status: 'active', required_version: '1.0.0' },
    });

    expect(downloadImpl).not.toHaveBeenCalled();
    expect(preflightImpl).toHaveBeenCalledTimes(1);
    expect(mm.getActiveModules()).toEqual([]);
  });

  it('syncModules 跳过非 active（locked / not_purchased）模块', async () => {
    const downloadImpl = vi.fn();
    const mm = new ModuleManager({ modulesRoot: root, downloadImpl });

    await mm.syncModules({
      'line02-lead-gen': { status: 'locked', required_version: '1.0.0' },
      'line05-video': { status: 'not_purchased', required_version: '1.0.0' },
    });

    expect(downloadImpl).not.toHaveBeenCalled();
  });

  it('forwardMessage 在模块未激活时不抛异常', () => {
    const mm = new ModuleManager({ modulesRoot: root });
    expect(() => mm.forwardMessage('line04-wechat-cs', { type: 'incoming_message' })).not.toThrow();
  });

  it('downloadModule 失败时 syncModules 不抛异常，并把失败原因记入 module_status', async () => {
    const downloadImpl = vi.fn().mockRejectedValue(new Error('COS 503'));
    const mm = new ModuleManager({ modulesRoot: root, downloadImpl });

    await expect(
      mm.syncModules({
        'line04-wechat-cs': { status: 'active', required_version: '1.0.0' },
      }),
    ).resolves.toBeUndefined();

    const report = mm.getModuleStatusReport();
    expect(report['line04-wechat-cs'].ok).toBe(false);
    expect(report['line04-wechat-cs'].reason).toContain('COS 503');
    // 下载失败 → 不应激活
    expect(mm.getActiveModules()).toEqual([]);
  });

  it('manifest.json 损坏时不崩溃，activateModule 回退默认入口 index.js', async () => {
    const dir = path.join(root, 'line04-wechat-cs-1.2.3');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{ 这不是合法 JSON');
    fs.writeFileSync(path.join(dir, 'index.js'), '');

    const forkImpl = vi.fn().mockReturnValue({
      on: vi.fn(),
      send: vi.fn(),
      connected: true,
    } as unknown as import('node:child_process').ChildProcess);
    const preflightImpl = vi.fn().mockResolvedValue({ ok: true });
    const mm = new ModuleManager({ modulesRoot: root, forkImpl, preflightImpl });

    await expect(
      mm.syncModules({
        'line04-wechat-cs': { status: 'active', required_version: '1.2.3' },
      }),
    ).resolves.toBeUndefined();

    expect(forkImpl).toHaveBeenCalledTimes(1);
    // 默认入口 index.js
    expect(forkImpl.mock.calls[0][0]).toContain('index.js');
    expect(mm.getActiveModules()).toEqual(['line04-wechat-cs']);
  });

  it('preflight 未通过时触发 onPreflightFail 回调（弹窗 + 上报），且不激活', async () => {
    const dir = path.join(root, 'line04-wechat-cs-3.0.0');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ lineId: 'line04-wechat-cs', version: '3.0.0', entry: 'index.js' }),
    );

    const onPreflightFail = vi.fn();
    const forkImpl = vi.fn();
    const preflightImpl = vi.fn().mockResolvedValue({
      ok: false,
      reason: 'wechat_version_too_high',
      fixGuide: '微信版本过高，请降级到 4.1.8',
    });
    const mm = new ModuleManager({
      modulesRoot: root,
      forkImpl,
      preflightImpl,
      onPreflightFail,
    });

    await mm.syncModules({
      'line04-wechat-cs': { status: 'active', required_version: '3.0.0' },
    });

    expect(onPreflightFail).toHaveBeenCalledTimes(1);
    expect(onPreflightFail).toHaveBeenCalledWith('line04-wechat-cs', {
      ok: false,
      reason: 'wechat_version_too_high',
      fixGuide: '微信版本过高，请降级到 4.1.8',
    });
    expect(forkImpl).not.toHaveBeenCalled();
    expect(mm.getActiveModules()).toEqual([]);
    // fixGuide 进入上报 reason（fixGuide 优先于 reason）
    expect(mm.getModuleStatusReport()['line04-wechat-cs'].reason).toBe(
      'wechat_version_too_high',
    );
  });

  it('activateModule fork 时 env 含 ZENITHJOY_CORE_DIR（使 line04 能找到 core python-embedded）', async () => {
    // 回归：fork 不传 ZENITHJOY_CORE_DIR → line04 的 getPythonExe() 回退 python3 → listen_chat.py 从未起
    const dir = path.join(root, 'line04-wechat-cs-5.0.0');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ lineId: 'line04-wechat-cs', version: '5.0.0', entry: 'index.js' }),
    );
    fs.writeFileSync(path.join(dir, 'index.js'), '');

    const fakeChild = { on: vi.fn(), send: vi.fn(), connected: true } as any;
    const forkImpl = vi.fn().mockReturnValue(fakeChild);
    const preflightImpl = vi.fn().mockResolvedValue({ ok: true });
    const mm = new ModuleManager({ modulesRoot: root, forkImpl, preflightImpl });

    await mm.syncModules({ 'line04-wechat-cs': { status: 'active', required_version: '5.0.0' } });

    expect(forkImpl).toHaveBeenCalledTimes(1);
    const forkOptions = forkImpl.mock.calls[0][1] as { env?: Record<string, string> };
    expect(forkOptions?.env?.ZENITHJOY_CORE_DIR).toBeDefined();
  });

  it('forwardMessage 把消息发给已激活模块子进程', async () => {
    const dir = path.join(root, 'line04-wechat-cs-4.0.0');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ lineId: 'line04-wechat-cs', version: '4.0.0', entry: 'index.js' }),
    );
    const send = vi.fn();
    const forkImpl = vi.fn().mockReturnValue({
      on: vi.fn(),
      send,
      connected: true,
    } as unknown as import('node:child_process').ChildProcess);
    const preflightImpl = vi.fn().mockResolvedValue({ ok: true });
    const mm = new ModuleManager({ modulesRoot: root, forkImpl, preflightImpl });

    await mm.syncModules({
      'line04-wechat-cs': { status: 'active', required_version: '4.0.0' },
    });
    send.mockClear(); // 清掉 activate 时的 config 消息

    const msg = { type: 'incoming_message', data: { foo: 'bar' } };
    mm.forwardMessage('line04-wechat-cs', msg);
    expect(send).toHaveBeenCalledWith(msg);
  });

  it('defaultModulesRoot 在非 Windows 走 ~/.zenithjoy/modules（graceful fallback，不崩溃）', () => {
    // 仅断言构造不抛异常 + 路径以 modules 结尾
    const mm = new ModuleManager();
    expect(mm.getModulesRoot()).toContain('modules');
    expect(mm.getModuleDir('line04-wechat-cs', '1.0.0')).toContain(
      'line04-wechat-cs-1.0.0',
    );
  });

  it('preflight 通过时 fork 模块并写入 active 列表，发送 config 消息', async () => {
    const dir = path.join(root, 'line04-wechat-cs-2.0.0');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ lineId: 'line04-wechat-cs', version: '2.0.0', entry: 'index.js' }),
    );

    const sent: unknown[] = [];
    const fakeChild = {
      on: vi.fn(),
      send: vi.fn((m: unknown) => sent.push(m)),
      connected: true,
    } as unknown as import('node:child_process').ChildProcess;

    const forkImpl = vi.fn().mockReturnValue(fakeChild);
    const preflightImpl = vi.fn().mockResolvedValue({ ok: true });
    const mm = new ModuleManager({
      modulesRoot: root,
      forkImpl,
      preflightImpl,
      agentId: 'agent-xyz',
      apiBase: 'https://api.zenithjoy.com',
    });

    await mm.syncModules({
      'line04-wechat-cs': { status: 'active', required_version: '2.0.0' },
    });

    expect(forkImpl).toHaveBeenCalledTimes(1);
    expect(mm.getActiveModules()).toEqual(['line04-wechat-cs']);
    expect(sent).toContainEqual({
      type: 'config',
      agentId: 'agent-xyz',
      apiBase: 'https://api.zenithjoy.com',
    });
  });

  it('syncModules 有新版本时先 kill 旧模块 fork 再激活新版（防崩溃自愈重启旧版）', async () => {
    // 回归：旧模块 index.js fork 活着时 active.has=true → 跳过激活 → 旧 index.js 自愈重启旧 listen_chat.py
    // 修复：needsDownload=true 时先 kill 旧 fork，确保新版本被激活

    // 只建 1.0.7 目录（旧版已安装）；1.0.8 由 downloadImpl 创建，模拟真实下载
    const oldDir = path.join(root, 'line04-wechat-cs-1.0.7');
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(
      path.join(oldDir, 'manifest.json'),
      JSON.stringify({ lineId: 'line04-wechat-cs', version: '1.0.7', entry: 'index.js' }),
    );

    const killSpy = vi.fn();
    const oldChild = {
      kill: killSpy,
      on: vi.fn(),
      send: vi.fn(),
      connected: true,
    } as unknown as import('node:child_process').ChildProcess;

    const newChild = {
      kill: vi.fn(),
      on: vi.fn(),
      send: vi.fn(),
      connected: true,
    } as unknown as import('node:child_process').ChildProcess;

    const forkImpl = vi.fn().mockReturnValue(newChild);
    // downloadImpl 模拟真实下载：实际创建 1.0.8 目录 + manifest + index.js
    const downloadImpl = vi.fn().mockImplementation(async (_lineId: string, version: string, _url: string, destDir: string) => {
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(path.join(destDir, 'manifest.json'),
        JSON.stringify({ lineId: 'line04-wechat-cs', version, entry: 'index.js' }));
      fs.writeFileSync(path.join(destDir, 'index.js'), '');
    });
    const preflightImpl = vi.fn().mockResolvedValue({ ok: true });
    const mm = new ModuleManager({ modulesRoot: root, forkImpl, downloadImpl, preflightImpl });

    // 模拟 1.0.7 已激活：直接往 active map 写旧 child（绕过 syncModules 的安装检查）
    // @ts-expect-error accessing private field for test setup
    mm.active.set('line04-wechat-cs', oldChild);

    // 现在心跳带 required_version=1.0.8 → 触发升级
    await mm.syncModules({
      'line04-wechat-cs': { status: 'active', required_version: '1.0.8' },
    });

    // 旧 fork 必须被 kill
    expect(killSpy).toHaveBeenCalledTimes(1);
    // 新版本必须被 fork（激活）
    expect(forkImpl).toHaveBeenCalledTimes(1);
    // 新版本在 active 列表
    expect(mm.getActiveModules()).toContain('line04-wechat-cs');
  });

  it('runModulePreflight execFile 传 ZENITHJOY_CORE_DIR（客户机无系统 python 时能用 core embedded python）', async () => {
    // 回归：execFile 不传 ZENITHJOY_CORE_DIR → getModulePython 回退系统 python
    // → 无系统 python 的客户机 exit 9009 → 模块永不激活（preflight 一直 fail）
    const dir = path.join(root, 'line04-wechat-cs-6.0.0');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ lineId: 'line04-wechat-cs', version: '6.0.0', entry: 'index.js' }),
    );
    fs.writeFileSync(path.join(dir, 'preflight.js'), '');

    let capturedEnv: Record<string, string | undefined> | undefined;
    const execFileImpl = vi.fn().mockImplementation(
      (_cmd: unknown, _args: unknown, opts: { env?: Record<string, string> }, cb: (e: null, out: string, err: string) => void) => {
        capturedEnv = opts?.env;
        cb(null, JSON.stringify({ ok: true }), '');
      },
    );

    const mm = new ModuleManager({ modulesRoot: root, execFileImpl });
    await mm.runModulePreflight('line04-wechat-cs');

    expect(capturedEnv?.ZENITHJOY_CORE_DIR).toBeDefined();
  });

  it('getInstalledVersion semver 排序：1.0.12 > 1.0.9（数值比较，非字典序）', () => {
    // 回归：dirs.sort() 字典序时 "1.0.9" > "1.0.12"（因 '9' > '1'）
    // → getInstalledVersion 返回 "1.0.9" 而非正确的 "1.0.12"
    // → needsDownload("line04-wechat-cs", "1.0.12") = true → 每次心跳都下载覆盖文件
    const prefix = 'line04-wechat-cs-';
    for (const v of ['1.0.9', '1.0.12']) {
      const dir = path.join(root, `${prefix}${v}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'manifest.json'),
        JSON.stringify({ lineId: 'line04-wechat-cs', version: v, entry: 'index.js' }),
      );
    }

    const mm = new ModuleManager({ modulesRoot: root });
    expect(mm.getInstalledVersion('line04-wechat-cs')).toBe('1.0.12');
    expect(mm.needsDownload('line04-wechat-cs', '1.0.12')).toBe(false);
  });

  // ── 回归：并发 preflight 保护 ──────────────────────────────────────────────
  // 根因：WeChat 安装耗时 2-5 分钟，心跳每 30s 调一次 syncModules，
  //   若无保护会并发启动多个 preflight 进程，互相干扰导致安装失败或日志混乱。
  // 修法：preflightRunning Set 跟踪进行中的 lineId，第二次调用直接返回
  //   {ok: false, reason: 'preflight_already_running'} 而不启动新进程。
  describe('runModulePreflight — 并发保护', () => {
    it('同一 lineId 并发调用时第二次立即返回 preflight_already_running，不启动第二个进程', async () => {
      let concurrentCalls = 0;
      let maxConcurrent = 0;

      const mm = new ModuleManager({
        modulesRoot: root,
        preflightImpl: async (_lineId, _dir) => {
          concurrentCalls++;
          maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
          await new Promise((r) => setTimeout(r, 80));
          concurrentCalls--;
          return { ok: true };
        },
      });

      // 建一个假安装目录让 getInstalledVersion 能返回版本
      const modDir = path.join(root, 'line04-wechat-cs-1.0.0');
      fs.mkdirSync(modDir, { recursive: true });
      fs.writeFileSync(
        path.join(modDir, 'manifest.json'),
        JSON.stringify({ lineId: 'line04-wechat-cs', version: '1.0.0', entry: 'index.js' }),
      );

      // 两次并发调用
      const [r1, r2] = await Promise.all([
        mm.runModulePreflight('line04-wechat-cs'),
        mm.runModulePreflight('line04-wechat-cs'),
      ]);

      // 只有一个真正执行，另一个返回 preflight_already_running
      expect(maxConcurrent).toBe(1);
      const results = [r1, r2];
      const running = results.filter((r) => r.reason === 'preflight_already_running');
      const ok = results.filter((r) => r.ok === true);
      expect(running).toHaveLength(1);
      expect(ok).toHaveLength(1);
    });

    it('第一次 preflight 结束后，同一 lineId 可以再次正常运行', async () => {
      let callCount = 0;
      const mm = new ModuleManager({
        modulesRoot: root,
        preflightImpl: async () => {
          callCount++;
          return { ok: true };
        },
      });

      const modDir = path.join(root, 'line04-wechat-cs-1.0.0');
      fs.mkdirSync(modDir, { recursive: true });
      fs.writeFileSync(
        path.join(modDir, 'manifest.json'),
        JSON.stringify({ lineId: 'line04-wechat-cs', version: '1.0.0', entry: 'index.js' }),
      );

      await mm.runModulePreflight('line04-wechat-cs');
      await mm.runModulePreflight('line04-wechat-cs');
      expect(callCount).toBe(2);
    });
  });

  // ── 回归：preflight 是「激活门禁」而非周期健康检查 ──────────────────────────
  // 根因：syncModules 每次心跳（~30s）无条件调 runModulePreflight，即便模块已激活
  //   (active.has=true) 且版本一致 (needsDownload=false)。preflight → spawn preflight.js
  //   → checkVerifySilent() → spawn listen_chat.py --verify-silent → 激活 UIA 碰微信窗口，
  //   用户体感「自检每 30s 抢键盘」。
  // 修法：已激活 + 版本一致 → 跳过 runModulePreflight，保持激活态不动；
  //   只在「未激活 或 需升级」时才跑 preflight + 激活逻辑。
  describe('preflight gating — 已激活+版本一致不重跑（根治 verify-silent 抢键盘）', () => {
    it('模块已激活且版本一致时 syncModules 不重跑 runModulePreflight', async () => {
      const dir = path.join(root, 'line04-wechat-cs-1.0.0');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'manifest.json'),
        JSON.stringify({ lineId: 'line04-wechat-cs', version: '1.0.0', entry: 'index.js' }),
      );

      const preflightImpl = vi.fn().mockResolvedValue({ ok: true });
      const downloadImpl = vi.fn();
      const mm = new ModuleManager({ modulesRoot: root, preflightImpl, downloadImpl });

      // 模拟模块已激活：直接往 active map 写一个假 child（绕过 fork 检查）
      // @ts-expect-error accessing private field for test setup
      mm.active.set('line04-wechat-cs', {
        kill: vi.fn(), on: vi.fn(), send: vi.fn(), connected: true,
      } as unknown as import('node:child_process').ChildProcess);

      // 心跳 required_version 与已安装一致 → needsDownload=false
      await mm.syncModules({
        'line04-wechat-cs': { status: 'active', required_version: '1.0.0' },
      });

      // 核心断言：已激活 + 版本一致 → 不应重跑 preflight（不 spawn verify-silent 抢窗口）
      expect(preflightImpl).not.toHaveBeenCalled();
      expect(downloadImpl).not.toHaveBeenCalled();
      // 模块保持激活态不动
      expect(mm.getActiveModules()).toContain('line04-wechat-cs');
    });

    it('对照：模块未激活时仍跑一次 preflight 并激活（门禁照常生效）', async () => {
      const dir = path.join(root, 'line04-wechat-cs-1.0.0');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'manifest.json'),
        JSON.stringify({ lineId: 'line04-wechat-cs', version: '1.0.0', entry: 'index.js' }),
      );
      fs.writeFileSync(path.join(dir, 'index.js'), '');

      const preflightImpl = vi.fn().mockResolvedValue({ ok: true });
      const forkImpl = vi.fn().mockReturnValue({
        kill: vi.fn(), on: vi.fn(), send: vi.fn(), connected: true,
      } as unknown as import('node:child_process').ChildProcess);
      const mm = new ModuleManager({ modulesRoot: root, preflightImpl, forkImpl });

      await mm.syncModules({
        'line04-wechat-cs': { status: 'active', required_version: '1.0.0' },
      });

      // 未激活 → preflight 跑一次完成首次门禁 + 激活
      expect(preflightImpl).toHaveBeenCalledTimes(1);
      expect(mm.getActiveModules()).toContain('line04-wechat-cs');
    });
  });

  // ── 回归：OTA 自升级残缺目录毒化（卡 1.0.62 真因）─────────────────────────
  // 根因：downloadModule 下载/解压失败留下空/残缺版本目录（COS 跨境 CDN 抖动常见），
  //   getInstalledVersion 只按目录名排序取最大、不校验内容 → 空 1.0.70 目录被当
  //   「已装最新」→ needsDownload 永久 false 不再重试 + preflight 永久 fail 永不激活 → 卡旧版。
  // 修法：getInstalledVersion 只认含 manifest.json 的完整目录（残缺目录视为未安装，自愈重下）
  //   + downloadModule 原子安装（staging→校验→rename→失败回滚），绝不在正式目录留半成品。
  describe('OTA 残缺目录毒化自愈', () => {
    it('getInstalledVersion 忽略无 manifest 的残缺版本目录，返回较低的完整版本', () => {
      // 残缺的 1.0.70（空目录，无 manifest）+ 完整的 1.0.62
      fs.mkdirSync(path.join(root, 'line04-wechat-cs-1.0.70'), { recursive: true });
      const okDir = path.join(root, 'line04-wechat-cs-1.0.62');
      fs.mkdirSync(okDir, { recursive: true });
      fs.writeFileSync(
        path.join(okDir, 'manifest.json'),
        JSON.stringify({ lineId: 'line04-wechat-cs', version: '1.0.62', entry: 'index.js' }),
      );

      const mm = new ModuleManager({ modulesRoot: root });
      // 残缺 1.0.70 不算已装 → 返回完整的 1.0.62
      expect(mm.getInstalledVersion('line04-wechat-cs')).toBe('1.0.62');
      // 因而仍需要下载 1.0.70（不被毒化目录 latch 成 false）
      expect(mm.needsDownload('line04-wechat-cs', '1.0.70')).toBe(true);
    });

    it('下载留下残缺（空）目录时不被 latch：needsDownload 仍 true 且不留毒化目录', async () => {
      // downloadImpl 模拟失败：只 mkdir 空目录，不写 manifest（真实 COS 抖动/解压中断的产物）
      const downloadImpl = vi.fn().mockImplementation(
        async (_l: string, _v: string, _u: string, destDir: string) => {
          fs.mkdirSync(destDir, { recursive: true });
        },
      );
      const mm = new ModuleManager({ modulesRoot: root, downloadImpl });

      await mm.syncModules({
        'line04-wechat-cs': { status: 'active', required_version: '1.0.70' },
      });

      // 残缺安装不能被当成功 → 下次心跳仍需重下
      expect(mm.needsDownload('line04-wechat-cs', '1.0.70')).toBe(true);
      // 原子性：失败回滚，正式目录不得残留半成品
      expect(fs.existsSync(path.join(root, 'line04-wechat-cs-1.0.70'))).toBe(false);
    });

    it('瞬时下载失败后下一次心跳自愈：最终装到 required 版本并激活', async () => {
      let attempt = 0;
      const downloadImpl = vi.fn().mockImplementation(
        async (_l: string, version: string, _u: string, destDir: string) => {
          attempt++;
          if (attempt === 1) {
            // 第一次：残缺（空目录），模拟 COS 抖动
            fs.mkdirSync(destDir, { recursive: true });
            return;
          }
          // 第二次：完整下载
          fs.mkdirSync(destDir, { recursive: true });
          fs.writeFileSync(
            path.join(destDir, 'manifest.json'),
            JSON.stringify({ lineId: 'line04-wechat-cs', version, entry: 'index.js' }),
          );
          fs.writeFileSync(path.join(destDir, 'index.js'), '');
        },
      );
      const forkImpl = vi.fn().mockReturnValue({
        kill: vi.fn(), on: vi.fn(), send: vi.fn(), connected: true,
      } as unknown as import('node:child_process').ChildProcess);
      const preflightImpl = vi.fn().mockResolvedValue({ ok: true });
      const mm = new ModuleManager({ modulesRoot: root, downloadImpl, forkImpl, preflightImpl });

      // 第一次心跳：下载残缺 → 不应 latch
      await mm.syncModules({ 'line04-wechat-cs': { status: 'active', required_version: '1.0.70' } });
      expect(mm.needsDownload('line04-wechat-cs', '1.0.70')).toBe(true);

      // 第二次心跳：自愈重下成功 → 装到 1.0.70 + 激活
      await mm.syncModules({ 'line04-wechat-cs': { status: 'active', required_version: '1.0.70' } });
      expect(mm.getInstalledVersion('line04-wechat-cs')).toBe('1.0.70');
      expect(mm.getActiveModules()).toContain('line04-wechat-cs');
    });
  });
});
