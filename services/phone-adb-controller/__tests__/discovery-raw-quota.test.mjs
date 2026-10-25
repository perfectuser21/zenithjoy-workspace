// 真发现循环/持久progress；只在手机、PG外部边界隔离，不连接设备。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createDiscoveryHandlers} from '../leadgen-discovery.mjs';
import * as runtime from '../runtime-definition.mjs';
import {withDiscoveryMetricsFixture} from './helpers/discovery-metrics-fixture.mjs';
const card=i=>`${300+i}\t540\t00:20\t目标${i}\t作者${i}`;
function input(dir,max=2){const file=join(dir,'keywords.txt');writeFileSync(file,'AI考证\n');return {env:{WF_BRAIN_WORKFLOW:'douyin_video_discovery',WFR_TAG:'rawquota',P:'legacy',SERIAL:'SERIAL',LEADGEN_LINE:'jinuo',LEADGEN_SOURCE_KIND:'keyword',LEADGEN_SOURCES_FILE:file,LEADGEN_MAX_SCREENS:'1',LEADGEN_DISCOVERY_MAX_CANDIDATES:String(max)},fixed:{schema_version:1,workflow_key:'douyin_video_discovery',run_tag:'rawquota',profile:'legacy',serial:'SERIAL',line:'jinuo',max_candidates:max,max_screens:1,source_kind:'keyword',sources:['AI考证'],source_sha256:createHash('sha256').update('AI考证\n').digest('hex')}};}
function rig(dir,{cards=2,max=2,missing=false,reveal=false,restricted=true}={}){
 const request=input(dir,max),calls=[],writes=[];let reads=0;
 const h=withDiscoveryMetricsFixture(createDiscoveryHandlers)({root:dir,profile:'legacy',run:'rawquota',sources:['AI考证'],limit:6,location:'unlimited',discoveryInput:restricted?request.fixed:undefined,env:{WFR_RUN_DIR:dir,...request.env},execute:async()=>({code:0}),queue:async(op,{video})=>{writes.push(video.videoId);return {status:'pending',inserted:true};},phone:async(command)=>{
  calls.push(command);
  if(command==='search-time-layer')return 'sort=latest\ntime_layer=six_months\nduration=unlimited\nscope=unlimited\nlocation=unlimited\n';
  if(command==='search-video-cards'){reads++;const list=reveal&&reads>1?[]:Array.from({length:cards},(_,i)=>missing?`${300+i}\t540\t00:20\t目标${i}\t`:card(i));return list.join('\n')+'\nvideo_tab=1\nloading=0\nend_of_results=1\nevidence=/tmp/raw-grid.xml';}
  if(command==='search-kw-matches')return 'kw_matches=1';
  if(command==='card-bottom-hint-from-xml')return 'clipped=1';
  if(command==='current-video-link')return 'video_id=7700140623701611674\nshort_url=https://v.douyin.com/valid/\ncontent_type=video\nreturn_mode=results\n';return '';
 }});return {h,calls,writes,request};
}
async function temp(body){const dir=mkdtempSync(join(tmpdir(),'discovery-raw-'));try{return await body(dir);}finally{rmSync(dir,{recursive:true,force:true});}}

test('重复VID也耗raw尝试额度，不能因唯一persisted不足而多点击',()=>temp(async dir=>{
 const {h,calls,writes}=rig(dir,{cards:3,max:3});const out=await h.collect_videos();assert.equal(out.counts.attempted,3);assert.equal(writes.length,3);assert.equal(out.counts.persisted,1);assert.equal(out.request?.max_candidates??JSON.parse(readFileSync(join(dir,'discovery-progress.json'))).request.max_candidates,3);assert.equal(calls.filter(x=>x==='tap-evidence').length,3);
}));
test('首屏超过raw上限如实记录seen并零候选点击零写入',()=>temp(async dir=>{
 const {h,calls,writes}=rig(dir,{cards:3,max:2});const out=await h.collect_videos();assert.equal(out.counts.cards,3);assert.equal(out.counts.attempted,0);assert.equal(out.stop_reason,'candidate_limit_exceeded');assert.equal(calls.includes('tap-evidence'),false);assert.deepEqual(writes,[]);
}));
test('受限模式不得为缺失候选reveal或restore追加视口',()=>temp(async dir=>{
 const {h,calls}=rig(dir,{cards:1,max:2,reveal:true});await h.collect_videos();assert.equal(calls.includes('search-grid-scroll'),false);assert.equal(calls.includes('tap-evidence'),false);
}));
test('受限同run已有progress拒二次采集，额度不能重置',()=>temp(async dir=>{
 const {h,calls}=rig(dir,{cards:1,max:2});await h.collect_videos();const before=calls.length;await assert.rejects(h.collect_videos(),/DISCOVERY_INPUT_ALREADY_USED/);assert.equal(calls.length,before);
}));
test('无受限输入旧reveal行为仍保持',()=>temp(async dir=>{
 const {h,calls}=rig(dir,{cards:1,reveal:true,restricted:false});await h.collect_videos();assert.equal(calls.includes('search-grid-scroll'),true);
}));

test('正式解析固定唯一来源文件字节、运行身份和raw上限',()=>temp(dir=>{
 const {env,fixed}=input(dir);assert.equal(typeof runtime.discoveryInput,'function');assert.deepEqual(runtime.discoveryInput(env),fixed);
}));
for(const bad of ['0','-1','2.5','NaN','1001'])test('非法raw数量派发前拒 '+bad,()=>temp(dir=>{
 const {env}=input(dir);env.LEADGEN_DISCOVERY_MAX_CANDIDATES=bad;assert.throws(()=>runtime.discoveryInput(env),/DISCOVERY_INPUT_INVALID/);
}));
test('冻结raw输入加删改及来源文件漂移拒，不借无字段旧默认',()=>temp(dir=>{
 const {env,fixed}=input(dir);assert.equal(typeof runtime.assertDiscoveryInput,'function');assert.deepEqual(runtime.assertDiscoveryInput({discovery_input:fixed},env),fixed);
 for(const snapshot of [{},{discovery_input:{...fixed,max_candidates:3}}])assert.throws(()=>runtime.assertDiscoveryInput(snapshot,env),/DISCOVERY_INPUT/);
 const changed={...env};delete changed.LEADGEN_DISCOVERY_MAX_CANDIDATES;assert.throws(()=>runtime.assertDiscoveryInput({discovery_input:fixed},changed),/DISCOVERY_INPUT/);
 writeFileSync(env.LEADGEN_SOURCES_FILE,'AI考证\n其他\n');assert.throws(()=>runtime.assertDiscoveryInput({discovery_input:fixed},env),/DISCOVERY_INPUT/);
}));
test('非101或多屏不能启用raw受限模式',()=>temp(dir=>{
 const {env}=input(dir);for(const patch of [{WF_BRAIN_WORKFLOW:'douyin_video_processing'},{LEADGEN_MAX_SCREENS:'2'}])assert.throws(()=>runtime.discoveryInput({...env,...patch}),/DISCOVERY_INPUT_INVALID/);
}));
