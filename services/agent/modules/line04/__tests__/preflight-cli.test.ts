// modules/line04/__tests__/preflight-cli.test.ts
//
// 契约测试：core ModuleManager 用 `node preflight.js`（cwd=moduleDir，不传 argv）执行，
// 读 stdout **最后一行** 并 JSON.parse。本测试用 tsx 直接跑 .ts 源码验证同等行为：
//   1. stdout 最后一行是合法 JSON
//   2. JSON 含 ok(boolean) 与 checks
//   3. MOCK 版本 4.1.8 接受 / 4.1.7 拒绝，退出码与 ok 对应
// 仅 CLI 契约 fixture；版本来自注入，不安装/启动微信，不执行静默、送达或更新锁操作。

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

// Execute the exported CLI with Node: npm's shell shims are not native Windows executables.
const TSX_CLI = require.resolve('tsx/cli');
const PREFLIGHT_TS = path.resolve(__dirname, '../preflight.ts');

describe('line04 preflight CLI 执行契约', () => {
  it.each([
    { version: '4.1.8.107', ok: true, code: 0 },
    { version: '4.1.7.25', ok: false, code: 1 },
  ])('MOCK $version：真实 Node+tsx CLI 最后一行 JSON 与退出码一致', async ({ version, ok, code }) => {
    let stdout = '';
    let exitCode = 0;
    try {
      const r = await execFileP(process.execPath, [TSX_CLI, PREFLIGHT_TS], {
        timeout: 60_000,
        env: {
          ...process.env,
          CI_MODE: '1',
          MOCK_WECHAT_VERSION: version,
          MOCK_VERIFY_SILENT: 'skip',
          MOCK_VERIFY_DELIVERY: 'skip',
          MOCK_UPDATE_LOCK: 'skip',
        },
      });
      stdout = r.stdout;
    } catch (e) {
      // ok:false 时 process.exit(1) → execFile reject，但 stdout 仍带 JSON
      stdout = (e as { stdout?: string }).stdout ?? '';
      exitCode = (e as { code?: number }).code ?? 1;
    }

    const lines = stdout.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    const last = lines[lines.length - 1];

    const parsed = JSON.parse(last);
    expect(typeof parsed.ok).toBe('boolean');
    expect(parsed).toHaveProperty('checks');

    expect(parsed.ok).toBe(ok);
    expect(parsed.checks.wechat_version).toBe(ok);
    expect(parsed.checks.pywinauto).toBe(true);
    expect(parsed.checks.verify_silent).toBe(true);
    expect(parsed.checks.verify_delivery).toBe(true);
    expect(parsed.checks.update_lock).toBe(true);
    expect(parsed.reason).toContain(version);
    expect(exitCode).toBe(code);
  });
});
