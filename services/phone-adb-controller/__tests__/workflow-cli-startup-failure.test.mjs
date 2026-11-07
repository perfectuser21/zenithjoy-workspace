import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,cpSync,rmSync,chmodSync,lstatSync,symlinkSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const service=new URL('../',import.meta.url).pathname,repository=resolve(service,'../..');
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const sha=x=>createHash('sha256').update(x).digest('hex');
function fixture(t){
 const top=mkdtempSync(join(repository,'.cli-startup-fixture-'));t.after(()=>rmSync(top,{recursive:true,force:true}));
 const runId='douyin_video_discovery-startup',dir=join(top,runId),runtime=join(dir,'runtime');mkdirSync(dir,{mode:0o700});
 cpSync(service,runtime,{recursive:true,filter:path=>!path.split('/').includes('__tests__')&&!path.split('/').includes('node_modules')});chmodSync(runtime,0o700);
 const body={execution_mode:'code',files:{'runtime/leadgen-workflow.mjs':sha(readFileSync(join(runtime,'leadgen-workflow.mjs')))},deployment:{source_commit:'a'.repeat(40)},workflow_version:{payload:{key:'douyin_video_discovery',contract:{}}},run_identity:{capability:'douyin_video_discovery',run_id:runId,tag:'startup',profile:'fixture',serial:'SERIAL'},activities:[]};
 const frozen={...body,snapshot_sha256:sha(canonical(body))};writeFileSync(join(dir,'run-definition.json'),JSON.stringify(frozen),{mode:0o600});
 const env={...process.env,NODE_OPTIONS:'',WF_HOME:runtime,WFR_RUN_DIR:dir,WFR_RUN_ID:runId,WFR_TAG:'startup',WFR_ATTEMPT:'a1',WF_BRAIN_WORKFLOW:'douyin_video_discovery',P:'fixture',SERIAL:'SERIAL',LEADGEN_EXECUTION_MODE:'invalid'};
 const invoke=(overrides={})=>spawnSync(process.execPath,[join(runtime,'leadgen-workflow.mjs')],{cwd:top,env:{...env,...overrides},encoding:'utf8',timeout:10000});
 return {top,dir,runtime,runId,frozen,env,invoke,file:join(dir,'startup-failure-a1.json')};
}
test('actual frozen CLI startup failure persists controlled code, identity and600 bytes while preserving exit1',t=>{
 const f=fixture(t),r=f.invoke();assert.equal(r.status,1,r.stderr);assert.equal(r.error,undefined);assert.match(r.stderr,/新流程执行失败，请读取本批固定定义与活动证据/);assert.match(r.stderr,/EXECUTION_MODE_INVALID/);
 const row=JSON.parse(readFileSync(f.file));assert.equal(row.phase,'startup_failure');assert.equal(row.status,'failed');assert.equal(row.error_code,'EXECUTION_MODE_INVALID');assert.equal(row.run_id,f.runId+'__a1');assert.equal(row.attempt,'a1');assert.equal(row.source_commit,'a'.repeat(40));assert.equal(row.runtime_snapshot_sha256,f.frozen.snapshot_sha256);assert.ok(Number.isFinite(Date.parse(row.observed_at)));assert.equal(lstatSync(f.file).mode&0o777,0o600);
 for(const key of ['activities','results','execution_stopped','resources','cleanup','stack','message','body'])assert.equal(Object.hasOwn(row,key),false,key);
 assert.equal(existsSync(join(f.dir,'activity-events.jsonl')),false);assert.equal(existsSync(join(f.dir,'split-result.json')),false);
});
test('actual generic binding failure never copies secret-bearing raw message, body or stack into record/stderr',t=>{
 const f=fixture(t),secret='PRIVATE_BEARER_TOKEN_do_not_log',bindings=join(f.dir,'run-bindings');mkdirSync(bindings,{mode:0o700});
 const run_id=f.runId+'__a1',body={actor:'code',[secret]:'private body'};writeFileSync(join(bindings,'a1.request.json'),JSON.stringify({run_id,runtime_snapshot_sha256:f.frozen.snapshot_sha256,body}));writeFileSync(join(bindings,'a1.ack.json'),JSON.stringify({binding:{id:'fixture',run_id,actor:'code'}}));
 const r=f.invoke({LEADGEN_EXECUTION_MODE:'code'});assert.equal(r.status,1,r.stderr);const text=readFileSync(f.file,'utf8'),row=JSON.parse(text);assert.equal(row.error_code,'CLI_STARTUP_FAILURE');assert.doesNotMatch(text+r.stdout+r.stderr,new RegExp(secret+'|private body|Error:|at main'));
});
for(const kind of ['foreign-run','symlink-run','writable-parent','symlink-definition'])test('startup record refuses '+kind+' and reports persistence failure without changing exit1',t=>{
 const f=fixture(t);let overrides={};
 if(kind==='foreign-run'){const foreign=join(f.top,'foreign');mkdirSync(foreign);writeFileSync(join(foreign,'run-definition.json'),JSON.stringify({...f.frozen,files:{}}));overrides={WFR_RUN_DIR:foreign};}
 if(kind==='symlink-run'){const alias=join(f.top,'run-alias');symlinkSync(f.dir,alias);overrides={WFR_RUN_DIR:alias};}
 if(kind==='writable-parent')chmodSync(f.dir,0o777);
 if(kind==='symlink-definition'){const source=join(f.top,'definition.json');writeFileSync(source,readFileSync(join(f.dir,'run-definition.json')));rmSync(join(f.dir,'run-definition.json'));symlinkSync(source,join(f.dir,'run-definition.json'));}
 const r=f.invoke(overrides);assert.equal(r.status,1,r.stderr);assert.match(r.stderr,/CLI_STARTUP_FAILURE_RECORD_FAILED/);assert.equal(existsSync(f.file),false);assert.equal(existsSync(join(f.top,'foreign','startup-failure-a1.json')),false);
});
test('existing symlink failure target cannot overwrite foreign bytes or turn persistence failure into success',t=>{
 const f=fixture(t),foreign=join(f.top,'foreign-receipt');writeFileSync(foreign,'do not overwrite');symlinkSync(foreign,f.file);const r=f.invoke();assert.equal(r.status,1);assert.match(r.stderr,/CLI_STARTUP_FAILURE_RECORD_FAILED/);assert.equal(readFileSync(foreign,'utf8'),'do not overwrite');assert.equal(lstatSync(f.file).isSymbolicLink(),true);
});
