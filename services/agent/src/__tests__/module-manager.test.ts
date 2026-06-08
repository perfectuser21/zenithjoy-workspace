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
});
