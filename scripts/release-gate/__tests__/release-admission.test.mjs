import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAcceptance, releaseContract } from '../acceptance-record.mjs';
import { validateStagingRun } from '../staging-evidence.mjs';
const sha = 'a'.repeat(40), repo = 'perfectuser21/zenithjoy-workspace';
function receipt() { const c=releaseContract(['api','dashboard']);return {run:{id:'run-id',run_key:'release-check',status:'adjudicated',gp_id:'gp',detail:{source_repo:repo,environment:'staging',release_targets:['api','dashboard'],backend_sha:sha,backend_sha_src2:sha,frontend_sha:sha,frontend_sha_src2:sha,spec_sha:c.spec_sha,gate_verdict:'绿'}}, checks:c.checks.map(x=>({...x,run_id:'run-id',result:'通过',note:'evidence://result/'+x.check_key}))}; }
const options={sha,targets:['api','dashboard'],runKey:'release-check'};
test('真实同版本staging验收允许晋级',()=>assert.doesNotThrow(()=>validateAcceptance(receipt(),options)));
for (const [name,mutate] of [
 ['未完成',x=>x.run.status='in_review'],['旧版本',x=>x.run.detail.backend_sha='b'.repeat(40)],
 ['前端不是同一候选',x=>x.run.detail.frontend_sha='c'.repeat(40)],['版本双源不符',x=>x.run.detail.backend_sha_src2='b'.repeat(40)],
 ['生产环境冒充staging',x=>x.run.detail.environment='production'],['其它仓',x=>x.run.detail.source_repo='someone/else'],
 ['错误目标',x=>x.run.detail.release_targets=['staff-hub']],['缺验收格',x=>x.checks=[]],
 ['伪绿但格红',x=>x.checks[0].result='不通过'],['无法验证',x=>x.checks[0].result='无法验证'],
 ['无业务证据',x=>x.checks[0].note=''],['重复格',x=>x.checks.push(x.checks[0])],
 ['其它验收单',x=>x.run.run_key='different'],['跨run混入格',x=>x.checks[0].run_id='different'],
 ['哑火',x=>x.run.detail.ai_status='dumb'],['没有定案',x=>x.run.status='human_complete'],['漏了规程格',x=>x.checks.pop()],['伪造规程',x=>x.run.detail.spec_sha='fake'],['验收项替换',x=>x.checks[0].name='总是通过']
]) test(`${name}拒绝晋级`,()=>{const x=receipt();mutate(x);assert.throws(()=>validateAcceptance(x,options));});
const run=()=>({id:123,head_sha:sha,head_branch:'main',event:'push',path:'.github/workflows/deploy-staging-hk.yml',status:'completed',conclusion:'success',repository:{full_name:repo}});
test('同版本香港staging成功可作为部署证据',()=>assert.doesNotThrow(()=>validateStagingRun(run(),{sha,workflow:'deploy-staging-hk.yml'})));
for(const [key,value] of Object.entries({head_sha:'b'.repeat(40),head_branch:'feature/fake',event:'pull_request',conclusion:'failure',status:'in_progress',path:'.github/workflows/deploy-us-vps.yml'}))test(`staging ${key}不符拒绝`,()=>assert.throws(()=>validateStagingRun({...run(),[key]:value},{sha,workflow:'deploy-staging-hk.yml'})));
test('固定发布规程包含每个组件的业务最小集合',()=>{
 assert.deepEqual(releaseContract(['api','dashboard']).checks.map(c=>c.check_key),['S1-c1','S2-c1','S3-c1','S4-c1','S5-c1']);
 assert.deepEqual(releaseContract(['staff-hub']).checks.map(c=>c.check_key),['S6-c1','S7-c1']);
});
test('Brain正常终态默认读取不请求被禁止的review视图',async()=>{
 const {readAcceptance}=await import('../acceptance-record.mjs');
 const {createServer}=await import('node:http');
 const server=createServer((req,res)=>{if(req.url!='/api/brain/acceptance/runs/release-check'){res.writeHead(403);res.end();return;}res.setHeader('content-type','application/json');res.end(JSON.stringify(receipt()));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try { const r=await readAcceptance({...options,baseUrl:`http://127.0.0.1:${server.address().port}`});assert.equal(r.check_count,5); }
 finally {await new Promise(resolve=>server.close(resolve));}
});
test('最近同SHA失败不会被更早成功运行遮住',async()=>{
 const {verifyStaging}=await import('../staging-evidence.mjs');
 const api=path=>path.includes('/compare/')?{status:'ahead'}:{workflow_runs:[run(),{...run(),id:124,conclusion:'failure'}]};
 assert.throws(()=>verifyStaging({sha,targets:['api'],api}),/未通过/);
});
