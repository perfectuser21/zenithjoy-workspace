import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parse} from 'yaml';
import {createDiscoveryHandlers} from '../leadgen-discovery.mjs';
import {runProbes} from '../verify-step.mjs';

const good='sort=latest\ntime_layer=six_months\nduration=unlimited\nscope=unlimited\nlocation=same_city\n';
const commit='a'.repeat(40),runId='douyin_video_discovery-filter-proof__a1';
function rig(outputs,{location='same_city',sources=['AI']}={}){
 const dir=mkdtempSync(join(tmpdir(),'discovery-filter-')),calls=[],writes=[];
 let invocation=0;
 const phone=async(command,...args)=>{
  calls.push([command,...args]);
  if(command==='search-time-layer')return outputs[invocation++];
  if(command==='search-video-cards')return 'video_tab=1\nloading=0\nend_of_results=1\nevidence=/fixed/grid.xml\n';
  if(command==='search-kw-matches')return 'kw_matches=1\n';
  return '';
 };
 const options={phone,execute:async()=>({code:0,stdout:'',stderr:''}),queue:async(...args)=>{writes.push(args);return {status:'pending',inserted:true};},
  profile:'legacy',run:'filter-proof',runId,sourceCommit:commit,root:dir,sources,location,env:{WFR_RUN_DIR:dir}};
 return {h:createDiscoveryHandlers(options),options,calls,writes,dir,
  receipt:()=>JSON.parse(readFileSync(join(dir,runId+'-filter-readback.json'),'utf8')),
  cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}

for(const [name,output] of [
 ['same_city降级',good.replace('location=same_city','location=unavailable\nlocation_requested=same_city')],
 ['空stdout',''],['缺location',good.replace('location=same_city\n','')],
 ['重复location',good+'location=same_city\n'],['重复sort',good+'sort=latest\n'],
 ['错误时间',good.replace('six_months','one_week')],['错误排序',good.replace('latest','most_liked')],
 ['错误地域',good.replace('same_city','unlimited')],['非法枚举',good.replace('same_city','nearby')]
])test('101 '+name+' 在业务读页与入队前失败，并保存原始回执',async()=>{
 const r=rig([output]);try{
  await assert.rejects(r.h.collect_videos(),/DISCOVERY_FILTER/);
  assert.equal(r.calls.filter(c=>c[0]==='search-video-cards').length,0);
  assert.equal(r.writes.length,0);
  const receipt=r.receipt();assert.equal(receipt.source_commit,commit);assert.equal(receipt.run_id,runId);
  assert.equal(receipt.receipts[0].raw_stdout,output);assert.equal(receipt.receipts[0].verified,false);
 }finally{r.cleanup();}
});

test('原合法unlimited请求保留，实际生效字段及同源回执可读',async()=>{
 const r=rig([good.replace('same_city','unlimited')],{location:'unlimited'});try{
  const out=await r.h.collect_videos();assert.equal(out.stop_reason,'exhausted');
  assert.equal(r.receipt().receipts[0].effective.location,'unlimited');
  assert.equal(r.receipt().receipts[0].verified,true);
 }finally{r.cleanup();}
});

test('下一来源实际筛选降级不能复用前一成功，保留每次回执并停止读页',async()=>{
 const r=rig([good,good.replace('same_city','unavailable')],{sources:['AI','考证']});try{
  const out=await r.h.collect_videos();assert.equal(out.status,'partial');
  assert.equal(r.calls.filter(c=>c[0]==='search-video-cards').length,1);
  assert.equal(r.writes.length,0);
  const receipt=r.receipt();assert.deepEqual(receipt.receipts.map(r=>r.verified),[true,false]);
  assert.notEqual(receipt.receipts[0].evidence_id,receipt.receipts[1].evidence_id);
 }finally{r.cleanup();}
});

test('正式101 probe拒绝缺失或失败的筛选独立回执，不因其它metric全绿放行',async()=>{
 const doc=parse(readFileSync('services/phone-adb-controller/checks/douyin-video-discovery.yaml','utf8'));
 const metricDoc={...doc,probes:doc.probes.filter(p=>p.probe.type==='metric')};
 for(const value of [undefined,0]){
  const metrics={source_completed:1,commander_verified:1,manifest_verified:1,...(value===undefined?{}:{filters_verified:value})};
  const result=await runProbes({doc:metricDoc,stage:'collect_videos',params:{metrics}});
  assert.ok(result.probes.some(p=>p.pass!==true),'无可信筛选回执时必须至少一个正式业务probe拒绝');
 }
});
