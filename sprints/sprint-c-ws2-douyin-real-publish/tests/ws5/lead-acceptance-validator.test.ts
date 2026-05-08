import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';

const VALIDATOR = path.resolve(__dirname, '../../../../scripts/check-lead-acceptance.sh');
const SAMPLE = '/tmp/lead-acceptance-test.md';

function runValidator(file: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('bash', [VALIDATOR, file], { encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e: any) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() || '', stderr: e.stderr?.toString() || '' };
  }
}

describe('Workstream 5 — Lead acceptance evidence 校验脚本 [BEHAVIOR]', () => {
  it('validator 脚本存在', () => { expect(existsSync(VALIDATOR)).toBe(true); });

  it('evidence 文件不存在 → exit 非 0', () => {
    if (existsSync('/tmp/no-such-file.md')) unlinkSync('/tmp/no-such-file.md');
    const r = runValidator('/tmp/no-such-file.md');
    expect(r.code).not.toBe(0);
  });

  it('文件含抖音 URL + 扫码字眼 → exit 0', () => {
    writeFileSync(SAMPLE, ['# Sprint 2.1a Lead Acceptance', '## Step 4: 扫码绑定', 'lead 用手机抖音扫码登录成功', '## Step 6: 真发视频', '抖音公网 URL: https://www.douyin.com/video/7234567890'].join('\n'));
    const r = runValidator(SAMPLE);
    expect(r.code).toBe(0);
  });

  it('文件含 "preset cookie" / "预置 cookie" 字眼 → exit 非 0（防作弊）', () => {
    writeFileSync(SAMPLE, ['# Lead Acceptance', 'preset cookie was used to skip QR scan', 'https://www.douyin.com/video/7234567890'].join('\n'));
    const r = runValidator(SAMPLE);
    expect(r.code).not.toBe(0);
    expect((r.stdout + r.stderr)).toMatch(/preset cookie|预置/i);
  });

  it('smoke step 6 跑 type=video（不跑 image）— grep 验证', () => {
    const fs = require('node:fs');
    const smoke = fs.readFileSync('.github/workflows/scripts/smoke/golden-path-1-smoke.sh', 'utf8');
    expect(smoke).toMatch(/"type"\s*:\s*"video"/);
  });
});
