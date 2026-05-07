// services/agent/src/handlers/__tests__/qr-bind-douyin.test.ts
//
// Walking Skeleton #1 — qr-bind-douyin handler unit test
//
// 验证：
//   - getSessionPath 按约定 ~/.zenithjoy-agent/sessions/<platform>/<account_label>.json 计算
//   - handleQrBindDouyin 调 chromiumLauncher.connectOverCDP('http://localhost:19222')
//   - 拿到 storageState 后写到 sessionPath
//   - 写文件目录会自动 mkdir

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { handleQrBindDouyin, getSessionPath } from '../qr-bind-douyin';

describe('qr-bind-douyin', () => {
  describe('getSessionPath', () => {
    it('returns ~/.zenithjoy-agent/sessions/<platform>/<account_label>.json', () => {
      const p = getSessionPath('douyin', 'default');
      expect(p).toBe(
        path.join(os.homedir(), '.zenithjoy-agent', 'sessions', 'douyin', 'default.json'),
      );
    });

    it('honors custom sessionDir override', () => {
      const p = getSessionPath('douyin', 'main', '/tmp/sess');
      expect(p).toBe('/tmp/sess/douyin/main.json');
    });
  });

  describe('handleQrBindDouyin', () => {
    let tmpSessionDir: string;
    beforeEach(() => {
      tmpSessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-agent-qr-'));
    });

    it('connects to CDP 19222 and writes storageState to sessionPath', async () => {
      const fakeStorageState = {
        cookies: [{ name: 'sessionid', value: 'abc' }],
        origins: [],
      };
      const context = {
        pages: () => [{ url: () => 'https://creator.douyin.com/creator-micro/home' }],
        storageState: vi.fn(async () => fakeStorageState),
        newPage: vi.fn(async () => ({
          url: () => 'about:blank',
          goto: vi.fn(),
        })),
      };
      const browser = {
        contexts: () => [context],
        close: vi.fn(),
      };
      const chromiumLauncher = {
        connectOverCDP: vi.fn(async (url: string) => {
          expect(url).toBe('http://localhost:19222');
          return browser;
        }),
      };

      const res = await handleQrBindDouyin(
        { account_label: 'default' },
        {
          sessionDir: tmpSessionDir,
          chromiumLauncher: chromiumLauncher as any,
          // already 'logged in' — pretend ready instantly
          isLoggedIn: () => true,
          pollIntervalMs: 1,
          timeoutMs: 100,
        },
      );

      expect(res.ok).toBe(true);
      expect(res.sessionPath).toBe(
        path.join(tmpSessionDir, 'douyin', 'default.json'),
      );
      expect(chromiumLauncher.connectOverCDP).toHaveBeenCalledTimes(1);
      expect(context.storageState).toHaveBeenCalledTimes(1);

      const written = JSON.parse(fs.readFileSync(res.sessionPath, 'utf-8'));
      expect(written.cookies[0].value).toBe('abc');
    });

    it('returns ok:false when CDP connect fails', async () => {
      const chromiumLauncher = {
        connectOverCDP: vi.fn(async () => {
          throw new Error('ECONNREFUSED');
        }),
      };

      const res = await handleQrBindDouyin(
        { account_label: 'default' },
        {
          sessionDir: tmpSessionDir,
          chromiumLauncher: chromiumLauncher as any,
          pollIntervalMs: 1,
          timeoutMs: 50,
        },
      );

      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/ECONNREFUSED|connect/i);
    });

    it('times out if user never logs in', async () => {
      const context = {
        pages: () => [{ url: () => 'https://creator.douyin.com/login' }],
        storageState: vi.fn(async () => ({ cookies: [], origins: [] })),
        newPage: vi.fn(),
      };
      const browser = { contexts: () => [context], close: vi.fn() };
      const chromiumLauncher = {
        connectOverCDP: vi.fn(async () => browser),
      };

      const res = await handleQrBindDouyin(
        {},
        {
          sessionDir: tmpSessionDir,
          chromiumLauncher: chromiumLauncher as any,
          isLoggedIn: () => false,
          pollIntervalMs: 5,
          timeoutMs: 30,
        },
      );

      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/timeout|timed out/i);
    });
  });
});
