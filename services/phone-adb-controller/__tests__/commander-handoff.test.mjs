import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const HELPER=join(dirname(fileURLToPath(import.meta.url)),'../commander/wf-agent-handoff.py');
const parent='agent:work-commander:test-parent';
function call(dir,cmd,data,...args){return spawnSync('python3',[HELPER,cmd,dir,...args],{input:data==null?undefined:JSON.stringify(data),encoding:'utf8'});}
function setup(){
 const dir=mkdtempSync(join(tmpdir(),'wf-handoff-'));
 writeFileSync(join(dir,'state.env'),'RUN_ID=wfd-test\nTASK_ID=1234abcd-0000-4000-8000-000000000001\nAGENT=skill-factory\n');
 const p=call(dir,'init',null,parent,'60');assert.equal(p.status,0,p.stderr);
 const request=JSON.parse(readFileSync(join(dir,'agent-request.json')));
 const identity=Object.fromEntries(['run_id','task_id','parent_session_key','nonce'].map(k=>[k,request[k]]));
 const receipt={...identity,child_session_key:'agent:skill-factory:subagent:1234',child_run_id:'1234abcd-0000-4000-8000-000000000002'};
 return {dir,request,identity,receipt};
}
test('正式交接：绑定父子run后接收原始完成结果，重复同回执幂等',()=>{
 const {dir,receipt}=setup();
 assert.equal(call(dir,'bind',receipt).status,0);
 assert.equal(call(dir,'bind',receipt).status,0);
 const result={...receipt,status:'ok',result:'WF_DELIVERY {"claimed_result":"success"}'};
 assert.equal(call(dir,'complete',result).status,0);
 assert.equal(call(dir,'complete',result).status,0);
 assert.equal(JSON.parse(readFileSync(join(dir,'agent-delivery.json'))).claimed_result,'success');
 assert.equal(readFileSync(join(dir,'agent.log'),'utf8'),result.result);
});
test('拒绝跨run、父会话、子会话、nonce错配以及先完成后绑定',()=>{
 const {dir,receipt}=setup();
 assert.notEqual(call(dir,'complete',{...receipt,status:'ok',result:'WF_DELIVERY {}'}).status,0);
 assert.equal(call(dir,'bind',receipt).status,0);
 for(const key of ['run_id','task_id','parent_session_key','nonce','child_session_key','child_run_id']){
  assert.notEqual(call(dir,'complete',{...receipt,[key]:'wrong',status:'ok',result:'WF_DELIVERY {}'}).status,0,key);
 }
 assert.equal(existsSync(join(dir,'agent-delivery.json')),false);
});
test('过期或已关闭的run拒绝晚到交付，不把失败伪装成功',()=>{
 const {dir,receipt,request}=setup();
 assert.equal(call(dir,'bind',receipt).status,0);
 writeFileSync(join(dir,'agent-request.json'),JSON.stringify({...request,expires_at:1}));
 assert.notEqual(call(dir,'complete',{...receipt,status:'ok',result:'WF_DELIVERY {"claimed_result":"success"}'}).status,0);
 assert.equal(existsSync(join(dir,'agent-delivery.json')),false);
});

test('关闭后拒绝绑定/交付；官方失败不能采信模型自报success',()=>{
 const {dir,receipt}=setup();
 assert.equal(call(dir,'stop',null).status,0);
 assert.notEqual(call(dir,'bind',receipt).status,0);
 const next=setup();
 assert.equal(call(next.dir,'bind',next.receipt).status,0);
 assert.equal(call(next.dir,'complete',{...next.receipt,status:'error',result:'WF_DELIVERY {"claimed_result":"success"}'}).status,0);
 assert.equal(JSON.parse(readFileSync(join(next.dir,'agent-delivery.json'))).claimed_result,'failed');
});
