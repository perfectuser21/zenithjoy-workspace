/**
 * commander-skill-contracts.test.js — 合同 commander_skill 字段 + Commander 运行时合同清单（决策 2186700a / 26df670a，任务 c0fe7e30）
 *
 * 钉四件事：①commander_skill 可空，非空必须 {name: wf-<能力>, version: semver}；②非空时陪跑 skill 必须在仓里且版本一致；
 * ③抖音视频发布合同挂上陪跑 skill；④Commander 运行时清单 commander/workflow-contracts.json 与合同一致（只收 codex_agent 合同，
 * 准备/收尾标 shell，业务活动标 agent，读回照抄合同）。
 * 运行: node --test scripts/product-map/__tests__/commander-skill-contracts.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadContractsFromDisk, validateContracts, commanderContractsSpec } from '../contracts-lib.mjs';

const fresh = () => loadContractsFromDisk();
const DOUYIN = 'douyin_video_publish';
const errorsOf = (ctx) => validateContracts(ctx);

test('commander_skill 可为 null（第一阶段陪跑 skill 可空）', () => {
  const ctx = fresh();
  ctx.contracts[DOUYIN].commander_skill = null;
  assert.deepEqual(errorsOf(ctx), []);
});

test('commander_skill 名必须是 wf-<能力>、版本必须是 semver', () => {
  for (const bad of [{ name: 'workflow-commander', version: '0.1.0' }, { name: 'wf-douyin_video_publish', version: 'v1' }, { name: 'wf-douyin_video_publish' }]) {
    const ctx = fresh();
    ctx.contracts[DOUYIN].commander_skill = bad;
    assert.ok(errorsOf(ctx).some((e) => e.includes('commander_skill')), JSON.stringify(bad));
  }
});

test('commander_skill 指向的陪跑 skill 必须在仓里且 frontmatter 版本一致', () => {
  const missing = fresh();
  missing.contracts[DOUYIN].commander_skill = { name: 'wf-not_exist_cap', version: '0.1.0' };
  assert.ok(errorsOf(missing).some((e) => /commander_skill.*不存在/.test(e)));
  const drift = fresh();
  drift.contracts[DOUYIN].commander_skill = { name: 'wf-douyin_video_publish', version: '9.9.9' };
  assert.ok(errorsOf(drift).some((e) => /commander_skill.*版本/.test(e)));
});

test('抖音视频发布合同挂陪跑 skill wf-douyin_video_publish', () => {
  const ctx = fresh();
  assert.equal(ctx.contracts[DOUYIN].commander_skill.name, 'wf-douyin_video_publish');
  assert.match(ctx.contracts[DOUYIN].commander_skill.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(errorsOf(ctx), []);
});

test('Commander 运行时清单：只收 codex_agent 合同，准备/收尾归外壳、业务归 agent，读回照抄合同', () => {
  const spec = commanderContractsSpec(fresh());
  const d = spec.contracts[DOUYIN];
  assert.ok(d, '缺抖音');
  assert.equal(d.execution_profile, 'codex_agent');
  assert.equal(d.brain_workflow_key, 'douyin_video_publish.android');
  assert.deepEqual(d.commander_skill, fresh().contracts[DOUYIN].commander_skill);
  assert.deepEqual(d.activities.map((a) => [a.key, a.by]), [['preflight', 'shell'], ['prepare', 'agent'], ['publish', 'agent'], ['verify', 'agent'], ['cleanup', 'shell']]);
  assert.deepEqual(d.activities.find((a) => a.key === 'publish').readback, { type: 'evidence', glob: '*publish*original.json', expect: { op: '>=', value: 1 } });
  assert.equal(spec.contracts.keyword_acquisition, undefined, '获客 wf-run 合同不进 Commander codex 清单');
  assert.equal(spec.contracts.kuaishou_video_publish.activities.find((a) => a.key === 'preflight').from, DOUYIN);
  assert.equal(spec.contracts.kuaishou_video_publish.commander_skill, null);
});

test('commander/workflow-contracts.json 与合同一致（gen --check）', () => {
  const r = spawnSync(process.execPath, ['scripts/product-map/gen-commander-contracts.mjs', '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const file = JSON.parse(readFileSync(new URL('../../../services/phone-adb-controller/commander/workflow-contracts.json', import.meta.url), 'utf8'));
  assert.ok(file.contracts[DOUYIN]);
});

test('原抖音合同升级v2：冻结私密视频输入、手机资源、一次预算与实际输出',()=>{
 const spec=commanderContractsSpec(fresh()).contracts.douyin_video_publish;
 assert.equal(spec.skill,'multi-platform-publish');assert.equal(spec.agent,'skill-factory');
 assert.deepEqual(spec.resources,{machine:'xian-m4',profile:'xiaolongxia',device_serial:'ANGYVB4311010223',account_ref:'Ai办公室'});
 assert.equal(spec.recovery.max_attempts,1);assert.equal(spec.recovery.retry_safe,false);assert.equal(spec.recovery.total_timeout_sec,2400);assert.equal(spec.recovery.cleanup_timeout_sec,300);
 for(const field of ['title','body','media_path','media_sha256','allow_discard_existing_draft','authorized','privacy','content_type'])assert.ok(spec.input_schema.required.includes(field),field);
 assert.equal(spec.input_schema.properties.privacy.const,'private');assert.equal(spec.input_schema.properties.content_type.const,'video');assert.equal(spec.input_schema.properties.authorized.const,true);
 for(const field of ['publication','privacy','readback','media_sha256','evidence'])assert.ok(spec.output_schema.required.includes(field),field);
 assert.equal(spec.output_schema.properties.publication.required.includes('work_id'),false);
});
