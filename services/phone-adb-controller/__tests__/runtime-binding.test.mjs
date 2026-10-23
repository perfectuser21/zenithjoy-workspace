import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn,spawnSync } from 'node:child_process';
import { mkdtempSync,writeFileSync,readFileSync,existsSync } from 'node:fs';
import { tmpdir,hostname } from 'node:os';
import { deploymentTarget } from '../deployment-release.mjs';
const actualHost=deploymentTarget(hostname());
import { join } from 'node:path';
import { digest } from '../runtime-definition.mjs';
import {bindRun,readBinding} from '../runtime-binding.mjs';
import {createHandlers} from '../leadgen-handlers.mjs';
import {execInput} from '../leadgen-client.mjs';
import {readNativeOperation,nativeOperationIdentityMatches} from '../native-operation-receipt.mjs';
import {readdirSync,rmSync,mkdirSync} from 'node:fs';
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'binding-runtime-'));const steps=JSON.stringify({steps:[{key:'test.run.execute',usage:{slot_key:'run'},mode:'checkpoint'}]});writeFileSync(join(dir,'step-dod.json'),steps);
 const body={schema_version:2,release:{id:'release',target:actualHost},deployment:{observation_id:'observation',target:actualHost},workflow_version:{id:'wv',payload_sha256:'a'.repeat(64),payload:{workflow_id:'workflow'}},activities:[{reference:{reference_id:'ref',slot_key:'run',activity_id:'activity',activity_version_id:'av'},version:{id:'av',payload:{steps:[{step_id:'step',locator:{step_key:'execute'},contract:{key:'execute'}}]}}}],files:{'step-dod.json':digest(steps)}};
 writeFileSync(join(dir,'run-definition.json'),JSON.stringify({...body,snapshot_sha256:digest(body)}));return dir;
}
test('public ACK 显式空task经真实createHandlers保留空身份，缺键不得冒充空绑定',async t=>{
 for(const task of [null,undefined]){
  const dir=fixture();t.after(()=>rmSync(dir,{recursive:true,force:true}));let posted;
  await bindRun({dir,runId:'public-run',brainUrl:'https://fixture.invalid',request:async(_url,body)=>{
   if(body)posted=body;
   return {binding:{id:'public-binding',run_id:'public-run__a1',...posted,...(task===null?{task_id:null}:{})}};
  }});
  const binding=readBinding(dir,'a1');assert.equal(Object.hasOwn(binding,'task_id'),task===null);
  let controllerCalls=0;
  const h=createHandlers({root:dir,taskId:binding.task_id,sourceCommit:'a'.repeat(40),
   env:{P:'fixture',SERIAL:'fixture-device',WFR_TAG:'public-run',WFR_RUN_ID:'public-run',WFR_ATTEMPT:'a1',WFR_RUN_DIR:dir,HOME:dir,
    DOUYIN_PHONE_ADB:join(dir,'missing-controller')},
   execute:async(command,args,options)=>{
    if(args[0]===join(dir,'adb-existing-route.py'))return {code:0,stdout:'5042\n',stderr:''};
    if(command==='adb'){assert.deepEqual(args,['-s','fixture-device','get-state']);return {code:0,stdout:'device\n',stderr:''};}
    controllerCalls++;return execInput(command,args,options);
   },rpc:async()=>{throw Error('unexpected RPC');}});
  h.state.currentActivity='preflight';
  if(task===undefined){await assert.rejects(h.preflight(),/NATIVE_OPERATION_CONTEXT_INVALID/);assert.equal(existsSync(join(dir,'native-operations')),false);}
  else {
   await assert.rejects(h.preflight(),/EXECUTION_START_FAILED/);
   const [file]=readdirSync(join(dir,'native-operations'));const id=file.slice(0,-5),proof=readNativeOperation(dir,id);
   assert.equal(proof.task_id,null);assert.equal(proof.status,'not_started');assert.equal(proof.execution_stopped,true);
   const identity={operationId:id,runDir:dir,runId:binding.run_id,taskId:null,profile:'fixture',serial:'fixture-device',sourceCommit:'a'.repeat(40),owner:'public-run',activity:'preflight'};
   assert.equal(nativeOperationIdentityMatches(proof,identity),true);
   for(const taskId of [undefined,'other-task','',0])assert.equal(nativeOperationIdentityMatches(proof,{...identity,taskId}),false);
   assert.equal(nativeOperationIdentityMatches({...proof,task_id:'other-task'},identity),false);
   const {task_id,...missing}=proof;assert.equal(nativeOperationIdentityMatches(missing,identity),false);
  }
  assert.equal(controllerCalls,1);
 }
});
test('真实public缺task键ACK经原main调用点归一空绑定，原响应保留且native上下文仍严格',async t=>{
 const dir=fixture();t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const {snapshot_sha256,...body}=JSON.parse(readFileSync(join(dir,'run-definition.json'),'utf8'));
 body.deployment.source_commit='a'.repeat(40);body.activities[0].reference.slot_key='preflight';body.activities[0].version.payload.contract={budget:{max_duration_s:120}};
 const steps=JSON.stringify({steps:[{key:'test.preflight.execute',usage:{slot_key:'preflight'},mode:'checkpoint'}]});
 writeFileSync(join(dir,'step-dod.json'),steps);body.files['step-dod.json']=digest(steps);
 writeFileSync(join(dir,'run-definition.json'),JSON.stringify({...body,snapshot_sha256:digest(body)}));mkdirSync(join(dir,'runtime'));
 let posted;
 const initial=await bindRun({dir,runId:'public-main',brainUrl:'https://fixture.invalid',request:async(_url,input)=>{
  if(input)posted=input;
  return {binding:{id:'public-binding',run_id:'public-main__a1',...posted,task_run_id:null,payload:{...posted}}};
 }});
 assert.equal(initial.binding.task_id,null);assert.equal(readBinding(dir,'a1').task_id,null);
 const originalAck=readFileSync(join(dir,'run-bindings/a1.ack.json'),'utf8');
 const raw=JSON.parse(readFileSync(join(dir,'run-bindings/a1.ack.json'),'utf8')).binding;
 assert.equal(Object.hasOwn(raw,'task_id'),false);assert.equal(Object.hasOwn(raw.payload,'task_id'),false);
 const script=join(dir,'main-probe.mjs');
 writeFileSync(script,`import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {pathToFileURL} from 'node:url';
const root=${JSON.stringify(new URL('../',import.meta.url).pathname)},dir=${JSON.stringify(dir)},runtime=path.join(dir,'runtime');
const {createHandlers}=await import(pathToFileURL(root+'leadgen-handlers.mjs'));
const {execInput}=await import(pathToFileURL(root+'leadgen-client.mjs'));
const {readNativeOperation}=await import(pathToFileURL(root+'native-operation-receipt.mjs'));
const definition=await import(pathToFileURL(root+'runtime-definition.mjs'));
const binding=await import(pathToFileURL(root+'runtime-binding.mjs'));
const result={calls:[]};
const env={HOME:dir,WF_HOME:runtime,WFR_RUN_DIR:dir,WFR_ATTEMPT:'a1',WFR_RUN_ID:'public-main',WFR_TAG:'public-main',P:'fixture',SERIAL:'fixture-device',LEADGEN_LINE:'jinuo',WF_BRAIN_WORKFLOW:'douyin_video_discovery',WF_RUN_START_TS:String(Math.floor(Date.now()/1000)),WF_RUN_MAX_SECONDS:'900',LEADGEN_DISCOVERY_MAX_SECONDS:'120'};
const proc={env,argv:['node','not-main'],execPath:process.execPath,pid:process.pid,stdout:{write(){}},stderr:{write(){}},exitCode:0};
const context=vm.createContext({process:proc,console,Date,Map,Set,Buffer,JSON});
const modules={
 './activity-commander.mjs':{runWorkflow:async options=>{await options.handlers.preflight();throw Error('unexpected preflight success');}},
 './leadgen-handlers.mjs':{createHandlers:options=>{result.task_own=Object.hasOwn(options,'taskId');result.task_is_null=options.taskId===null;return createHandlers({...options,execute:async(command,args,opts)=>{if(args[0]?.endsWith('/adb-existing-route.py'))return {code:0,stdout:'5042\\n',stderr:''};result.calls.push(command==='adb'?'adb-read-state':'controller');if(command==='adb')return {code:0,stdout:'device\\n',stderr:''};return execInput(command,args,opts);}});},parseCollection:()=>{}},
 './activity-skill-recovery.mjs':{createActivityRecovery:()=>()=>{}},
 './collection-phone-scope.mjs':await import(pathToFileURL(root+'collection-phone-scope.mjs')),
 './discovery-phone-scope.mjs':await import(pathToFileURL(root+'discovery-phone-scope.mjs')),
 './commander-model-receipt.mjs':await import(pathToFileURL(root+'commander-model-receipt.mjs')),
 './discovery-cleanup-readback.mjs':await import(pathToFileURL(root+'discovery-cleanup-readback.mjs')),
 './discovery-metrics.js':await import(pathToFileURL(root+'discovery-metrics.js')),
 './line-routes.js':await import(pathToFileURL(root+'line-routes.js')),
 './runtime-definition.mjs':definition,'./runtime-binding.mjs':binding,
 './leadgen-client.mjs':{createRpc:()=>async()=>{throw Error('unexpected RPC');},execInput:async()=>({code:0,stdout:'',stderr:''})},
 './leadgen-discovery.mjs':{verifyDiscoveryFilterEvidence:()=>{throw Error('unexpected filter verify during failed preflight');}},
 './step-judge.mjs':{judgeSteps:()=>{throw Error('unexpected verify');}}};
const source=fs.readFileSync(root+'leadgen-workflow.mjs','utf8');
const main=new vm.SourceTextModule(source+'\\nexport {main as probeMain};',{context,identifier:pathToFileURL(path.join(runtime,'leadgen-workflow.mjs')).href,initializeImportMeta:meta=>{meta.url=pathToFileURL(path.join(runtime,'leadgen-workflow.mjs')).href;}});
await main.link(async name=>{const values=modules[name]||await import(name);return new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);},{context});});await main.evaluate();
try{await main.namespace.probeMain();}catch(error){result.error=error.message;}
const folder=path.join(dir,'native-operations');result.proofs=fs.existsSync(folder)?fs.readdirSync(folder).map(n=>readNativeOperation(dir,n.slice(0,-5))):[];
console.log(JSON.stringify(result));`,{mode:0o600});
 const child=spawnSync(process.execPath,['--experimental-vm-modules',script],{encoding:'utf8',timeout:15000});
 assert.equal(child.status,0,child.stderr);const observed=JSON.parse(child.stdout);
 assert.equal(observed.error,'EXECUTION_START_FAILED');assert.equal(observed.task_own,true);assert.equal(observed.task_is_null,true);
 assert.deepEqual(observed.calls,['adb-read-state','controller']);assert.equal(observed.proofs.length,1);
 assert.equal(observed.proofs[0].task_id,null);assert.equal(observed.proofs[0].status,'not_started');assert.equal(observed.proofs[0].execution_stopped,true);
 assert.equal(readFileSync(join(dir,'run-bindings/a1.ack.json'),'utf8'),originalAck);
});
test('public归一不隐藏关联任务/其他来源/显式undefined，也不改原ACK',async t=>{
 for(const kind of ['associated','task_run_missing','payload_task','task_string','task_null','task_undefined','payload_undefined','payload_task_run','contradictory_task','task_run_undefined','payload_task_run_undefined','other_source']){
  const dir=fixture();t.after(()=>rmSync(dir,{recursive:true,force:true}));let posted;
  const action=bindRun({dir,runId:'scope-run',brainUrl:'https://fixture.invalid',request:async(_url,input)=>{
   if(input)posted=input;
   const binding={id:'binding',run_id:'scope-run__a1',...posted,task_run_id:null,payload:{...posted}};
   if(kind==='associated')binding.task_run_id='actual-task-run';
   if(kind==='task_run_missing')delete binding.task_run_id;
   if(kind==='payload_task')binding.payload.task_id='actual-task';
   if(kind==='task_string')binding.task_id='actual-task';
   if(kind==='task_null')binding.task_id=null;
   if(kind==='task_undefined')binding.task_id=undefined;
   if(kind==='payload_undefined')binding.payload.task_id=undefined;
   if(kind==='payload_task_run')binding.payload.task_run_id='actual-task-run';
   if(kind==='contradictory_task'){binding.task_id='actual-task';binding.payload.task_id='other-task';}
   if(kind==='task_run_undefined')binding.task_run_id=undefined;
   if(kind==='payload_task_run_undefined')binding.payload.task_run_id=undefined;
   if(kind==='other_source')binding.source_kind='kernel';
   return {binding};
  }});
  if(['task_undefined','payload_undefined','payload_task_run','contradictory_task','task_run_undefined','payload_task_run_undefined','other_source'].includes(kind)){
   await assert.rejects(action,kind==='other_source'?/ACK内容不匹配: source_kind/:/RUN_BINDING_TASK_ID_INVALID/);
   assert.equal(existsSync(join(dir,'run-bindings/a1.ack.json')),false);continue;
  }
  const first=await action,again=readBinding(dir,'a1');
  if(kind==='task_string')assert.equal(first.binding.task_id,'actual-task');
  else if(kind==='task_null')assert.equal(first.binding.task_id,null);
  else assert.equal(Object.hasOwn(first.binding,'task_id'),false);
  assert.deepEqual(again,first.binding);
  const raw=JSON.parse(readFileSync(join(dir,'run-bindings/a1.ack.json'),'utf8')).binding;
  assert.equal(Object.hasOwn(raw,'task_id'),['task_string','task_null'].includes(kind));
 }
});
async function server(t,handler){const seen=[];const s=createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;const event={method:req.method,path:req.url,body:raw?JSON.parse(raw):null};seen.push(event);const answer=handler(event);res.writeHead(answer.status||200,{'Content-Type':'application/json'});res.end(JSON.stringify(answer.body));});await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>s.close());return {seen,url:`http://127.0.0.1:${s.address().port}`};}
const cli=(dir,url,args=['bind-run'])=>new Promise(resolve=>{const child=spawn(process.execPath,[new URL('../runtime-receipts.mjs',import.meta.url).pathname,...args],{env:{...process.env,WFR_RUN_DIR:dir,WFR_RUN_ID:'run',WFR_ATTEMPT:'a1',BRAIN_URL:url,BRAIN_INTERNAL_TOKEN:'fixture-token',WFR_HOSTKEY:'fixture'}});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('exit',code=>resolve({code,out,err}));});
test('HTTP绑定ACK前持久请求；失联重试同attempt/内容，ACK后真实续跑新attempt',async t=>{
 const dir=fixture();let failure=true,last;
 const s=await server(t,e=>{if(e.method==='POST'){assert.ok(existsSync(join(dir,'run-bindings',`${e.body.attempt_key}.request.json`)));last=e.body;if(failure)return {status:503,body:{error:'offline'}};return {body:{binding:{id:`binding-${e.body.attempt_key}`,run_id:e.path.split('/')[4],...e.body}}};}return {body:{binding:{id:`binding-${last.attempt_key}`,run_id:e.path.split('/')[4],...last}}};});
 const first=await cli(dir,s.url);assert.equal(first.code,1);assert.equal(s.seen.length,1,'失败应发生在真实POST，而非未知CLI命令');
 failure=false;const second=await cli(dir,s.url);assert.equal(second.code,0,second.err);assert.match(second.out,/WFR_ATTEMPT=a1/);
 assert.deepEqual(s.seen[0].body,s.seen[1].body);assert.equal(last.expected_path.filter(p=>p.step_id==='step'&&p.required).length,1);
 const third=await cli(dir,s.url);assert.equal(third.code,0,third.err);assert.match(third.out,/WFR_ATTEMPT=a2/);assert.equal(last.run_binding_id,undefined);assert.equal(last.external_origin,`zenithjoy:${actualHost}`,'WFR_HOSTKEY不能覆盖实际主机身份');
 assert.doesNotMatch(readFileSync(join(dir,'run-bindings/a1.request.json'),'utf8'),/fixture-token/);
});
test('409绑定冲突明确拒绝且持久blocked，不作为网络pending重复提交',async t=>{
 const dir=fixture();const s=await server(t,()=>({status:409,body:{code:'CONFLICT'}}));
 assert.equal((await cli(dir,s.url)).code,1);assert.equal(s.seen.length,1);
 assert.equal((await cli(dir,s.url)).code,1);assert.equal(s.seen.length,1);
});

test('v2 span必须带已ACK绑定及版本/位置/attempt；skipped保留明确原因',async t=>{
 const dir=fixture();let last;const s=await server(t,e=>{
  if(e.path.endsWith('/spans'))return {body:{inserted:1}};
  if(e.method==='POST')last=e.body;return {body:{binding:{id:'binding-a1',run_id:'run__a1',...last}}};
 });
 assert.equal((await cli(dir,s.url)).code,0);
 const artifact=join(dir,'artifact.json');writeFileSync(artifact,JSON.stringify({observed_at:new Date().toISOString(),summary:'本词判定未通过',metrics:{}}));
 const sent=await cli(dir,s.url,['span','run','blocked','1',artifact]);assert.equal(sent.code,0,sent.err);
 const span=s.seen.find(e=>e.path.endsWith('/spans')).body[0];
 assert.equal(span.identity_protocol,2);assert.equal(span.run_binding_id,'binding-a1');assert.equal(span.reference_id,'ref');assert.equal(span.activity_definition_version_id,'av');assert.equal(span.workflow_definition_version_id,'wv');assert.equal(span.attempt_key,'a1');assert.equal(span.enabler_call_id,null);
 assert.equal(span.evidence.runtime_snapshot_sha256,last.runtime_snapshot_sha256);assert.equal(span.evidence.skip_reason,'本词判定未通过');
});
test('缺绑定ACK不能生成新span；不能降级v1冒充兼容',async t=>{
 const dir=fixture();const s=await server(t,()=>({body:{inserted:1}}));const file=join(dir,'artifact.json');writeFileSync(file,'{"metrics":{}}');
 assert.equal((await cli(dir,s.url,['span','run','completed','1',file])).code,1);assert.equal(s.seen.length,0);
});
test('有规范UUID的Step必须在冻结计划出现，缺计划不得静默省略绑定路径',async()=>{
 const {expectedPath}=await import('../runtime-binding.mjs');const frozen=JSON.parse(readFileSync(join(fixture(),'run-definition.json'),'utf8'));
 assert.throws(()=>expectedPath(frozen,{steps:[]}),/Step.*冻结计划/);
 const path=expectedPath(frozen,{steps:[{key:'test.run.execute',usage:{slot_key:'run'}}]});assert.equal(path.length,2);assert.equal(path[1].required,true);
});

test('异机复制冻结件且伪造WFR_HOSTKEY仍拒绝，零ledger和HTTP',async t=>{
 const dir=fixture(),file=join(dir,'run-definition.json');const {snapshot_sha256,...body}=JSON.parse(readFileSync(file,'utf8'));
 body.release.target='fixture';body.deployment.target='fixture';writeFileSync(file,JSON.stringify({...body,snapshot_sha256:digest(body)}));
 let requestBody;const s=await server(t,e=>{if(e.body)requestBody=e.body;return {body:{binding:{id:'binding',run_id:'run__a1',...requestBody}}};});
 const result=await cli(dir,s.url);assert.equal(result.code,1);assert.match(result.err,/实际.*机器|实际.*主机/);
 assert.equal(s.seen.length,0);assert.equal(existsSync(join(dir,'ledger.json')),false);assert.equal(existsSync(join(dir,'run-bindings')),false);
});
