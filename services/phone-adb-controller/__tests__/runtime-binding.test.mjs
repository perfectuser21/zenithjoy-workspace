import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync,writeFileSync,readFileSync,existsSync } from 'node:fs';
import { tmpdir,hostname } from 'node:os';
import { deploymentTarget } from '../deployment-release.mjs';
const actualHost=deploymentTarget(hostname());
import { join } from 'node:path';
import { digest } from '../runtime-definition.mjs';
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'binding-runtime-'));const steps=JSON.stringify({steps:[{key:'test.run.execute',usage:{slot_key:'run'},mode:'checkpoint'}]});writeFileSync(join(dir,'step-dod.json'),steps);
 const body={schema_version:2,release:{id:'release',target:actualHost},deployment:{observation_id:'observation',target:actualHost},workflow_version:{id:'wv',payload_sha256:'a'.repeat(64),payload:{workflow_id:'workflow'}},activities:[{reference:{reference_id:'ref',slot_key:'run',activity_id:'activity',activity_version_id:'av'},version:{id:'av',payload:{steps:[{step_id:'step',locator:{step_key:'execute'},contract:{key:'execute'}}]}}}],files:{'step-dod.json':digest(steps)}};
 writeFileSync(join(dir,'run-definition.json'),JSON.stringify({...body,snapshot_sha256:digest(body)}));return dir;
}
async function server(t,handler){const seen=[];const s=createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;const event={method:req.method,path:req.url,body:raw?JSON.parse(raw):null};seen.push(event);const answer=handler(event);res.writeHead(answer.status||200,{'Content-Type':'application/json'});res.end(JSON.stringify(answer.body));});await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>s.close());return {seen,url:`http://127.0.0.1:${s.address().port}`};}
const cli=(dir,url,args=['bind-run'])=>new Promise(resolve=>{const child=spawn(process.execPath,[new URL('../runtime-receipts.mjs',import.meta.url).pathname,...args],{env:{...process.env,WFR_RUN_DIR:dir,WFR_RUN_ID:'run',WFR_ATTEMPT:'a1',BRAIN_URL:url,BRAIN_INTERNAL_TOKEN:'fixture-token',WFR_HOSTKEY:'fixture'}});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('exit',code=>resolve({code,out,err}));});
test('HTTP绑定ACK前持久请求；失联重试同attempt/内容，ACK后真实续跑新attempt',async t=>{
 const dir=fixture();let failure=true,last;
 const s=await server(t,e=>{if(e.method==='POST'){assert.ok(existsSync(join(dir,'run-bindings',`${e.body.attempt_key}.request.json`)));last=e.body;if(failure)return {status:503,body:{error:'offline'}};return {body:{binding:{id:`binding-${e.body.attempt_key}`,run_id:e.path.split('/')[4],...e.body}}};}return {body:{binding:{id:`binding-${last.attempt_key}`,run_id:e.path.split('/')[4],...last}}};});
 const first=await cli(dir,s.url);assert.equal(first.code,1);assert.equal(s.seen.length,1,'失败应发生在真实POST，而非未知CLI命令');
 failure=false;const second=await cli(dir,s.url);assert.equal(second.code,0,second.err);assert.match(second.out,/WFR_ATTEMPT=a1/);
 assert.deepEqual(s.seen[0].body,s.seen[1].body);assert.equal(last.expected_path.filter(p=>p.step_id==='step'&&p.required).length,1);
 const third=await cli(dir,s.url);assert.equal(third.code,0,third.err);assert.match(third.out,/WFR_ATTEMPT=a2/);assert.equal(last.run_binding_id,undefined);
 assert.doesNotMatch(readFileSync(join(dir,'run-bindings/a1.request.json'),'utf8'),/fixture-token/);
});
test('409绑定冲突明确拒绝且持久blocked，不作为网络pending重复提交',async t=>{
 const dir=fixture();const s=await server(t,()=>({status:409,body:{code:'CONFLICT'}}));
 assert.equal((await cli(dir,s.url)).code,1);assert.equal(s.seen.length,1);
 assert.equal((await cli(dir,s.url)).code,1);assert.equal(s.seen.length,1);
});

test('v2 span必须带已ACK绑定及版本/位置/attempt；skipped保留明确原因',async t=>{
 const dir=fixture();let last;const s=await server(t,e=>{
  if(e.path.endsWith('/spans'))return {body:{inserted:1}};
  if(e.method==='POST')last=e.body;return {body:{binding:{id:'binding-a1',run_id:'run__a1',...last}}};
 });
 assert.equal((await cli(dir,s.url)).code,0);
 const artifact=join(dir,'artifact.json');writeFileSync(artifact,JSON.stringify({observed_at:new Date().toISOString(),summary:'本词判定未通过',metrics:{}}));
 const sent=await cli(dir,s.url,['span','run','blocked','1',artifact]);assert.equal(sent.code,0,sent.err);
 const span=s.seen.find(e=>e.path.endsWith('/spans')).body[0];
 assert.equal(span.identity_protocol,2);assert.equal(span.run_binding_id,'binding-a1');assert.equal(span.reference_id,'ref');assert.equal(span.activity_definition_version_id,'av');assert.equal(span.workflow_definition_version_id,'wv');assert.equal(span.attempt_key,'a1');assert.equal(span.enabler_call_id,null);
 assert.equal(span.evidence.runtime_snapshot_sha256,last.runtime_snapshot_sha256);assert.equal(span.evidence.skip_reason,'本词判定未通过');
});
test('缺绑定ACK不能生成新span；不能降级v1冒充兼容',async t=>{
 const dir=fixture();const s=await server(t,()=>({body:{inserted:1}}));const file=join(dir,'artifact.json');writeFileSync(file,'{"metrics":{}}');
 assert.equal((await cli(dir,s.url,['span','run','completed','1',file])).code,1);assert.equal(s.seen.length,0);
});
test('有规范UUID的Step必须在冻结计划出现，缺计划不得静默省略绑定路径',async()=>{
 const {expectedPath}=await import('../runtime-binding.mjs');const frozen=JSON.parse(readFileSync(join(fixture(),'run-definition.json'),'utf8'));
 assert.throws(()=>expectedPath(frozen,{steps:[]}),/Step.*冻结计划/);
 const path=expectedPath(frozen,{steps:[{key:'test.run.execute',usage:{slot_key:'run'}}]});assert.equal(path.length,2);assert.equal(path[1].required,true);
});

test('异机复制冻结件且伪造WFR_HOSTKEY仍拒绝，零ledger和HTTP',async t=>{
 const dir=fixture(),file=join(dir,'run-definition.json');const {snapshot_sha256,...body}=JSON.parse(readFileSync(file,'utf8'));
 body.release.target='fixture';body.deployment.target='fixture';writeFileSync(file,JSON.stringify({...body,snapshot_sha256:digest(body)}));
 const s=await server(t,e=>({body:{binding:{id:'binding',run_id:'run__a1',...e.body}}}));
 const result=await cli(dir,s.url);assert.equal(result.code,1);assert.match(result.err,/实际.*机器|实际.*主机/);
 assert.equal(s.seen.length,0);assert.equal(existsSync(join(dir,'ledger.json')),false);assert.equal(existsSync(join(dir,'run-bindings')),false);
});
