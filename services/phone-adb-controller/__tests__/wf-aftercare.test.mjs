import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('../wf-aftercare.sh', import.meta.url));
test('真实shell将已finalize本run交给异步售后；退出不直接删cron', () => {
  const root = mkdtempSync(join(tmpdir(), 'wf-aftercare-')); mkdirSync(join(root, 'bin'));
  const ssh = join(root, 'bin/ssh');
  writeFileSync(ssh, '#!/bin/sh\nprintf "%s\\n" "$*" > "$TEST_ROOT/argv"\ncat > "$TEST_ROOT/context.json"\n'); chmodSync(ssh, 0o755);
  const result = spawnSync('zsh', ['-c', `source '${helper}';
    TAG=cmd-test; HOSTKEY=xian-m4; WFR_FINALIZE_OK=1;
    WFR_BRAIN_TASK_ID=11111111-2222-4333-8444-555555555555;
    ESCORT_ID_FILE=/Users/test/wf-escort-cmd-test.id; LOG=/dev/null;
    escort_current_id(){ print 11111111-2222-4333-8444-555555555555; }
    log(){ :; }; escort_aftercare`], { encoding: 'utf8', env: { ...process.env, TEST_ROOT: root, PATH: `${root}/bin:${process.env.PATH}` } });
  assert.equal(result.status, 0, result.stderr);
  const ctx = JSON.parse(readFileSync(join(root, 'context.json')));
  assert.equal(ctx.finalized, true); assert.equal(ctx.tag, 'cmd-test');
  assert.equal(ctx.taskId, '11111111-2222-4333-8444-555555555555');
  assert.match(readFileSync(join(root, 'argv'), 'utf8'), /commander-aftercare.mjs.*--enqueue/);
  assert.doesNotMatch(readFileSync(join(root, 'argv'), 'utf8'), /cron rm/);
});
test('生产trap在finalize后请求售后，不能直接删除活跃陪跑', () => {
  const text = readFileSync(fileURLToPath(new URL('../wf-run.sh', import.meta.url)), 'utf8');
  assert.match(text, /run_finalize && escort_aftercare/);
  assert.doesNotMatch(text, /run_finalize && escort_dismiss/);
});
