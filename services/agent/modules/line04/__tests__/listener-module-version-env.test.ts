import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _listenerKillFuncs, startWechatListener, getModuleVersion } from '../handlers/wechat-rpa';

describe('startWechatListener — spawn env 注入模块版本（Phase 0 观测）', () => {
  let origSpawnFn: typeof _listenerKillFuncs.spawnFn;
  let origPlatform: string;
  let origKill: typeof _listenerKillFuncs.killExistingListeners;

  beforeEach(() => {
    origSpawnFn = _listenerKillFuncs.spawnFn;
    origPlatform = _listenerKillFuncs.platform;
    origKill = _listenerKillFuncs.killExistingListeners;
    _listenerKillFuncs.platform = 'win32';
    _listenerKillFuncs.killExistingListeners = () => {};
  });
  afterEach(() => {
    _listenerKillFuncs.spawnFn = origSpawnFn;
    _listenerKillFuncs.platform = origPlatform;
    _listenerKillFuncs.killExistingListeners = origKill;
  });

  function captureSpawnEnv(): () => Record<string, string | undefined> | undefined {
    let captured: Record<string, string | undefined> | undefined;
    _listenerKillFuncs.spawnFn = vi.fn((_cmd: string, _args: string[], opts: { env?: Record<string, string | undefined> }) => {
      captured = opts?.env;
      return { stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, on: vi.fn() } as unknown as ReturnType<typeof _listenerKillFuncs.spawnFn>;
    }) as unknown as typeof _listenerKillFuncs.spawnFn;
    return () => captured;
  }

  it('getModuleVersion 返回 manifest.json 的版本（非 unknown）', () => {
    expect(getModuleVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('spawn listen_chat 的 env 含 ZENITHJOY_MODULE_VERSION=manifest 版本', () => {
    const getEnv = captureSpawnEnv();
    startWechatListener('http://localhost:3000', 'test-agent');
    const env = getEnv();
    expect(env).toBeDefined();
    expect(env!.ZENITHJOY_MODULE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
