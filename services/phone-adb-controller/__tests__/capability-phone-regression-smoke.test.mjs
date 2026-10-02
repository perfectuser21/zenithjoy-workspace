// 仅验证 smoke 编排与失败传播；实际业务回归由 smoke 调用真实 node --test 独立执行。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const script = new URL('../../../.github/workflows/scripts/smoke/capability-phone-regression-smoke.sh', import.meta.url).pathname;
function run(t, mode = 'pass') {
  const dir = mkdtempSync(join(tmpdir(), 'capability-smoke-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls = join(dir, 'node-argv');
  writeFileSync(join(dir, 'node'), `#!/bin/sh\nprintf '%s\\n' "$@" > "$SMOKE_TEST_CALLS"\ncase "$SMOKE_TEST_MODE" in\nfail) echo 'not ok 1 - injected runner failure'; exit 29;;\nskip) echo 'ok 1 - unavailable dependency # SKIP'; echo '# skipped 1';;\n*) echo 'ok 1 - orchestration fixture'; echo '# skipped 0';;\nesac\n`, { mode: 0o755 });
  return { ...spawnSync('bash', [script], { cwd: tmpdir(), encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SMOKE_TEST_CALLS: calls, SMOKE_TEST_MODE: mode } }), calls };
}
test('回归入口从任意目录选择实际动态套，不混入 phone-wall，不冒充业务执行', t => {
  const result = run(t);
  assert.equal(result.status, 0, result.stderr);
  const args = readFileSync(result.calls, 'utf8');
  assert.match(args, /--test\n/);
  for (const name of ['real-contract-step-protocol', 'wf-run', 'discover-keyword', 'discover-benchmark', 'harvest-keyword-judge-before-collect', 'harvest-keyword-profile-link-retry', 'pipeline-v4-integration', 'qualify-video', 'outreach-tick-guard', 'phone-lock-lifecycle', 'lease-heartbeat']) assert.ok(args.includes(`/${name}.test.mjs`), name);
  assert.doesNotMatch(args, /phone-wall-push|wall-lib|wall-report\.test/);
  assert.match(result.stdout, /PASS capability-phone-regression-smoke/);
  assert.match(result.stdout, /regression_only/);
});
test('动态套失败必须传播原退出码，禁止输出 PASS', t => {
  const result = run(t, 'fail');
  assert.equal(result.status, 29, result.stderr);
  assert.doesNotMatch(result.stdout, /PASS capability-phone-regression-smoke/);
});
test('任何动态用例跳过都拒绝宣称完整回归通过', t => {
  const result = run(t, 'skip');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /跳过/);
  assert.doesNotMatch(result.stdout, /PASS capability-phone-regression-smoke/);
});
test('完整动态回归进入必绿基线，Glob runner显式安装所选套的真实依赖',()=>{
 const baseline=readFileSync(new URL('../../../.github/workflows/scripts/smoke-baseline.txt',import.meta.url),'utf8').split('\n');
 assert.ok(baseline.includes('capability-phone-regression-smoke.sh'),'新动态回归必须纳入必绿棘轮');
 const workflow=readFileSync(new URL('../../../.github/workflows/ci-smoke-glob-runner.yml',import.meta.url),'utf8');
 assert.match(workflow,/apt-get install -y zsh python3 jq libxml2-utils/);
 assert.match(workflow,/npm ci --workspace=apps\/api --workspace=apps\/agent-panel --include-workspace-root/);
});
test('OpenClaw全套执行真实YAML契约前安装已锁定根依赖，不靠全局包或跳过',()=>{
 const workflow=readFileSync(new URL('../../../.github/workflows/ci-l3-code.yml',import.meta.url),'utf8');
 const job=workflow.split('  openclaw-scripts-test:')[1].split('  api-scripts-test:')[0];
 assert.match(job,/run: npm ci --ignore-scripts --workspaces=false/);
 assert.ok(job.indexOf('npm ci --ignore-scripts --workspaces=false')<job.indexOf('run: node --test'));
});
