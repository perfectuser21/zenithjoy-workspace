import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest } from '../runtime-definition.mjs';
import { readBilibiliVerifyReceipt } from '../bilibili-verify-worker.mjs';

test('proof admitted to the worker must match the rooted, current-run original file digests', t => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'bili-worker-test-')));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const root = join(scratch, 'bilibili-existing');
  mkdirSync(root, { mode: 0o700 });
  const scope = { runId: randomUUID(), sourceRunId: 'real-old-audit', bvid: 'BV1cLpG6cEHH', ownerUid: '3546824935738234', profile: 'yueshengyun-work', serial: 'e6c7ef34',
    title: '傍晚的颜色，慢一点也很好', durationSeconds: 10 };
  scope.owner = scope.runId;
  const files = {};
  for (const role of ['account', 'author', 'detail', 'editor', 'settings', 'player']) {
    const path = role + (role === 'player' ? '.png' : '.xml');
    const bytes = Buffer.from('trusted provider output: ' + role);
    writeFileSync(join(root, path), bytes, { mode: 0o600 });
    files[role] = { path, sha256: digest(bytes) };
  }
  const observation = { protocol: 'bilibili-verify-existing/v1', run_id: scope.runId, owner: scope.owner, source_run_id: scope.sourceRunId,
    bvid: scope.bvid, owner_uid: scope.ownerUid, profile: scope.profile, serial: scope.serial,
    title: scope.title, visibility: 'private', duration_seconds: 10, outward_actions: 0 };
  const receipt = { observation, files };
  const receiptFile = join(root, 'receipt.json');
  writeFileSync(receiptFile, JSON.stringify(receipt), { mode: 0o600 });
  assert.deepEqual(readBilibiliVerifyReceipt(scratch, scope), receipt);
  assert.throws(() => readBilibiliVerifyReceipt(scratch, { ...scope, runId: randomUUID() }), /scope_unconfirmed/);
  files.editor.path = '../foreign.xml';
  writeFileSync(receiptFile, JSON.stringify(receipt));
  assert.throws(() => readBilibiliVerifyReceipt(scratch, scope), /scope_unconfirmed/);
  files.editor.path = 'editor.xml';
  writeFileSync(receiptFile, JSON.stringify(receipt));
  writeFileSync(join(root, 'editor.xml'), 'other proof');
  assert.throws(() => readBilibiliVerifyReceipt(scratch, scope), /scope_unconfirmed/);
});
