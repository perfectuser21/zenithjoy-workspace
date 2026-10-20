import test from 'node:test';
import assert from 'node:assert/strict';
import * as producer from '../create-release-acceptance.mjs';
import { releaseContract } from '../acceptance-record.mjs';
const sha='a'.repeat(40), other='b'.repeat(40);
const input=()=>({run_key:'candidate-case',title:'候选验收',gp_id:'gp-1',detail:{tenant_account:'qa'}});
const stamps=()=>({backend_sha:sha,backend_sha_src2:sha,frontend_sha:sha,frontend_sha_src2:sha});
const draft=()=>({...input(),detail:{...input().detail,...stamps()}});
test('自动生成固定合同，不要求人手编造checks或spec_sha',()=>{
 const r=producer.prepareAcceptance(draft(),{sha,targets:['api','dashboard']});
 assert.deepEqual(r.checks,releaseContract(['api','dashboard']).checks);
 assert.equal(r.detail.spec_sha,releaseContract(['api','dashboard']).spec_sha);
 assert.equal(r.detail.environment,'staging');assert.equal(r.detail.gate_verdict,undefined);
 assert.equal(r.checks[0].result,undefined);
});
for(const [label,mutate] of [['缺实测版本',x=>delete x.detail.backend_sha],['版本不符',x=>x.detail.frontend_sha=other],['预填绿灯',x=>x.detail.gate_verdict='绿'],['预填结果',x=>x.checks=[{result:'通过'}]]])test(label+'拒绝建单',()=>{const x=draft();mutate(x);assert.throws(()=>producer.prepareAcceptance(x,{sha,targets:['api','dashboard']}));});

function sources({backend=sha,dashboard=sha,staff=sha,githubFailure=false}={}) {
 const reads=[], writes=[];
 const urls={
  'https://staging-autopilot.zenjoymedia.media/api/health':{build:{sha:backend}},
  'https://staging-autopilot.zenjoymedia.media/release-sha.json':{sha:dashboard},
  'http://100.86.118.99:8091/api/health':{build:{sha:backend}},
  'http://100.86.118.99:8091/release-sha.json':{sha:staff},
 };
 const fetchImpl=async(url,options={})=>{
  const parsed=new URL(url), key=parsed.origin+parsed.pathname;
  reads.push(key);
  if(key==='http://localhost:5221/api/brain/acceptance/runs') {
   assert.equal(options.method,'POST');
   const data=JSON.parse(options.body); writes.push(data);
   return Response.json({created:true,run:{...data,id:'run-1',status:'pending'},checks:data.checks.map(c=>({...c,run_id:'run-1'}))});
  }
  assert.ok(key in urls,'不能访问未固定的输入URL：'+key);
  assert.equal(options.redirect,'error');
  return Response.json(urls[key]);
 };
 const api=path=>{
  if(path.includes('/compare/'))return {status:'ahead'};
  const url=new URL(path,'https://api.github.com/');
  const workflow=url.pathname.split('/').at(-2), version=url.searchParams.get('head_sha');
  return {workflow_runs:[{id:71,head_sha:version,head_branch:'main',event:'push',path:'.github/workflows/'+workflow,status:'completed',conclusion:githubFailure?'failure':'success',repository:{full_name:'perfectuser21/zenithjoy-workspace'}}]};
 };
 return {reads,writes,fetchImpl,api};
}
test('建单入口实际读取两个可信部署面，覆盖用户伪造版本及URL',async()=>{
 const s=sources({dashboard:other}); const request=input();
 request.detail.backend_sha='f'.repeat(40); request.detail.frontend_sha='f'.repeat(40);
 request.detail.staging_url='https://attacker.invalid/pass';
 const result=await producer.createReleaseAcceptance(request,{sha,targets:['api'],fetchImpl:s.fetchImpl,api:s.api});
 assert.equal(result.status,'pending');assert.equal(s.writes.length,1);
 assert.equal(s.writes[0].detail.backend_sha,sha);assert.equal(s.writes[0].detail.frontend_sha,other);
 assert.equal(s.writes[0].detail.frontend_sha_src2,other);
 assert.ok(s.reads.includes('https://staging-autopilot.zenjoymedia.media/api/health'));
 assert.ok(s.reads.includes('https://staging-autopilot.zenjoymedia.media/release-sha.json'));
});
test('staff使用独立Tailscale预发前端，后端允许独立版本但必须有同SHA部署证据',async()=>{
 const s=sources({backend:other});
 await producer.createReleaseAcceptance(input(),{sha,targets:['staff-hub'],fetchImpl:s.fetchImpl,api:s.api});
 assert.ok(s.reads.includes('http://100.86.118.99:8091/release-sha.json'));
 assert.ok(s.reads.includes('http://100.86.118.99:8091/api/health'));
 assert.equal(s.writes[0].detail.backend_sha,other);
});
for(const [label,setup,targets] of [
 ['实际候选不是输入SHA',{backend:other},['api']],
 ['GitHub同SHA部署失败',{githubFailure:true},['api']],
 ['另一个前端未部署候选',{staff:other},['dashboard','staff-hub']],
]) test(label+'不创建验收单',async()=>{
 const s=sources(setup);
 await assert.rejects(()=>producer.createReleaseAcceptance(input(),{sha,targets,fetchImpl:s.fetchImpl,api:s.api}));
 assert.equal(s.writes.length,0);
});
test('实际版本读取失败不退回用户自报双源版本',async()=>{
 const s=sources(); const request=draft();
 await assert.rejects(()=>producer.createReleaseAcceptance(request,{sha,targets:['api'],api:s.api,fetchImpl:async(url,o)=>String(url).includes('/api/health')?new Response('unavailable',{status:503}):s.fetchImpl(url,o)}));
 assert.equal(s.writes.length,0);
});
for(const [label,mutate] of [
 ['run_key',x=>x.run.run_key='other'],['gp_id',x=>x.run.gp_id='other'],
 ['标题',x=>x.run.title='other'],['双源',x=>x.run.detail.backend_sha_src2=other],
 ['租户',x=>x.run.detail.tenant_account='other'],['缺格',x=>x.checks.pop()],
 ['换格内容',x=>x.checks[0].name='其它不相关验收'],['串单',x=>x.checks[0].run_id='other'],
]) test('建单回读'+label+'不一致不能当成成功',async()=>{
 const data={...draft(),source:'manual',checks:releaseContract(['api']).checks};
 data.detail={...data.detail,source_repo:'perfectuser21/zenithjoy-workspace',environment:'staging',release_targets:['api'],spec_sha:releaseContract(['api']).spec_sha};
 const record={created:false,run:{...structuredClone(data),id:'run-1',status:'pending'},checks:data.checks.map(c=>({...c,run_id:'run-1'}))};mutate(record);
 await assert.rejects(()=>producer.createAcceptance(data,{fetchImpl:async()=>Response.json(record)}));
});

test('SPA的HTTP200兜底页不是版本证据，错误说明具体入口且不建单',async()=>{
 const s=sources();
 await assert.rejects(()=>producer.createReleaseAcceptance(input(),{sha,targets:['api'],api:s.api,fetchImpl:async(url,o)=>String(url).includes('/release-sha.json')?new Response('<!doctype html><title>Dashboard</title>',{status:200}):s.fetchImpl(url,o)}),/staging-autopilot.*release-sha.json.*JSON/);
 assert.equal(s.writes.length,0);
});
