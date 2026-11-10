import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import {syncBuiltinESMExports} from 'node:module';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest} from '../runtime-definition.mjs';
import {readBrain} from '../device-epoch-fence-review.mjs';
import {createPhoneEpochGuard} from '../phone-epoch-admission.mjs';
import {createLeadgenAgentTools} from '../leadgen-agent-tools.mjs';

const runtime=dirname(dirname(fileURLToPath(import.meta.url)));
const task='11111111-1111-4111-8111-111111111111',run='22222222-2222-4222-8222-222222222222',epoch='33333333-3333-4333-8333-333333333333';
const endpointPath={task:'/api/brain/tasks/'+task,definition:'/api/brain/runs/'+run+'/definition',reconciliation:'/api/brain/runs/'+run+'/reconciliation',device_locks:'/api/brain/device-locks'};
function fixture(t){
 const home=fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(),'epoch-diagnostic-'))),runDir=join(home,'run'),policyPath=join(home,'policy.json');
 fs.mkdirSync(runDir,{mode:0o700});
 const original={userInfo:os.userInfo,fetch:globalThis.fetch,token:process.env.BRAIN_INTERNAL_TOKEN,timeout:AbortSignal.timeout};
 os.userInfo=()=>({...original.userInfo(),homedir:home});syncBuiltinESMExports();process.env.BRAIN_INTERNAL_TOKEN='fixture-secret-never-transmitted';
 t.after(()=>{os.userInfo=original.userInfo;syncBuiltinESMExports();globalThis.fetch=original.fetch;AbortSignal.timeout=original.timeout;if(original.token===undefined)delete process.env.BRAIN_INTERNAL_TOKEN;else process.env.BRAIN_INTERNAL_TOKEN=original.token;fs.rmSync(home,{recursive:true,force:true});});
 const serial='192.0.2.31:10001',policy={schema_version:2,instance_id:'fixture-private',endpoint:'tcp:127.0.0.1:5042'};
 fs.writeFileSync(policyPath,JSON.stringify(policy),{mode:0o600});
 const spec={serial,profile:'fixture',expected_account:'fixture-account',source_commit:'a'.repeat(40),policy,policy_binding:{policy_path:policyPath}};
 const record={protocol:'device-epoch-fence-record/v1',epoch_id:epoch,status:'fenced',authority_basis:'old-route-fenced-observed-noninterference/v1',original_execution_stopped:false,android_internal:'not_attested',resource:{serial,profile:spec.profile,expected_account:spec.expected_account},new_route:{instance_id:policy.instance_id,endpoint:policy.endpoint,policy_path:policyPath},runtime_source:{commit:spec.source_commit}};
 const recordPath=join(home,'.local/share/zenithjoy/device-epoch-fences',serial,epoch+'.json');fs.mkdirSync(dirname(recordPath),{recursive:true,mode:0o700});const raw=JSON.stringify(record);fs.writeFileSync(recordPath,raw,{mode:0o600});
 spec.policy_binding.epoch_fence={protocol:'device-epoch-fence-reference/v1',epoch_id:epoch,path:recordPath,sha256:digest(raw)};
 const body={files:{},discovery_phone_scope:spec,public_domain:{task_id:task,run_id:run}},frozen={...body,snapshot_sha256:digest(body)};fs.writeFileSync(join(runDir,'run-definition.json'),JSON.stringify(frozen),{mode:0o600});
 const state={},guard=createPhoneEpochGuard({root:runtime,env:{WFR_RUN_DIR:runDir,WF_BRAIN_TASK_ID:task,WFR_RUN_ID:run,SERIAL:serial},frozen,state});
 const scope={workflow:'douyin_video_discovery',activity:'preflight',run:'fixture',run_id:'douyin_video_discovery-fixture__a1',task_id:task,binding_id:epoch,source_commit:'a'.repeat(40),snapshot_sha256:'b'.repeat(64),profile:'fixture',serial,line:'yuesheng',source_run:null,limit:1,comment_limit:1,deadline_ms:Date.now()+30000};
 let prepares=0,phones=0;
 const tools=createLeadgenAgentTools({scope,runDir,primitives:{assertResources:async()=>true,prepare:async()=>{prepares++;return guard();},phone:async()=>{phones++;throw Error('phone forbidden');},inspect:async()=>({})}});
 return {runDir,tools,state,guard,counts:()=>({prepares,phones})};
}
function failure(runDir){const dir=join(runDir,'agent-tools/preflight'),file=fs.readdirSync(dir).find(n=>n.endsWith('.failure.json'));assert.ok(file);return {raw:fs.readFileSync(join(dir,file),'utf8'),value:JSON.parse(fs.readFileSync(join(dir,file),'utf8'))};}
const diagnostic=(endpoint,failure,read_phase='request',http_status=null,transport_code=null)=>({protocol:'epoch-admission-diagnostic/v1',stage:'initial_business',endpoint,read_phase,failure,http_status,transport_code});

for(const endpoint of ['task','reconciliation'])test('resource_prepare preserves '+endpoint+' timeout in its real failure journal without replay',async t=>{
 const f=fixture(t),calls=[],budgets=[];AbortSignal.timeout=ms=>{budgets.push(ms);const c=new AbortController();c.abort(new DOMException('fixture timeout','TimeoutError'));return c.signal;};
 globalThis.fetch=async(url,options)=>{calls.push({path:new URL(url).pathname,method:options.method??'GET'});if(String(url).endsWith(endpointPath[endpoint]))throw options.signal.reason;return new Response('{}',{headers:{'Content-Type':'application/json'}});};
 await assert.rejects(()=>f.tools.prepare(),/AGENT_TOOL_COMMIT_UNKNOWN_READBACK_REQUIRED/);
 const v=failure(f.runDir);assert.equal(v.value.error_code,'EPOCH_ADMISSION_FAILED');assert.deepEqual(v.value.epoch_diagnostic,diagnostic(endpoint,'timeout'));
 assert.equal(v.raw.includes('fixture-secret'),false);assert.deepEqual(budgets,[10000,10000,10000,10000]);assert.equal(calls.length,4);assert.ok(calls.every(c=>c.method==='GET'));
 assert.equal(f.state.executionUnknown,true);assert.equal(f.state.epochFenceLost,true);await assert.rejects(()=>f.guard(),e=>e.code==='EPOCH_ADMISSION_LOST'&&!Object.hasOwn(e,'executionStopped'));
 await assert.rejects(()=>f.tools.prepare(),/READBACK_REQUIRED/);await assert.rejects(()=>f.tools.phone('foreground'),/READBACK_REQUIRED/);assert.deepEqual(f.counts(),{prepares:1,phones:0});assert.equal(calls.length,4);
});

for(const [name,response,expected] of [
 ['http503',()=>new Response('{}',{status:503,headers:{'Content-Type':'application/json'}}),diagnostic('definition','http_status','response',503)],
 ['content_type',()=>new Response('private response',{headers:{'Content-Type':'text/plain'}}),diagnostic('definition','content_type','response',200)],
 ['invalid_json',()=>new Response('private invalid json',{headers:{'Content-Type':'application/json'}}),diagnostic('definition','invalid_json','json',200)],
 ['socket',()=>{throw Object.assign(new TypeError('private exception'),{cause:{code:'UND_ERR_SOCKET'}});},diagnostic('definition','socket','request',null,'UND_ERR_SOCKET')],
 ['body_socket',()=>({status:200,headers:new Headers({'Content-Type':'application/json'}),text:async()=>{throw Object.assign(Error('private body'),{code:'ECONNRESET'});}}),diagnostic('definition','socket','body',200,'ECONNRESET')],
 ])test('resource_prepare records finite '+name+' evidence and keeps its intent unresolved',async t=>{
 const f=fixture(t);let reads=0;globalThis.fetch=async url=>{reads++;return String(url).endsWith(endpointPath.definition)?response():new Response('{}',{headers:{'Content-Type':'application/json'}});};
 await assert.rejects(()=>f.tools.prepare(),/READBACK_REQUIRED/);const v=failure(f.runDir);assert.deepEqual(v.value.epoch_diagnostic,expected);assert.equal(v.raw.includes('private '),false);assert.equal(reads,4);assert.equal(f.state.executionUnknown,true);assert.equal(Object.hasOwn(v.value,'executionStopped'),false);
});

test('read failure evidence never executes exception getters or serializes arbitrary fields',async t=>{
 const f=fixture(t);let getters=0;const secret='private-getter-secret',error={};for(const key of ['code','cause','message','stack','epoch_diagnostic'])Object.defineProperty(error,key,{get(){getters++;return secret;}});
 globalThis.fetch=async url=>{if(String(url).endsWith(endpointPath.task))throw error;return new Response('{}',{headers:{'Content-Type':'application/json'}});};
 await assert.rejects(()=>f.tools.prepare(),/READBACK_REQUIRED/);const v=failure(f.runDir);assert.deepEqual(v.value.epoch_diagnostic,diagnostic('task','unknown'));assert.equal(v.raw.includes(secret),false);assert.equal(getters,0);
});

test('readBrain keeps successful values and rejects invalid paths before any request',async t=>{
 fixture(t);let requests=0;globalThis.fetch=async()=>{requests++;return new Response('{"accepted":true}',{headers:{'Content-Type':'application/json'}});};assert.deepEqual(await readBrain(endpointPath.task),{accepted:true});await assert.rejects(()=>readBrain('/api/brain/device-locks/release'),/BRAIN_READ_PATH/);assert.equal(requests,1);
});
