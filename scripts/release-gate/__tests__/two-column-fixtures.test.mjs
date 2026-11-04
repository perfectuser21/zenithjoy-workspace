import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const gate = fileURLToPath(new URL('../two-column-gate.sh', import.meta.url));
const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));
const sha = 'aaaaaaaabbbbbbbbccccccccddddddddeeeeeeee';
for (const [file, expected, reason] of [
  ['case-not-finalized.json', 1, /尚未定案/],
  ['case-green.json', 0, /候选 SHA=/],
  ['nonexistent.json', 1, /fixture 文件不存在/],
  ['case-infra-error-bypass.json', 1, /业务验收未通过/],
  ['case-cells-red-bypass.json', 1, /业务验收未通过/],
]) test(`real two-column fixture ${file} returns ${expected} for the intended reason`, () => {
  const result = spawnSync('bash', [gate, '--fixture', fixtures + file], {
    env: { ...process.env, PROMOTE_SHA: sha, BYPASS_TWO_COLUMN_INFRA: 'true' }, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.error, undefined); assert.equal(result.status, expected, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, reason);
});
