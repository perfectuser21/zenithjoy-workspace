// Real local detached capture, media decoding, primitive lifecycle, socket broker
// and primary executor. Phone/epoch/model I/O is a deterministic fixture only.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,cpSync,rmSync,realpathSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';import {tmpdir} from 'node:os';import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';import http from 'node:http';
const hash=b=>createHash('sha256').update(b).digest('hex'),id=()=>randomUUID();
const inventory=(root,p='')=>readdirSync(join(root,p),{withFileTypes:true}).flatMap(e=>{const n=p?p+'/'+e.name:e.name;return e.isDirectory()?inventory(root,n):e.isFile()?[n]:[];});
const controller=dirname(fileURLToPath(new URL('../leadgen-public-domain.mjs',import.meta.url)));
const cli=String.raw`import sys,os,json,pathlib,runpy,signal,time,struct,math,subprocess
root=pathlib.Path(__file__).parent;a=sys.argv[1:];i=a.index('record-start') if 'record-start' in a else a.index('record-stop');op=a[i];eid=a[i+1];out=pathlib.Path(os.environ['FIXTURE_EVIDENCE']);intent=os.environ['ZJ_OFFICIAL_RECORDING_INTENT'];p=out/eid
put=lambda suffix,v:(pathlib.Path(str(p)+suffix).write_text(v if isinstance(v,str) else json.dumps(v)),os.chmod(str(p)+suffix,0o600))
if op=='record-start':
 seconds=int(a[i+2]);vid=a[i+3];media=str(p)+'.rec.wav';policy=json.loads((root/'runtime/runtime-policy.json').read_text());argv=[str(root/'fixture-client'),'-s',os.environ['SERIAL'],'--no-window','--no-playback','--no-video','--audio-source=output','--audio-codec=raw','--record-format=wav','--require-audio','--record='+media,'--time-limit='+str(seconds)]
 m=runpy.run_path(str(root/'official-recording-observer.py'));child=m['owned_popen'](argv,stdin=-3,stdout=-3,stderr=-3,start_new_session=True)
 put('.capture-sdk.txt','31\n');put('.capture-runtime.json',{'runtime':dict(verified=True,client_path=str(root/'fixture-client'),server_path=str(root/'fixture-server'),**policy),'stage':{'verified':True,'execution_stop_unknown':False}});put('.capture-startup.json',{'status':'ready','pid':child.pid,'expected_argv':argv,'observations':[{},{}]});put('.record.pid',str(child.pid));print('record=started')
else:
 startup=json.loads(pathlib.Path(str(p)+'.capture-startup.json').read_text());os.kill(startup['pid'],signal.SIGTERM);time.sleep(.15);seconds=5;media=str(p)+'.rec.wav';pcm=b''.join(struct.pack('<h',round(5000*math.sin(i*2*math.pi*440/16000))) for i in range(80000));header=b'RIFF'+struct.pack('<I',36+len(pcm))+b'WAVEfmt '+struct.pack('<IHHIIHH',16,1,1,16000,32000,2,16)+b'data'+struct.pack('<I',len(pcm));pathlib.Path(media).write_bytes(header+pcm);os.chmod(media,0o600)
 subprocess.run([sys.executable,str(root/'decode-recording.py'),'--media',media,'--ffmpeg',os.environ['FIXTURE_FFMPEG'],'--requested-seconds','5','--evidence-file',str(p)+'.decode.json'],check=True,stdout=subprocess.DEVNULL);print('record=stopped')
`;
async function fixture(t,{leaseExpiresAt,failedCli=false,revokeAfterCli=false,resetHeldRead=false,activityKey='qualification'}={}){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'official-capture-chain-'))),runtime=join(dir,'runtime'),evidence=join(dir,'evidence');mkdirSync(evidence,{mode:0o700});
 cpSync(controller,runtime,{recursive:true,filter:p=>!p.includes('/__tests__')&&!p.includes('/node_modules')});
 writeFileSync(join(runtime,'fixture-server'),'fixed server');
 const built=spawnSync('cc',['-x','c','-o',join(runtime,'fixture-client'),'-'],{input:'#include <unistd.h>\nint main(void){for(;;)pause();}',encoding:'utf8'});assert.equal(built.status,0,built.stderr);
 const ffmpeg=realpathSync(spawnSync('/bin/sh',['-c','command -v ffmpeg'],{encoding:'utf8'}).stdout.trim());
 const policy={schema:'scrcpy-sdk31-pinned-v1',version:'5.0.1',client_sha256:hash(readFileSync(join(runtime,'fixture-client'))),server_sha256:hash(readFileSync(join(runtime,'fixture-server')))};writeFileSync(join(runtime,'runtime/runtime-policy.json'),JSON.stringify(policy));
 writeFileSync(join(runtime,'fixture-capture-cli.py'),cli);
 writeFileSync(join(runtime,'douyin-phone-adb'),'#!/bin/zsh\nexec "$DOUYIN_PYTHON_BIN" "${0:A:h}/fixture-capture-cli.py" "$@"\n',{mode:0o700});
 if(failedCli)writeFileSync(join(runtime,'douyin-phone-adb'),'#!/bin/zsh\nprintf started > "$FIXTURE_EVIDENCE/failed-cli-started"\nexit 2\n',{mode:0o700});
 const closure=join(runtime,'official-cli-closure.mjs');writeFileSync(closure,readFileSync(closure,'utf8').replace(/ "douyin-phone-adb":.*\n/,' "douyin-phone-adb": "'+hash(readFileSync(join(runtime,'douyin-phone-adb')))+'",\n'));
 const admission=join(runtime,'phone-operation-admission.mjs'),admissionSource=readFileSync(admission,'utf8'),epochAdmission='createPhoneEpochGuard({root,env,frozen,state,deadlineMs:scope.worker_deadline_ms})';
 assert.equal(admissionSource.split(epochAdmission).length-1,1,'capture fixture epoch admission target must occur once');
 writeFileSync(admission,admissionSource.replace(epochAdmission,'(async()=>({authorized:true}))'));
 const python=realpathSync(spawnSync('python3',['-c','import sys;print(sys.executable)'],{encoding:'utf8'}).stdout.trim()),program=path=>({path:realpathSync(path),sha256:hash(readFileSync(realpathSync(path)))});
 const workflow_id=id(),workflow_version=id(),ref=id(),av=id(),activity=id(),task_id=id(),run_id=id(),binding_id=id(),source='a'.repeat(40),tag='fixture102';
 const env={...process.env,LEADGEN_EXECUTION_MODE:'agent',WF_BRAIN_WORKFLOW:'douyin_video_processing',WF_BRAIN_TASK_ID:task_id,WFR_RUN_ID:run_id,WFR_RUN_DIR:dir,WF_HOME:runtime,WFR_TAG:tag,P:'cloud-phone-test',SERIAL:'47.100.213.173:10001',LEADGEN_LINE:'yuesheng',LEADGEN_SOURCE_RUN:'fixture101',LEADGEN_LIMIT:'1',LEADGEN_COMMENT_LIMIT:'5',QUEUED_VIDEO_COLLECTION_SECONDS:'60',WF_RUN_START_TS:String(Math.floor(Date.now()/1000)),WF_RUN_MAX_SECONDS:'90',FIXTURE_EVIDENCE:evidence,FIXTURE_FFMPEG:ffmpeg};
 const load=n=>import(pathToFileURL(join(runtime,n)).href),defs=await load('runtime-definition.mjs');
 const path=`skills/douyin-leadgen-activity-102-${activityKey}/SKILL.md`,text=readFileSync(join(runtime,path),'utf8'),version=text.match(/^  version: (\S+)/m)[1],contract={key:activityKey,budget:{max_duration_s:90,heartbeat_s:10},runtime:{phase:'source'}};
 const claim={claimed_by:'common-runner',claimed_at:'2026-11-09T00:00:00.000Z'},run_binding={run_binding_id:binding_id,workflow_id,workflow_definition_version_id:workflow_version,attempt_key:'task:1',activities:{[activityKey]:{reference_id:ref,activity_id:activity,activity_definition_version_id:av}}};
 const files=Object.fromEntries(inventory(runtime).map(p=>['runtime/'+p,hash(readFileSync(join(runtime,p)))])),runtimeHash=defs.digest(Object.fromEntries(Object.entries(files).map(([p,v])=>[p.slice(8),v])));
 const identity={run_id,task_id,machine_id:'us-mac-m4',mode:'formal',profile_sha256:'b'.repeat(64),run_binding};
 const frozen={execution_mode:'agent',primary_host:'official-child-v1',agent_input:defs.agentInput(env),sampling_input:defs.commentSamplingInput(env),native_claim:claim,files,deployment:{source_commit:source,target:'mmv',observation_id:id()},release:{id:id()},workflow_version:{id:workflow_version,payload:{key:'douyin_video_processing',workflow_id}},public_domain:{...identity,protocol:'workflow-domain/v1',runtime_snapshot_sha256:runtimeHash},collection_phone_scope:{run_id,profile:env.P,serial:env.SERIAL,evidence_root:evidence,policy:{schema_version:2},executables:{python:program(python),node:program(process.execPath),zsh:program('/bin/zsh')}},activities:[{reference:{slot_key:activityKey,reference_id:ref,activity_id:activity},version:{id:av,payload:{definition_key:'douyin_video_processing.'+activityKey,contract,implementation_bindings:[{kind:'skill',name:'douyin-leadgen-activity-102-'+activityKey,path:'services/phone-adb-controller/'+path,version}]}}}]};frozen.snapshot_sha256=defs.digest(frozen);writeFileSync(join(dir,'run-definition.json'),JSON.stringify(frozen));
 const task={id:task_id,status:'in_progress',...claim,result:{common_runner:{...identity}}};
 let heldRequests=0;
 const server=http.createServer(async(req,res)=>{for await(const c of req){};if(req.url.includes('device-locks')&&++heldRequests===1&&resetHeldRead){req.socket.destroy();return;}if(revokeAfterCli&&existsSync(join(evidence,'failed-cli-started')))task.status='cancelled';res.end(JSON.stringify(req.url.includes('device-locks')?{success:true,locks:[{device_name:env.SERIAL,locked_by:task_id,...(leaseExpiresAt==='missing'?{}:{expires_at:leaseExpiresAt??new Date(Date.now()+120000).toISOString()})}]}:task));});await new Promise(r=>server.listen(0,'127.0.0.1',r));env.BRAIN_URL='http://127.0.0.1:'+server.address().port;env.BRAIN_INTERNAL_TOKEN='unit-only';
 const authority=await load('public-domain-authority.mjs'),stop=authority.registerPublicDomainAuthority({runDirectory:dir,identity,business_scope:{run:tag,run_id,task_id,source_commit:source,profile:env.P,serial:env.SERIAL,attempt:'a1'},snapshot_authority:{local_snapshot_sha256:frozen.snapshot_sha256,runtime_snapshot_sha256:runtimeHash},deadline_ms:Date.now()+90000,cleanup_deadline_ms:Date.now()+100000}),binding=authority.readPublicDomainBinding(dir),state={};
 t.after(async()=>{stop();await new Promise(r=>server.close(r));for(const p of readdirSync(evidence).filter(p=>p.endsWith('.record.pid')))try{process.kill(Number(readFileSync(join(evidence,p),'utf8')),'SIGKILL');}catch{}rmSync(dir,{recursive:true,force:true});});
 return {load,dir,runtime,evidence,frozen,env,binding,state,contract,task,get heldRequests(){return heldRequests;}};
}
test('官方未启动拒绝穿过真实handler后不污染原生域，原调用可正常封闭',async t=>{
 const f=await fixture(t),{createOfficialChildPrimitives}=await f.load('official-child-primitives.mjs'),{createHandlers}=await f.load('leadgen-handlers.mjs');
 const p=createOfficialChildPrimitives({root:f.runtime,env:f.env,frozen:f.frozen,binding:f.binding,taskId:f.binding.task_id,state:f.state});
 const scope={activity:'qualification',workflow:f.frozen.agent_input.workflow_key,run:f.env.WFR_TAG,source_commit:f.frozen.deployment.source_commit,profile:f.env.P,serial:f.env.SERIAL,task_id:f.binding.task_id,run_id:f.binding.run_id,binding_id:f.binding.id,snapshot_sha256:f.frozen.snapshot_sha256,deadline_ms:Date.now()+60000,worker_deadline_ms:Date.now()+50000,receipt_deadline_ms:Date.now()+55000};
 await p.begin(scope);
 const handlers=createHandlers({root:f.runtime,env:{...f.env,DOUYIN_PHONE_ADB:join(f.runtime,'douyin-phone-adb')},rpc:async()=>{throw Error('UNEXPECTED_RPC');},execute:p.execute,sourceCommit:f.frozen.deployment.source_commit,taskId:f.binding.task_id});handlers.state.currentActivity='qualification';
 try{
  await assert.rejects(()=>handlers.handoffPhone('lock-acquire','foreign-owner'),error=>{
   assert.match(error.message,/OFFICIAL_CLI_OWNER/);assert.equal(error.executionStopped,true);assert.equal(error.externalEffect,'none');return true;
  });
  assert.notEqual(handlers.state.executionUnknown,true);assert.equal(handlers.agentNativeState().execution_unknown,false);assert.equal(f.state.executionUnknown,undefined);assert.equal(handlers.state.nativeStopProof,null);assert.equal(p.snapshot().pending,0);assert.equal(p.snapshot().execution_unknown,false);
  assert.equal(existsSync(join(f.dir,'native-operations')),false,'拒绝发生在原命令和receipt派发前');
  assert.equal((await p.finish('qualification')).execution_stopped,true);assert.equal((await p.close()).execution_stopped,true);
 }finally{await p.close();}
});
for(const mode of ['forged','cloned','foreign-receipt'])test('未启动拒绝不能跨越真实handler调用身份: '+mode,async t=>{
 const f=await fixture(t),{createOfficialChildPrimitives}=await f.load('official-child-primitives.mjs'),{createHandlers}=await f.load('leadgen-handlers.mjs');
 const p=createOfficialChildPrimitives({root:f.runtime,env:f.env,frozen:f.frozen,binding:f.binding,taskId:f.binding.task_id,state:f.state});
 const scope={activity:'qualification',workflow:f.frozen.agent_input.workflow_key,run:f.env.WFR_TAG,source_commit:f.frozen.deployment.source_commit,profile:f.env.P,serial:f.env.SERIAL,task_id:f.binding.task_id,run_id:f.binding.run_id,binding_id:f.binding.id,snapshot_sha256:f.frozen.snapshot_sha256,deadline_ms:Date.now()+60000,worker_deadline_ms:Date.now()+50000,receipt_deadline_ms:Date.now()+55000};
 await p.begin(scope);
 const command=join(f.runtime,'douyin-phone-adb'),args=['--profile',f.env.P,'lock-acquire','foreign-owner'];
 const receipt={runDir:f.dir,operationId:'different-original-call',runId:f.binding.run_id,taskId:f.binding.task_id,profile:f.env.P,serial:f.env.SERIAL,sourceCommit:f.frozen.deployment.source_commit,owner:f.env.WFR_TAG,activity:'qualification'};
 let original;try{await p.execute(command,args,{receipt});}catch(error){original=error;}
 assert.match(original?.message,/OFFICIAL_CLI_OWNER/);
 const error=mode==='foreign-receipt'?original:mode==='cloned'?Object.assign(Error(original.message),JSON.parse(JSON.stringify(original))):Object.assign(Error('OFFICIAL_CLI_OWNER'),{executionStopped:true,notStarted:true,externalEffect:'none'});
 let intercepted=0;
 const handlers=createHandlers({root:f.runtime,env:{...f.env,DOUYIN_PHONE_ADB:command},rpc:async()=>{throw Error('UNEXPECTED_RPC');},execute:async(_command,_args,options)=>{intercepted++;assert.notEqual(options.receipt.operationId,receipt.operationId);throw error;},sourceCommit:f.frozen.deployment.source_commit,taskId:f.binding.task_id});handlers.state.currentActivity='qualification';
 try{
  await assert.rejects(()=>handlers.handoffPhone('lock-acquire','foreign-owner'),rejected=>{assert.equal(rejected.executionStopped,false);assert.equal(rejected.externalEffect,'unknown');return true;});
  assert.equal(intercepted,1);assert.equal(handlers.state.executionUnknown,true);assert.equal(handlers.agentNativeState().execution_unknown,true);
  assert.equal(existsSync(join(f.dir,'native-operations')),false);
 }finally{await p.close();}
});
test('official child真实held GET断连在同预算重读后仅派发一次原CLI',async t=>{
 const f=await fixture(t,{failedCli:true,resetHeldRead:true}),{createOfficialChildPrimitives}=await f.load('official-child-primitives.mjs');
 const p=createOfficialChildPrimitives({root:f.runtime,env:f.env,frozen:f.frozen,binding:f.binding,taskId:f.binding.task_id,state:f.state});
 const scope={activity:'qualification',workflow:f.frozen.agent_input.workflow_key,run:f.env.WFR_TAG,source_commit:f.frozen.deployment.source_commit,profile:f.env.P,serial:f.env.SERIAL,task_id:f.binding.task_id,run_id:f.binding.run_id,binding_id:f.binding.id,snapshot_sha256:f.frozen.snapshot_sha256,deadline_ms:Date.now()+60000,worker_deadline_ms:Date.now()+50000,receipt_deadline_ms:Date.now()+55000};
 await p.begin(scope);
 const result=await p.execute(join(f.runtime,'douyin-phone-adb'),['--profile',f.env.P,'runtime-contract']);
 assert.equal(result.code,2);assert.equal(f.heldRequests,3);assert.equal(f.state.executionUnknown,undefined);
 assert.equal(readdirSync(f.evidence).filter(n=>n==='failed-cli-started').length,1);
 assert.equal((await p.finish('qualification')).execution_stopped,true);
 assert.equal((await p.close()).execution_stopped,true);
});
for(const [omitStop,badLease,revokeTask] of [[false,undefined],[true,undefined],[false,'missing'],[false,'not-a-date'],[false,'2000-01-01T00:00:00Z'],[false,undefined,true]])test(revokeTask?'capture remains unknown when Task is revoked after actual start':badLease?'invalid central lease '+badLease+' rejects before any capture CLI':'real owned-active capture crosses broker then '+(omitStop?'unfinished capture stays unknown':'record-stop and media close complete the primary executor'),async t=>{
 const f=await fixture(t,{leaseExpiresAt:badLease}),{createOfficialChildPrimitives,officialChildOperationReturned}=await f.load('official-child-primitives.mjs'),p=createOfficialChildPrimitives({root:f.runtime,env:f.env,frozen:f.frozen,binding:f.binding,taskId:f.binding.task_id,state:f.state}),{createActivitySkillExecutor}=await f.load('activity-skill-executor.mjs'),{callActivityTool}=await f.load('activity-skill-tool.mjs');
 let result=null,operations=0,activeSeen=false;const eid='fixture-record',vid='7693970762462579121';
 const execute=createActivitySkillExecutor({runDir:f.dir,frozen:f.frozen,binding:f.binding,env:f.env,deadlineFor:()=>Date.now()+90000,supportsNativeScope:a=>p.supports(a),nativeState:()=>p.snapshot(),createTools:async(a,scope)=>{await p.begin(scope);return p.wrapTools(a,scope,{prepare:async()=>{},inspect:async()=>({phone_capabilities:['record-start','record-stop']}),business:async()=>{throw Error('unexpected');},phone:async(command)=>{const args=['--profile',f.env.P,'--lock-owner',f.env.WFR_TAG,command,eid,...(command==='record-start'?['5',vid]:[])],receipt={runDir:f.dir,operationId:id(),runId:f.binding.run_id,taskId:f.binding.task_id,profile:f.env.P,serial:f.env.SERIAL,sourceCommit:f.frozen.deployment.source_commit,owner:f.env.WFR_TAG,activity:a.key},r=await p.execute(join(f.runtime,'douyin-phone-adb'),args,{receipt});assert.equal(officialChildOperationReturned(r,{command:join(f.runtime,'douyin-phone-adb'),args,receipt,root:f.runtime,frozen:f.frozen}),true);operations++;return {stdout:r.stdout};},getResult:()=>result,settle:async()=>{result={status:'completed',recording_closed:true};}});},rpc:async q=>{if(q.kind==='activity_skill_authority')return {authorized:true};assert.equal(q.kind,'activity_skill');await callActivityTool(q.request.broker_request_path,'phone',{command:'record-start',args:[]});activeSeen=true;assert.equal(p.snapshot().execution_unknown,false);if(revokeTask)f.task.status='cancelled';if(!omitStop&&!revokeTask)await callActivityTool(q.request.broker_request_path,'phone',{command:'record-stop',args:[]});if(revokeTask)await assert.rejects(callActivityTool(q.request.broker_request_path,'phone',{command:'record-stop',args:[]}));const child=id();return {result:{status:'ok',execution_stopped:true,owner_execution_stopped:true,child_execution_stopped:true,source_commit:q.request.source_commit,child_run_id:child,terminal:{runId:child,status:'ok',endedAt:Date.now()}}};}});
 if(badLease){await assert.rejects(execute(f.contract,{context:{task_id:f.binding.task_id}}));assert.equal(operations,0);assert.equal(activeSeen,false);assert.equal(readdirSync(f.evidence).some(p=>p.endsWith('.record.pid')),false);return;}
 let outcome;if(omitStop)await assert.rejects(execute(f.contract,{context:{task_id:f.binding.task_id}}),error=>error.executionStopped===false);else outcome=await execute(f.contract,{context:{task_id:f.binding.task_id}});assert.equal(activeSeen,true);assert.equal(operations,omitStop||revokeTask?1:2);
 if(revokeTask){assert.equal(outcome.execution_stopped,false);assert.equal((await p.close()).execution_stopped,false);const pid=Number(readFileSync(join(f.evidence,eid+'.record.pid'),'utf8'));assert.doesNotThrow(()=>process.kill(pid,0));}else if(omitStop){assert.equal((await p.close()).execution_stopped,false);}else{assert.equal(outcome.status,'completed');assert.equal(outcome.result.recording_closed,true);assert.equal((await p.close()).execution_stopped,true);}
});

let priorNoStartProof;
for(const mode of ['known-code2','no-cli','clone-proof','foreign-proof','after-authority','marker','pending'])test('未launch物理域封闭保持业务未知: '+mode,async t=>{
 const f=await fixture(t,{failedCli:true,revokeAfterCli:mode==='after-authority'});
 const {createOfficialChildPrimitives,officialChildOperationReturned}=await f.load('official-child-primitives.mjs'),p=createOfficialChildPrimitives({root:f.runtime,env:f.env,frozen:f.frozen,binding:f.binding,taskId:f.binding.task_id,state:f.state});
 const {createActivitySkillExecutor}=await f.load('activity-skill-executor.mjs'),{createLeadgenAgentTools}=await f.load('leadgen-agent-tools.mjs');
 let preparations=0,dispatches=0,tools,scope,closedProof,launched;
 const execute=createActivitySkillExecutor({runDir:f.dir,frozen:f.frozen,binding:f.binding,env:f.env,deadlineFor:()=>Date.now()+60000,supportsNativeScope:a=>p.supports(a),nativeState:()=>p.snapshot(),rpc:async()=>{dispatches++;throw Error('NO_SKILL_DISPATCH');},createTools:async(a,q)=>{
  scope=q;await p.begin(q);
  const raw=createLeadgenAgentTools({runDir:f.dir,scope:q,primitives:{assertResources:async()=>true,prepare:async()=>{
   preparations++;
   if(mode!=='no-cli'){
    const command=join(f.runtime,'douyin-phone-adb'),args=['--profile',f.env.P,'runtime-contract'],receipt={runDir:f.dir,operationId:'failed-cli',runId:f.binding.run_id,taskId:f.binding.task_id,profile:f.env.P,serial:f.env.SERIAL,sourceCommit:f.frozen.deployment.source_commit,owner:f.env.WFR_TAG,activity:a.key};
    if(mode==='marker'){mkdirSync(join(f.dir,'native-operations'),{recursive:true});writeFileSync(join(f.dir,'native-operations','failed-cli.unknown'),'sticky');}
    if(mode==='pending'){launched=p.execute(command,args,{receipt}).catch(()=>{});throw Object.assign(Error('PENDING_CLI'),{executionStopped:true});}
    const r=await p.execute(command,args,{receipt});assert.equal(r.code,2);assert.equal(officialChildOperationReturned(r,{command,args,receipt,root:f.runtime,frozen:f.frozen}),true);
   }
   throw Object.assign(Error('KNOWN_FAILED_PREPARE'),{executionStopped:true});
  }}});
  tools=typeof p.wrapTools==='function'?p.wrapTools(a,q,raw):raw;
  if(tools.closeNativeScope){const close=tools.closeNativeScope;tools={...tools,closeNativeScope:proof=>{closedProof=proof;if(mode==='known-code2')priorNoStartProof=proof;return close(mode==='clone-proof'?{...proof}:mode==='foreign-proof'?priorNoStartProof:proof);}};}
  return tools;
 }});
 let error;try{await execute(f.contract,{context:{task_id:f.binding.task_id}});}catch(e){error=e;}
 assert.ok(error);assert.equal(error.message,'AGENT_TOOL_COMMIT_UNKNOWN_READBACK_REQUIRED');assert.equal(error.externalEffect,'unknown');
 const safe=['known-code2','no-cli'].includes(mode);assert.equal(error.executionStopped,safe);assert.equal(dispatches,0);assert.equal(preparations,1);
 const journal=join(f.dir,'agent-tools','qualification'),names=readdirSync(journal),before=Object.fromEntries(names.map(n=>[n,readFileSync(join(journal,n),'utf8')]));
 assert.equal(names.filter(n=>n.endsWith('.failure.json')).length,1);assert.equal(names.filter(n=>n.endsWith('.intent.json')).length,1);assert.equal(names.some(n=>n.endsWith('.result.json')),false);
 await assert.rejects(tools.prepare(),/COMMIT_UNKNOWN/);assert.equal(preparations,1);assert.deepEqual(Object.fromEntries(readdirSync(journal).map(n=>[n,readFileSync(join(journal,n),'utf8')])),before);
 await launched;assert.equal((await p.close()).execution_stopped,safe);if(typeof p.wrapTools==='function')assert.ok(closedProof);assert.equal(p.snapshot().active,!safe);
});


test('已停官方父子且零业务调用，preflight settle拒绝仍封闭原生域并保留业务错误',async t=>{
 const f=await fixture(t,{activityKey:'preflight'});delete f.env.DATABASE_URL;
 const {createOfficialChildPrimitives}=await f.load('official-child-primitives.mjs');
 const p=createOfficialChildPrimitives({root:f.runtime,env:f.env,frozen:f.frozen,binding:f.binding,taskId:f.binding.task_id,state:f.state});
 const {createActivitySkillExecutor}=await f.load('activity-skill-executor.mjs');
 const businessError=Error('COMPANY_ACCOUNT_IDENTITY_UNVERIFIED');let dispatches=0,businessCalls=0,phoneCalls=0;
 const execute=createActivitySkillExecutor({runDir:f.dir,frozen:f.frozen,binding:f.binding,env:f.env,deadlineFor:()=>Date.now()+90000,supportsNativeScope:a=>p.supports(a),nativeState:()=>p.snapshot(),
  createTools:async(a,scope)=>{await p.begin(scope);return p.wrapTools(a,scope,{prepare:async()=>{},inspect:async()=>({}),phone:async()=>{phoneCalls++;throw Error('UNEXPECTED_PHONE');},business:async()=>{businessCalls++;throw Error('UNEXPECTED_BUSINESS');},getResult:()=>null,settle:async()=>{throw businessError;}});},
  rpc:async q=>{assert.equal(q.kind,'activity_skill');dispatches++;const child=id();return {result:{status:'ok',execution_stopped:true,owner_execution_stopped:true,child_execution_stopped:true,source_commit:q.request.source_commit,child_run_id:child,terminal:{runId:child,status:'ok',endedAt:Date.now()}}};}});
 let error;try{await execute(f.contract,{context:{task_id:f.binding.task_id}});}catch(e){error=e;}
 const native=p.snapshot(),closed=await p.close();
 assert.equal(error,businessError);assert.equal(error.message,'COMPANY_ACCOUNT_IDENTITY_UNVERIFIED');
 assert.equal(dispatches,1);assert.equal(phoneCalls,0);assert.equal(businessCalls,0);
 assert.equal(error.executionStopped,true);assert.equal(native.active,false);assert.equal(native.pending,0);assert.equal(native.execution_unknown,false);assert.equal(closed.execution_stopped,true);
});

test('普通伪造停止字段不能封闭已打开preflight原生域',async t=>{
 const f=await fixture(t,{activityKey:'preflight'}),{createOfficialChildPrimitives}=await f.load('official-child-primitives.mjs');
 const p=createOfficialChildPrimitives({root:f.runtime,env:f.env,frozen:f.frozen,binding:f.binding,taskId:f.binding.task_id,state:f.state});
 const scope={activity:'preflight',workflow:f.frozen.agent_input.workflow_key,run:f.env.WFR_TAG,source_commit:f.frozen.deployment.source_commit,profile:f.env.P,serial:f.env.SERIAL,task_id:f.binding.task_id,run_id:f.binding.run_id,binding_id:f.binding.id,snapshot_sha256:f.frozen.snapshot_sha256,deadline_ms:Date.now()+60000,worker_deadline_ms:Date.now()+50000,receipt_deadline_ms:Date.now()+55000};
 await p.begin(scope);const tools=p.wrapTools(f.contract,scope,{settle:async()=>{throw Error('BUSINESS_FAILED');}});
 await assert.rejects(tools.closeNativeScope({execution_stopped:true,owner_execution_stopped:true,child_execution_stopped:true,source_commit:scope.source_commit}),/OFFICIAL_CHILD_PRIMITIVE_UNCONFIRMED/);
 assert.equal(p.snapshot().active,true);assert.equal((await p.close()).execution_stopped,false);
});

for(const mode of ['success','cleanup-success','cleanup-settle-reject','cleanup-release-reject','cleanup-release-unknown','clone-capability','foreign-scope','owner-unproven','child-unproven','source-mismatch','terminal-mismatch','broker-unknown'])test('官方已启动域的关闭能力与业务结果独立: '+mode,async t=>{
 const cleanup=mode.startsWith('cleanup-'),f=await fixture(t,{activityKey:cleanup?'cleanup':'preflight'});
 const {createOfficialChildPrimitives}=await f.load('official-child-primitives.mjs');
 const {createActivitySkillExecutor,skillOfficialExecutionStopped}=await f.load('activity-skill-executor.mjs');
 const {callActivityTool}=await f.load('activity-skill-tool.mjs');
 const p=createOfficialChildPrimitives({root:f.runtime,env:f.env,frozen:f.frozen,binding:f.binding,taskId:f.binding.task_id,state:f.state});
 const businessError=Object.assign(Error('COMPANY_ACCOUNT_IDENTITY_UNVERIFIED'),mode==='cleanup-release-unknown'?{externalEffect:'unknown',executionStopped:false}:{});
 let result=null,settles=0,releases=0,capabilitySeen=false;
 const execute=createActivitySkillExecutor({runDir:f.dir,frozen:f.frozen,binding:f.binding,env:f.env,deadlineFor:()=>Date.now()+90000,supportsNativeScope:a=>p.supports(a),nativeState:()=>p.snapshot(),
  createTools:async(a,scope)=>{
   const nativeScope=mode==='foreign-scope'?{...scope,deadline_ms:scope.deadline_ms+1}:scope;
   await p.begin(nativeScope);
   const tools=p.wrapTools(a,nativeScope,{prepare:async()=>{},inspect:async()=>({}),phone:async()=>{throw Error('UNEXPECTED_PHONE');},business:async()=>({execution_stopped:false,external_effect:'unknown'}),getResult:()=>result,
    settle:async()=>{settles++;assert.equal(p.snapshot().active,true);if(mode==='cleanup-settle-reject')throw businessError;result={status:'completed'};},
    release:async()=>{releases++;assert.equal(p.snapshot().active,true);if(mode.startsWith('cleanup-release-'))throw businessError;}});
   const close=tools.closeNativeScope;
   return {...tools,closeNativeScope:async proof=>{
    if(skillOfficialExecutionStopped(proof,scope)){
     capabilitySeen=true;assert.equal(Object.isFrozen(proof),true);assert.equal(skillOfficialExecutionStopped({...proof},scope),false);
     for(const field of ['run_id','task_id','source_commit','binding_id','activity','snapshot_sha256'])assert.equal(skillOfficialExecutionStopped(proof,{...scope,[field]:'foreign'}),false,field);
     assert.equal(skillOfficialExecutionStopped(proof,nativeScope),mode!=='foreign-scope');
    }
    return close(mode==='clone-capability'?{...proof}:proof);
   }};
  },rpc:async q=>{
   if(q.kind==='activity_skill_authority')return {authorized:true};assert.equal(q.kind,'activity_skill');
   if(mode==='broker-unknown')await callActivityTool(q.request.broker_request_path,'business',{operation:'readback',input:{}});
   const child=id(),receipt={status:'ok',execution_stopped:true,owner_execution_stopped:true,child_execution_stopped:true,source_commit:q.request.source_commit,child_run_id:child,terminal:{runId:child,status:'ok',endedAt:Date.now()}};
   if(mode==='owner-unproven')receipt.owner_execution_stopped=false;
   if(mode==='child-unproven')receipt.child_execution_stopped=false;
   if(mode==='source-mismatch')receipt.source_commit='b'.repeat(40);
   if(mode==='terminal-mismatch')receipt.terminal.runId=id();
   return {result:receipt};
  }});
 let outcome,error;try{outcome=await execute(f.contract,{context:{task_id:f.binding.task_id}});}catch(e){error=e;}
 const physicalKnown=['success','cleanup-success','cleanup-settle-reject','cleanup-release-reject'].includes(mode);
 const identityUnknown=['owner-unproven','child-unproven','source-mismatch','terminal-mismatch','broker-unknown'].includes(mode);
 assert.equal(capabilitySeen,physicalKnown||['clone-capability','foreign-scope'].includes(mode));
 assert.equal(settles,identityUnknown?0:1);assert.equal(releases,mode==='cleanup-success'||mode.startsWith('cleanup-release-')?1:0);
 if(mode==='success'||mode==='cleanup-success'){assert.equal(error,undefined);assert.equal(outcome.status,'completed');assert.equal(outcome.execution_stopped,true);}
 else if(mode.startsWith('cleanup-')){assert.equal(error,businessError);assert.equal(error.executionStopped,physicalKnown);}
 else if(identityUnknown){assert.equal(error,undefined);assert.equal(outcome.execution_stopped,false);}
 else{assert.match(error.message,/AGENT_PRIMARY_NATIVE_SCOPE_UNVERIFIED/);assert.equal(error.executionStopped,false);}
 assert.equal(p.snapshot().active,!physicalKnown);assert.equal((await p.close()).execution_stopped,physicalKnown);
});

test('代码专属getter只交出当前同scope准入实例，关闭后及克隆能力均拒绝',async t=>{
 const f=await fixture(t,{activityKey:'preflight'}),{createOfficialChildPrimitives}=await f.load('official-child-primitives.mjs'),{isPhoneOperationAdmission}=await f.load('phone-operation-admission.mjs');
 const context={root:f.runtime,env:f.env,frozen:f.frozen,binding:f.binding,taskId:f.binding.task_id,state:f.state},p=createOfficialChildPrimitives(context);
 const scope={activity:'preflight',workflow:f.frozen.agent_input.workflow_key,run:f.env.WFR_TAG,source_commit:f.frozen.deployment.source_commit,profile:f.env.P,serial:f.env.SERIAL,task_id:f.binding.task_id,run_id:f.binding.run_id,binding_id:f.binding.id,snapshot_sha256:f.frozen.snapshot_sha256,deadline_ms:Date.now()+60000,worker_deadline_ms:Date.now()+50000,receipt_deadline_ms:Date.now()+55000};
 assert.equal(typeof p.operationAdmission,'function');assert.throws(()=>p.operationAdmission(scope),/OFFICIAL_CHILD_PRIMITIVE_UNCONFIRMED/);
 await p.begin(scope);
 try{
  const admission=p.operationAdmission(scope);assert.equal(p.operationAdmission(structuredClone(scope)),admission);assert.equal(isPhoneOperationAdmission(admission,{...context,scope}),true);assert.equal(isPhoneOperationAdmission({...admission},{...context,scope}),false);
  assert.throws(()=>p.operationAdmission({...scope,activity:'collection'}),/OFFICIAL_CHILD_PRIMITIVE_UNCONFIRMED/);assert.throws(()=>p.operationAdmission({...scope,worker_deadline_ms:scope.worker_deadline_ms+1}),/OFFICIAL_CHILD_PRIMITIVE_UNCONFIRMED/);assert.throws(()=>p.operationAdmission(),/OFFICIAL_CHILD_PRIMITIVE_UNCONFIRMED/);
  assert.equal((await p.finish('preflight')).execution_stopped,true);assert.throws(()=>p.operationAdmission(scope),/OFFICIAL_CHILD_PRIMITIVE_UNCONFIRMED/);
 }finally{await p.close();}
 assert.throws(()=>p.operationAdmission(scope),/OFFICIAL_CHILD_PRIMITIVE_UNCONFIRMED/);
});
