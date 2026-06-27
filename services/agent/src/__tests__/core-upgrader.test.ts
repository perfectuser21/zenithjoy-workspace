// services/agent/src/__tests__/core-upgrader.test.ts
//
// Sprint 06222100 — Agent 核心自升级（CoreUpgrader）单测（TDD commit-1 红）
//
// 根治"客户机 Agent 核心不自升级"：心跳收到 required_agent_version > 自身版本时，
// CoreUpgrader 从 COS 下载新核心包 → sha 校验 → 解压到 extracted/zenithjoy-agent-v<ver>
// → 拷过 .env/license/已下模块 → 写 .active-core 指针 → 触发优雅退出（由启动器拉起新核心）。
//
// 设计取舍（照 module-manager 成熟模式）：
//   - download/extract/sha/exit 全部 try/catch，失败回滚到旧核心，绝不把客户机搞挂
//   - download/exit 通过 options 注入，便于单测（不打真实网络/不真退出）

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { CoreUpgrader, compareSemver } from '../core-upgrader';

describe('compareSemver', () => {
  it('required > current → 正', () => {
    expect(compareSemver('2.0.22', '2.0.21')).toBeGreaterThan(0);
    expect(compareSemver('2.1.0', '2.0.99')).toBeGreaterThan(0);
    expect(compareSemver('3.0.0', '2.9.9')).toBeGreaterThan(0);
  });
  it('required == current → 0', () => {
    expect(compareSemver('2.0.21', '2.0.21')).toBe(0);
  });
  it('required < current → 负', () => {
    expect(compareSemver('2.0.20', '2.0.21')).toBeLessThan(0);
    expect(compareSemver('1.9.9', '2.0.0')).toBeLessThan(0);
  });
  it('段数不齐也按数字比（2.0 vs 2.0.1）', () => {
    expect(compareSemver('2.0', '2.0.1')).toBeLessThan(0);
    expect(compareSemver('2.0.1', '2.0')).toBeGreaterThan(0);
  });
});

describe('CoreUpgrader', () => {
  let root: string; // 模拟客户机 C:\zenithjoy-prod 根
  let coreDir: string; // 当前运行核心目录 extracted/zenithjoy-agent-v2.0.21

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-coretest-'));
    coreDir = path.join(root, 'extracted', 'zenithjoy-agent-v2.0.21');
    fs.mkdirSync(coreDir, { recursive: true });
    // 当前核心目录里有 .env + license + modules（升级时要拷过去）
    fs.writeFileSync(path.join(coreDir, '.env'), 'ZENITHJOY_LICENSE=ZJ-REAL-KEY\n');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('needsUpgrade：required > current → true，<= → false', () => {
    const up = new CoreUpgrader({ currentVersion: '2.0.21', coreDir });
    expect(up.needsUpgrade('2.0.22')).toBe(true);
    expect(up.needsUpgrade('2.0.21')).toBe(false);
    expect(up.needsUpgrade('2.0.20')).toBe(false);
  });

  it('needsUpgrade：非法/空版本号 → false（不误触发）', () => {
    const up = new CoreUpgrader({ currentVersion: '2.0.21', coreDir });
    expect(up.needsUpgrade('')).toBe(false);
    expect(up.needsUpgrade(undefined as unknown as string)).toBe(false);
    expect(up.needsUpgrade('latest')).toBe(false);
  });

  it('buildCosUrl：核心包路径 = install-pack/zenithjoy-agent-v<ver>.tar.gz', () => {
    const up = new CoreUpgrader({ currentVersion: '2.0.21', coreDir });
    expect(up.buildCosUrl('2.0.22')).toContain('zenithjoy-agent-v2.0.22.tar.gz');
    expect(up.buildCosUrl('2.0.22')).toContain('install-pack');
  });

  it('upgradeIfNeeded：required <= current → 不下载不退出', async () => {
    const downloadImpl = vi.fn().mockResolvedValue(undefined);
    const exitImpl = vi.fn();
    const up = new CoreUpgrader({
      currentVersion: '2.0.21',
      coreDir,
      downloadImpl,
      exitImpl,
    });
    const r = await up.upgradeIfNeeded('2.0.21');
    expect(r.upgraded).toBe(false);
    expect(downloadImpl).not.toHaveBeenCalled();
    expect(exitImpl).not.toHaveBeenCalled();
  });

  it('upgradeIfNeeded：required > current → 下载 → 校验 → 写指针 → 优雅退出', async () => {
    const newVer = '2.0.22';
    const newCoreDir = path.join(root, 'extracted', `zenithjoy-agent-v${newVer}`);
    // downloadImpl 模拟真解压：往目标目录写一个 zenithjoy-agent.exe
    const downloadImpl = vi.fn(async (_ver: string, _url: string, destDir: string) => {
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(path.join(destDir, 'zenithjoy-agent.exe'), 'NEW-CORE-BINARY');
      fs.writeFileSync(path.join(destDir, 'start.bat'), '@echo new');
    });
    const exitImpl = vi.fn();
    const up = new CoreUpgrader({
      currentVersion: '2.0.21',
      coreDir,
      downloadImpl,
      exitImpl,
    });

    const r = await up.upgradeIfNeeded(newVer);

    expect(r.upgraded).toBe(true);
    expect(downloadImpl).toHaveBeenCalledTimes(1);
    // 新核心解压到 extracted/zenithjoy-agent-v2.0.22
    expect(fs.existsSync(path.join(newCoreDir, 'zenithjoy-agent.exe'))).toBe(true);
    // .env 已从旧核心拷过去
    expect(fs.readFileSync(path.join(newCoreDir, '.env'), 'utf-8')).toContain('ZJ-REAL-KEY');
    // .active-core 指针写到 root（启动器读它选最新核心目录）
    const pointer = fs.readFileSync(path.join(root, '.active-core'), 'utf-8').trim();
    expect(pointer).toBe(`zenithjoy-agent-v${newVer}`);
    // 优雅退出被触发（由启动器拉起新核心）
    expect(exitImpl).toHaveBeenCalledTimes(1);
  });

  // ── 身份统一（cp-06270030）：自升级必须把 %APPDATA%/zenithjoy-agent/config.json
  //    （含 apiUrl + agentUuid + agentId）带到新核心可读处，否则新核心拿不到 apiBase
  //    → 静默回落生产 / 重新 register 裂身份。 ──
  it('upgradeIfNeeded：carry-over 把 config.json（含 apiUrl/agentUuid）带到新核心目录', async () => {
    const newVer = '2.0.22';
    const newCoreDir = path.join(root, 'extracted', `zenithjoy-agent-v${newVer}`);
    // 模拟客户机 %APPDATA%/zenithjoy-agent/config.json
    const appdata = path.join(root, 'appdata');
    const cfgDir = path.join(appdata, 'zenithjoy-agent');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      path.join(cfgDir, 'config.json'),
      JSON.stringify({
        licenseKey: 'ZJ-REAL-KEY',
        agentId: 'agent-stable',
        agentUuid: 'uuid-from-register',
        apiUrl: 'wss://api.staging.test/agent-ws',
        loggedInAt: 0,
      })
    );

    const downloadImpl = vi.fn(async (_ver: string, _url: string, destDir: string) => {
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(path.join(destDir, 'zenithjoy-agent.exe'), 'NEW-CORE-BINARY');
    });
    const exitImpl = vi.fn();
    const up = new CoreUpgrader({
      currentVersion: '2.0.21',
      coreDir,
      configDir: cfgDir, // 注入测试用 config 目录
      downloadImpl,
      exitImpl,
    });

    const r = await up.upgradeIfNeeded(newVer);

    expect(r.upgraded).toBe(true);
    // config.json 已带到新核心目录，新核心据此拿到 apiUrl + agentUuid，不会回落生产
    const carried = path.join(newCoreDir, 'config.json');
    expect(fs.existsSync(carried)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(carried, 'utf-8'));
    expect(parsed.apiUrl).toBe('wss://api.staging.test/agent-ws');
    expect(parsed.agentUuid).toBe('uuid-from-register');
  });

  it('upgradeIfNeeded：sha 校验注入失败 → 回滚（不写指针、不退出）', async () => {
    const newVer = '2.0.22';
    const downloadImpl = vi.fn(async (_ver: string, _url: string, destDir: string) => {
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(path.join(destDir, 'zenithjoy-agent.exe'), 'TAMPERED');
    });
    const exitImpl = vi.fn();
    const up = new CoreUpgrader({
      currentVersion: '2.0.21',
      coreDir,
      downloadImpl,
      // verifyImpl 返回 false 模拟 sha 不符
      verifyImpl: vi.fn().mockResolvedValue(false),
      exitImpl,
    });

    const r = await up.upgradeIfNeeded(newVer, { sha256: 'deadbeef', size: 123 });

    expect(r.upgraded).toBe(false);
    expect(r.reason).toMatch(/校验|verify|sha/i);
    // 校验失败 → 绝不写指针、绝不退出（防把客户机切到坏核心）
    expect(fs.existsSync(path.join(root, '.active-core'))).toBe(false);
    expect(exitImpl).not.toHaveBeenCalled();
  });

  it('upgradeIfNeeded：下载抛错 → 不写指针、不退出（回滚旧核心）', async () => {
    const downloadImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const exitImpl = vi.fn();
    const up = new CoreUpgrader({
      currentVersion: '2.0.21',
      coreDir,
      downloadImpl,
      exitImpl,
    });
    const r = await up.upgradeIfNeeded('2.0.22');
    expect(r.upgraded).toBe(false);
    expect(fs.existsSync(path.join(root, '.active-core'))).toBe(false);
    expect(exitImpl).not.toHaveBeenCalled();
  });

  it('upgradeIfNeeded：同一次只升一次（升级中再来心跳不重复下载）', async () => {
    const downloadImpl = vi.fn(async (_ver: string, _url: string, destDir: string) => {
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(path.join(destDir, 'zenithjoy-agent.exe'), 'NEW');
    });
    const exitImpl = vi.fn();
    const up = new CoreUpgrader({
      currentVersion: '2.0.21',
      coreDir,
      downloadImpl,
      exitImpl,
    });
    await Promise.all([up.upgradeIfNeeded('2.0.22'), up.upgradeIfNeeded('2.0.22')]);
    expect(downloadImpl).toHaveBeenCalledTimes(1);
  });

  it('verifyFile（真实 sha 校验）：sha 一致 → true，不一致 → false', async () => {
    const up = new CoreUpgrader({ currentVersion: '2.0.21', coreDir });
    const tmpFile = path.join(root, 'pack.tar.gz');
    fs.writeFileSync(tmpFile, 'hello-core-pack');
    const realSha = crypto.createHash('sha256').update('hello-core-pack').digest('hex');
    expect(await up.verifyFile(tmpFile, { sha256: realSha })).toBe(true);
    expect(await up.verifyFile(tmpFile, { sha256: 'wrong' })).toBe(false);
    // size 也校验
    const sz = fs.statSync(tmpFile).size;
    expect(await up.verifyFile(tmpFile, { sha256: realSha, size: sz })).toBe(true);
    expect(await up.verifyFile(tmpFile, { sha256: realSha, size: sz + 1 })).toBe(false);
  });

  // ── Sprint cp-06261900：观测上报接进升级各阶段 ──
  it('成功升级路径上报 upgrade 各阶段（download→verify→extract→activate→done）', async () => {
    const downloadImpl = vi.fn(async (_ver: string, _url: string, destDir: string) => {
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(path.join(destDir, 'zenithjoy-agent.exe'), 'NEW');
    });
    const exitImpl = vi.fn();
    const reportImpl = vi.fn(async (_cfg: any, _event: any) => undefined);
    const up = new CoreUpgrader({
      currentVersion: '2.0.21',
      coreDir,
      downloadImpl,
      exitImpl,
      reporter: { apiBase: 'https://api.x', license: 'K', agentId: 'a1' },
      reportImpl,
    });
    const r = await up.upgradeIfNeeded('2.0.22');
    expect(r.upgraded).toBe(true);

    const phases = reportImpl.mock.calls
      .map((c) => c[1])
      .filter((e: any) => e.kind === 'upgrade')
      .map((e: any) => e.phase);
    expect(phases).toContain('download');
    expect(phases).toContain('verify');
    expect(phases).toContain('extract');
    expect(phases).toContain('activate');
    expect(phases).toContain('done');
  });

  it('下载失败路径上报 upgrade=failed + log=error，且不崩升级（仍正常回滚）', async () => {
    const downloadImpl = vi.fn(async () => {
      throw new Error('cos 502');
    });
    const exitImpl = vi.fn();
    const reportImpl = vi.fn(async (_cfg: any, _event: any) => undefined);
    const up = new CoreUpgrader({
      currentVersion: '2.0.21',
      coreDir,
      downloadImpl,
      exitImpl,
      reporter: { apiBase: 'https://api.x', license: 'K', agentId: 'a1' },
      reportImpl,
    });
    const r = await up.upgradeIfNeeded('2.0.22');
    expect(r.upgraded).toBe(false);
    expect(exitImpl).not.toHaveBeenCalled();

    const events = reportImpl.mock.calls.map((c) => c[1]);
    expect(events.some((e: any) => e.kind === 'upgrade' && e.phase === 'failed')).toBe(true);
    expect(events.some((e: any) => e.kind === 'log' && e.level === 'error')).toBe(true);
  });

  it('reportImpl 抛错也不影响升级主流程（观测旁路静默）', async () => {
    const downloadImpl = vi.fn(async (_ver: string, _url: string, destDir: string) => {
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(path.join(destDir, 'zenithjoy-agent.exe'), 'NEW');
    });
    const exitImpl = vi.fn();
    const reportImpl = vi.fn(async () => {
      throw new Error('report boom');
    });
    const up = new CoreUpgrader({
      currentVersion: '2.0.21',
      coreDir,
      downloadImpl,
      exitImpl,
      reporter: { apiBase: 'https://api.x', license: 'K', agentId: 'a1' },
      reportImpl,
    });
    const r = await up.upgradeIfNeeded('2.0.22');
    expect(r.upgraded).toBe(true);
    expect(exitImpl).toHaveBeenCalled();
  });

  it('无 reporter 配置 → 不上报（向后兼容）', async () => {
    const downloadImpl = vi.fn(async (_ver: string, _url: string, destDir: string) => {
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(path.join(destDir, 'zenithjoy-agent.exe'), 'NEW');
    });
    const reportImpl = vi.fn(async (_cfg: any, _event: any) => undefined);
    const up = new CoreUpgrader({
      currentVersion: '2.0.21',
      coreDir,
      downloadImpl,
      exitImpl: vi.fn(),
      reportImpl, // 提供 impl 但不提供 reporter → 不应被调用
    });
    await up.upgradeIfNeeded('2.0.22');
    expect(reportImpl).not.toHaveBeenCalled();
  });
});
