import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execInput} from '../leadgen-client.mjs';
import {reserveWorkflowCommanderTurn,workflowCommanderSession,ownerPending} from '../commander-owner-state.mjs';
const api=await import('../official-skill-owner.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
function fixture(t,variant='ok'){
 const directory=mkdtempSync(join(tmpdir(),'official-owner-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const request={protocol:'leadgen-activity-v1',mode:'execute',primary_host:'official-child-v1',run_id:'fixture__a1',task_id:'11111111-1111-4111-8111-111111111111',binding_id:'22222222-2222-4222-8222-222222222222',nonce:'a'.repeat(48),source_commit:'b'.repeat(40),deadline_ms:Date.now()+10000,receipt_deadline_ms:Date.now()+8000};
 const parent=workflowCommanderSession(request),cli=join(directory,'gateway-fixture');
 writeFileSync(join(directory,'activity-request.json'),JSON.stringify(request),{mode:0o600});
 writeFileSync(cli,`#!/usr/bin/python3
import sys,json,time,pathlib
d=pathlib.Path(${JSON.stringify(directory)});v=${JSON.stringify(variant)}
assert sys.argv[1:3]==['gateway','call']
method=sys.argv[3];params=json.loads(sys.argv[sys.argv.index('--params')+1])
intent=json.loads((d/'owner-rpc-intent.json').read_text())
assert '--expect-final' not in sys.argv
with (d/'calls.jsonl').open('a') as f:f.write(json.dumps({'method':method,'params':params})+'\\n')
if method=='agent':
 assert params['idempotencyKey']==intent['owner_run_id'] and params['sessionKey']==intent['parent_session_key']
 assert 'runId' not in params
 if v=='acklost':sys.exit(2)
 print(json.dumps({'runId':'wrong' if v=='wrong-ack' else params['idempotencyKey'],'sessionKey':params['sessionKey'],'agentId':'work-commander','status':'accepted','acceptedAt':int(time.time()*1000)}))
elif method=='agent.wait':
 assert params['runId']==intent['owner_run_id']
 if v=='pending':print(json.dumps({'runId':params['runId'],'status':'timeout'}))
 else:print(json.dumps({'runId':'wrong' if v=='wrong-terminal' else params['runId'],'status':'error','startedAt':intent['started_at_ms'],'endedAt':intent['receipt_deadline_ms']+1 if v=='outside-budget' else int(time.time()*1000)}))
else:raise RuntimeError('unexpected RPC')
`,{mode:0o700});
 return {directory,request,parent,message:'parent instruction literal $(false)',authorize:async()=>true,execute:(_command,args,options)=>execInput(cli,args,options)};
}
for(const variant of ['ok','acklost'])test('real fixed CLI persists owner key before one agent RPC; '+variant+' follows exact-key wait',async t=>{
 assert.equal(typeof api.runOfficialSkillOwner,'function');const f=fixture(t,variant);
 const result=await api.runOfficialSkillOwner(f);
 assert.equal(api.officialOwnerTerminated(result,f.request),true);
 assert.equal(api.officialOwnerTerminated({...result},f.request),false);
 assert.equal(api.officialOwnerTerminated(result,{...f.request,nonce:'c'.repeat(48)}),false);
 const calls=readFileSync(join(f.directory,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.deepEqual(calls.map(c=>c.method),['agent','agent.wait']);
 assert.equal(calls[0].params.idempotencyKey,calls[1].params.runId);
 assert.equal(existsSync(join(f.directory,'parent-cli-result.json')),false);
 await assert.rejects(()=>api.runOfficialSkillOwner(f));
 assert.equal(readFileSync(join(f.directory,'calls.jsonl'),'utf8').trim().split('\n').length,2,'existing intent cannot relaunch');
});
for(const variant of ['wrong-ack','wrong-terminal','pending'])test('official owner '+variant+' remains unknown without another agent dispatch',async t=>{
 assert.equal(typeof api.runOfficialSkillOwner,'function');const f=fixture(t,variant);
 if(variant==='pending'){f.request.receipt_deadline_ms=Date.now()+1000;writeFileSync(join(f.directory,'activity-request.json'),JSON.stringify(f.request));}
 const result=await api.runOfficialSkillOwner(f);assert.equal(api.officialOwnerTerminated(result,f.request),false);assert.equal(result.execution_stopped,false);
 const calls=readFileSync(join(f.directory,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(calls.filter(c=>c.method==='agent').length,1);assert.ok(calls.filter(c=>c.method==='agent.wait').length>=1);
});
test('official terminal archives only its real branded owner reservation without minting a CLI-returned record',async t=>{
 const f=fixture(t,'acklost'),turn=await reserveWorkflowCommanderTurn(f.request,{home:f.directory});
 try{
  assert.equal(typeof turn.observedTerminal,'function');const result=await api.runOfficialSkillOwner(f);
  await assert.rejects(()=>turn.observedTerminal({...result}));
  await turn.observedTerminal(result);
  const file=ownerPending(f.request,f.directory).file;
  assert.equal(existsSync(file),false);
  const {readdirSync}=await import('node:fs');const files=readdirSync(join(f.directory,'.openclaw/leadgen-owner-turns'));
  assert.equal(files.some(name=>name.endsWith('.returned.json')),false);
  assert.equal(files.filter(name=>name.endsWith('.official_terminal.json')).length,1);
 }finally{await turn.close();}
});
test('mutable source during trusted admission cannot dispatch a mismatched frozen owner intent',async t=>{
 const f=fixture(t);f.authorize=async()=>{f.request.source_commit='c'.repeat(40);return true;};
 await assert.rejects(()=>api.runOfficialSkillOwner(f));assert.equal(existsSync(join(f.directory,'calls.jsonl')),false);assert.equal(existsSync(join(f.directory,'owner-rpc-intent.json')),false);
});
test('a terminal timestamp beyond the unchanged receipt deadline cannot mint an owner stop proof',async t=>{
 const f=fixture(t,'outside-budget');f.request.receipt_deadline_ms=Date.now()+900;writeFileSync(join(f.directory,'activity-request.json'),JSON.stringify(f.request));
 const result=await api.runOfficialSkillOwner(f);assert.equal(result.execution_stopped,false);assert.equal(api.officialOwnerTerminated(result,f.request),false);
});
