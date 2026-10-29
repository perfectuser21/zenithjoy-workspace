// 不连接手机：真实handler/发现循环/guard；设备与PG只在各自外部边界隔离。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHandlers} from '../leadgen-handlers.mjs';
import {createDiscoveryHandlers} from '../leadgen-discovery.mjs';
import {activityExecutionDeadline,invokeNativeActivity,runWorkflow} from '../leadgen-workflow.mjs';
const source=new URL('../',import.meta.url).pathname;

// 回归目标：collect不能吃掉global最后的cleanup预算，也不能续跑重置截止。
test('101采集截止从原global内保留cleanup尾部，不增加业务时间',()=>{
 const now=1800000000000,activity={key:'collect_videos',budget:{max_duration_s:2400}};
 const env={WF_BRAIN_WORKFLOW:'douyin_video_discovery',WF_RUN_START_TS:String(now/1000),WF_RUN_MAX_SECONDS:'600'};
 const first=activityExecutionDeadline({activity,env,now,cleanupReserveMs:120000});
 assert.equal(first,now+480000);
 assert.equal(activityExecutionDeadline({activity,env,now:now+100000,previous:first,cleanupReserveMs:120000}),first);
 assert.equal(activityExecutionDeadline({activity:{key:'cleanup',budget:{max_duration_s:120}},env,now:now+480000,cleanupReserveMs:120000}),now+600000);
});

// 回归目标：剩余budget不足原命令完整时长时，不能先续锁/spawn再缩timeout杀半途。
test('101当前取链余量不足既有300秒预算时拒绝启动原生命令',async()=>{
 const d=mkdtempSync(join(tmpdir(),'discovery-command-admission-')),calls=[];
 try{
  mkdirSync(join(d,'.config/openclaw'),{recursive:true});writeFileSync(join(d,'.config/openclaw/douyin-account-routes.tsv'),'p\taccount\n');
  const h=createHandlers({root:source,sourceCommit:'a'.repeat(40),taskId:'task',env:{HOME:d,WFR_RUN_DIR:d,WFR_RUN_ID:'run',WFR_ATTEMPT:'a1',WFR_TAG:'owner',P:'p',SERIAL:'SERIAL',LEADGEN_LINE:'jinuo',WF_BRAIN_WORKFLOW:'douyin_video_discovery'},rpc:async()=>({result:{}}),execute:async(command,args)=>{
   calls.push({command,args});const c=args.find(a=>['preflight','lock-acquire','lock-refresh','account-current'].includes(a));
   return {code:0,stderr:'',stdout:args.includes('telephony.registry')?'mCallState=0\n':args[0]===join(source,'adb-existing-route.py')?'5042\n':c==='preflight'?'serial=SERIAL\n':c==='lock-acquire'?'lock=acquired\n':c==='lock-refresh'?'lock=refreshed owner=owner ttl=300s\n':c==='account-current'?'douyin_id=account\n':'device\n'};
  }});
  await h.preflight();calls.length=0;h.state.currentActivity='collect_videos';h.state.budgetDeadline=Date.now()+10000;
  await assert.rejects(h.handoffPhone('current-video-link','owner-candidate8-link','AI'),/budget_exhausted/);
  assert.deepEqual(calls,[],'不足预算须在续锁和第8条取链之前停止，不能出现rc143再恢复');
 }finally{rmSync(d,{recursive:true,force:true});}
});

// 回归目标：余量不足完整捕获闭包时不得先点开下一视频。
test('101下一捕获余量不足时保留partial且没有tap/取链/PG写入',async()=>{
 const d=mkdtempSync(join(tmpdir(),'discovery-capture-admission-')),calls=[],writes=[];const xml=join(d,'grid.xml');
 writeFileSync(xml,'<hierarchy><node resource-id="com.ss.android.ugc.aweme:id/et_search_kw" text="AI"/></hierarchy>');
 try{
  const h=createDiscoveryHandlers({root:source,profile:'p',run:'owner',runId:'run__a1',sourceCommit:'a'.repeat(40),sources:['AI'],limit:1,location:'unlimited',captureBudgetMs:661000,budgetDeadline:()=>Date.now()+10000,env:{WFR_RUN_DIR:d,LEADGEN_LINE:'jinuo'},execute:async()=>({code:0,stdout:'',stderr:''}),queue:async(op,fields)=>{writes.push({op,fields});throw Error('不得写入');},phone:async(command)=>{
   calls.push(command);if(command==='search-time-layer')return 'sort=latest\ntime_layer=six_months\nduration=unlimited\nscope=unlimited\nlocation=unlimited\n';
   if(command==='search-video-cards')return '340\t540\t00:20\t真实目标\t甲\nvideo_tab=1\nloading=0\nend_of_results=1\nevidence='+xml;
   if(command==='search-kw-matches')return 'kw_matches=1\n';return '';
  }});
  const out=await h.collect_videos();
  assert.equal(calls.includes('tap-evidence'),false,'余量不足不能先点开下一视频');assert.equal(calls.includes('current-video-link'),false);assert.deepEqual(writes,[]);
  assert.equal(out.status,'partial');assert.equal(out.stop_reason,'budget_exhausted');
 }finally{rmSync(d,{recursive:true,force:true});}
});

// 原run同类真负例：child.wait已返回143但子PG仍活，必须原生unknown，不能伪cleanup能力洗白。
test('真实guard根143但live PG仍在：unknown标记保留且不能清场/重跑',{skip:process.platform==='win32'},async()=>{
 const d=mkdtempSync(join(tmpdir(),'discovery-live-pg-'));try{
  const script=join(d,'controller'),marker=join(d,'native.unknown');
  writeFileSync(script,`#!/bin/zsh\npython3 -c 'import subprocess,sys; subprocess.Popen(["/bin/sleep","1"],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);sys.exit(143)'\n`,{mode:0o755});
  const r=spawnSync('python3',[join(source,'phone-lock-helper.py'),'guard',join(d,'SERIAL.guard'),'SERIAL','--lock-owner',script,'p','owner','current-video-link'],{env:{...process.env,WFR_NATIVE_UNKNOWN_FILE:marker},encoding:'utf8',timeout:5000});
  assert.notEqual(r.status,0);assert.match(r.stderr,/guarded command termination unproven: live process group remains/);assert.equal(existsSync(marker),true);assert.match(readFileSync(marker,'utf8'),/guard_exception/);
  const state={nativeStopUnproven:true},partial=await invokeNativeActivity(async()=>({status:'partial',stop_reason:'budget_exhausted',persisted:7,cleanup_only:{verified:true,execution_stopped:true}}),state);let cleaned=0,recovered=0;
  const out=await runWorkflow({activities:[{key:'collect_videos'},{key:'cleanup'}],context:{},handlers:{collect_videos:async()=>partial,cleanup:async()=>{cleaned++;return {};}},recover:async()=>{recovered++;return {status:'completed',execution_stopped:true};},commander:async()=>({action:'continue'}),record:async()=>{},terminationUnverified:()=>state.nativeStopUnproven});
  assert.equal(out.status,'failed');assert.equal(cleaned,0);assert.equal(recovered,0);assert.equal(partial.persisted,7);assert.equal(state.executionUnknown,true);
 }finally{await new Promise(r=>setTimeout(r,1100));rmSync(d,{recursive:true,force:true});}
});

import {discoveryFixture,discoveredId} from './helpers/discovery-cleanup-fixture.mjs';
test('101 冻结包缺原生闭包能力时在业务动作前拒绝，不靠 screen_limit 清场',{skip:process.platform!=='darwin'},async t=>{
 const f=await discoveryFixture(t,{stop:false,screenLimit:true});
 try{
  delete f.frozen.discovery_phone_scope;
  const {digest}=await f.load('runtime-definition.mjs');delete f.frozen.snapshot_sha256;f.frozen.snapshot_sha256=digest(f.frozen);
  writeFileSync(join(f.d,'run-definition.json'),JSON.stringify(f.frozen));
  await assert.rejects(f.h.collect_videos(),/DISCOVERY_PHONE_SCOPE_REQUIRED/);
  assert.deepEqual(f.stored,[]);assert.equal(existsSync(join(f.d,'discovery-progress.json')),false);
 }finally{rmSync(f.d,{recursive:true,force:true});}
});
test('101 首屏有限停止且原生叶子已封闭：保留 partial、进入真实 verify 和 cleanup',{skip:process.platform!=='darwin'},async t=>{
 const f=await discoveryFixture(t,{stop:false,screenLimit:true});
 const {invokeNativeActivity,runWorkflow}=await f.load('leadgen-workflow.mjs');let verified=0,cleaned=0,recovered=0;
 try{
  const out=await runWorkflow({activities:[{key:'collect_videos',retry_safe:true},{key:'cleanup'}],context:f.context,
   handlers:{collect_videos:()=>invokeNativeActivity(()=>f.h.collect_videos(),f.h.state),cleanup:async()=>{cleaned++;f.h.state.currentActivity='cleanup';f.h.state.budgetDeadline=(Number(f.env.WF_RUN_START_TS)+Number(f.env.WF_RUN_MAX_SECONDS))*1000;return invokeNativeActivity(()=>f.h.cleanup(),f.h.state);}},
   commander:async()=>({action:'continue'}),record:async()=>{},verify:async(a,e)=>{if(a.key==='collect_videos'){verified++;assert.equal(e.result.stop_reason,'screen_limit');assert.equal(e.result.counts.persisted,1);assert.equal(JSON.parse(readFileSync(join(f.d,'discovery-progress.json'))).request.target_count,10);assert.deepEqual(e.result.failures,[]);}return {verified:true};},
   recover:async()=>{recovered++;throw Error('不得重新采集');},terminationUnverified:()=>f.h.state.nativeStopUnproven});
  assert.equal(out.status,'partial','有限首屏不冒称全量完成');assert.equal(out.results[0].status,'partial');
  assert.equal(verified,1,'已持久化的部分结果必须经过原验收');assert.equal(cleaned,1);assert.equal(recovered,0);
  assert.equal(out.results.at(-1).result.cleanup_readback_verified,1);assert.equal(out.results.at(-1).result.lock_released,1);
  assert.equal(f.h.state.executionUnknown,undefined);assert.equal(existsSync(f.ownerFile),false);
 }finally{rmSync(f.d,{recursive:true,force:true});}
});
test('101 discover 回执与最终 PG 清单读回失败：业务保持 partial，封闭原生叶子后仍独立清场',{skip:process.platform!=='darwin'},async t=>{
 const f=await discoveryFixture(t,{stop:false,attemptLimit:2,rpcFailure:true});
 const {invokeNativeActivity,runWorkflow}=await f.load('leadgen-workflow.mjs');let cleaned=0,verified=0,recovered=0;
 try{
  const out=await runWorkflow({activities:[{key:'collect_videos',retry_safe:true},{key:'cleanup'}],context:f.context,
   handlers:{collect_videos:()=>invokeNativeActivity(()=>f.h.collect_videos(),f.h.state),cleanup:async()=>{cleaned++;f.h.state.currentActivity='cleanup';f.h.state.budgetDeadline=(Number(f.env.WF_RUN_START_TS)+Number(f.env.WF_RUN_MAX_SECONDS))*1000;return invokeNativeActivity(()=>f.h.cleanup(),f.h.state);}},
   commander:async()=>({action:'continue'}),record:async()=>{},verify:async()=>{verified++;return {verified:true};},recover:async()=>{recovered++;throw Error('不得重采');},terminationUnverified:()=>f.h.state.nativeStopUnproven});
  assert.equal(out.status,'partial');assert.equal(out.results[0].status,'partial');
  assert.equal(out.results[0].result.stop_reason,'persistence_failed');
  assert.equal(out.results[0].result.manifest_verified,0,'PG读回失败不能冒称业务通过');
  assert.equal(out.results[0].result.video_manifest_readback_failures,1);
  assert.equal(f.stored.length,1,'第二条未知写入不能重发');
  assert.equal(f.rpcCalls.filter(x=>x.request?.op==='discover').length,2);
  assert.equal(f.rpcCalls.filter(x=>x.request?.op==='inspect_videos').length,1);
  const discoverBudget=f.rpcOptions[f.rpcCalls.findIndex(x=>x.request?.op==='discover')].timeoutMs;
  assert.ok(discoverBudget>=180000,'101 discover 须保留完整首发、读回、单次补写的有界预算');
  assert.equal(verified,0);assert.equal(recovered,0);assert.equal(cleaned,1);
  assert.equal(out.results.at(-1).result.cleanup_readback_verified,1);assert.equal(out.results.at(-1).result.lock_released,1);
  assert.equal(f.h.state.executionUnknown,undefined);assert.equal(f.h.state.nativeStopUnproven,true);
  assert.equal(existsSync(f.ownerFile),false);
 }finally{rmSync(f.d,{recursive:true,force:true});}
});
test('101 有限停止不能由停止词、假进度或复制的原生能力伪造',{skip:process.platform!=='darwin'},async t=>{
 const f=await discoveryFixture(t,{stop:false,screenLimit:true});
 const {invokeNativeActivity}=await f.load('leadgen-workflow.mjs'),{discoveryFiniteStopEvidence}=await f.load('discovery-phone-scope.mjs');
 try{
  const result=await invokeNativeActivity(()=>f.h.collect_videos(),f.h.state);
  assert.equal(result.status,'partial');assert.equal(result.stop_reason,'screen_limit');
  assert.ok(discoveryFiniteStopEvidence(result,f.context));
  for(const changed of [{...result,stop_reason:'screen_limit',cleanup_phone_scope:structuredClone(result.cleanup_phone_scope)},
   {...result,manifest_verified:0},{...result,stop_reason:'budget_exhausted'},{...result,pending_capture:{videoId:'pending'}}])
   assert.equal(discoveryFiniteStopEvidence(changed,f.context),null);
  const path=join(f.d,'discovery-progress.json'),progress=JSON.parse(readFileSync(path));progress.counts.persisted=99;writeFileSync(path,JSON.stringify(progress));
  assert.equal(discoveryFiniteStopEvidence(result,f.context),null,'落盘进度漂移不能继续验证');
 }finally{rmSync(f.d,{recursive:true,force:true});}
});
test('101 有限停止的业务验收失败仍如实失败，并仅归位原设备',{skip:process.platform!=='darwin'},async t=>{
 const f=await discoveryFixture(t,{stop:false,screenLimit:true});
 const {invokeNativeActivity,runWorkflow}=await f.load('leadgen-workflow.mjs');let verified=0,cleaned=0,recovered=0;
 try{
  const out=await runWorkflow({activities:[{key:'collect_videos',retry_safe:true},{key:'cleanup'}],context:f.context,
   handlers:{collect_videos:()=>invokeNativeActivity(()=>f.h.collect_videos(),f.h.state),cleanup:async()=>{cleaned++;f.h.state.currentActivity='cleanup';f.h.state.budgetDeadline=(Number(f.env.WF_RUN_START_TS)+Number(f.env.WF_RUN_MAX_SECONDS))*1000;return invokeNativeActivity(()=>f.h.cleanup(),f.h.state);}},
   commander:async()=>({action:'continue'}),record:async()=>{},verify:async(a)=>{if(a.key==='collect_videos'){verified++;return {verified:false};}return {verified:true};},
   recover:async()=>{recovered++;throw Error('不得重跑');},terminationUnverified:()=>f.h.state.nativeStopUnproven});
  assert.equal(out.status,'failed');assert.equal(verified,1);assert.equal(cleaned,1);assert.equal(recovered,0);
  assert.equal(out.results.at(-1).result.cleanup_readback_verified,1);assert.equal(out.results.at(-1).result.lock_released,1);
  assert.equal(existsSync(f.ownerFile),false);
 }finally{rmSync(f.d,{recursive:true,force:true});}
});
for(const mode of ['partial','normal','empty'])test('真实101封闭leaf→'+mode+'→仅原cleanup，不恢复采集',{skip:process.platform!=='darwin'},async t=>{
 const f=await discoveryFixture(t,{empty:mode==='empty',stop:mode!=='normal'});
 const {invokeNativeActivity,runWorkflow}=await f.load('leadgen-workflow.mjs');let recoveries=0;
 try{
  const out=await runWorkflow({activities:[{key:'collect_videos',retry_safe:true},{key:'cleanup'}],context:f.context,handlers:{collect_videos:()=>invokeNativeActivity(()=>f.h.collect_videos(),f.h.state),cleanup:async()=>{f.h.state.currentActivity='cleanup';f.h.state.budgetDeadline=(Number(f.env.WF_RUN_START_TS)+Number(f.env.WF_RUN_MAX_SECONDS))*1000;return invokeNativeActivity(()=>f.h.cleanup(),f.h.state);}},commander:async()=>({action:'retry'}),recover:async()=>{recoveries++;throw Error('cleanup_only不许恢复');},record:async()=>{},terminationUnverified:()=>f.h.state.nativeStopUnproven});
  t.diagnostic(JSON.stringify({status:out.status,activities:out.results.map(r=>({key:r.activity,status:r.status,reason:r.error||r.result?.failures}))}));assert.equal(out.status,mode==='normal'?'completed':'partial');assert.equal(recoveries,0);
  assert.equal(f.stored.length,mode==='empty'?0:1);if(mode!=='empty'){assert.equal(f.stored[0].videoId,discoveredId);assert.equal(JSON.parse(readFileSync(join(f.d,'discovery-progress.json'))).videos[0].videoId,discoveredId);}
  assert.equal(out.results.at(-1).result.lock_released,1);assert.equal(out.results.at(-1).result.cleanup_readback_verified,1);
  const phone=f.phoneCalls();assert.ok(phone.some(c=>c.cmd==='close-app'&&c.scoped));
  assert.equal(phone.at(-1).cmd,'lock-release');assert.equal(phone.at(-1).scoped,true);assert.equal(existsSync(f.ownerFile),false);
  const scopes=join(f.d,'discovery-phone-scopes'),cleanupDir=readdirSync(scopes).filter(n=>n!=='collect');assert.equal(cleanupDir.length,1);
  const cleanupLeaves=readdirSync(join(scopes,cleanupDir[0])).filter(n=>n.endsWith('.jsonl')).flatMap(n=>readFileSync(join(scopes,cleanupDir[0],n),'utf8').trim().split('\n').map(JSON.parse));
  assert.equal(cleanupLeaves.filter(e=>e.phase==='exit').length,8,'四个设备读回各含version与get-state；seal后的精确lock-release不能再发ADB');
  assert.equal(phone.filter(c=>c.cmd==='tap-evidence').length,mode==='empty'?0:1);
  if(mode==='empty')assert.deepEqual(f.scopeLedgers(),[],'零业务leaf只可签明确空闭包，不借102complete');else assert.ok(f.scopeLedgers().every(log=>log.includes('darwin-sandbox-deny-process-fork-v1')));
  assert.equal(f.h.state.executionUnknown,undefined);assert.equal(f.h.state.nativeStopUnproven,true,'OS观察收据保持unknown');
  f.h.state.currentActivity='collect_videos';await assert.rejects(f.h.collect_videos(),/COLLECT_CLOSED/);
 }finally{rmSync(f.d,{recursive:true,force:true});}
});

test('真实空闭包能力不可跨身份、克隆、恢复collect或新turn',{skip:process.platform!=='darwin'},async t=>{
 const f=await discoveryFixture(t,{empty:true});try{
  const {invokeNativeActivity}=await f.load('leadgen-workflow.mjs'),{discoveryCleanupEvidence}=await f.load('discovery-phone-scope.mjs');
  const result=await invokeNativeActivity(()=>f.h.collect_videos(),f.h.state);
  assert.ok(discoveryCleanupEvidence(result,f.context),'须先取得真实parent签发的有效空闭包能力');
  for(const key of ['run_id','task_id','source_commit','activity','attempt','owner','account','profile','serial','epoch','snapshot_sha256','binding_id','route','client_sha256','work_deadline_ms','global_deadline_ms','purpose'])assert.equal(discoveryCleanupEvidence(result,{...f.context,[key]:'other'}),null,'跨'+key+'必须拒绝');
  assert.equal(discoveryCleanupEvidence({...result,cleanup_phone_scope:structuredClone(result.cleanup_phone_scope)},f.context),null);
  assert.equal(discoveryCleanupEvidence({...result,persisted:99},f.context),null,'不可改原partial产物');
  const {createActivityRecovery}=await f.load('activity-skill-recovery.mjs');let launches=0;
  await assert.rejects(createActivityRecovery({runDir:f.d,frozen:f.frozen,binding:{id:'scope-binding',run_id:f.context.run_id,task_id:'scope-task'},env:f.env,handlers:f.h,rpc:async()=>{launches++;throw Error('不得启动');}})({activity:{key:'collect_videos'},failure:{status:'partial',execution_stopped:false,result}}),/OLD_EXECUTION_TERMINATION_UNKNOWN/);
  assert.equal(launches,0);await assert.rejects(f.h.collect_videos(),/COLLECT_CLOSED/);await assert.rejects(f.h.handoffPhone('current-video-link','late','AI'),/COLLECT_CLOSED/);
  f.h.state.executionUnknown=true;assert.equal(discoveryCleanupEvidence(result,f.context),null,'已有unknown不允许空闭包洗白');
  f.h.state.currentActivity='cleanup';await assert.rejects(f.h.cleanup(),/IDENTITY_INVALID/);assert.equal(existsSync(f.ownerFile),true);
 }finally{rmSync(f.d,{recursive:true,force:true});}
});

test('原生guard unknown污染时没有cleanup能力、没有清场或恢复',{skip:process.platform!=='darwin'},async t=>{
 const f=await discoveryFixture(t,{guardUnknown:true});try{
  const {invokeNativeActivity,runWorkflow}=await f.load('leadgen-workflow.mjs');let cleaned=0,recovered=0;
  const out=await runWorkflow({activities:[{key:'collect_videos'},{key:'cleanup'}],context:f.context,handlers:{collect_videos:()=>invokeNativeActivity(()=>f.h.collect_videos(),f.h.state),cleanup:async()=>{cleaned++;return {};}},commander:async()=>({action:'continue'}),record:async()=>{},recover:async()=>{recovered++;return {status:'completed',execution_stopped:true};},terminationUnverified:()=>f.h.state.nativeStopUnproven});
  assert.equal(out.status,'failed');assert.equal(cleaned,0);assert.equal(recovered,0);assert.equal(f.stored.length,0);assert.equal(existsSync(f.ownerFile),true);
  assert.equal(out.results[0].result?.cleanup_phone_scope,undefined);assert.ok(readdirSync(join(f.d,'native-operations')).some(n=>n.endsWith('.unknown')));
 }finally{rmSync(f.d,{recursive:true,force:true});}
});

test('实际ADB叶子在原截止途中超时，tainted不签cleanup_only',{skip:process.platform!=='darwin'},async t=>{
 const f=await discoveryFixture(t,{slowLeaf:true}),{startDiscoveryPhoneScope}=await f.load('discovery-phone-scope.mjs'),{execInput}=await f.load('leadgen-client.mjs');let scope;
 try{
  // 仅测试预算：给启动边界留余量，真实C叶子sleep30s必须被原10s截止终止。
  f.h.state.budgetDeadline=Date.now()+10000;
  scope=await startDiscoveryPhoneScope({root:f.runtime,env:f.env,state:f.h.state,sourceCommit:'a'.repeat(40),taskId:'scope-task',lockHeld:true});
  // 复现CI启动/调度已消耗500ms：必须证明确实进入C叶子，不能把空scope拒派当超时。
  await new Promise(r=>setTimeout(r,600));
  const r=await execInput(scope.env.DOUYIN_PYTHON_BIN,[join(f.runtime,'adb-managed-client.py'),'-s','NO-DEVICE','shell','sleep-probe'],{env:{...f.env,...scope.env},timeoutMs:15000});
  assert.notEqual(r.code,0,'必须真的在原leaf sleep中到期，不是夹具setup错误');
  assert.equal(existsSync(join(f.d,'slow-leaf-entered')),true,'C叶子必须实际进入sleep；连接拒绝不能冒充叶子超时');
  const result=await scope.finish({status:'partial',stop_reason:'budget_exhausted',persisted:0});assert.equal(result.cleanup_phone_scope,undefined);
  assert.ok(f.scopeLedgers().some(log=>log.includes('"tainted":true')),'父真实intent/start/exit账必须记录超时污染');assert.equal(existsSync(f.ownerFile),true);
 }finally{await scope?.close();rmSync(f.d,{recursive:true,force:true});}
});

test('原截止在派发前已过时空scope可仅清理，不能冒称真实叶子超时',{skip:process.platform!=='darwin'},async t=>{
 const f=await discoveryFixture(t,{slowLeaf:true}),{startDiscoveryPhoneScope,discoveryCleanupEvidence}=await f.load('discovery-phone-scope.mjs'),{execInput}=await f.load('leadgen-client.mjs');let scope;
 try{
  f.h.state.budgetDeadline=Date.now()+1000;
  scope=await startDiscoveryPhoneScope({root:f.runtime,env:f.env,state:f.h.state,sourceCommit:'a'.repeat(40),taskId:'scope-task',lockHeld:true});
  await new Promise(r=>setTimeout(r,Math.max(1,f.h.state.budgetDeadline-Date.now()+150)));
  const r=await execInput(scope.env.DOUYIN_PYTHON_BIN,[join(f.runtime,'adb-managed-client.py'),'-s','NO-DEVICE','shell','sleep-probe'],{env:{...f.env,...scope.env},timeoutMs:2000});
  assert.notEqual(r.code,0);assert.equal(existsSync(join(f.d,'slow-leaf-entered')),false);
  assert.deepEqual(f.scopeLedgers(),[],'空拒派没有任何真实叶子intent/start/exit');
  const result=await scope.finish({status:'partial',stop_reason:'budget_exhausted',persisted:0});
  assert.ok(discoveryCleanupEvidence(result,f.context));assert.equal(existsSync(f.ownerFile),true);
 }finally{await scope?.close();rmSync(f.d,{recursive:true,force:true});}
});

test('cleanup_only可过采集截止但不得过原global截止，过期保原锁',{skip:process.platform!=='darwin'},async t=>{
 const f=await discoveryFixture(t,{empty:true});try{
  f.env.WF_RUN_START_TS=String(Math.floor(Date.now()/1000));f.env.WF_RUN_MAX_SECONDS='2';f.h.state.budgetDeadline=Date.now()+300;
  const {invokeNativeActivity}=await f.load('leadgen-workflow.mjs'),{discoveryCleanupEvidence}=await f.load('discovery-phone-scope.mjs');
  const result=await invokeNativeActivity(()=>f.h.collect_videos(),f.h.state);assert.ok(discoveryCleanupEvidence(result,f.context));
  const global=(Number(f.env.WF_RUN_START_TS)+2)*1000;await new Promise(r=>setTimeout(r,Math.max(1,global-Date.now()+30)));
  assert.equal(discoveryCleanupEvidence(result,f.context),null);f.h.state.currentActivity='cleanup';await assert.rejects(f.h.cleanup(),/IDENTITY_INVALID/);assert.equal(existsSync(f.ownerFile),true);
 }finally{rmSync(f.d,{recursive:true,force:true});}
});

test('真实scope内route CLI→managed wrapper→父version，不伪称stub覆盖两秒接缝',{skip:process.platform!=='darwin'},async t=>{
 const f=await discoveryFixture(t,{empty:true}),{startDiscoveryPhoneScope}=await f.load('discovery-phone-scope.mjs'),{execInput}=await f.load('leadgen-client.mjs');let scope;
 try{
  scope=await startDiscoveryPhoneScope({root:f.runtime,env:f.env,state:f.h.state,sourceCommit:'a'.repeat(40),taskId:'scope-task',lockHeld:true});
  const r=await execInput(scope.env.DOUYIN_PYTHON_BIN,[join(f.runtime,'adb-existing-route.py'),'NO-DEVICE',scope.env.DOUYIN_ADB_BIN],{env:{...f.env,...scope.env},timeoutMs:4000});
  assert.equal(r.code,0,r.stderr);assert.equal(r.stdout.trim(),String(f.frozen.discovery_phone_scope.policy.endpoint.split(':').at(-1)));
  const result=await scope.finish({status:'partial',stop_reason:'budget_exhausted',persisted:0});assert.ok(result.cleanup_phone_scope);
  const entries=f.scopeLedgers().flatMap(s=>s.trim().split('\n').map(JSON.parse));assert.equal(entries.filter(e=>e.phase==='intent').length,1);assert.equal(entries.filter(e=>e.phase==='exit'&&e.code===0).length,1,'route CLI的version须真由父ledger确认结束');
 }finally{await scope?.close();rmSync(f.d,{recursive:true,force:true});}
});

// Explicit v2 sample completion must survive the real native scope and managed cleanup.
test('v2首屏4仅尝试2条重复VID，真实scope归还后正常cleanup且不冒全量',{skip:process.platform!=='darwin'},async t=>{
 const f=await discoveryFixture(t,{stop:false,attemptLimit:2});
 const {invokeNativeActivity,runWorkflow}=await f.load('leadgen-workflow.mjs');
 const {verifyDiscoveryFilterEvidence}=await f.load('leadgen-discovery.mjs'),{verifyCleanupReadback}=await f.load('discovery-cleanup-readback.mjs');
 const metrics=(await f.load('discovery-metrics.js')).default;
 const verify=async(activity,result)=>{
  const scope={run:f.env.WFR_TAG,run_id:f.context.run_id,profile:f.env.P,source_commit:f.context.source_commit,line_key:'jinuo'};
  if(activity.key==='cleanup')return {verified:verifyCleanupReadback({runDir:f.d,digest:result.result.cleanup_readback_digest,scope:{...scope,serial:f.env.SERIAL}})};
  const filters=verifyDiscoveryFilterEvidence({runDir:f.d,runId:f.context.run_id,run:f.env.WFR_TAG,profile:f.env.P,sourceCommit:f.context.source_commit,requested:{sort:'latest',time_layer:'six_months',location:'unlimited'},invocations:result.result.filter_invocations});
  const archived=await metrics.verifyArchivedObservations({videos:result.result.videos,runDir:f.d,scope,readback:async video=>({metrics_verified:true,metrics_digest:f.stored.findLast(v=>v.videoId===video.videoId).metrics.digest,recovered:true})});
  return {verified:filters&&archived};
 };
 try{
  const out=await runWorkflow({activities:[{key:'collect_videos'},{key:'cleanup'}],context:f.context,handlers:{collect_videos:()=>invokeNativeActivity(()=>f.h.collect_videos(),f.h.state),cleanup:async()=>{f.h.state.currentActivity='cleanup';f.h.state.budgetDeadline=(Number(f.env.WF_RUN_START_TS)+Number(f.env.WF_RUN_MAX_SECONDS))*1000;return invokeNativeActivity(()=>f.h.cleanup(),f.h.state);}},commander:async()=>({action:'continue'}),record:async()=>{},verify,terminationUnverified:()=>f.h.state.nativeStopUnproven});
  t.diagnostic(JSON.stringify({status:out.status,activities:out.results.map(r=>({activity:r.activity,status:r.status,error:r.error,counts:r.result?.counts}))}));
  assert.equal(out.status,'completed');const p=JSON.parse(readFileSync(join(f.d,'discovery-progress.json')));
  assert.equal(p.counts.cards,4);assert.equal(p.counts.attempted,2);assert.equal(p.counts.persisted,1);assert.equal(f.stored.length,2);
  assert.equal(p.stop_reason,'attempt_limit_reached');assert.equal(p.all_results_scanned,false);assert.equal(p.request.max_attempts,2);
  assert.equal(out.results.at(-1).result.lock_released,1);assert.equal(out.results.at(-1).result.cleanup_readback_verified,1);assert.equal(existsSync(f.ownerFile),false);
  assert.equal(f.phoneCalls().filter(c=>c.cmd==='tap-evidence').length,2);assert.equal(f.phoneCalls().some(c=>c.cmd==='search-grid-scroll'),false);
  assert.equal(f.h.state.executionUnknown,undefined);assert.equal(f.h.state.nativeStopUnproven,true,'OS观察unknown保持，不冒完整OS停证');
 }finally{rmSync(f.d,{recursive:true,force:true});}
});
