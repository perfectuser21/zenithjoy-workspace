// 不连接手机：真实handler/发现循环/guard；设备与PG只在各自外部边界隔离。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
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
