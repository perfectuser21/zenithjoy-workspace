import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('agent loadOrInitConfig — Sprint 2.1f Fix 6 envOrConfig', () => {
  const ENV_VARS_TO_RESTORE = [
    'ZENITHJOY_LICENSE',
    'ZENITHJOY_API_BASE',
    'ZENITHJOY_API_URL',
    'ZENITHJOY_CHROME_DEBUG_PORT',
    'APPDATA',
    'HOME',
  ];
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    ENV_VARS_TO_RESTORE.forEach((k) => (original[k] = process.env[k]));
    // 清空 env，让每个 case 自己控制
    delete process.env.ZENITHJOY_LICENSE;
    delete process.env.ZENITHJOY_API_BASE;
    delete process.env.ZENITHJOY_API_URL;
    delete process.env.ZENITHJOY_CHROME_DEBUG_PORT;
    // 隔离 APPDATA 到临时目录，避免污染真实 config
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-agent-test-'));
    process.env.APPDATA = tmp;
    process.env.HOME = tmp;
    vi.resetModules();
  });

  afterEach(() => {
    ENV_VARS_TO_RESTORE.forEach((k) => {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    });
  });

  it('设了 ZENITHJOY_LICENSE env → loadOrInitConfig 返此 license，不读 config.json', async () => {
    process.env.ZENITHJOY_LICENSE = 'ZJ-F-XXXXXXXX';
    process.env.ZENITHJOY_API_URL = 'wss://api.test.com/agent-ws';
    const readSpy = vi.spyOn(fs, 'readFileSync');

    const mod = await import('../config-loader'); // Task 4 要新建该模块
    const cfg = mod.loadOrInitConfig();

    expect(cfg.licenseKey).toBe('ZJ-F-XXXXXXXX');
    // readFileSync 不应该被调用读 config.json（其他读没关系）
    const calls = readSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((p) => p.endsWith('config.json'))).toBe(false);
  });

  it('未设 env，但 %APPDATA%/zenithjoy-agent/config.json 存在 → fallback 读 config.json', async () => {
    const cfgDir = path.join(process.env.APPDATA!, 'zenithjoy-agent');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      path.join(cfgDir, 'config.json'),
      JSON.stringify({
        licenseKey: 'ZJ-F-FROMCONF',
        agentId: 'agent-test',
        apiUrl: 'wss://api.test.com/agent-ws',
        loggedInAt: 0,
      })
    );

    const mod = await import('../config-loader');
    const cfg = mod.loadOrInitConfig();
    expect(cfg.licenseKey).toBe('ZJ-F-FROMCONF');
  });

  it('env 和 config 都没 → 抛错告知去检查 .env / 重装 install pack', async () => {
    const mod = await import('../config-loader');
    expect(() => mod.loadOrInitConfig()).toThrowError(/ZENITHJOY_LICENSE|install pack|.env/i);
  });
});
