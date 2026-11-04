import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
test('actual format runner rejects empty/template-only/invalid evidence and limits valid claims to format', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lead-format-'));
  const path = join(dir, 'lead-acceptance-sprint-fixture.md');
  const run = () => spawnSync('bash', ['.github/workflows/scripts/check-lead-evidence-format.sh', dir], { encoding: 'utf8' });
  try {
    assert.notEqual(run().status, 0);
    writeFileSync(path, '> **PLACEHOLDER**\n'); assert.notEqual(run().status, 0);
    writeFileSync(path, 'preset cookie https://douyin.com/video/123 QR'); assert.notEqual(run().status, 0);
    writeFileSync(path, '# Historical format fixture\nhttps://douyin.com/video/123 QR\n');
    const ok = run(); assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /validated=1.*DEVICE_NOT_RUN.*PLATFORM_READBACK_NOT_VERIFIED/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
