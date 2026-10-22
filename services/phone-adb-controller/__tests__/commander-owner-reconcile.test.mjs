import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,lstatSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import * as owner from '../activity-commander.mjs';

const scope={run_id:'unknown-owner__a2',binding_id:'binding-two',source_commit:'a'.repeat(40),task_id:null};
const sha=x=>createHash('sha256').update(x).digest('hex');
async function fixture(t){
 const home=mkdtempSync(join(tmpdir(),'owner-reconcile-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const turn=await owner.reserveWorkflowCommanderTurn(scope,{home});await turn.close();
 const session=owner.workflowCommanderSession(scope),file=join(home,'.openclaw/leadgen-owner-turns',session.split(':').at(-1)+'.pending.json');
 const raw=readFileSync(file),record=JSON.parse(raw),s=lstatSync(file);
 return {home,file,raw,record,request:{scope,session,expected:{dev:s.dev,ino:s.ino,sha256:sha(raw),transport_nonce:record.transport_nonce}}};
}
function readers(f,mode='quiet'){
 const gateway={pid:200,started_at_ms:Date.now(),command_sha256:'b'.repeat(64)};
 return {readHost:async()=>({gateway,scope_processes:[],observed_at:Date.now()}),readOfficial:async(method,params)=>{
  assert.equal(params.key??params.sessionKey??params.spawnedBy,f.request.session);
  if(method==='sessions.describe')return {session:{key:f.request.session,sessionId:'original-session',snapshotAt:Date.now(),hasActiveRun:mode==='active',activeRunIds:mode==='active'?['current']:[]}};
  if(method==='sessions.get')return {messages:[{role:'assistant',timestamp:Date.now()-1000}]};
  if(method==='chat.history')return {sessionKey:f.request.session,sessionId:'original-session',pendingInputs:{total:0,queued:0,items:[]}};
  if(method==='sessions.list')return {ts:Date.now(),sessions:[],hasMore:false};
  if(method==='tools.invoke')return {ok:true,toolName:'subagents',source:'core',output:{details:{status:'ok',action:'list',callerIsSubagent:false,callerSessionKey:f.request.session,requesterSessionKey:f.request.session,active:[]}}};
  throw Error('unexpected official method '+method);
 }};
}
test('未知pending只能由完整fresh官方inactive与换代本机读回CAS归档，不伪旧turn成功',async t=>{
 const f=await fixture(t);assert.equal(typeof owner.reconcileWorkflowCommanderTurn,'function','正式维护入口尚不存在');
 const result=await owner.reconcileWorkflowCommanderTurn(f.request,{home:f.home,...readers(f)});
 assert.equal(result.status,'reconciled_inactive');assert.equal(result.business_result,'unknown');
 assert.equal(existsSync(f.file),false);assert.deepEqual(readFileSync(result.original_path),f.raw);
 const proof=JSON.parse(readFileSync(result.receipt_path));assert.equal(proof.original.status,'reserved');assert.equal(proof.original_sha256,sha(f.raw));
 assert.equal(Object.hasOwn(proof,'execution_stopped'),false);
 const next=await owner.reserveWorkflowCommanderTurn(scope,{home:f.home});await next.close();
});
test('官方active、缺pending字段和scope漂移均保原pending拒绝归档',async t=>{
 assert.equal(typeof owner.reconcileWorkflowCommanderTurn,'function','正式维护入口尚不存在');
 for(const mode of ['active','missing_queue','wrong_nonce']){
  const f=await fixture(t),io=readers(f,mode),read=io.readOfficial;
  if(mode==='missing_queue')io.readOfficial=async(m,p)=>m==='chat.history'?{sessionKey:f.request.session,sessionId:'original-session'}:read(m,p);
  if(mode==='wrong_nonce')f.request.expected.transport_nonce='wrong';
  await assert.rejects(owner.reconcileWorkflowCommanderTurn(f.request,{home:f.home,...io}),/COMMANDER_OWNER_RECONCILE_/);
  assert.deepEqual(readFileSync(f.file),f.raw);
 }
});
