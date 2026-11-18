import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('manual historical evidence validator accepts formatted evidence and rejects missing or preset-cookie input', t => {
  const dir = mkdtempSync(join(tmpdir(), 'manual-lead-validator-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'evidence.md');
  const run = path => spawnSync('bash', ['scripts/check-lead-acceptance.sh', path], { encoding: 'utf8' });
  assert.notEqual(run(file).status, 0, 'missing evidence must fail');
  writeFileSync(file, 'https://www.douyin.com/video/7234567890\n扫码绑定\n');
  const accepted = run(file);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /FORMAT_OK.*NOT_VERIFIED/);
  writeFileSync(file, 'preset cookie was used to skip QR scan\nhttps://www.douyin.com/video/7234567890\n');
  assert.notEqual(run(file).status, 0, 'preset cookie must fail');
  writeFileSync(file, '扫码绑定，没有平台链接\n');
  assert.notEqual(run(file).status, 0, 'missing platform URL must fail');
  writeFileSync(file, 'https://www.douyin.com/video/7234567890\n');
  assert.notEqual(run(file).status, 0, 'missing QR evidence must fail');
});
