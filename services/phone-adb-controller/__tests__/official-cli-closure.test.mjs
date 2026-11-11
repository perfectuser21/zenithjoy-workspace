import test from 'node:test';
import assert from 'node:assert/strict';
import {execInput} from '../leadgen-client.mjs';
import * as client from '../leadgen-client.mjs';
const outer=(...a)=>{assert.equal(typeof client.executionOuterReturned,'function','CLI closure needs a live outer-close capability');return client.executionOuterReturned(...a);};
test('only the actual execInput close brands its exact immutable invocation',async()=>{const args=['-c','printf closed'],result=await execInput('/bin/sh',args,{env:{PATH:'/usr/bin:/bin'}});assert.equal(outer(result,'/bin/sh',args),true);assert.equal(outer({...result},'/bin/sh',args),false);assert.equal(outer(result,'/bin/sh',['-c','printf different']),false);assert.equal(outer(result,'/usr/bin/true',args),false);args[1]='changed';assert.equal(outer(result,'/bin/sh',args),false);});
test('execInput timeout and serialized exit zero cannot grant outer return authority',async()=>{const args=['-c','sleep 5'];let error;try{await execInput('/bin/sh',args,{timeoutMs:30,env:{PATH:'/usr/bin:/bin'}});}catch(e){error=e;}assert.ok(error);assert.equal(outer(error,'/bin/sh',args),false);assert.equal(outer({code:0,executionStopped:true},'/bin/sh',args),false);});
import {describeOfficialCliInvocation,createOfficialCliClosure,isOfficialCliOperationStopped,isOfficialCliOuterReturned,isOfficialCliInvocationNotStarted} from '../official-cli-closure.mjs';
import {readFileSync,readdirSync,lstatSync,mkdtempSync,realpathSync,rmSync,mkdirSync,writeFileSync,unlinkSync,symlinkSync,cpSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createLeadgenAgentTools} from '../leadgen-agent-tools.mjs';
import {createPhoneAction} from '../leadgen-phone-action.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,''),digest=b=>createHash('sha256').update(b).digest('hex');
test('官方CLI固定受审清单必须覆盖当前每份依赖的确切源码字节',()=>{
 const source=readFileSync(join(root,'official-cli-closure.mjs'),'utf8'),literal=source.match(/const REVIEWED=Object\.freeze\((\{[\s\S]*\})\);\s*$/);
 assert.ok(literal,'受审清单必须保持静态JSON字面量');
 for(const [name,pins]of Object.entries(JSON.parse(literal[1]))){
  const reviewed=Array.isArray(pins)?pins:[pins];assert.ok(reviewed.length&&reviewed.every(pin=>/^[a-f0-9]{64}$/.test(pin)),name);
  const actual=digest(readFileSync(join(root,name)));assert.ok(reviewed.includes(actual),`${name} 当前源码 ${actual} 未经固定受审pin接纳`);
 }
});
const executables={zsh:{path:'/bin/zsh'},python:{path:realpathSync('/usr/bin/python3')},node:{path:realpathSync(process.execPath)}};for(const spec of Object.values(executables))spec.sha256=digest(readFileSync(spec.path));
const describe=(command,args)=>describeOfficialCliInvocation({root,command,args,executables,profile:'fixture',owner:'run',serial:'serial'});
test('Skill公布的只读能力经真实phone参数适配可被官方CLI执行边界识别',async t=>{
 const runDir=mkdtempSync(join(tmpdir(),'published-phone-status-'));t.after(()=>rmSync(runDir,{recursive:true,force:true}));
 const scope={workflow:'douyin_video_discovery',activity:'preflight',run:'agent_fixture',run_id:'douyin_video_discovery-agent_fixture__a1',task_id:'28f30d70-7248-434b-a1d4-29afed626017',binding_id:'00000000-0000-4000-8000-000000000001',source_commit:'a'.repeat(40),snapshot_sha256:'b'.repeat(64),profile:'fixture',serial:'serial',line:'yuesheng',source_run:null,limit:1,deadline_ms:Date.now()+10000};
 const invocations=[];
 const phone=createPhoneAction({env:{HOME:runDir,DOUYIN_PHONE_ADB:join(root,'douyin-phone-adb')},state:{},profile:scope.profile,run:scope.run,isLocked:()=>true,isClosed:()=>false,getScope:()=>({zsh:executables.zsh.path}),nativeReceipt:()=>({operationId:'status-operation'}),checked:async(command,args)=>{
  const plan=describeOfficialCliInvocation({root,command,args,executables,profile:scope.profile,owner:scope.run,serial:scope.serial});invocations.push(plan);
  return plan.operation==='lock-refresh'?'lock=refreshed':'native-read-'+plan.operation;
 }});
 const tools=createLeadgenAgentTools({scope,runDir,primitives:{assertResources:async()=>true,inspect:async()=>({}),phone}});
 const context=await tools.inspect(),commands=['status','foreground','window','ui-evidence','snapshot-evidence','outward-ledger'];
 for(const command of commands){assert.ok(context.phone_capabilities.includes(command));assert.deepEqual(context.tool_contract.phone[command].args,[]);assert.equal(await tools.phone(command),'native-read-'+command);}
 for(const command of ['status','window'])assert.deepEqual(invocations.find(plan=>plan.operation===command).args,['-f',join(root,'douyin-phone-adb'),'--profile',scope.profile,command]);
 for(const command of ['ui-evidence','snapshot-evidence']){
  const args=invocations.find(plan=>plan.operation===command).args;assert.deepEqual(args.slice(0,-1),['-f',join(root,'douyin-phone-adb'),'--profile',scope.profile,'--lock-owner',scope.run,command]);assert.ok(args.at(-1).startsWith(scope.run+'-'));
 }
 const ledger=invocations.find(plan=>plan.operation==='outward-ledger');assert.equal(ledger.args.at(-1),scope.run,'账本身份来自server锁owner，不能替换为运行UUID');
 const before=invocations.length;await assert.rejects(()=>tools.phone('outward-ledger','foreign-run'),/PHONE_INPUT_INVALID/);assert.equal(invocations.length,before);
});
test('CLI plan admits fixed argv and refuses arbitrary shell, sends and background entry points',()=>{assert.equal(describe('zsh',['-f',join(root,'douyin-phone-adb'),'--profile','fixture','foreground']).kind,'synchronous-cli');assert.equal(describe(join(root,'douyin-phone-adb'),['--profile','fixture','record-start','run-record','25','7712345678901234567']).kind,'recording-outer-only');for(const [command,args]of [['zsh',['-fc','echo fake']],['python3',['-c','pass']],[join(root,'douyin-phone-adb'),['--profile','fixture','private-message-send']],[join(root,'douyin-phone-adb'),['--profile','fixture','with-lock']],[join(root,'douyin-phone-adb'),['--profile','fixture','tap-evidence','--outward','send']]])assert.throws(()=>describe(command,args),/OFFICIAL_CLI/);});
test('只读命令不能携带额外参数或改读另一owner账本',()=>{
 const ctl=join(root,'douyin-phone-adb'),prefix=['--profile','fixture'];
 for(const command of ['status','window']){
  assert.throws(()=>describe(ctl,[...prefix,command,'extra']),/OFFICIAL_CLI_INVOCATION/);
  assert.throws(()=>describe(ctl,[...prefix,'--lock-owner','run',command]),/OFFICIAL_CLI_INVOCATION/);
 }
 for(const tail of [[],['foreign-owner'],['11111111-1111-4111-8111-111111111111'],['run','extra']])assert.throws(()=>describe(ctl,[...prefix,'outward-ledger',...tail]),/OFFICIAL_CLI_OWNER/);
 assert.throws(()=>describe(ctl,[...prefix,'--lock-owner','run','outward-ledger','run']),/OFFICIAL_CLI_OWNER/);
});
function rig(t,{epochFails=false,sourceMismatch=false,runtimeRoot=root,createFacade=createOfficialCliClosure}={}){const directory=realpathSync(mkdtempSync(join(tmpdir(),'official-cli-')));t.after(()=>rmSync(directory,{recursive:true,force:true}));const files={};for(const name of readdirSync(runtimeRoot)){const path=join(runtimeRoot,name);if(lstatSync(path).isFile())files['runtime/'+name]=digest(readFileSync(path));}if(sourceMismatch)files['runtime/douyin-phone-adb']='0'.repeat(64);const taskId='11111111-1111-4111-8111-111111111111',binding={run_id:'run__a1',id:'22222222-2222-4222-8222-222222222222'},env={HOME:directory,WFR_RUN_DIR:directory,P:'fixture',SERIAL:'serial',WFR_TAG:'run',WFR_ATTEMPT:'a1'},frozen={snapshot_sha256:'a'.repeat(64),deployment:{source_commit:'b'.repeat(40)},files,agent_input:{task_id:taskId,profile:'fixture',serial:'serial',run_tag:'run',workflow_key:'douyin_video_processing'},collection_phone_scope:{run_id:binding.run_id,profile:'fixture',serial:'serial',policy:{schema_version:2},executables}};let admissions=0;const phases=[];const facade=createFacade({root:runtimeRoot,env,frozen,binding,taskId,scope:{activity:'preflight',task_id:taskId,run_id:binding.run_id,binding_id:binding.id,snapshot_sha256:frozen.snapshot_sha256,source_commit:frozen.deployment.source_commit,profile:'fixture',serial:'serial',run:'run',workflow:'douyin_video_processing',worker_deadline_ms:Date.now()+20000,receipt_deadline_ms:Date.now()+25000,deadline_ms:Date.now()+30000},assertAdmission:async request=>{phases.push(request);admissions++;if(epochFails)throw Object.assign(Error('EPOCH_LOST'),{resourceUnknown:true});return {authorized:true};}});const receipt={runDir:directory,operationId:'op1',runId:binding.run_id,taskId,profile:'fixture',serial:'serial',sourceCommit:frozen.deployment.source_commit,owner:'run',activity:'preflight'};return {facade,frozen,receipt,phases,admissions:()=>admissions};}
test('伪造的未启动字段、克隆异常和错操作身份不能取得原生停止权限',async t=>{
 const r=rig(t),command=join(root,'douyin-phone-adb'),args=['--profile','fixture','private-message-send'];
 let original;try{await r.facade.execute(command,args,{receipt:r.receipt});}catch(error){original=error;}
 assert.ok(original);assert.equal(r.admissions(),0);
 const forged=Object.assign(Error(original.message),{code:original.code,executionStopped:true,notStarted:true,resourceUnknown:false});
 const cloned=Object.assign(Error(original.message),JSON.parse(JSON.stringify(original)));
 for(const [error,invocation,receipt]of [[forged,args,r.receipt],[cloned,args,r.receipt],[original,[...args],{...r.receipt,operationId:'foreign-operation'}]]){
  const state={};client.applyNativeFailure(error,command,invocation,{receipt},state);
  assert.equal(error.executionStopped,false);assert.equal(state.executionUnknown,true);
 }
 await r.facade.close();
});
test('fixed original CLI failure closes normally without granting its clone authority',async t=>{const r=rig(t),command=join(root,'douyin-phone-adb'),args=['--profile','fixture','runtime-contract'];const result=await r.facade.execute(command,args,{receipt:r.receipt,timeoutMs:10000});assert.notEqual(result.code,0,'isolated fixture has no phone registry');assert.equal(result.executionStopped,false,'execInput public semantics remain conservative');const context={command,args,receipt:r.receipt,root,frozen:r.frozen};assert.equal(isOfficialCliOperationStopped(result,context),true);assert.equal(isOfficialCliOuterReturned(result,context),true);assert.equal(isOfficialCliOperationStopped({...result},context),false);assert.equal(isOfficialCliOperationStopped(result,{...context,receipt:{...r.receipt,activity:'collection'}}),false);assert.equal(r.admissions(),2);assert.equal((await r.facade.close()).execution_stopped,true);});
test('epoch rejection happens before a fixed CLI spawn and keeps the domain unknown',async t=>{const r=rig(t);r.frozen.files['runtime/douyin-phone-adb']='0'.repeat(64);const context={command:join(root,'douyin-phone-adb'),args:['--profile','fixture','runtime-contract'],receipt:r.receipt};assert.equal(isOfficialCliOperationStopped({code:0},context),false);await r.facade.close();const second=rig(t,{epochFails:true});await assert.rejects(second.facade.execute(context.command,context.args,{receipt:second.receipt}),/EPOCH_LOST/);assert.equal(second.admissions(),1);assert.equal((await second.facade.close()).unknown,true);});

test('record CLI has only outer return evidence and cannot issue ordinary operation stop',async t=>{const r=rig(t),command=join(root,'douyin-phone-adb'),args=['--profile','fixture','record-status','run-record'];const result=await r.facade.execute(command,args,{receipt:r.receipt,timeoutMs:10000});const context={command,args,receipt:r.receipt,root,frozen:r.frozen};assert.equal(isOfficialCliOuterReturned(result,context),true);assert.equal(isOfficialCliOperationStopped(result,context),false);assert.equal((await r.facade.close()).execution_stopped,true,'this domain covers only the CLI, never the record client');});
test('frozen source mismatch and preexisting unknown marker fail before CLI dispatch',async t=>{const r=rig(t,{sourceMismatch:true}),command=join(root,'douyin-phone-adb'),args=['--profile','fixture','runtime-contract'];await assert.rejects(r.facade.execute(command,args,{receipt:r.receipt}),/SOURCE/);assert.equal(r.admissions(),0);await r.facade.close();const q=rig(t);mkdirSync(join(q.receipt.runDir,'native-operations'),{mode:0o700});writeFileSync(join(q.receipt.runDir,'native-operations','op1.unknown'),'sticky',{mode:0o600});await assert.rejects(q.facade.execute(command,args,{receipt:q.receipt}),/PREVIOUS_UNKNOWN/);assert.equal(q.admissions(),0);assert.equal((await q.facade.close()).unknown,true);});

test('prepare checks source and fresh epoch before an official child can launch',async t=>{const r=rig(t);assert.equal(await r.facade.prepare(),true);assert.equal(r.admissions(),1);await r.facade.close();const q=rig(t,{sourceMismatch:true});await assert.rejects(q.facade.prepare(),/SOURCE/);assert.equal(q.admissions(),0);await q.facade.close();});

test('local metadata uses explicit Task authority without requiring a physical epoch owner',async t=>{const r=rig(t);await r.facade.prepare();const command=join(root,'douyin-phone-adb'),args=['--profile','fixture','runtime-contract'];await r.facade.execute(command,args,{receipt:r.receipt});assert.deepEqual(r.phases.map(p=>[p.phase,p.resourceOnly]),[['prepare',true],['before',true],['after',true]]);await r.facade.close();assert.throws(()=>describe(command,['--profile','fixture','lock-release-exact','foreign']),/OWNER/);assert.equal(describe(command,['--profile','fixture','lock-acquire-new','run']).kind,'local-metadata');});

test('private PATH entries cannot be replaced between prepare and a CLI operation',async t=>{const r=rig(t);assert.equal(await r.facade.prepare(),true);const node=join(r.receipt.runDir,'official-cli-bin-preflight','node');unlinkSync(node);symlinkSync('/usr/bin/true',node);await assert.rejects(r.facade.prepare(),/PINNED_RUNTIME/);await r.facade.close();});

// The reviewed v2 policy remains a fixed dependency; a new frozen hash alone is no authority.
test('正式新auth policy仅已独审字节通过，任意追加即使重冻hash也在spawn前拒绝',async t=>{const clone=realpathSync(mkdtempSync(join(tmpdir(),'cli-policy-review-')));t.after(()=>rmSync(clone,{recursive:true,force:true}));cpSync(root,clone,{recursive:true,filter:p=>!p.split('/').some(n=>['__tests__','node_modules','_dependencies'].includes(n))});symlinkSync(realpathSync(join(root,'../../node_modules')),join(clone,'node_modules'));const createFacade=(await import(pathToFileURL(join(clone,'official-cli-closure.mjs')).href)).createOfficialCliClosure;const approved=rig(t,{runtimeRoot:clone,createFacade});assert.equal(await approved.facade.prepare(),true);await approved.facade.close();const policy=join(clone,'adb-host-instance-policy.py');writeFileSync(policy,readFileSync(policy,'utf8')+'\n# unreviewed source change\n');const changed=rig(t,{runtimeRoot:clone,createFacade});await assert.rejects(changed.facade.execute(join(clone,'douyin-phone-adb'),['--profile','fixture','runtime-contract'],{receipt:changed.receipt}),/OFFICIAL_CLI_SOURCE/);assert.equal(changed.admissions(),0);await changed.facade.close();});

test('只有callee自身规划拒绝具有精确调用品牌，外部plan和其他前置失败不能取得品牌',async t=>{
 const r=rig(t),command=join(root,'douyin-phone-adb'),args=['--profile','fixture','lock-acquire','foreign-owner'];
 let error;try{r.facade.plan(command,args,{receipt:r.receipt});}catch(e){error=e;}
 const context={command,args,receipt:r.receipt,root,frozen:r.frozen};
 assert.equal(isOfficialCliInvocationNotStarted(error,context),true);
 assert.equal(error.externalEffect,'none');assert.equal(r.admissions(),0);
 for(const changed of [{command:'zsh'},{args:[...args,'extra']},{receipt:{...r.receipt,operationId:'foreign'}},{root:root+'-foreign'},{frozen:{...r.frozen,snapshot_sha256:'c'.repeat(64)}}])assert.equal(isOfficialCliInvocationNotStarted(error,{...context,...changed}),false);
 assert.equal(isOfficialCliInvocationNotStarted(Object.assign(Error(error.message),error),context),false);
 await assert.rejects(r.facade.execute(command,args,{receipt:r.receipt,plan:{kind:'local-metadata',binary:'/usr/bin/true',args:[]}}),e=>isOfficialCliInvocationNotStarted(e,context));
 let invalidReceipt;try{r.facade.plan(command,args,{receipt:{...r.receipt,operationId:'bad/receipt'}});}catch(e){invalidReceipt=e;}
 assert.equal(isOfficialCliInvocationNotStarted(invalidReceipt,context),false);
 await r.facade.close();
 const q=rig(t,{sourceMismatch:true}),qcontext={...context,receipt:q.receipt,frozen:q.frozen};
 let sourceError;try{q.facade.plan(command,args,{receipt:q.receipt});}catch(e){sourceError=e;}
 assert.match(sourceError.message,/SOURCE/);assert.equal(isOfficialCliInvocationNotStarted(sourceError,qcontext),false);await q.facade.close();
 const sticky=rig(t),stickyContext={...context,receipt:sticky.receipt,frozen:sticky.frozen};
 mkdirSync(join(sticky.receipt.runDir,'native-operations'),{mode:0o700});writeFileSync(join(sticky.receipt.runDir,'native-operations','op1.unknown'),'sticky',{mode:0o600});
 let stickyError;try{sticky.facade.plan(command,args,{receipt:sticky.receipt});}catch(e){stickyError=e;}
 assert.match(stickyError.message,/PREVIOUS_UNKNOWN/);assert.equal(isOfficialCliInvocationNotStarted(stickyError,stickyContext),false);assert.equal((await sticky.facade.close()).unknown,true);
});

test('合法M4 USB边界经原作用域准入后可构造，JSON克隆不能代替准入能力',async t=>{
 const api=await import('../phone-operation-admission.mjs');
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'official-usb-cli-')));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const taskId='11111111-1111-4111-8111-111111111111',binding={run_id:'run__a1',id:'22222222-2222-4222-8222-222222222222'};
 const input={task_id:taskId,profile:'xiaolongxia',serial:'ANGYVB4311010223',run_tag:'run',workflow_key:'douyin_video_discovery'};
 const files={};for(const name of readdirSync(root)){const p=join(root,name);if(lstatSync(p).isFile())files['runtime/'+name]=digest(readFileSync(p));}
 for(const path of ['config/collection-phone-hosts.json','config/native-phone-command-sources.json','config/native-phone-reviews/xiaolongxia-sdk35-xian-m4.md'])files['runtime/'+path]=digest(readFileSync(join(root,path)));
 const policy=JSON.parse(readFileSync(join(root,'config/collection-phone-hosts.json'))).hosts.find(h=>h.profile==='xiaolongxia').policy;
 const frozen={snapshot_sha256:'a'.repeat(64),deployment:{source_commit:'b'.repeat(40)},files,agent_input:input,discovery_phone_scope:{run_id:binding.run_id,target:'xian-m4',profile:input.profile,serial:input.serial,expected_account:'90915521618',policy,executables,policy_binding:{usb_local:{protocol:'usb-local-lease/v1',device_sdk:35,daemon:{pid:111,uid:process.getuid(),endpoint:policy.endpoint},transport:{serial:input.serial,transport_id:'11',usb_path:'0-1'}}}}};
 const env={HOME:directory,WFR_RUN_DIR:directory,P:input.profile,SERIAL:input.serial,WFR_TAG:'run'},scope={activity:'preflight',task_id:taskId,run_id:binding.run_id,binding_id:binding.id,snapshot_sha256:frozen.snapshot_sha256,source_commit:frozen.deployment.source_commit,profile:input.profile,serial:input.serial,run:'run',workflow:input.workflow_key,worker_deadline_ms:Date.now()+20000,receipt_deadline_ms:Date.now()+25000,deadline_ms:Date.now()+30000};
 const context={root,env,frozen,state:{},scope,binding,taskId,assertAuthority:async()=>({authorized:true})};
 const admission=api.createPhoneOperationAdmission(context);
 assert.equal(admission.kind,'usb-local');
 assert.equal(api.isPhoneOperationAdmission(admission,context),true);
 assert.equal(api.isPhoneOperationAdmission({...admission},context),false);
 assert.throws(()=>createOfficialCliClosure({...context,operationAdmission:{kind:'usb-local',assert:async()=>({authorized:true})}}),/OFFICIAL_CLI_ADMISSION/);
 const facade=createOfficialCliClosure({...context,operationAdmission:admission});
 assert.equal((await facade.close()).execution_stopped,true);
});
