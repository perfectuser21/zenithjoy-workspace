import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../douyin-phone-adb', import.meta.url));
test('controller shell sources parse with zsh and reject unbraced variables adjacent to CJK', () => {
  for (const name of ['douyin-phone-adb', 'harvest-keyword.sh', 'refill-profile-links.sh', 'outreach-tick.sh', 'harvest-cron.sh', 'wf-run.sh', 'discover-keyword.sh']) {
    const path = fileURLToPath(new URL(`../${name}`, import.meta.url));
    const result = spawnSync('zsh', ['-n', path], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  }
  for (const name of readdirSync(new URL('../', import.meta.url)).filter(name => name.endsWith('.sh'))) {
    const code = readFileSync(new URL(`../${name}`, import.meta.url), 'utf8').split('\n').filter(line => !line.trimStart().startsWith('#')).join('\n');
    assert.doesNotMatch(code, /\$[A-Za-z_][A-Za-z0-9_]*[一-鿿]/, `${name}: shell treats adjacent CJK as part of the variable`);
  }
});
test('real nickname normalizer decodes entities and trims under an empty environment', () => {
  const text = readFileSync(source, 'utf8');
  const body = text.match(/^normalize_nickname\(\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(body, 'runtime normalizer is missing');
  const result = spawnSync('zsh', ['-c', `${body}\nprint -n -- "$(normalize_nickname '小辣椒&#127798;️')|$(normalize_nickname '  峥嵘岁月  ')"`], {
    env: { PATH: '/usr/bin:/bin:/opt/homebrew/bin' }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '小辣椒🌶|峥嵘岁月');
});
test('wall push and report execute one isolated fake API/ADB cycle', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./wall-smoke-harness.mjs', import.meta.url))], {
    env: process.env, encoding: 'utf8', timeout: 60000,
  });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /wall-smoke-harness: OK/);
});
