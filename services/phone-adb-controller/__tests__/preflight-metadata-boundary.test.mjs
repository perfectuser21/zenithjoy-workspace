import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHandlers} from '../leadgen-handlers.mjs';
import {digest} from '../runtime-definition.mjs';

// Catches the unsafe branch that dispatches an unclosed RPC outer before phone admission.
function rig(t,{metadataError,metadataGate,completePrepare=false}={}){
  const dir=mkdtempSync(join(tmpdir(),'preflight-metadata-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const source='a'.repeat(40),task='42e1439e-c7d3-47b5-8239-3308bcad32a7';
  const body={execution_mode:'agent',deployment:{source_commit:source},files:{}};
  writeFileSync(join(dir,'run-definition.json'),JSON.stringify({...body,snapshot_sha256:digest(body)}));
  const env={HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:'metadata_fixture',WFR_RUN_ID:'douyin_video_processing-metadata_fixture',WFR_ATTEMPT:'a1',P:'fixture',SERIAL:'fixture-serial',LEADGEN_LINE:'yuesheng',LEADGEN_SOURCE_RUN:'source101',LEADGEN_LIMIT:'2',WF_BRAIN_WORKFLOW:'douyin_video_processing'};
  const calls=[];
  const h=createHandlers({root:dir,env,sourceCommit:source,taskId:task,
    centralLease:{async verifyTask(){},async acquire(){calls.push('central-acquire');},async ensure(){},async verifyHeld(){}},
    rpc:async()=>{throw Error('FORBIDDEN_PREFLIGHT_RPC_OUTER');},
    preflightMetadata:async input=>{
      assert.equal(input.kind,'queue');assert.equal(input.request.op,'company_config');
      assert.deepEqual(input.request.device_binding,{profile:'fixture',device_serial:'fixture-serial'});
      if(metadataGate)await metadataGate;
      if(metadataError)throw Object.assign(Error(metadataError),{code:metadataError});
      return {result:{company_id:'company',tenant_id:'tenant',version:1,run_id:'metadata_fixture',device_binding:{company_id:'company',tenant_id:'tenant',version:1,run_id:'metadata_fixture',profile:'fixture',device_serial:'fixture-serial',douyin_id:'expected-account',verification_status:'verified',enabled:true}}};
    },
    execute:async(_command,args)=>{calls.push('physical');if(!completePrepare)throw Object.assign(Error('STOP_BEFORE_FIRST_PHYSICAL'),{code:'STOP_BEFORE_FIRST_PHYSICAL'});const stdout=args[0]?.endsWith('adb-existing-route.py')?'5042\n':args.includes('get-state')?'device\n':args.includes('preflight')?'serial=fixture-serial\n':args.includes('lock-acquire')?'lock=acquired\n':args.includes('lock-refresh')?'lock=refreshed\n':'mCallState=0\n';return {code:0,stdout,stderr:''};}
  });
  const scope={workflow:env.WF_BRAIN_WORKFLOW,activity:'preflight',run:env.WFR_TAG,run_id:env.WFR_RUN_ID+'__a1',task_id:task,binding_id:'00000000-0000-4000-8000-000000000001',source_commit:source,snapshot_sha256:digest(body),profile:env.P,serial:env.SERIAL,line:env.LEADGEN_LINE,source_run:'source101',limit:2,comment_limit:null,deadline_ms:Date.now()+20000};
  return {dir,h,calls,scope};
}
test('parent metadata admission preserves expected binding without claiming a verified UI account',async t=>{
  const r=rig(t),tools=await r.h.createAgentTools({key:'preflight'},r.scope);
  await assert.rejects(()=>tools.prepare(),{code:'STOP_BEFORE_FIRST_PHYSICAL'});
  assert.equal(r.h.state.company_config.expected_sender,'expected-account');
  assert.equal(r.h.state.account??null,null);
  assert.deepEqual(r.calls,['central-acquire','physical']);
});
test('unknown metadata outcome never acquires or starts physical execution',async t=>{
  const r=rig(t,{metadataError:'PREFLIGHT_METADATA_UNKNOWN'}),tools=await r.h.createAgentTools({key:'preflight'},r.scope);
  await assert.rejects(()=>tools.prepare(),{code:'PREFLIGHT_METADATA_UNKNOWN'});
  assert.deepEqual(r.calls,[]);assert.equal(r.h.state.account??null,null);
  assert.equal(existsSync(join(r.dir,'central-lock-events.jsonl')),false);
});

test('late metadata cannot acquire central ownership or start physical execution after the frozen deadline',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const r=rig(t,{metadataGate:gate});r.scope.deadline_ms=Date.now()+100;
  const tools=await r.h.createAgentTools({key:'preflight'},r.scope),pending=tools.prepare();
  await new Promise(resolve=>setTimeout(resolve,120));release();
  await assert.rejects(()=>pending,{code:'PREFLIGHT_METADATA_DEADLINE'});
  assert.deepEqual(r.calls,[]);assert.equal(r.h.state.account??null,null);
  assert.equal(existsSync(join(r.dir,'central-lock-events.jsonl')),false);
});
test('metadata worker deadline closes admission while receipt time remains available',async t=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});const r=rig(t,{metadataGate:gate});
 r.scope.deadline_ms=Date.now()+10000;r.scope.worker_deadline_ms=Date.now()+50;
 const tools=await r.h.createAgentTools({key:'preflight'},r.scope),pending=tools.prepare();await new Promise(resolve=>setTimeout(resolve,80));release();
 await assert.rejects(()=>pending,{code:'PREFLIGHT_METADATA_DEADLINE'});assert.deepEqual(r.calls,[]);assert.equal(r.h.state.account??null,null);
});

test('worker company_config reads the already verified parent snapshot without reopening the old RPC outer',async t=>{
 const r=rig(t,{completePrepare:true}),tools=await r.h.createAgentTools({key:'preflight'},r.scope);await tools.prepare();const count=r.calls.length;
 const result=await tools.business('company_config',{});assert.equal(result.device_binding.douyin_id,'expected-account');assert.equal(result.run_id,'metadata_fixture');
 assert.equal(r.calls.length,count);assert.equal(r.h.state.account??null,null);
});
