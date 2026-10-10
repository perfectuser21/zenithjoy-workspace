import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDiscoveryHandlers} from '../leadgen-discovery.mjs';
import {execFileSync} from 'node:child_process';
const id=n=>'76856629997972584'+String(n).padStart(2,'0');
function rig({loading=false,failWrite=false,limit=0,stall=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'stream-discovery-')),events=[],writes=[];
 let screen=0,readCount=0,tapped=0;const pages=[[
  {x:100,y:200,title:'同标题视频内容',author:'同作者',duration:'00:20',id:id(1)},
  {x:300,y:200,title:'同标题视频内容',author:'同作者',duration:'00:20',id:id(2)}],
  [{x:100,y:200,title:'加载后新的视频',author:'另一作者',duration:'00:20',id:id(3)}]];
 const rows=cards=>cards.map(c=>[c.x,c.y,c.duration,c.title,c.author].join('\t')).join('\n');
 const phone=async(cmd,...args)=>{events.push([cmd,...args]);
  if(cmd==='search-video-cards'){readCount++;const old=loading&&screen===1&&readCount<6;const page=pages[old?0:screen];return rows(page)+'\nvideo_tab=1\nloading='+(old?'1':'0')+'\nend_of_results='+(screen===1&&!old&&!stall?'1':'0')+'\nevidence='+join(dir,'grid.xml');}
  if(cmd==='search-kw-matches')return 'kw_matches=1\n';
  if(cmd==='search-grid-scroll'){if(!stall)screen=1;return 'scrolled=up';}
  if(cmd==='tap-evidence'){const page=pages[screen];tapped=page.findIndex(c=>c.x===Number(args[0]));return '';}
  if(cmd==='current-video-link'){assert.equal(args[1],'AI','101取链应请求直接归位本词结果页');const c=pages[screen][tapped];return 'content_type=video\nvideo_id='+c.id+'\nshort_url=https://v.douyin.com/'+c.id+'/\nreturn_mode=results\n';}
  return '';
 };
 const execute=async(cmd,args)=>{events.push([cmd,...args]);if(cmd==='zsh')return {code:0,stdout:rows(pages[0]),stderr:''};return {code:0,stdout:'',stderr:''};};
 const queue=async(op,{video}={})=>{assert.equal(op,'discover','101不得查询历史标题');if(failWrite)throw Error('DB_DOWN');writes.push(video);events.push(['persist',video.videoId]);return {status:'pending',inserted:true};};
 const options={phone,execute,queue,profile:'p',run:'stream-test',root:join(import.meta.dirname,'..'),sources:['AI'],ownAccounts:{nicknames:[],ids:[]},limit,env:{WFR_RUN_DIR:dir}};
 const h=createDiscoveryHandlers(options);
 return {h,options,writes,events,dir,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
test('真实发现handler逐屏取链，保同标题不同ID，每条保存先于下一次点击，整页不重搜',async()=>{
 const r=rig();try{await r.h.source();const out=await r.h.write_videos();assert.deepEqual(r.writes.map(v=>v.videoId),[id(1),id(2),id(3)]);assert.equal(r.events.filter(e=>e[0]==='open-search').length,1);assert.equal(out.stop_reason,'exhausted');assert.equal(out.all_results_scanned,true);assert.equal(r.h.state.counts.created,3);
 const second=r.events.findIndex((e,i)=>e[0]==='tap-evidence'&&i>r.events.findIndex(x=>x[0]==='tap-evidence'));assert.ok(r.events.findIndex(e=>e[0]==='persist')<second);const progress=JSON.parse(readFileSync(join(r.dir,'discovery-progress.json'),'utf8'));assert.equal(progress.videos.length,3);
 }finally{r.cleanup();}
});
test('滑动后的旧卡片仍在加载时重读，不能把暂时无新增当已采完',async()=>{const r=rig({loading:true});try{await r.h.source();const out=await r.h.write_videos();assert.equal(r.writes.length,3);assert.equal(out.all_results_scanned,true);}finally{r.cleanup();}});
test('没有明确到底证据的停滞保留成果并标partial，不声称全量完成',async()=>{const r=rig({stall:true});try{await r.h.source();const out=await r.h.write_videos();assert.equal(r.writes.length,2);assert.equal(out.status,'partial');assert.equal(out.all_results_scanned,false);assert.equal(out.stop_reason,'stalled');}finally{r.cleanup();}});
test('PG失败不计保存成功、不吞掉失败后继续称全部成功',async()=>{const r=rig({failWrite:true});try{await r.h.source();const out=await r.h.write_videos();assert.equal(out.status,'partial');assert.equal(r.h.state.counts.persisted,0);assert.ok(out.failures.some(f=>f.reason==='persistence_failed'));}finally{r.cleanup();}});
test('显式采集目标大于旧20限制可接受；0表示扫描到明确尽头',()=>{for(const limit of [0,30,100]){const r=rig({limit});r.cleanup();}});
test('受信长链接无short_url时，采集器仍按已核验resolved_url保存真实视频',async()=>{
 const r=rig({limit:1});try{const h=createDiscoveryHandlers({...r.options,phone:async(cmd,...args)=>{
  if(cmd==='current-video-link')return 'content_type=video\nvideo_id='+id(1)+'\nshort_url=\nresolved_url=https://www.douyin.com/video/'+id(1)+'\nreturn_mode=results\n';
  return r.options.phone(cmd,...args);
 }});const out=await h.collect_videos();assert.equal(out.stop_reason,'limit_reached');assert.equal(out.videos.length,1);assert.equal(r.writes[0].videoUrl,'https://www.douyin.com/video/'+id(1));
 }finally{r.cleanup();}
});
test('取链执行中耗尽时间预算，停止原因为budget_exhausted而不是一次取链业务失败',async()=>{
 const r=rig();let deadline=Date.now()+60000;
 try{const h=createDiscoveryHandlers({...r.options,budgetDeadline:()=>deadline,phone:async(cmd,...args)=>{
  if(cmd==='current-video-link'){deadline=Date.now()-1;throw Error('动作失败 code=null: timeout');}
  return r.options.phone(cmd,...args);
 }});const out=await h.collect_videos();assert.equal(out.status,'partial');assert.equal(out.stop_reason,'budget_exhausted');assert.equal(out.counts.failed,0);assert.equal(out.videos.length,0);
 }finally{r.cleanup();}
});
test('采集Activity直接接收关键词，从搜索开始交出已持久化视频，不需要调用取源Activity',async()=>{
 const r=rig();try{const out=await r.h.collect_videos();assert.equal(out.videos.length,3);assert.equal(out.all_results_scanned,true);assert.equal(r.events.filter(e=>e[0]==='open-search').length,1);}finally{r.cleanup();}
});
test('换新进程重做采集保留已落表清单，达到目标不再次点击视频',async()=>{
 const r=rig({limit:2});try{
  const first=await r.h.collect_videos();assert.equal(first.videos.length,2);
  const taps=r.events.filter(e=>e[0]==='tap-evidence').length;
  const fresh=createDiscoveryHandlers(r.options);const second=await fresh.collect_videos();
  assert.equal(second.videos.length,2);assert.equal(second.stop_reason,'limit_reached');
  assert.equal(r.events.filter(e=>e[0]==='tap-evidence').length,taps);
  await assert.rejects(createDiscoveryHandlers({...r.options,sources:['别的关键词']}).collect_videos(),/输入与原run不一致/);
 }finally{r.cleanup();}
});
test('控制器实际终点检测认两种真机文案，同时拒绝把视频标题当终点',()=>{
 const script=readFileSync(join(import.meta.dirname,'..','douyin-phone-adb'),'utf8');
 const patterns=[...script.matchAll(/grep -qE '([^']+)' "\$svc_xml"/g)].map(m=>m[1]).filter(p=>p.includes('暂无更多'));
 assert.equal(patterns.length,2);
 for(const pattern of patterns){
  for(const text of ['暂时没有更多了','暂无更多，查看所有内容'])execFileSync('grep',['-qE',pattern],{input:`<hierarchy><node text="${text}"/></hierarchy>`});
  assert.throws(()=>execFileSync('grep',['-qE',pattern],{input:'<hierarchy><node text="讲解暂时没有更多了的原因"/></hierarchy>'}));
 }
});

test('丢失写回执仍留下真实待写ID、URL、证据引用，不计入成功清单',async()=>{
 const r=rig({failWrite:true});try{
  const out=await r.h.collect_videos(),saved=JSON.parse(readFileSync(join(r.dir,'discovery-progress.json'),'utf8'));
  assert.equal(out.status,'partial');assert.equal(saved.videos.length,0);assert.equal(saved.counts.persisted,0);
  assert.equal(saved.pending_capture.videoId,id(1));assert.equal(saved.pending_capture.videoUrl,'https://v.douyin.com/'+id(1)+'/');assert.ok(saved.pending_capture.evidence_id.endsWith('-link'));
 }finally{r.cleanup();}
});

function changedGridRig({transient=false,limit=1}={}) {
 const r=rig({limit});let reads=0;
 const h=createDiscoveryHandlers({...r.options,phone:async(cmd,...args)=>{
  if(cmd==='search-video-cards') {
   reads++;
   const out=(await r.options.phone(cmd,...args)).replace('100\t200\t00:20\t同标题视频内容','100\t200\t00:20\t独立候选标题');
   if(reads>=2&&(!transient||reads===2))return out.split('\n').filter(l=>!l.includes('独立候选标题')).join('\n');
   return transient&&reads>=3?out.replace('100\t200\t00:20\t独立候选标题','400\t250\t00:20\t独立候选标题'):out;
  }
  if(transient&&cmd==='tap-evidence'){r.events.push([cmd,...args]);return '';}
  return r.options.phone(cmd,...args);
 }});return {...r,h};
}
test('原候选短暂消失先有界重读，恢复后用新树坐标点击',async()=>{
 const r=changedGridRig({transient:true});try {
  const out=await r.h.collect_videos();
  assert.equal(out.stop_reason,'limit_reached');assert.equal(out.videos[0].videoId,id(1));
  assert.ok(r.events.some(e=>e[0]==='tap-evidence'&&e[1]==='400'&&e[2]==='250'));
  assert.ok(!r.events.some(e=>e[0]==='tap-evidence'&&e[1]==='100'));
  assert.ok(r.events.some(e=>e[0]==='/bin/sleep'&&e[1]==='1'));
 }finally{r.cleanup();}
});
test('原候选持续消失不得沿用坐标，也不得停止其余候选；达到目标允许交接',async()=>{
 const r=changedGridRig();try {
  const out=await r.h.collect_videos();
  assert.equal(out.stop_reason,'limit_reached');assert.deepEqual(out.videos.map(v=>v.videoId),[id(2)]);
  assert.equal(out.counts.failed,0);assert.equal(out.counts.relocation_skipped,1);
  assert.equal(out.known_gaps[0].kind,'candidate_disappeared');
  assert.ok(out.known_gaps[0].evidence_path);
  assert.equal(r.events.filter(e=>e[0]==='tap-evidence'&&e[1]==='100').length,0);
 }finally{r.cleanup();}
});
test('出现消失候选仍可继续翻屏，但不能声称已扫描全部结果',async()=>{
 const r=changedGridRig({limit:0});try {
  const out=await r.h.collect_videos();
  assert.deepEqual(out.videos.map(v=>v.videoId),[id(2),id(3)]);
  assert.equal(out.all_results_scanned,false);assert.equal(out.status,'partial');
  assert.equal(out.stop_reason,'exhausted_with_gaps');
 }finally{r.cleanup();}
});
