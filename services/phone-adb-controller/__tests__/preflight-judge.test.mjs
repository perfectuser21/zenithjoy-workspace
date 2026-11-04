import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {createHash} from 'node:crypto';import {RPC_FILES} from '../leadgen-client.mjs';
const root=dirname(new URL('../leadgen-handlers.mjs',import.meta.url).pathname),sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(t){const base=mkdtempSync(join(tmpdir(),'preflight-judge-'));t.after(()=>rmSync(base,{recursive:true,force:true}));const source={commit:'a'.repeat(40),files:RPC_FILES.map(path=>{const bytes=readFileSync(join(root,path));mkdirSync(dirname(join(base,path)),{recursive:true});writeFileSync(join(base,path),bytes);return {path,sha256:sha(bytes)};})};writeFileSync(join(base,'deployment-manifest.json'),JSON.stringify({source_commit:source.commit}));return {base,source};}
test('parent Judge reuses original preflight metric checks and retains failed account verdict without PG or Caller',async t=>{
 const f=fixture(t),{judgePreflightInProcess}=await import('../preflight-judge.mjs');
 const input={workflow:'douyin_video_discovery',stage:'preflight',run:'fixture',line:'yuesheng',metrics:{device_verified:1,account_verified:1,call_state_idle:1,lock_acquired:1}};
 const pass=await judgePreflightInProcess({...input,root:f.base,source:f.source,deadlineMs:Date.now()+10000});assert.equal(pass.ok,true);assert.equal(pass.result.gate.verdict,'pass');
 const fail=await judgePreflightInProcess({...input,metrics:{...input.metrics,account_verified:0},root:f.base,source:f.source,deadlineMs:Date.now()+10000});assert.equal(fail.result.gate.verdict,'fail');assert.equal(fail.result.probes.find(p=>p.key==='pf_account_verified').pass,false);
 writeFileSync(join(f.base,'checks/douyin-video-discovery.yaml'),'tampered');await assert.rejects(()=>judgePreflightInProcess({...input,root:f.base,source:f.source,deadlineMs:Date.now()+10000}),/RPC_SOURCE_BYTES_MISMATCH/);
});
test('parent-only preflight Judge rejects other phases and exhausted endcheck window',async t=>{
 const f=fixture(t),{judgePreflightInProcess}=await import('../preflight-judge.mjs');
 for(const changes of [{stage:'collect_videos'},{workflow:'douyin_lead_outreach'},{deadlineMs:Date.now()-1}])await assert.rejects(()=>judgePreflightInProcess({root:f.base,source:f.source,workflow:'douyin_video_discovery',stage:'preflight',run:'fixture',line:'yuesheng',deadlineMs:Date.now()+10000,...changes}),/PREFLIGHT_JUDGE_SCOPE|PREFLIGHT_JUDGE_DEADLINE/);
});
test('real workflow preflight readback dispatch does not reopen the old Judge RPC outer',async t=>{
 const f=fixture(t),workflow=await import('../leadgen-workflow.mjs'),frozen={deployment:{source_commit:f.source.commit},files:Object.fromEntries(f.source.files.map(x=>['runtime/'+x.path,x.sha256]))};
 const result=await workflow.readbackActivityChecks({executionMode:'agent',activity:{key:'preflight'},root:f.base,frozen,env:{WF_BRAIN_WORKFLOW:'douyin_video_discovery',WFR_TAG:'fixture',LEADGEN_LINE:'yuesheng'},metrics:{device_verified:1,account_verified:1,call_state_idle:1,lock_acquired:1},rpc:async()=>{throw Error('UNCONTROLLED_JUDGE_OUTER');},deadline_ms:Date.now()+10000});
 assert.equal(result.result.gate.verdict,'pass');
});
