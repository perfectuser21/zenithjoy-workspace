import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync,writeFileSync,readFileSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest } from '../runtime-definition.mjs';
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'binding-runtime-'));const steps=JSON.stringify({steps:[{key:'test.run.execute',usage:{slot_key:'run'},mode:'checkpoint'}]});writeFileSync(join(dir,'step-dod.json'),steps);
 const body={schema_version:2,release:{id:'release'},deployment:{observation_id:'observation',target:'fixture'},workflow_version:{id:'wv',payload:{workflow_id:'workflow'}},activities:[{reference:{reference_id:'ref',slot_key:'run',activity_id:'activity',activity_version_id:'av'},version:{id:'av',payload:{steps:[{step_id:'step',locator:{step_key:'execute'},contract:{key:'execute'}}]}}}],files:{'step-dod.json':digest(steps)}};
 writeFileSync(join(dir,'run-definition.json'),JSON.stringify({...body,snapshot_sha256:digest(body)}));return dir;
}
async function server(t,handler){const seen=[];const s=createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;const event={method:req.method,path:req.url,body:raw?JSON.parse(raw):null};seen.push(event);const answer=handler(event);res.writeHead(answer.status||200,{'Content-Type':'application/json'});res.end(JSON.stringify(answer.body));});await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>s.close());return {seen,url:`http://127.0.0.1:${s.address().port}`};}
const cli=(dir,url)=>new Promise(resolve=>{const child=spawn(process.execPath,[new URL('../runtime-receipts.mjs',import.meta.url).pathname,'bind-run'],{env:{...process.env,WFR_RUN_DIR:dir,WFR_RUN_ID:'run',BRAIN_URL:url,BRAIN_INTERNAL_TOKEN:'fixture-token',WFR_HOSTKEY:'fixture'}});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('exit',code=>resolve({code,out,err}));});
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
