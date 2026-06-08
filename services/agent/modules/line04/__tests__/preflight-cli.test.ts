// modules/line04/__tests__/preflight-cli.test.ts
//
// 契约测试：core ModuleManager 用 `node preflight.js`（cwd=moduleDir，不传 argv）执行，
// 读 stdout **最后一行** 并 JSON.parse。本测试用 tsx 直接跑 .ts 源码验证同等行为：
//   1. stdout 最后一行是合法 JSON
//   2. JSON 含 ok(boolean) 与 checks
//   3. 退出码与 ok 对应（非 Windows ok:true → exit 0）

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const TSX = path.resolve(__dirname, '../../../node_modules/.bin/tsx');
const PREFLIGHT_TS = path.resolve(__dirname, '../preflight.ts');

describe('line04 preflight CLI 执行契约', () => {
  it('直接执行打印最后一行 JSON（含 ok + checks），非 Windows 退出码 0', async () => {
    let stdout = '';
    let exitCode = 0;
    try {
      const r = await execFileP(TSX, [PREFLIGHT_TS], { timeout: 60_000 });
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

    // 非 Windows：三项跳过 → ok:true → 退出码 0
    if (process.platform !== 'win32') {
      expect(parsed.ok).toBe(true);
      expect(exitCode).toBe(0);
    } else {
      // Windows：退出码必须与 ok 一致
      expect(exitCode).toBe(parsed.ok ? 0 : 1);
    }
  });
});
