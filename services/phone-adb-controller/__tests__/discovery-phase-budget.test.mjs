// 真发现循环与phone派发；只隔离手机/PG边界，不连接设备。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPhoneAction} from '../leadgen-phone-action.mjs';
import {createDiscoveryHandlers} from '../leadgen-discovery.mjs';
import {discoveryCaptureBudgetMs} from '../discovery-phone-scope.mjs';
import {withDiscoveryMetricsFixture} from './helpers/discovery-metrics-fixture.mjs';

async function clocked(body){const original=Date.now;let now=1800000000000;Date.now=()=>now;try{return await body({now:()=>now,advance:ms=>{now+=ms;}});}finally{Date.now=original;}}
function phoneRig(clock,{remaining=616000,workflow='douyin_video_discovery',activity='collect_videos',refreshCost=0,rejectCommand}={}){
 const state={currentActivity:activity,budgetDeadline:clock.now()+remaining},calls=[];
 const phone=createPhoneAction({env:{HOME:'/tmp',WF_BRAIN_WORKFLOW:workflow},state,profile:'legacy',run:'owner',isLocked:()=>true,isClosed:()=>false,getScope:()=>null,nativeReceipt:()=>({}),checked:async(bin,args,opts)=>{
  const command=args[2];calls.push({command,opts});if(command===rejectCommand)throw Error('EXECUTION_DEADLINE');
  if(command==='lock-refresh'){clock.advance(refreshCost);return 'lock=refreshed owner=owner';}
  return 'ok';
 }});return {phone,state,calls};
}

test('剩余616秒真实发现循环仍可完成下一候选，不被旧661准入拒绝',async()=>clocked(async clock=>{
 const dir=mkdtempSync(join(tmpdir(),'discovery-phase-'));let taps=0,writes=0;
 try{
  const h=withDiscoveryMetricsFixture(createDiscoveryHandlers)({root:dir,profile:'legacy',run:'phase',sources:['AI考证'],limit:1,location:'unlimited',captureBudgetMs:discoveryCaptureBudgetMs,budgetDeadline:()=>clock.now()+616000,env:{WFR_RUN_DIR:dir,LEADGEN_MAX_SCREENS:'1'},execute:async()=>({code:0}),queue:async()=>{writes++;return {inserted:true};},phone:async(command)=>{
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
