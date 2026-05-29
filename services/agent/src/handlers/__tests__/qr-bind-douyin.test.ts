// services/agent/src/handlers/__tests__/qr-bind-douyin.test.ts
//
// Walking Skeleton #1 — qr-bind-douyin handler unit test
//
// 验证：
//   - getSessionPath 按约定 ~/.zenithjoy-agent/sessions/<platform>/<account_label>.json 计算
//   - handleQrBindDouyin 调 chromiumLauncher.launch() 自启动 Chrome
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

    it('launches browser and writes storageState to sessionPath', async () => {
      const fakeStorageState = {
        cookies: [{ name: 'sessionid', value: 'abc', domain: '.douyin.com' }],
        origins: [],
      };
      const mockPage = {
        url: () => 'https://creator.douyin.com/creator-micro/home',
        goto: vi.fn(),
      };
      const context = {
        pages: () => [mockPage],
        storageState: vi.fn(async () => fakeStorageState),
        newPage: vi.fn(async () => mockPage),
      };
      const browser = {
        newContext: vi.fn(async () => context),
        close: vi.fn(),
      };
      const chromiumLauncher = {
        launch: vi.fn(async () => browser),
      };

      const res = await handleQrBindDouyin(
        { account_label: 'default' },
        {
          sessionDir: tmpSessionDir,
          chromiumLauncher: chromiumLauncher as any,
          pollIntervalMs: 1,
          timeoutMs: 100,
        },
      );

      expect(res.ok).toBe(true);
      expect(res.sessionPath).toBe(
        path.join(tmpSessionDir, 'douyin', 'default.json'),
      );
      expect(chromiumLauncher.launch).toHaveBeenCalledTimes(1);
      expect(chromiumLauncher.launch).toHaveBeenCalledWith(
        expect.objectContaining({ headless: false }),
      );
      expect(context.storageState).toHaveBeenCalledTimes(1);

      const written = JSON.parse(fs.readFileSync(res.sessionPath, 'utf-8'));
      expect(written.cookies[0].value).toBe('abc');
    });

    it('returns ok:false when launch fails', async () => {
      const chromiumLauncher = {
        launch: vi.fn(async () => {
          throw new Error('launch failed: cannot find Chrome executable');
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
      expect(res.error).toMatch(/launch failed|chrome/i);
    });

    it('times out if user never logs in', async () => {
      const mockPage = {
        url: () => 'https://creator.douyin.com/login',
        goto: vi.fn(),
      };
      const context = {
        pages: () => [mockPage],
        storageState: vi.fn(async () => ({ cookies: [], origins: [] })),
        newPage: vi.fn(async () => mockPage),
      };
      const browser = {
        newContext: vi.fn(async () => context),
        close: vi.fn(),
      };
      const chromiumLauncher = {
        launch: vi.fn(async () => browser),
      };

      const res = await handleQrBindDouyin(
        {},
        {
          sessionDir: tmpSessionDir,
          chromiumLauncher: chromiumLauncher as any,
          pollIntervalMs: 5,
          timeoutMs: 30,
        },
      );

      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/timeout|timed out/i);
    });
  });
});
