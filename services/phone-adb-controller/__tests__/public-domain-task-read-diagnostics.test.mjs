import test from 'node:test';
import assert from 'node:assert/strict';
import {readPublicDomainClaim} from '../public-domain-pg.mjs';
import {createLeadgenAgentTools} from '../leadgen-agent-tools.mjs';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('公共Task准入失败明确区分GET传输、HTTP与解析，保持拒绝且不重试',async t=>{
 const wire=Object.assign(Error('private-token-not-for-diagnostic'),{code:'ECONNRESET'});
 const cases=[
  {fetch:async()=>{throw wire;},code:'PUBLIC_DOMAIN_TASK_GET_TRANSPORT',cause:wire},
  {fetch:async()=>({ok:false,status:503}),code:'PUBLIC_DOMAIN_TASK_GET_HTTP'},
  {fetch:async()=>({ok:true,json:async()=>{throw wire;}}),code:'PUBLIC_DOMAIN_TASK_GET_BODY',cause:wire},
 ];
 for(const sample of cases){
  let calls=0;const mock=t.mock.method(globalThis,'fetch',async()=>{calls++;return sample.fetch();});
  try{await assert.rejects(()=>readPublicDomainClaim({identity:{task_id:'7037d210-2af1-4af9-8635-f93a805e58b6',run_binding:{}},env:{BRAIN_URL:'http://brain.test:5221',BRAIN_INTERNAL_TOKEN:'unit-only'}}),error=>error.message==='PUBLIC_DOMAIN_PG_SCOPE'&&error.code===sample.code&&error.cause===sample.cause);assert.equal(calls,1);}
  finally{mock.mock.restore();}
 }
});

function publicTask(){
 const identity={task_id:randomUUID(),run_id:randomUUID(),machine_id:'fixture',profile_sha256:'a'.repeat(64),run_binding:{run_binding_id:randomUUID(),workflow_id:randomUUID(),workflow_definition_version_id:randomUUID(),attempt_key:'task:1',activities:{preflight:{reference_id:randomUUID(),activity_id:randomUUID(),activity_definition_version_id:randomUUID()}}}};
 const task={id:identity.task_id,status:'in_progress',claimed_by:'common-runner',claimed_at:'2026-11-09T00:00:00Z',result:{common_runner:{task_id:identity.task_id,run_id:identity.run_id,machine_id:identity.machine_id,profile_sha256:identity.profile_sha256,run_binding:identity.run_binding}}};
 return {identity,task};
}
async function httpFixture(t,respond){
 const requests=[];
 const server=createServer((req,res)=>{requests.push({method:req.method,url:req.url,authorization:req.headers.authorization});respond(req,res,requests.length);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 return {requests,env:{BRAIN_URL:'http://127.0.0.1:'+server.address().port,BRAIN_INTERNAL_TOKEN:'fixture-not-secret'}};
}
function heartbeatTools(t,identity,env){
 const runDir=mkdtempSync(join(tmpdir(),'claim-read-heartbeat-'));t.after(()=>rmSync(runDir,{recursive:true,force:true}));
 const calls={phone:0,unknown:0};
 const tools=createLeadgenAgentTools({runDir,scope:{workflow:'douyin_video_discovery',activity:'preflight',run:'claim_fixture',run_id:'douyin_video_discovery-claim_fixture__a1',task_id:identity.task_id,binding_id:identity.run_binding.run_binding_id,source_commit:'a'.repeat(40),snapshot_sha256:'b'.repeat(64),profile:'fixture',serial:'fixture',line:'fixture',source_run:null,limit:1,deadline_ms:Date.now()+30000},primitives:{assertResources:async()=>true,heartbeat:()=>readPublicDomainClaim({identity,env}),resourceUnknown:()=>{calls.unknown++;},validatePhone:async()=>[],phone:async()=>{calls.phone++;return '';},inspect:async()=>({})}});
 return {tools,calls};
}

test('真实Task GET断连后同身份再读成功，心跳不隔离且手机只准入一次',async t=>{
 const {identity,task}=publicTask();
 const http=await httpFixture(t,(req,res,n)=>{if(n===1){req.socket.destroy();return;}res.setHeader('content-type','application/json');res.end(JSON.stringify(task));});
 const {tools,calls}=heartbeatTools(t,identity,http.env);
 const receipt=await tools.heartbeat();assert.equal(receipt.claim_verified,true);
 await tools.phone('open-app');assert.deepEqual(calls,{phone:1,unknown:0});
 assert.equal(http.requests.length,2);assert.deepEqual(http.requests.map(r=>r.method),['GET','GET']);
 assert.ok(http.requests.every(r=>r.url==='/api/brain/tasks/'+identity.task_id&&r.authorization==='Bearer fixture-not-secret'));
 assert.deepEqual((await tools.inspect()).pending_write_readbacks,[]);
});

test('真实Task GET持续断连最多两次，心跳保留未知且不再派手机',async t=>{
 const {identity}=publicTask(),http=await httpFixture(t,req=>req.socket.destroy());
 const {tools,calls}=heartbeatTools(t,identity,http.env);
 await assert.rejects(()=>tools.heartbeat(),/UNKNOWN/);
 assert.equal(http.requests.length,2);assert.ok(http.requests.every(r=>r.method==='GET'));
 await assert.rejects(()=>tools.phone('open-app'),/UNKNOWN/);
 assert.deepEqual(await tools.heartbeat(),{deferred:true,commit_unknown:true});
 assert.equal(http.requests.length,2);assert.deepEqual(calls,{phone:0,unknown:1});
 assert.deepEqual((await tools.inspect()).pending_write_readbacks,[{operation:'resource_heartbeat',readback_operations:[]}]);
});

test('断连后的Task已经撤权，重新读到JSON也不得准入手机',async t=>{
 const {identity,task}=publicTask();task.status='failed';
 const http=await httpFixture(t,(req,res,n)=>{if(n===1){req.socket.destroy();return;}res.end(JSON.stringify(task));});
 const {tools,calls}=heartbeatTools(t,identity,http.env);
 await assert.rejects(()=>tools.heartbeat(),/UNKNOWN/);assert.equal(http.requests.length,2);
 await assert.rejects(()=>tools.phone('open-app'),/UNKNOWN/);assert.deepEqual(calls,{phone:0,unknown:1});
});
