import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';

const workflow = YAML.parse(readFileSync(new URL('../../agent-preflight-e2e.yml', import.meta.url), 'utf8'));
const command = workflow.jobs['preflight-xian-rog'].steps.find(step => step.name === 'Run preflight line04 (real machine)').run;
const checks = { wechat_version: true, pywinauto: true, memory: true };
for (const [name, result, success] of [
  ['complete current preflight', { ok: true, checks }, true],
  ['unsupported version', { ok: false, reason: '微信版本过低', checks: { ...checks, wechat_version: false } }, false],
  ['version and driver fail together', { ok: false, reason: '微信版本过低；pywinauto unavailable', checks: { ...checks, wechat_version: false, pywinauto: false } }, false],
  ['memory failure', { ok: false, reason: 'memory insufficient', checks: { ...checks, memory: false } }, false],
  ['contradictory success', { ok: true, checks: { ...checks, memory: false } }, false],
  ['missing checks', { ok: true }, false],
  ['nonboolean success', { ok: 'true', checks }, false],
]) {
  test(`actual preflight workflow command: ${name}`, () => {
    const folder = mkdtempSync(join(tmpdir(), 'ci-preflight-result-'));
    try {
      mkdirSync(join(folder, 'dist/preflight'), { recursive: true });
      writeFileSync(join(folder, 'dist/preflight/preflight-runner.js'), `exports.runPreflight = async line => { if (line !== 'line04-wechat-cs') throw Error('wrong line'); return ${JSON.stringify(result)}; };`);
      const run = spawnSync('bash', ['-e', '-c', command], { cwd: folder, env: { ...process.env, PATH: `${process.execPath.slice(0, process.execPath.lastIndexOf('/'))}:${process.env.PATH}` }, encoding: 'utf8', timeout: 5000 });
      assert.ifError(run.error);
      assert.equal(run.status === 0, success, run.stdout + run.stderr);
      if (!success) assert.doesNotMatch(run.stdout, /\[preflight\] line04 真机检测通过/);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
}
