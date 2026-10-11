// 仅验证 smoke 编排与失败传播；实际业务回归由 smoke 调用真实 node --test 独立执行。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
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
test('聚合16套真实时序回归使用180秒有界时限，普通smoke仍90秒',()=>{
 const workflow=readFileSync(new URL('../../../.github/workflows/ci-smoke-glob-runner.yml',import.meta.url),'utf8');
 const fn=workflow.match(/script_timeout\(\) \{[\s\S]*?\n\s*\}/)?.[0];assert.ok(fn);
 const result=spawnSync('bash',['-c',`${fn}\nscript_timeout capability-phone-regression-smoke.sh\nscript_timeout ordinary-smoke.sh`],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.deepEqual(result.stdout.trim().split('\n'),['180','90']);
});

// 直接执行正式Step34的Node门禁；不复制一个平行validator。
const gp2Smoke = new URL('../../../.github/workflows/scripts/smoke/golden-path-2-smoke.sh', import.meta.url);
const gp2Controller = readFileSync(new URL('../douyin-phone-adb', import.meta.url), 'utf8');
const gp2Harvest = readFileSync(new URL('../harvest-keyword.sh', import.meta.url), 'utf8');
function runCanonicalStep34(t, ctl=gp2Controller, harvest=gp2Harvest) {
 const smoke=readFileSync(gp2Smoke,'utf8');const block=smoke.slice(smoke.indexOf('# Step 34：'));
 const code=block.match(/node - <<'NODE'[^\n]*\n([\s\S]*?)\nNODE\n/)?.[1];assert.ok(code,'必须提取正式Step34代码');
 const dir=mkdtempSync(join(tmpdir(),'canonical-step34-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 mkdirSync(join(dir,'services/phone-adb-controller'),{recursive:true});
 writeFileSync(join(dir,'services/phone-adb-controller/douyin-phone-adb'),ctl);
 writeFileSync(join(dir,'services/phone-adb-controller/harvest-keyword.sh'),harvest);
 return spawnSync(process.execPath,['-'],{input:code,cwd:dir,encoding:'utf8'});
}
test('正式Step34接受当前完整守卫，早于函数定义的detail调用不能截断判定',t=>{
 assert.ok(gp2Controller.indexOf('_is_video_detail_xml "$local_path"')<gp2Controller.indexOf('_is_search_results_fg() {'));
 const r=runCanonicalStep34(t);assert.equal(r.status,0,r.stderr);
});
test('正式Step34拒绝结果页判定缺SEARCH_RESULT_ACTIVITY',t=>{
 const r=runCanonicalStep34(t,gp2Controller.replaceAll('SEARCH_RESULT_ACTIVITY','UNTRUSTED_ACTIVITY'));assert.equal(r.status,1,r.stderr);
});
test('正式Step34拒绝归位函数不再失败return1，其他函数return1不能冒充',t=>{
 const ctl=gp2Controller.replace(/^back_to_results\(\) \{[\s\S]*?^\}/m,fn=>fn.replaceAll('return 1','return 0'));
 assert.notEqual(ctl,gp2Controller);const r=runCanonicalStep34(t,ctl);assert.equal(r.status,1,r.stderr);
});
test('正式Step34拒绝采收循环新增裸back，合法控制器归位不能掩盖它',t=>{
 const harvest=gp2Harvest+'\n'+Array(6).fill('# neutral fixture').join('\n')+'\n"$CTL" --profile "$P" back\n';
 const r=runCanonicalStep34(t,gp2Controller,harvest);assert.equal(r.status,1,r.stderr);
});
test('正式Step34拒绝缺失真正的判定或详情函数定义',t=>{
 for(const name of ['_is_search_results_fg','_is_video_detail_xml']) {
  const ctl=gp2Controller.replace(new RegExp('^'+name+'\\(\\) \\{','m'),name+'_missing() {');
  const r=runCanonicalStep34(t,ctl);assert.equal(r.status,1,r.stderr);
 }
});
