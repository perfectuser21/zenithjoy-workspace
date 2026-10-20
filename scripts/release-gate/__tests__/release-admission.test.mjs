import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAcceptance } from '../acceptance-record.mjs';
import { validateStagingRun } from '../staging-evidence.mjs';
const sha = 'a'.repeat(40), repo = 'perfectuser21/zenithjoy-workspace';
function receipt() { return {run:{id:'run-id',run_key:'release-check',status:'human_complete',gp_id:'gp',detail:{source_repo:repo,environment:'staging',release_targets:['api','dashboard'],backend_sha:sha,backend_sha_src2:sha,frontend_sha:sha,frontend_sha_src2:sha,spec_sha:'spec-v1',gate_verdict:'绿'}}, checks:[{run_id:'run-id',check_key:'S1-c1',result:'通过',note:'evidence://result/1',adjudication:{verdict:'绿',by:'reviewer',reason:'已读回业务产出',at:'2026-10-20T00:00:00Z'}}]}; }
const options={sha,targets:['api','dashboard'],runKey:'release-check'};
test('真实同版本staging验收允许晋级',()=>assert.doesNotThrow(()=>validateAcceptance(receipt(),options)));
for (const [name,mutate] of [
 ['未完成',x=>x.run.status='in_review'],['旧版本',x=>x.run.detail.backend_sha='b'.repeat(40)],
 ['前端不是同一候选',x=>x.run.detail.frontend_sha='c'.repeat(40)],['版本双源不符',x=>x.run.detail.backend_sha_src2='b'.repeat(40)],
 ['生产环境冒充staging',x=>x.run.detail.environment='production'],['其它仓',x=>x.run.detail.source_repo='someone/else'],
 ['错误目标',x=>x.run.detail.release_targets=['staff-hub']],['缺验收格',x=>x.checks=[]],
 ['伪绿但格红',x=>x.checks[0].adjudication.verdict='红'],['无法验证',x=>x.checks[0].result='无法验证'],
 ['无业务证据',x=>x.checks[0].note=''],['重复格',x=>x.checks.push(x.checks[0])],
 ['其它验收单',x=>x.run.run_key='different'],['跨run混入格',x=>x.checks[0].run_id='different'],
 ['哑火',x=>x.run.detail.ai_status='dumb'],['没有定案',x=>delete x.checks[0].adjudication]
]) test(`${name}拒绝晋级`,()=>{const x=receipt();mutate(x);assert.throws(()=>validateAcceptance(x,options));});
const run=()=>({id:123,head_sha:sha,head_branch:'main',event:'push',path:'.github/workflows/deploy-staging-hk.yml',status:'completed',conclusion:'success',repository:{full_name:repo}});
test('同版本香港staging成功可作为部署证据',()=>assert.doesNotThrow(()=>validateStagingRun(run(),{sha,workflow:'deploy-staging-hk.yml'})));
for(const [key,value] of Object.entries({head_sha:'b'.repeat(40),head_branch:'feature/fake',event:'pull_request',conclusion:'failure',status:'in_progress',path:'.github/workflows/deploy-us-vps.yml'}))test(`staging ${key}不符拒绝`,()=>assert.throws(()=>validateStagingRun({...run(),[key]:value},{sha,workflow:'deploy-staging-hk.yml'})));
