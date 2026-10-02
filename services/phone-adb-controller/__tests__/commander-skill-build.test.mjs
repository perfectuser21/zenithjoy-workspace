import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const business = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = process.env.CECELIA_ACTIVITY_RUNTIME || resolve(business, '../../../.cecelia-activity-runtime/packages/brain/scripts/activity-contract-run.js');
const generator = join(dirname(runtime), 'generate-commander-skill.mjs');
function assertAftercareSkill(skill) {
  assert.ok(skill.includes('终态优先：先检查同TAG协调器请求；已有finalize请求时只核终态、完成售后，不再发运行期心跳或触碰手机。'));
  assert.ok(skill.includes('at在网关实际写回执时由程序生成带时区时间，禁止估算或抄请求时间'));
  assert.ok(skill.includes('每个售后tick重新核验证据并写本轮回执，不能复用旧回执'));
}

test('真实获客契约及SOP生成可部署skill；失败不覆盖既有文件', () => {
  const root = mkdtempSync(join(tmpdir(), 'wf-skill-'));
  try {
    const output = join(root, 'wf-keyword_acquisition/SKILL.md');
    const args = [join(business, 'commander/build-workflow-skill.mjs'), 'keyword_acquisition',
      join(business, 'plans/keyword_workflow.contract.json'), join(business, 'commander/keyword-acquisition-sop.json'), output];
    const env = { ...process.env, CECELIA_COMMANDER_SKILL_GENERATOR: generator };
    const result = spawnSync(process.execPath, args, { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const skill = readFileSync(output, 'utf8');
    assertAftercareSkill(skill);
    for (const value of ['commander_capability: keyword_acquisition', 'pf_account_verified', 'cl_lock_released',
      'screen_asleep', 'progress_stalled', 'lock_busy', 'account_mismatch', 'return_to_home_failed']) assert.ok(skill.includes(value), value);
    const again = spawnSync(process.execPath, args, { env: { ...env, CECELIA_COMMANDER_SKILL_GENERATOR: '/absent' }, encoding: 'utf8' });
    assert.notEqual(again.status, 0); assert.equal(readFileSync(output, 'utf8'), skill);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('现有两条workflow从真身契约组装生成，只有发现活动不同；不伪造对标JSON执行入口', () => {
  const root = mkdtempSync(join(tmpdir(), 'wf-skill-assembled-'));
  try {
    const skills = [];
    for (const cap of ['keyword_acquisition', 'benchmark_link_acquisition']) {
      const output = join(root, `wf-${cap}/SKILL.md`);
      const r = spawnSync(process.execPath, [join(business, 'commander/build-workflow-skill.mjs'), cap,
        '--assembled', join(business, 'commander/keyword-acquisition-sop.json'), output], {
        env: { ...process.env, CECELIA_COMMANDER_SKILL_GENERATOR: generator }, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr); skills.push(readFileSync(output, 'utf8'));assertAftercareSkill(skills.at(-1));
    }
    assert.match(skills[0], /discover-keyword.sh/);
    assert.match(skills[1], /discover-benchmark.sh/);
    assert.match(skills[1], /bench_candidates_persisted/);
    assert.match(skills[1], /独立触发活动/);
    const stages = s => s.match(/## \d+\..*(?:\n|.)*?(?=## \d+\.|## 同run)/g);
    const first = stages(skills[0]), second = stages(skills[1]);
    assert.equal(first.length, second.length);
    for (let i = 0; i < first.length; i++) if (i !== 1) assert.equal(first[i], second[i]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('CI显式提供生成器路径；真实部署准备后两条专属技能与两机控制器均进入原子下发', () => {
  const repo = resolve(business, '../..');
  const root = mkdtempSync(join(tmpdir(), 'wf-skill-deploy-'));
  try {
    for (const workflow of ['ci-smoke-glob-runner.yml', 'ci-l3-code.yml']) {
      const source = readFileSync(join(repo, '.github/workflows', workflow), 'utf8');
      assert.match(source, /CECELIA_COMMANDER_SKILL_GENERATOR: \$\{\{ github\.workspace \}\}\/\.cecelia-activity-runtime\/packages\/brain\/scripts\/generate-commander-skill\.mjs/, workflow);
    }
    const log = join(root, 'calls.log');
    for (const tool of ['ssh', 'scp']) writeFileSync(join(root, tool), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$DEPLOY_TEST_LOG"\ncase "$*" in *"sort -u | wc -l"*) printf '1\\n';; esac\n`, { mode: 0o700 });
    const result = spawnSync('bash', [join(business, 'deploy.sh')], {
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, DEPLOY_TEST_LOG: log,
        CECELIA_COMMANDER_SKILL_GENERATOR: generator }, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr + result.stdout.slice(-4000));
    const calls = readFileSync(log, 'utf8');
    for (const cap of ['keyword_acquisition', 'benchmark_link_acquisition']) assert.ok(calls.includes(`wf-${cap}/.SKILL.md.deploy-new`), cap);
    for (const host of ['xian-m4', 'xian-m1']) for (const directory of ['~/.local/bin', '~/bin-harvest']) {
      assert.ok(calls.includes(`${host}:${directory}/.douyin-phone-adb.deploy-new`));
      assert.ok(calls.includes(`mv -f ${directory}/.douyin-phone-adb.deploy-new ${directory}/douyin-phone-adb`));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
