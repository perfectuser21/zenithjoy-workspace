import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRpc,RPC_FILES} from '../leadgen-client.mjs';
import {workflowCommanderSession} from '../commander-owner-state.mjs';
import * as owner from '../commander-owner-state.mjs';

const sha='6ca1596321e5939a53a7ef020ac2609b890cc7f5';
const scope={workflow_key:'douyin_video_discovery',run_id:'douyin_video_discovery-accept6ca_jinuo101_20261029t2002__a1',binding_id:'f9231bee-ae73-4ab5-bcb7-e4491682ebdf',source_commit:sha,task_id:null,activity:'collect_videos',phase:'after'};
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(t){
 const home=mkdtempSync(join(tmpdir(),'commander-returned-readback-'));
 t.after(()=>rmSync(home,{recursive:true,force:true}));
 const dir=join(home,'.openclaw','leadgen-owner-turns');mkdirSync(dir,{recursive:true,mode:0o700});
 const session=workflowCommanderSession(scope),file=join(dir,session.split(':').at(-1)+'.pending.json');
 const nonce='68b014c5-1f6d-481e-b8a7-0038ed575295';
 const original={protocol:'commander-owner-turn-v1',session,run_id:scope.run_id,binding_id:scope.binding_id,source_commit:sha,task_id:null,transport_nonce:nonce,status:'reserved',started_at:'2026-10-29T12:10:22.918Z'};
 const raw=JSON.stringify({status:'ok',runId:'gateway-1',result:{payloads:[{text:JSON.stringify({action:'continue',reason:'采集完成，继续清场'})}],meta:{agentMeta:{provider:'openai',model:'test-model',sessionId:'session-1',terminalReceipt:{runId:'gateway-1',sessionId:'session-1',turnId:'turn-1',effective:{provider:'openai',model:'test-model'}}}}}});
 const returned={...original,status:'returned',returned_at:'2026-10-29T12:10:29.409Z',response_sha256:hash(raw),workflow_key:scope.workflow_key,activity:scope.activity,phase:scope.phase,raw_response:raw,original_sha256:hash(JSON.stringify(original))};
 const path=file+'.'+nonce+'.returned.json';
 writeFileSync(file+'.'+nonce+'.returned.original.json',JSON.stringify(original),{mode:0o600});
 writeFileSync(path,JSON.stringify(returned),{mode:0o600});
 return {path,returned};
}
test('SSH 空回执后只读恢复同 run/SHA/binding/activity/phase 的原始 returned，绝不重发 Commander',async t=>{
 const {path}=fixture(t),calls=[];
 const frozen={deployment:{source_commit:sha},files:Object.fromEntries(RPC_FILES.map(p=>['runtime/'+p,'b'.repeat(64)]))};
 const rpc=createRpc({frozen,execute:async(_cmd,_args,opts)=>{
  const body=JSON.parse(opts.input);calls.push(body);
  return calls.length===1?{code:255,stdout:'',stderr:'Connection closed'}:{code:0,stdout:JSON.stringify({ok:true,decision:owner.readReturnedCommanderTurn(body.receipt,{home:path.split('/.openclaw/')[0]})}),stderr:''};
 }});
 const result=await rpc({kind:'commander',receipt:scope},{timeoutMs:3000});
 assert.equal(result.decision.action,'continue');
 assert.deepEqual(calls.map(c=>c.kind),['commander','commander_readback']);
 assert.deepEqual(calls[1].receipt,scope);
});
test('只读回执拒绝不匹配、损坏或多份归档，不能误报成功',t=>{
 const {path,returned}=fixture(t),home=path.split('/.openclaw/')[0];
 assert.equal(owner.readReturnedCommanderTurn(scope,{home}).action,'continue');
 for(const key of ['run_id','source_commit','binding_id','activity','phase']){
  const wrong={...scope,[key]:key==='source_commit'?'a'.repeat(40):'different'};
  assert.throws(()=>owner.readReturnedCommanderTurn(wrong,{home}));
 }
 writeFileSync(path,JSON.stringify({...returned,response_sha256:'0'.repeat(64)}),{mode:0o600});
 assert.throws(()=>owner.readReturnedCommanderTurn(scope,{home}));
});
