// modules/line04/__tests__/listener-real-publish-env.test.ts
//
// Sprint 06221906 — agent 自愈件 2：真发开关一处传。
//
// 缺口：长驻 listen_chat（出站给关键人真发）读 REAL_PUBLISH，但模块/agent 配置里用的是
// ZENITHJOY_AGENT_REAL_PUBLISH（与按需 handler handleWechatRpa 注入 REAL_PUBLISH=1 不一致）。
// 修复：startWechatListener spawn listen_chat 时，把 agent 配置的真发开关
// （ZENITHJOY_AGENT_REAL_PUBLISH）显式传成 listen_chat 认的形式（REAL_PUBLISH，配合 #821 兼容两名）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _listenerKillFuncs, startWechatListener, resolveRealPublishEnv } from '../handlers/wechat-rpa';

describe('startWechatListener — 真发开关一处传（spawn env 注入）', () => {
  let origSpawnFn: typeof _listenerKillFuncs.spawnFn;
  let origPlatform: string;
  let origKill: typeof _listenerKillFuncs.killExistingListeners;
  let origReal: string | undefined;
  let origRealAlt: string | undefined;

  beforeEach(() => {
    origSpawnFn = _listenerKillFuncs.spawnFn;
    origPlatform = _listenerKillFuncs.platform;
    origKill = _listenerKillFuncs.killExistingListeners;
    origReal = process.env.ZENITHJOY_AGENT_REAL_PUBLISH;
    origRealAlt = process.env.REAL_PUBLISH;
    _listenerKillFuncs.platform = 'win32';
    _listenerKillFuncs.killExistingListeners = () => {};
    delete process.env.ZENITHJOY_AGENT_REAL_PUBLISH;
    delete process.env.REAL_PUBLISH;
  });

  afterEach(() => {
    _listenerKillFuncs.spawnFn = origSpawnFn;
    _listenerKillFuncs.platform = origPlatform;
    _listenerKillFuncs.killExistingListeners = origKill;
    if (origReal === undefined) delete process.env.ZENITHJOY_AGENT_REAL_PUBLISH;
    else process.env.ZENITHJOY_AGENT_REAL_PUBLISH = origReal;
    if (origRealAlt === undefined) delete process.env.REAL_PUBLISH;
    else process.env.REAL_PUBLISH = origRealAlt;
  });

  function captureSpawnEnv(): () => Record<string, string | undefined> | undefined {
    let captured: Record<string, string | undefined> | undefined;
    _listenerKillFuncs.spawnFn = vi.fn((_cmd: string, _args: string[], opts: { env?: Record<string, string | undefined> }) => {
      captured = opts?.env;
      return {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
      } as unknown as ReturnType<typeof _listenerKillFuncs.spawnFn>;
    }) as unknown as typeof _listenerKillFuncs.spawnFn;
    return () => captured;
  }

  it('ZENITHJOY_AGENT_REAL_PUBLISH=1 时，spawn listen_chat 的 env 含 REAL_PUBLISH=1', () => {
    process.env.ZENITHJOY_AGENT_REAL_PUBLISH = '1';
    const getEnv = captureSpawnEnv();

    startWechatListener('http://localhost:3000', 'test-agent');

    const env = getEnv();
    expect(env).toBeDefined();
    expect(env!.REAL_PUBLISH).toBe('1');
    // 同时保留新名，配合 #821 兼容两名
    expect(env!.ZENITHJOY_AGENT_REAL_PUBLISH).toBe('1');
  });

  it('真发开关未开时，REAL_PUBLISH 注入为 0（默认 mock 路径，不误真发）', () => {
    const getEnv = captureSpawnEnv();

    startWechatListener('http://localhost:3000', 'test-agent');

    const env = getEnv();
    expect(env).toBeDefined();
    expect(env!.REAL_PUBLISH).toBe('0');
  });

  it('resolveRealPublishEnv：两个 env 名任一为 1 都视作开启', () => {
    expect(resolveRealPublishEnv({ ZENITHJOY_AGENT_REAL_PUBLISH: '1' })).toBe('1');
    expect(resolveRealPublishEnv({ REAL_PUBLISH: '1' })).toBe('1');
    expect(resolveRealPublishEnv({})).toBe('0');
    expect(resolveRealPublishEnv({ ZENITHJOY_AGENT_REAL_PUBLISH: '0' })).toBe('0');
  });
});
