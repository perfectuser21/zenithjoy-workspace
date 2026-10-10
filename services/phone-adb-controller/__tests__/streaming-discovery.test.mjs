import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDiscoveryHandlers} from '../leadgen-discovery.mjs';
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
 const h=createDiscoveryHandlers({phone,execute,queue,profile:'p',run:'stream-test',root:join(import.meta.dirname,'..'),sources:['AI'],ownAccounts:{nicknames:[],ids:[]},limit,env:{WFR_RUN_DIR:dir}});
 return {h,writes,events,dir,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
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
