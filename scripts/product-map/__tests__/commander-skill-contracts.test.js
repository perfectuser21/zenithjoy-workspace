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
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
 assert.deepEqual(spec.resources,{machine:'xian-m4',profile:'legacy',device_serial:'ANGYVB4402004137',account_ref:'人工智能小诺考评'});
 assert.equal(spec.recovery.max_attempts,1);assert.equal(spec.recovery.retry_safe,false);assert.equal(spec.recovery.total_timeout_sec,2400);assert.equal(spec.recovery.cleanup_timeout_sec,300);
 for(const field of ['title','body','media_path','media_sha256','allow_discard_existing_draft','authorized','privacy','content_type'])assert.ok(spec.input_schema.required.includes(field),field);
 assert.equal(spec.input_schema.properties.privacy.const,'private');assert.equal(spec.input_schema.properties.content_type.const,'video');assert.equal(spec.input_schema.properties.authorized.const,true);
 for(const field of ['publication','privacy','readback','media_sha256','evidence'])assert.ok(spec.output_schema.required.includes(field),field);
 assert.equal(spec.output_schema.properties.publication.required.includes('work_id'),false);
});

test('冻结业务合同累计5次同类失败提出改进建议，不扩大单次执行尝试',()=>{
 const douyin=commanderContractsSpec(fresh()).contracts.douyin_video_publish;
 const report=JSON.parse(readFileSync(new URL('../../../services/phone-adb-controller/commander/contracts/workflow-report.json',import.meta.url),'utf8'));
 assert.equal(douyin.recovery.improvement_after_failures,5);assert.equal(douyin.recovery.max_attempts,1);
 assert.equal(report.recovery.improvement_after_failures,5);assert.equal(report.recovery.max_attempts,2);
 assert.deepEqual(errorsOf(fresh()),[]);
});

test('未还原Commander正文时必须核真实固定Git来源，坏repo/profile/loader锁不可借静态版本表通过',t=>{
 const root=mkdtempSync(join(tmpdir(),'commander-source-contract-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>{const r=spawnSync('git',['-c','core.hooksPath=/dev/null','-C',root,...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 git('init','-q');git('remote','add','origin','https://github.com/perfectuser21/zenithjoy-workspace.git');
 mkdirSync(join(root,'product-map/contracts'),{recursive:true});
 copyFileSync('product-map/contracts/activity-contract.schema.json',join(root,'product-map/contracts/activity-contract.schema.json'));
 const lock=JSON.parse(readFileSync('.skills-source.json'));
 const source=spawnSync('git',['clone','--no-hardlinks','--no-checkout','--quiet','.skills-source',join(root,'.skills-source')],{encoding:'utf8'});assert.equal(source.status,0,source.stderr);
 const env={...process.env,GIT_ALLOW_PROTOCOL:'file'};delete env.SKILLS_SOURCE_DIR;delete env.SKILLS_SOURCE_SSH_KEY;
 const script=`import {loadContractsFromDisk,validateContracts} from ${JSON.stringify(new URL('../contracts-lib.mjs',import.meta.url).href)};const ctx=loadContractsFromDisk();ctx.repoRoot=process.argv[1];console.log(JSON.stringify(validateContracts(ctx).filter(e=>e.includes('commander_skill'))));`;
 for(const [label,change] of [['valid',{}],['repo',{repository:'evil/not-central'}],['profile',{profile:'foreign'}],['loader',{loader_sha256:'0'.repeat(64)}]]){
  writeFileSync(join(root,'.skills-source.json'),JSON.stringify({...lock,...change}));git('add','.skills-source.json');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm',label);
  const r=spawnSync(process.execPath,['--input-type=module','-e',script,root],{env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  const errors=JSON.parse(r.stdout);if(label==='valid')assert.deepEqual(errors,[]);else assert.ok(errors.length>0,`${label}坏锁被当成已验证Skill来源`);
 }
});
