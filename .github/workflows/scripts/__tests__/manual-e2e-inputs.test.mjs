import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveManualE2e } from '../resolve-manual-e2e.mjs';
test('manual sprint dispatch accepts fixed candidate and rejects branch, mismatch, traversal and symlink escapes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'manual-e2e-'));
  try {
    const workspace = join(dir, 'repo'); mkdirSync(join(workspace, 'sprints', 'safe'), { recursive: true });
    writeFileSync(join(workspace, 'sprints', 'safe', 'e2e-verify.ps1'), 'exit 0');
    const options = { workspace, candidate: 'a'.repeat(40), actualSha: 'a'.repeat(40), taskId: '12345678-1234-1234-1234-123456789abc', sprintDir: 'sprints/safe' };
    assert.match(resolveManualE2e(options), /e2e-verify\.ps1$/);
    for (const override of [{ candidate: 'main' }, { actualSha: 'b'.repeat(40) }, { taskId: 'bad' }, { sprintDir: 'sprints/safe\nrun' }]) assert.throws(() => resolveManualE2e({ ...options, ...override }));
    mkdirSync(join(dir, 'outside')); writeFileSync(join(dir, 'outside', 'e2e-verify.ps1'), 'exit 0');
    assert.throws(() => resolveManualE2e({ ...options, sprintDir: '../outside' }));
    symlinkSync(join(dir, 'outside'), join(workspace, 'sprints', 'escape'), 'junction');
    assert.throws(() => resolveManualE2e({ ...options, sprintDir: 'sprints/escape' }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
