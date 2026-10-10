// 101只负责搜索筛选后的真实视频链接；历史状态和资格判断交102。
import {join} from 'node:path';
import {existsSync,mkdirSync,writeFileSync,renameSync,readFileSync} from 'node:fs';
const normalized=v=>String(v??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const fieldsOf=s=>Object.fromEntries(String(s??'').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).trim()];}));
function cardsOf(s,ctx){return String(s??'').split('\n').flatMap(l=>{const f=l.replace(/\r$/,'').split('\t');return /^\d+$/.test(f[0]??'')&&/^\d+$/.test(f[1]??'')?[{...ctx,x:Number(f[0]),y:Number(f[1]),duration:f[2]??'',title:f[3]??'',author:f[4]??''}]:[];});}
const identity=c=>JSON.stringify([normalized(c.title),normalized(c.author),c.duration]);
const fingerprint=cards=>JSON.stringify(cards.map(c=>[identity(c),c.x,c.y]));
function validVideoUrl(value,id){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&((u.hostname==='v.douyin.com'&&/^\/[A-Za-z0-9_-]+\/?$/.test(u.pathname))||(['www.douyin.com','douyin.com','www.iesdouyin.com','iesdouyin.com'].includes(u.hostname)&&new RegExp('/video/'+id+'(?:/|$)').test(u.pathname)));}catch{return false;}}
export function createDiscoveryHandlers({phone,execute,queue,profile,run,root,limit=0,sourceKind='keyword',sources,location='same_city',ownAccounts,env=process.env,budgetDeadline=()=>0}){
 if(!['keyword','benchmark'].includes(sourceKind))throw Error('发现来源类型无效');
 if(!Array.isArray(sources)||!sources.length)throw Error('发现来源为空');
 if(!Number.isSafeInteger(limit)||limit<0||limit>1000)throw Error('发现成功目标上限无效');
 for(const [k,fn] of Object.entries({phone,execute,queue}))if(typeof fn!=='function')throw Error('缺少执行依赖：'+k);
 const sort=env.LEADGEN_SORT||'latest',time=env.LEADGEN_TIME_LAYER||'six_months',maxScreens=Number(env.LEADGEN_MAX_SCREENS||100);
 if(!['comprehensive','latest','most_liked','most_commented','most_favorited'].includes(sort)||!['unlimited','one_day','one_week','six_months'].includes(time)||!Number.isSafeInteger(maxScreens)||maxScreens<1||maxScreens>1000)throw Error('搜索筛选或屏数配置无效');
 const contexts=sources.slice(0,2).map((s,i)=>{const value=typeof s==='string'?s:s?.source??s?.keyword??s?.url;if(typeof value!=='string'||!value.trim())throw Error('发现来源格式无效');return {source:value,keyword:sourceKind==='keyword'?value:'',sourceKind,sourceIndex:i,sourceEncoded:encodeURIComponent(value)};});
 const state={sourceKind,sources:contexts,source_receipts:[],persisted:[],captures:[],failures:[],known_gaps:[],counts:{sources:contexts.length,sources_succeeded:0,source_failed:0,cards:0,attempted:0,opened:0,linked:0,persisted:0,created:0,reused:0,duplicate:0,failed:0,screens:0,missing_identity:0,non_video:0},pending_capture:null,source_complete:false,write_complete:false};
 const request={keywords:contexts.map(c=>c.source),source_kind:sourceKind,sort,time_layer:time,location,target_count:limit,max_duration_s:Number(env.LEADGEN_DISCOVERY_MAX_SECONDS||2400)};
 if(!Number.isSafeInteger(request.max_duration_s)||request.max_duration_s<1||request.max_duration_s>2400)throw Error('采集Activity预算须为1至2400秒');
 let firstPage,stopReason=null,allScanned=false;
 const progress=()=>{if(!env.WFR_RUN_DIR)throw Error('缺少本run持久化交接目录');mkdirSync(env.WFR_RUN_DIR,{recursive:true});const file=join(env.WFR_RUN_DIR,'discovery-progress.json');writeFileSync(file+'.tmp',JSON.stringify({run,profile,request,observed_at:new Date().toISOString(),counts:{...state.counts},videos:state.persisted,captures:state.captures,pending_capture:state.pending_capture,failures:state.failures,known_gaps:state.known_gaps,stop_reason:stopReason,all_results_scanned:allScanned}),{mode:0o600});renameSync(file+'.tmp',file);};
 const failure=(c,reason,error)=>{state.counts.failed++;state.failures.push({source:c.source,title:c.title,author:c.author,reason,detail:String(error?.stderr||error?.message||error).slice(0,1000)});progress();};
 const boundary=()=>{if(env.WF_STOP_FILE&&existsSync(env.WF_STOP_FILE))throw Error('stop_requested');const deadline=budgetDeadline();if(deadline&&Date.now()>=deadline)throw Error('budget_exhausted');const start=Number(env.WF_RUN_START_TS),max=Number(env.WF_RUN_MAX_SECONDS||1800);if(start>0&&Date.now()/1000-start>=max)throw Error('budget_exhausted');};
 const pause=async n=>{boundary();const r=await execute('/bin/sleep',[String(n)],{maxDurationS:n+2});if(r?.code!==0)throw Error('发现页面等待失败');};
 async function readPage(ctx,eid){boundary();const output=await phone('search-video-cards',eid),f=fieldsOf(output);if(f.video_tab!=='1'||!f.evidence)throw Error('当前页面未实际核验视频tab及UI树');let kw;try{kw=await phone('search-kw-matches',ctx.source,f.evidence);}catch(e){throw Error('搜索框回读与本来源关键词不一致: '+e.message);}if(!/^kw_matches=1$/m.test(kw))throw Error('搜索框回读与本来源关键词不一致');return {cards:cardsOf(output,ctx),loading:f.loading==='1',end:f.end_of_results==='1'||f.empty_results==='true',evidence:f.evidence};}
 async function filters(ctx,eid){await phone('search-video-tab',eid+'-vtab');await phone('search-time-layer',time,eid+'-filter',sort,'unlimited','unlimited',location);await pause(1);}
 async function setup(ctx){
  boundary();const eid=run+'-src'+(ctx.sourceIndex+1);
  if(sourceKind==='benchmark'){state.known_gaps.push({source:ctx.source,kind:'benchmark_identity_unavailable',reason:'对标主页无稳定标题作者'});throw Error('对标主页无稳定标题作者，拒绝沿用坐标取链');}
  await phone('open-search',ctx.sourceEncoded);await pause(2);await filters(ctx,eid);
  const page=await readPage(ctx,eid+'-cards');
  const receipt={source:ctx.source,source_index:ctx.sourceIndex+1,source_kind:sourceKind,cards:page.cards.length,verified:true,evidence_path:page.evidence,observed_at:new Date().toISOString()};
  mkdirSync(env.WFR_RUN_DIR,{recursive:true});writeFileSync(join(env.WFR_RUN_DIR,run+'-source-'+(ctx.sourceIndex+1)+'-readback.json'),JSON.stringify(receipt,null,2),{mode:0o600});
  state.source_receipts.push(receipt);state.counts.sources_succeeded++;return page;
 }
 const result=()=>({counts:{...state.counts},videos:[...state.persisted],captures:[...state.captures],pending_capture:state.pending_capture,failures:[...state.failures],known_gaps:[...state.known_gaps],stop_reason:stopReason,all_results_scanned:allScanned,...(state.failures.length||(!allScanned&&stopReason!=='limit_reached')?{status:'partial'}:{})});
 async function source(){
  if(!state.source_complete){try{firstPage=await setup(contexts[0]);state.source_complete=true;}catch(e){state.counts.source_failed++;failure(contexts[0],'source_identity_unconfirmed',e);throw e;}}
  return {counts:{...state.counts},source_completed:1,sources_succeeded:state.counts.sources_succeeded,sources:[...state.source_receipts],candidates:firstPage.cards.length};
 }
 async function nextPage(ctx,old,eid){
  for(let attempt=0;attempt<3;attempt++){boundary();await pause(attempt+1);const page=await readPage(ctx,eid+'-wait'+attempt);if(page.loading)continue;if(page.end||fingerprint(page.cards)!==fingerprint(old.cards))return page;}
  return null;
 }
 async function write_videos(){
  if(!state.source_complete)throw Error('必须先执行取源');
  if(state.write_complete)return result();
  try{
   sourceLoop:for(const ctx of contexts){
    let page=ctx.sourceIndex===0?firstPage:await setup(ctx),screen=0;
    while(true){
     boundary();if(page.loading){page=await nextPage(ctx,{cards:[]},run+'-src'+ctx.sourceIndex+'-initial');if(!page){stopReason='stalled';break sourceLoop;}}
     state.counts.screens++;state.counts.cards+=page.cards.length;
     // 只枚举这一屏的卡片槽位；不按全局标题过滤，同标题不同视频都取真实ID。
     const targets=page.cards.map((c,i,a)=>({...c,ordinal:a.slice(0,i).filter(x=>identity(x)===identity(c)).length}));
     for(const target of targets){
      if(limit&&state.counts.persisted>=limit){stopReason='limit_reached';break sourceLoop;}
      if(state.counts.persisted>=1000){stopReason='manifest_limit';break sourceLoop;}
      boundary();const eid=run+'-candidate'+(state.counts.attempted+1);state.counts.attempted++;
      if(!normalized(target.title)||!normalized(target.author)){state.counts.missing_identity++;failure(target,'missing_identity','卡片无稳定标题或作者');continue;}
      try{
       const fresh=await readPage(ctx,eid+'-loc'),hit=fresh.cards.filter(c=>identity(c)===identity(target))[target.ordinal];
       if(!hit)throw Error('当前位置没有原候选，拒绝沿用旧坐标');
       await phone('tap-evidence',String(hit.x),String(hit.y),eid+'-open');state.counts.opened++;await pause(1);
       const f=fieldsOf(await phone('current-video-link',eid+'-link',ctx.source));
       if(f.content_type!=='video'){state.counts.non_video++;continue;}
       if(!/^\d{16,24}$/.test(f.video_id??'')||!validVideoUrl(f.short_url||f.resolved_url,f.video_id)||f.return_mode!=='results')throw Error('视频ID、链接或结果页归位未核验');
       state.counts.linked++;
       const video={videoId:f.video_id,videoUrl:f.short_url||f.resolved_url,title:target.title,keyword:ctx.keyword,author:target.author,harvestBatch:run};
       state.pending_capture={...video,evidence_id:eid+'-link',observed_at:new Date().toISOString()};progress();
       let stored;try{stored=await queue('discover',{video});}catch(e){failure(target,'persistence_failed',e);stopReason='persistence_failed';break sourceLoop;}
       if(!['pending','matched','rejected'].includes(stored?.status)||typeof stored.inserted!=='boolean'){failure(target,'persistence_failed','PG无实际入库回执');stopReason='persistence_failed';break sourceLoop;}
       state.pending_capture=null;
       state.captures.push({...video,status:stored.status,inserted:stored.inserted,observed_at:new Date().toISOString()});
       if(state.persisted.some(v=>v.videoId===video.videoId))state.counts.duplicate++;
       else{state.persisted.push({...video,status:stored.status,inserted:stored.inserted});state.counts.persisted++;if(stored.inserted)state.counts.created++;else state.counts.reused++;}
       progress();
       if(f.return_recovered_via==='research'){await filters(ctx,eid+'-recover');for(let s=0;s<screen;s++){await phone('search-grid-scroll',eid+'-restore'+s,'up');await pause(2);}}
      }catch(e){
       try{boundary();}catch(stop){
        if(['stop_requested','budget_exhausted'].includes(stop.message)){
         stopReason=stop.message;state.known_gaps.push({source:target.source,title:target.title,author:target.author,kind:'interrupted_capture',reason:stopReason});break sourceLoop;
        }
       }
       failure(target,'capture_failed',e);stopReason='capture_failed';break sourceLoop;
      }
     }
     if(limit&&state.counts.persisted>=limit){stopReason='limit_reached';break sourceLoop;}
     if(page.end)break;
     if(screen+1>=maxScreens){stopReason='screen_limit';break sourceLoop;}
     await phone('search-grid-scroll',run+'-src'+ctx.sourceIndex+'-scroll'+screen,'up');
     const next=await nextPage(ctx,page,run+'-src'+ctx.sourceIndex+'-screen'+(screen+1));
     if(!next){stopReason='stalled';break sourceLoop;}page=next;screen++;
    }
   }
   if(!stopReason){stopReason='exhausted';allScanned=true;}
  }catch(e){stopReason=['stop_requested','budget_exhausted'].includes(e.message)?e.message:'source_failed';state.failures.push({reason:stopReason,detail:e.message});}
  state.write_complete=true;progress();return result();
 }
 async function collect_videos(){
  const saved=env.WFR_RUN_DIR&&join(env.WFR_RUN_DIR,'discovery-progress.json');
  if(saved&&existsSync(saved)){
   const prior=JSON.parse(readFileSync(saved,'utf8'));
   if(prior.run!==run||prior.profile!==profile||JSON.stringify(prior.request)!==JSON.stringify(request))throw Error('采集重试输入与原run不一致');
   if(!Array.isArray(prior.videos)||prior.videos.length>1000||prior.videos.some(v=>!/^\d{16,24}$/.test(v.videoId)||!validVideoUrl(v.videoUrl,v.videoId)))throw Error('采集重试清单身份无效');
   state.persisted=[...new Map(prior.videos.map(v=>[v.videoId,v])).values()];state.captures=Array.isArray(prior.captures)?prior.captures:[];
   state.counts.persisted=state.persisted.length;state.counts.created=state.persisted.filter(v=>v.inserted).length;state.counts.reused=state.persisted.length-state.counts.created;
  }
  // 重试从本Activity起点重新搜索，不复用上次屏幕或进程内存坐标。
  firstPage=undefined;state.source_complete=false;state.write_complete=false;
  await source();const out=await write_videos();return {...out,source_completed:1};
 }
 return {source,write_videos,collect_videos,state};
}
