// Exercise the actual discovery loop; only external phone/queue operations are isolated.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createDiscoveryHandlers} from '../leadgen-discovery.mjs';
import * as runtime from '../runtime-definition.mjs';
import {withDiscoveryMetricsFixture} from './helpers/discovery-metrics-fixture.mjs';

function input(dir,max=2){
 const keyword='人工智能训练师怎么考',file=join(dir,'keywords.txt');writeFileSync(file,keyword+'\n');
 return {env:{WF_BRAIN_WORKFLOW:'douyin_video_discovery',WFR_TAG:'attemptquota',P:'legacy',SERIAL:'SERIAL',LEADGEN_LINE:'jinuo',LEADGEN_SOURCE_KIND:'keyword',LEADGEN_SOURCES_FILE:file,LEADGEN_MAX_SCREENS:'1',LEADGEN_DISCOVERY_MAX_ATTEMPTS:String(max)},fixed:{schema_version:2,workflow_key:'douyin_video_discovery',run_tag:'attemptquota',profile:'legacy',serial:'SERIAL',line:'jinuo',max_attempts:max,max_screens:1,source_kind:'keyword',sources:[keyword],source_sha256:createHash('sha256').update(keyword+'\n').digest('hex')}};
}
async function temp(body){const dir=mkdtempSync(join(tmpdir(),'discovery-attempt-'));try{return await body(dir);}finally{rmSync(dir,{recursive:true,force:true});}}
function rig(dir,{missing=false,failure=false,unknown=false,limit=6,legacy=false}={}){
 const {env,fixed}=input(dir),calls=[],writes=[];
 if(legacy){fixed.schema_version=1;fixed.max_candidates=fixed.max_attempts;delete fixed.max_attempts;env.LEADGEN_DISCOVERY_MAX_CANDIDATES=env.LEADGEN_DISCOVERY_MAX_ATTEMPTS;delete env.LEADGEN_DISCOVERY_MAX_ATTEMPTS;}
 const h=withDiscoveryMetricsFixture(createDiscoveryHandlers)({root:dir,profile:'legacy',run:'attemptquota',sources:fixed.sources,limit,location:'unlimited',discoveryInput:fixed,env:{WFR_RUN_DIR:dir,...env},execute:async()=>({code:0}),queue:async(_,{video})=>{writes.push(video.videoId);return {status:'pending',inserted:true};},phone:async(command,...args)=>{
  calls.push({command,args});
  if(command==='search-time-layer')return 'sort=latest\ntime_layer=six_months\nduration=unlimited\nscope=unlimited\nlocation=unlimited\n';
  if(command==='search-video-cards')return Array.from({length:4},(_,i)=>`${300+i}\t540\t00:20\t目标${i}\t${missing&&i===0?'':'作者'+i}`).join('\n')+'\nvideo_tab=1\nloading=0\nend_of_results=0\nevidence=/tmp/attempt-grid.xml';
  if(command==='search-kw-matches')return 'kw_matches=1';
  if(command==='tap-evidence'&&failure){const e=Error('candidate tap failed');if(unknown)e.executionStopped=false;throw e;}
  if(command==='current-video-link')return 'video_id=7700140623701611674\nshort_url=https://v.douyin.com/valid/\ncontent_type=video\nreturn_mode=results\n';return '';
 }});return {h,calls,writes,env,fixed};
}
test('explicit attempt input freezes schema2 without conflating displayed candidate cap',()=>temp(dir=>{
 const {env,fixed}=input(dir);assert.deepEqual(runtime.discoveryInput(env),fixed);
 assert.deepEqual(runtime.assertDiscoveryInput({discovery_input:fixed},env),fixed);
}));
test('first page four cards permits only first two slots, retains true seen count and duplicate cost',()=>temp(async dir=>{
 const {h,calls,writes}=rig(dir);const out=await h.collect_videos();
 assert.equal(out.counts.cards,4);assert.equal(out.counts.attempted,2);assert.equal(writes.length,2);assert.equal(out.counts.persisted,1);
 assert.equal(calls.filter(x=>x.command==='tap-evidence').length,2);assert.equal(out.stop_reason,'attempt_limit_reached');
 assert.equal(calls.some(x=>x.command==='search-grid-scroll'),false);
 const p=JSON.parse(readFileSync(join(dir,'discovery-progress.json')));assert.equal(p.request.max_attempts,2);assert.equal(Object.hasOwn(p.request,'max_candidates'),false);assert.equal(p.counts.cards,4);
}));
test('missing identity consumes a slot without replacing it with the third card',()=>temp(async dir=>{
 const {h,calls,writes}=rig(dir,{missing:true});const out=await h.collect_videos();
 assert.equal(out.counts.attempted,2);assert.equal(out.counts.missing_identity,1);assert.equal(writes.length,1);assert.equal(calls.filter(x=>x.command==='tap-evidence').length,1);assert.equal(out.status,'partial');
}));
test('failed attempted candidate consumes quota and cannot fill from later slots',()=>temp(async dir=>{
 const {h,calls,writes}=rig(dir,{failure:true});const out=await h.collect_videos();
 assert.equal(out.counts.attempted,2);assert.equal(out.counts.failed,2);assert.equal(calls.filter(x=>x.command==='tap-evidence').length,2);assert.deepEqual(writes,[]);assert.equal(out.status,'partial');
}));
test('unknown candidate execution retains safe stop instead of consuming remaining quota',()=>temp(async dir=>{
 const {h,calls}=rig(dir,{failure:true,unknown:true});await assert.rejects(h.collect_videos(),e=>e.executionStopped===false);assert.equal(calls.filter(x=>x.command==='tap-evidence').length,1);
}));
test('success limit is independent and may stop before attempt quota is exhausted',()=>temp(async dir=>{
 const {h,calls}=rig(dir,{limit:1});const out=await h.collect_videos();assert.equal(out.counts.attempted,1);assert.equal(out.stop_reason,'limit_reached');assert.equal(calls.filter(x=>x.command==='tap-evidence').length,1);
}));
test('completed single run cannot reset attempts by invoking discovery again',()=>temp(async dir=>{
 const {h,calls}=rig(dir);await h.collect_videos();const n=calls.length;await assert.rejects(h.collect_videos(),/DISCOVERY_INPUT_ALREADY_USED/);assert.equal(calls.length,n);
}));
test('old schema1 still rejects oversized first page with zero taps',()=>temp(async dir=>{
 const {h,calls,writes}=rig(dir,{legacy:true});const out=await h.collect_videos();assert.equal(out.counts.cards,4);assert.equal(out.counts.attempted,0);assert.equal(out.stop_reason,'candidate_limit_exceeded');assert.deepEqual(writes,[]);assert.equal(calls.some(x=>x.command==='tap-evidence'),false);
}));
test('simultaneous old and new limits fail rather than choosing a quota implicitly',()=>temp(dir=>{
 const {env}=input(dir);assert.throws(()=>runtime.discoveryInput({...env,LEADGEN_DISCOVERY_MAX_CANDIDATES:'2'}),/DISCOVERY_INPUT_INVALID/);
}));
test('schema and quota fields cannot be relabeled to silently change strict behavior',()=>temp(dir=>{
 const {fixed}=input(dir);for(const patch of [{schema_version:1},{max_candidates:2},{max_attempts:0},{max_attempts:1001},{max_screens:2}])assert.throws(()=>runtime.validateDiscoveryInput({...fixed,...patch}),/DISCOVERY_INPUT_INVALID/);
}));
test('frozen input rejects addition, deletion, mode switching or quota changes',()=>temp(dir=>{
 const {env,fixed}=input(dir);for(const patch of [{},{discovery_input:{...fixed,max_attempts:3}},{discovery_input:{...fixed,schema_version:1}}])assert.throws(()=>runtime.assertDiscoveryInput(patch,env),/DISCOVERY_INPUT/);
 const deleted={...env};delete deleted.LEADGEN_DISCOVERY_MAX_ATTEMPTS;assert.throws(()=>runtime.assertDiscoveryInput({discovery_input:fixed},deleted),/DISCOVERY_INPUT/);
}));
