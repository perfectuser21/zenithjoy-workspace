/**
 * WS2a — Agent burner handler: qr-bind-douyin-burner.ts
 *
 * commit-1 RED（文件未建），commit-2 GREEN。
 * 测试覆盖：handler 行为 + sessionPath 含 /burner/ + 上报字段 + 物理隔离 Path 1。
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// 真实 handler 路径（commit-1 时不存在 → import 失败 = RED）
import { handleQrBindDouyinBurner, getBurnerSessionPath } from '../../../../services/agent/src/handlers/qr-bind-douyin-burner';

describe('Workstream 2a — qr-bind-douyin-burner handler [BEHAVIOR]', () => {
  it('getBurnerSessionPath 含 /burner/ 子目录与 Path 1 main 隔离', () => {
    const p = getBurnerSessionPath('douyin', '装修小号1');
    expect(p).toMatch(/[\\/]burner[\\/]/);
    expect(p).toMatch(/装修小号1\.json$/);
  });

  it('handler 含 waitForURL 超时 >= 10 分钟（给 user 找小号手机时间）', async () => {
    const handlerSrc = fs.readFileSync(
      path.resolve(__dirname, '../../../../services/agent/src/handlers/qr-bind-douyin-burner.ts'),
      'utf8'
    );
    const m = handlerSrc.match(/waitForURL[^)]*timeout:\s*(\d+)/);
    expect(m, 'handler 必须含 waitForURL timeout 配置').not.toBeNull();
    expect(parseInt(m![1], 10)).toBeGreaterThanOrEqual(600000);
  });

  it('handler 上报含 cookie_local_path + qr_login + account_nickname 三字段', async () => {
    // 用 mock launcher 跑一次 → 检查返回结构
    const fakePage = {
      url: () => 'https://creator.douyin.com/dashboard',
      goto: vi.fn().mockResolvedValue(null),
    };
    const fakeContext = {
      newPage: vi.fn().mockResolvedValue(fakePage),
      pages: () => [fakePage],
      storageState: vi.fn().mockResolvedValue({ cookies: [], origins: [] }),
      waitForURL: vi.fn().mockResolvedValue(null),
      close: vi.fn().mockResolvedValue(null),
    };
    const fakeLauncher = {
      launchPersistentContext: vi.fn().mockResolvedValue(fakeContext),
    };

    const result = await handleQrBindDouyinBurner(
      { account_label: '装修小号1' },
      { chromiumLauncher: fakeLauncher as any, sessionDir: '/tmp/test-burner-sessions' }
    );

    expect(result).toMatchObject({
      ok: true,
      qr_login: 'success',
    });
    expect(result.cookie_local_path).toMatch(/[\\/]burner[\\/]装修小号1\.json$/);
    expect(result).toHaveProperty('account_nickname');
  });

  it('handler 不引用 Path 1 主号 handler（物理隔离）', () => {
    const handlerSrc = fs.readFileSync(
      path.resolve(__dirname, '../../../../services/agent/src/handlers/qr-bind-douyin-burner.ts'),
      'utf8'
    );
    expect(handlerSrc).not.toMatch(/from\s+['"]\.\/qr-bind-douyin['"]/);
  });
});
