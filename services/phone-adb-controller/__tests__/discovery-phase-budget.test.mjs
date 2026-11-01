// 真发现循环与phone派发；只隔离手机/PG边界，不连接设备。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHandlers} from '../leadgen-handlers.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createPhoneAction} from '../leadgen-phone-action.mjs';
import {createDiscoveryHandlers} from '../leadgen-discovery.mjs';
import {discoveryCaptureBudgetMs} from '../discovery-phone-scope.mjs';
import {withDiscoveryMetricsFixture} from './helpers/discovery-metrics-fixture.mjs';

async function clocked(body){const original=Date.now;let now=1800000000000;Date.now=()=>now;try{return await body({now:()=>now,advance:ms=>{now+=ms;}});}finally{Date.now=original;}}
function phoneRig(clock,{remaining=616000,workflow='douyin_video_discovery',activity='collect_videos',refreshCost=0,rejectCommand}={}){
 const state={currentActivity:activity,budgetDeadline:clock.now()+remaining},calls=[];
 const phone=createPhoneAction({env:{HOME:'/tmp',WF_BRAIN_WORKFLOW:workflow},state,profile:'legacy',run:'owner',isLocked:()=>true,isClosed:()=>false,getScope:()=>null,nativeReceipt:()=>({}),checked:async(bin,args,opts)=>{
  const command=args.find(a=>['lock-refresh','search-kw-matches','tap-evidence','search-video-cards','current-video-link','search-video-tab'].includes(a));calls.push({command,opts});if(command===rejectCommand)throw Error('EXECUTION_DEADLINE');
  if(command==='lock-refresh'){clock.advance(refreshCost);return 'lock=refreshed owner=owner';}
  return 'ok';
 }});return {phone,state,calls};
}

test('剩余616秒真实发现循环仍可完成下一候选，不被旧661准入拒绝',async()=>clocked(async clock=>{
 const dir=mkdtempSync(join(tmpdir(),'discovery-phase-'));let taps=0,writes=0;
 try{
  const h=withDiscoveryMetricsFixture(createDiscoveryHandlers)({root:dir,profile:'legacy',run:'phase',sources:['AI考证'],limit:1,location:'unlimited',captureBudgetMs:discoveryCaptureBudgetMs,budgetDeadline:()=>clock.now()+616000,env:{WFR_RUN_DIR:dir,LEADGEN_MAX_SCREENS:'1'},execute:async()=>({code:0}),queue:async()=>{writes++;return {status:'pending',inserted:true};},phone:async(command)=>{
   if(command==='search-time-layer')return 'sort=latest\ntime_layer=six_months\nduration=unlimited\nscope=unlimited\nlocation=unlimited\n';
   if(command==='search-video-cards')return '340\t540\t00:20\t真实目标\t甲\nvideo_tab=1\nloading=0\nend_of_results=1\nevidence=/tmp/grid.xml';
   if(command==='search-kw-matches')return 'kw_matches=1';
   if(command==='tap-evidence')taps++;
   if(command==='current-video-link')return 'video_id=7700140623701611674\nshort_url=https://v.douyin.com/valid/\ncontent_type=video\nreturn_mode=results\n';return '';
  }});
  const result=await h.collect_videos();assert.equal(result.counts.persisted,1);assert.equal(taps,1);assert.equal(writes,1);assert.equal(result.stop_reason,'limit_reached');
 }finally{rmSync(dir,{recursive:true,force:true});}
}));

for(const [command,seconds]of [['search-kw-matches',10],['tap-evidence',30],['search-video-cards',120],['current-video-link',300],['search-video-tab',180]])test('101 collect真实checked阶段cap '+command,async()=>clocked(async clock=>{
 const r=phoneRig(clock,{remaining:900000});await r.phone(command,'evidence');
 assert.equal(r.calls[0].command,'lock-refresh');assert.equal(r.calls[0].opts.maxDurationS,10);
 assert.equal(r.calls[1].opts.maxDurationS,seconds);
}));

test('续锁后剩342秒不足tap及归位尾部，结果页不得派发tap',async()=>clocked(async clock=>{
 const r=phoneRig(clock,{remaining:354000,refreshCost:12000});
 await assert.rejects(r.phone('tap-evidence','340','540','owner-open'),/budget_exhausted/);
 assert.deepEqual(r.calls.map(c=>c.command),['lock-refresh']);
}));
test('tap紧邻派发前不足353秒，连续锁也不开始',async()=>clocked(async clock=>{
 const r=phoneRig(clock,{remaining:352000});await assert.rejects(r.phone('tap-evidence','340','540','owner-open'),/budget_exhausted/);assert.deepEqual(r.calls,[]);
}));
test('续锁或阶段执行deadline失败不吞异常或继续tap',async()=>clocked(async clock=>{
 const r=phoneRig(clock,{rejectCommand:'lock-refresh'});await assert.rejects(r.phone('tap-evidence','340','540','owner-open'),/EXECUTION_DEADLINE/);assert.deepEqual(r.calls.map(c=>c.command),['lock-refresh']);
}));
for(const context of [{workflow:'douyin_video_processing'},{activity:'preflight'}])test('非101 collect不收紧既有checked默认预算 '+JSON.stringify(context),async()=>clocked(async clock=>{
 const r=phoneRig(clock,context);await r.phone('search-kw-matches','AI','xml');assert.equal(r.calls[0].opts.maxDurationS,undefined);assert.equal(r.calls[1].opts.maxDurationS,undefined);
}));

// 真正固定绝对截止，元数据与重定位耗时不能把剩余时间滚动续上。
for(const spent of [0,270000])test('固定绝对616秒截止，额外读页耗时 '+spent+'ms 后重新核tap尾部',async()=>clocked(async clock=>{
 const dir=mkdtempSync(join(tmpdir(),'discovery-absolute-')),deadline=clock.now()+616000;let calls=[],writes=0,reads=0;
 const dispatch=phoneRig(clock,{remaining:616000});
 try{
  const h=withDiscoveryMetricsFixture(createDiscoveryHandlers)({root:dir,profile:'legacy',run:'absolute',sources:['AI考证'],limit:1,location:'unlimited',captureBudgetMs:discoveryCaptureBudgetMs,budgetDeadline:()=>deadline,env:{WFR_RUN_DIR:dir,LEADGEN_MAX_SCREENS:'1'},execute:async()=>{clock.advance(1000);return {code:0};},queue:async()=>{writes++;clock.advance(5000);return {status:'pending',inserted:true};},phone:async(command,...args)=>{
   calls.push(command);
   if(command==='search-time-layer')return 'sort=latest\ntime_layer=six_months\nduration=unlimited\nscope=unlimited\nlocation=unlimited\n';
   if(command==='search-video-cards'){if(++reads===2)clock.advance(spent);return '340\t540\t00:20\t目标\t甲\nvideo_tab=1\nloading=0\nend_of_results=1\nevidence=/tmp/grid.xml';}
   if(command==='search-kw-matches')return 'kw_matches=1';
   if(command==='tap-evidence'){await dispatch.phone(command,...args);clock.advance(4000);}
   if(command==='current-video-link'){await dispatch.phone(command,...args);clock.advance(96000);return 'video_id=7700140623701611674\nshort_url=https://v.douyin.com/valid/\ncontent_type=video\nreturn_mode=results\n';}return '';
  }});
  const result=await h.collect_videos();assert.equal(writes,spent?0:1);assert.equal(dispatch.calls.filter(c=>c.command==='tap-evidence').length,spent?0:1);
  assert.equal(result.counts.persisted,spent?0:1);assert.equal(reads,2);assert.ok(clock.now()<deadline);if(spent)assert.equal(result.status,'partial');
 }finally{rmSync(dir,{recursive:true,force:true});}
}));
for(const command of ['tap-evidence','current-video-link'])test('真实phase '+command+' deadline不被准入吞掉或重派',async()=>clocked(async clock=>{
 const r=phoneRig(clock,{remaining:900000,rejectCommand:command});await assert.rejects(r.phone(command,'evidence'),/EXECUTION_DEADLINE/);assert.deepEqual(r.calls.map(c=>c.command),['lock-refresh',command]);
}));

// 不止检查phone传opts：走原checked→bounded并核真正交给executor的timeoutMs。
test('真实handler执行器收到收紧后的phase timeout，已有unknown不被洗白',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'discovery-bounded-')),calls=[];let fail=false;
 try{
  mkdirSync(join(dir,'.config/openclaw'),{recursive:true});writeFileSync(join(dir,'.config/openclaw/douyin-account-routes.tsv'),'legacy\taccount\n');
  const centralLease={held:false,async verifyTask(){},async acquire(){this.held=true;},async ensure(){},async release(){this.held=false;return true;}};
  const h=createHandlers({root:new URL('../',import.meta.url).pathname,sourceCommit:'a'.repeat(40),taskId:'task',centralLease,env:{HOME:dir,WFR_RUN_DIR:dir,WFR_RUN_ID:'run',WFR_ATTEMPT:'a1',WFR_TAG:'owner',P:'legacy',SERIAL:'SERIAL',LEADGEN_LINE:'jinuo',WF_BRAIN_WORKFLOW:'douyin_video_discovery'},rpc:async()=>({result:{}}),execute:async(command,args,opts)=>{
   const action=args.find(x=>['preflight','lock-acquire','lock-refresh','account-current','tap-evidence','current-video-link','search-kw-matches'].includes(x));calls.push({action,timeout:opts.timeoutMs});
   if(fail&&action==='tap-evidence')throw Error('EXECUTION_DEADLINE');
   return {code:0,stderr:'',stdout:args.includes('telephony.registry')?'mCallState=0\n':String(args[0]).endsWith('adb-existing-route.py')?'5042\n':action==='preflight'?'serial=SERIAL\n':action==='lock-acquire'?'lock=acquired\n':action==='lock-refresh'?'lock=refreshed owner=owner ttl=300s\n':action==='account-current'?'douyin_id=account\n':'device\n'};
  }});
  await h.preflight();calls.length=0;h.state.currentActivity='collect_videos';h.state.budgetDeadline=Date.now()+900000;
  for(const [action,ms]of [['search-kw-matches',10000],['tap-evidence',30000],['current-video-link',300000]]){await h.handoffPhone(action,'evidence');assert.equal(calls.at(-2).timeout,10000);assert.equal(calls.at(-1).timeout,ms);}
  fail=true;await assert.rejects(h.handoffPhone('tap-evidence','340','540','owner-open'),/EXECUTION_DEADLINE/);assert.equal(h.state.executionUnknown,true);assert.equal(h.state.discoveryCleanupEvidence,undefined);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

import {discoveryFixture} from './helpers/discovery-cleanup-fixture.mjs';
test('真实scope同步身份核验耗时后，bounded最终派发门拒tap且不伪unknown',{skip:process.platform!=='darwin'},async t=>{
 const f=await discoveryFixture(t,{stop:false}),originalNow=Date.now;let shifted=false,afterRefreshReads=0;
 try{
  // 身份读取模拟同步核验耗时，不改生产scope/execute；仅在候选定位后的tap续锁结束才触发。
  Object.defineProperty(f.h.state,'account',{configurable:true,get(){
   const calls=f.phoneCalls(),tail=calls.at(-1),latestCards=calls.findLast(c=>c.cmd==='search-video-cards');
   if(tail?.cmd==='lock-refresh'&&latestCards?.args[0]?.includes('candidate1-loc')){
    if(++afterRefreshReads===2){shifted=true;Date.now=()=>f.workDeadline-342000;}
   }
   return 'fixture-account';
  }});
  const result=await f.h.collect_videos();assert.equal(shifted,true);assert.equal(result.status,'partial');
  assert.match(JSON.stringify(result.failures),/budget_exhausted/);assert.equal(f.phoneCalls().filter(c=>c.cmd==='tap-evidence').length,0);
  assert.equal(f.stored.length,0);assert.equal(f.h.state.executionUnknown,undefined);assert.equal(f.h.state.nativeStopUnproven,true,'既有observed_only仍保留，未伪全停');
 }finally{Date.now=originalNow;rmSync(f.d,{recursive:true,force:true});}
});

import {discoveryCommandBudgetMs} from '../discovery-phone-scope.mjs';
for(const command of ['constructor','__proto__','toString'])test('未知动作预算不继承对象原型且保原120秒默认 '+command,()=>assert.equal(discoveryCommandBudgetMs(command),120000));
