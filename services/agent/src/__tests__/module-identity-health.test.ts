// services/agent/src/__tests__/module-identity-health.test.ts
//
// Sprint 06221906 — agent 自愈件 3（身份一处定）+ 件 4（自检上报增强）的 core 侧验证。
//
// 件 3：activateModule 下发的 config.agentId 必须是注册得到的稳定 UUID（agents.id），
//       不是会漂移的 env-id；这样 listen_chat --agent-id 出站入队/拉取同一身份。
// 件 4：模块通过 IPC 上报 {type:'status'/'health', ...} 的真实健康（listen_chat 进程在不在/
//       found_window/最近一次成功送达）必须被 core 纳入 getModuleStatusReport()，随心跳上报。

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { ModuleManager } from '../module-manager';

function installModule(root: string, version = '1.0.0'): void {
  const dir = path.join(root, `line04-wechat-cs-${version}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ lineId: 'line04-wechat-cs', version, entry: 'index.js' }),
  );
  fs.writeFileSync(path.join(dir, 'index.js'), '');
}

function makeIpcChild(): {
  child: import('node:child_process').ChildProcess;
  emitMessage: (m: unknown) => void;
  sent: unknown[];
} {
  const ee = new EventEmitter();
  const sent: unknown[] = [];
  const child = {
    on: (ev: string, cb: (...a: unknown[]) => void) => ee.on(ev, cb),
    send: (m: unknown) => { sent.push(m); },
    kill: vi.fn(),
    connected: true,
  } as unknown as import('node:child_process').ChildProcess;
  return { child, emitMessage: (m: unknown) => ee.emit('message', m), sent };
}

describe('ModuleManager — 身份一处定（UUID）', () => {
  function mkRoot(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'zj-identity-'));
  }

  it('setIdentity 写入稳定 UUID 后，activateModule 下发的 config.agentId 是该 UUID', async () => {
    const root = mkRoot();
    installModule(root);
    const c = makeIpcChild();
    const mm = new ModuleManager({
      modulesRoot: root,
      forkImpl: () => c.child,
      preflightImpl: async () => ({ ok: true }),
    });
    // env-id 先写入（registerNode 前），随后注册拿到稳定 UUID 覆盖
    mm.setIdentity('agent-hostname-abc123', 'https://api.zenithjoy.com');
    mm.setIdentity('11111111-2222-3333-4444-555555555555', 'https://api.zenithjoy.com');

    await mm.syncModules({ 'line04-wechat-cs': { status: 'active', required_version: '1.0.0' } });

    expect(c.sent).toContainEqual({
      type: 'config',
      agentId: '11111111-2222-3333-4444-555555555555',
      apiBase: 'https://api.zenithjoy.com',
    });
  });
});

describe('ModuleManager — 模块健康自检上报增强', () => {
  function mkRoot(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'zj-modhealth-'));
  }

  it('模块 IPC 上报 status 健康字段后，getModuleStatusReport 含 listen_chat 真实健康', async () => {
    const root = mkRoot();
    installModule(root);
    const c = makeIpcChild();
    const mm = new ModuleManager({
      modulesRoot: root,
      forkImpl: () => c.child,
      preflightImpl: async () => ({ ok: true }),
    });
    await mm.syncModules({ 'line04-wechat-cs': { status: 'active', required_version: '1.0.0' } });

    // 模块上报 listen_chat 真实健康（进程在 + found_window + 最近一次成功送达）
    c.emitMessage({
      type: 'status',
      ok: true,
      listener_alive: true,
      found_window: true,
      last_delivery_ts: 1750000000000,
    });

    const report = mm.getModuleStatusReport()['line04-wechat-cs'];
    expect(report.ok).toBe(true);
    expect(report.listener_alive).toBe(true);
    expect(report.found_window).toBe(true);
    expect(report.last_delivery_ts).toBe(1750000000000);
  });

  it('模块上报 ok:false（listen_chat 挂了）覆盖 preflight 的 ok:true', async () => {
    const root = mkRoot();
    installModule(root);
    const c = makeIpcChild();
    const mm = new ModuleManager({
      modulesRoot: root,
      forkImpl: () => c.child,
      preflightImpl: async () => ({ ok: true }),
    });
    await mm.syncModules({ 'line04-wechat-cs': { status: 'active', required_version: '1.0.0' } });

    c.emitMessage({
      type: 'status',
      ok: false,
      reason: 'listen_chat 进程不在',
      listener_alive: false,
    });

    const report = mm.getModuleStatusReport()['line04-wechat-cs'];
    expect(report.ok).toBe(false);
    expect(report.listener_alive).toBe(false);
    expect(report.reason).toContain('listen_chat');
  });

  it('非 status/health 的 IPC 消息（如 draft_reply）仍通过 onModuleMessage 透传，不污染健康报告', async () => {
    const root = mkRoot();
    installModule(root);
    const c = makeIpcChild();
    const onModuleMessage = vi.fn();
    const mm = new ModuleManager({
      modulesRoot: root,
      forkImpl: () => c.child,
      preflightImpl: async () => ({ ok: true }),
      onModuleMessage,
    });
    await mm.syncModules({ 'line04-wechat-cs': { status: 'active', required_version: '1.0.0' } });

    c.emitMessage({ type: 'draft_reply', messageId: 'm1', draft: 'hi' });

    expect(onModuleMessage).toHaveBeenCalledWith(
      'line04-wechat-cs',
      expect.objectContaining({ type: 'draft_reply' }),
    );
    // 健康报告里仍是 preflight 的结果，没被 draft_reply 改写
    expect(mm.getModuleStatusReport()['line04-wechat-cs'].ok).toBe(true);
  });
});
