// 0101三个独立活动；调用方持锁并为每个活动安排Commander。
import {join} from 'node:path';
import {existsSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
const normalized = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const asSet = value => value instanceof Set ? value : new Set(value);
function cardsOf(stdout, context) {
 return String(stdout ?? '').split('\n').flatMap(line => {
  const f=line.replace(/\r$/, '').split('\t');
  if(!/^\d+$/.test(f[0]??'') || !/^\d+$/.test(f[1]??'')) return [];
  return [{...context,x:Number(f[0]),y:Number(f[1]),duration:f[2]??'',title:f[3]??'',author:f[4]??'',screen:/^\d+$/.test(f[5]??'')?Number(f[5]):0}];
 });
}
const fieldsOf=stdout=>Object.fromEntries(String(stdout??'').split('\n').filter(s=>s.includes('=')).map(s=>{const p=s.indexOf('=');return [s.slice(0,p),s.slice(p+1).trim()];}));
function validVideoUrl(value,id) {
 try {const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)return false;
  if(u.hostname==='v.douyin.com')return /^\/[A-Za-z0-9_-]+\/?$/.test(u.pathname);
  return ['www.douyin.com','douyin.com','www.iesdouyin.com','iesdouyin.com'].includes(u.hostname) && new RegExp(`/video/${id}(?:/|$)`).test(u.pathname);}
 catch {return false;}
}
export function createDiscoveryHandlers({phone,execute,queue,profile,run,root,limit=2,sourceKind='keyword',sources,location='same_city',ownAccounts,env=process.env}) {
 if(!ownAccounts || !(Array.isArray(ownAccounts.nicknames)||ownAccounts.nicknames instanceof Set) || !(Array.isArray(ownAccounts.ids)||ownAccounts.ids instanceof Set)) throw new Error('自家账号配置缺失或读取失败，拒绝发现');
 if(!['keyword','benchmark'].includes(sourceKind)) throw new Error('发现来源类型无效');
 if(!Array.isArray(sources) || sources.length===0) throw new Error('发现来源为空');
 if(!Number.isSafeInteger(limit)||limit<1||limit>20) throw new Error('发现成功目标上限无效');
 for(const [key,fn] of Object.entries({phone,execute,queue})) if(typeof fn!=='function') throw new Error(`缺少执行依赖：${key}`);
 const ownNames=new Set([...asSet(ownAccounts.nicknames)].map(normalized));
 const state={sourceKind,sources:[],source_receipts:[],candidates:[],kept:[],persisted:[],failures:[],known_gaps:[],counts:{sources:0,sources_succeeded:0,source_failed:0,cards:0,historical:0,own:0,duplicate:0,missing_identity:0,eligible:0,attempted:0,opened:0,linked:0,persisted:0,failed:0,limit_skipped:0},source_complete:false,dedup_complete:false,write_complete:false};
 const writeProgress=(extra={})=>{
  if(!env.WFR_RUN_DIR)return;
  mkdirSync(env.WFR_RUN_DIR,{recursive:true});
  const file=join(env.WFR_RUN_DIR,'discovery-progress.json'),tmp=file+'.tmp';
  writeFileSync(tmp,JSON.stringify({run,observed_at:new Date().toISOString(),counts:{...state.counts},
   videos:[...state.persisted],failures:[...state.failures],known_gaps:[...state.known_gaps],...extra}),{mode:0o600});
  renameSync(tmp,file);
 };
 const failed=(candidate,reason,error)=>{
  state.counts.failed++;
  state.failures.push({source:candidate.source,title:candidate.title,author:candidate.author,reason,detail:String(error?.stderr||error?.message||error||'').slice(0,1000)});
  writeProgress();
 };
 function checkBoundary(started=Date.now()) {
  const abort=reason=>{writeProgress({abort_reason:reason});throw new Error(reason);};
  if(env.WF_STOP_FILE && existsSync(env.WF_STOP_FILE)) abort('Commander请求停止发现');
  if(Date.now()-started>=480000) abort('发现活动预算已耗尽');
  const start=Number(env.WF_RUN_START_TS),max=Number(env.WF_RUN_MAX_SECONDS||14400);
  if(start>0 && max>0 && Date.now()/1000-start>=max) abort('整批运行预算已耗尽');
 }
 async function pause(seconds) {
  const r=await execute('/bin/sleep',[String(seconds)],{maxDurationS:seconds+2});
  if(r?.code!==0) throw new Error('发现页面等待失败');
 }
 async function source() {
  const resultOf=()=>({counts:{...state.counts},candidates:state.candidates.length,sources_succeeded:state.counts.sources_succeeded,
   source_completed:state.counts.sources_succeeded===state.counts.sources?1:0,sources:[...state.source_receipts],failures:[...state.failures]});
  if(state.source_complete) return resultOf();
  // Commander重试取源时重建当轮结果，不拼接上次失败的半成品。
  state.sources=[];state.source_receipts=[];state.candidates=[];state.counts.sources=0;state.counts.sources_succeeded=0;state.counts.source_failed=0;state.counts.cards=0;
  const started=Date.now();
  for(const [index,entry] of sources.slice(0,2).entries()) {
   checkBoundary(started);
   const value=typeof entry==='string'?entry:entry?.source??entry?.keyword??entry?.url;
   if(typeof value!=='string'||!value.trim()) throw new Error('发现来源格式无效');
   const context={source:value,keyword:sourceKind==='keyword'?value:'',sourceKind,sourceIndex:index,sourceEncoded:encodeURIComponent(value)};
   state.sources.push(context);state.counts.sources++;
   const result=await execute('zsh',[join(root,sourceKind==='keyword'?'discover-keyword.sh':'discover-benchmark.sh'),profile,context.sourceEncoded,'20',`${run}-src${index+1}`,location],{env:{DISCOVERY_V2_PROFILES:profile,DISCOVERY_V2_CARDS:'20'},maxDurationS:480});
   if(result?.code!==0){state.counts.source_failed++;state.failures.push({source:value,reason:'source_failed',detail:String(result?.stderr??'发现脚本未确认成功').slice(0,1000)});continue;}
   const found=cardsOf(result.stdout,context).slice(0,20);
   const receipt={source:value,source_index:index+1,source_kind:sourceKind,cards:found.length,verified:false,observed_at:new Date().toISOString()};
   if(sourceKind==='keyword'){
    receipt.evidence_path=join(env.DOUYIN_PHONE_TMP_ROOT||'/private/tmp/openclaw-phone','evidence',profile,`${run}-src${index+1}-vtab-aftertab.xml`);
    try{
     receipt.controller_stdout=await phone('search-kw-matches',value,receipt.evidence_path);
     receipt.verified=/^kw_matches=1$/m.test(receipt.controller_stdout);
     if(!receipt.verified)throw new Error('搜索框回读与本来源关键词不一致');
    }catch(error){receipt.error=String(error?.stderr||error?.message||error).slice(0,1000);}
   }else{
    // 对标原子入口已经验主页；卡片稳定身份仍由dedup明确缺口并拒绝取链。
    receipt.verified=result.code===0;receipt.controller_stdout=result.stdout;
   }
   if(!env.WFR_RUN_DIR)throw new Error('缺少本run来源回读工件目录');
   mkdirSync(env.WFR_RUN_DIR,{recursive:true,mode:0o700});
   const file=join(env.WFR_RUN_DIR,`${run}-source-${index+1}-readback.json`),tmp=`${file}.${process.pid}.tmp`;
   writeFileSync(tmp,JSON.stringify(receipt,null,2),{mode:0o600});renameSync(tmp,file);
   state.source_receipts.push(receipt);
   if(!receipt.verified){state.counts.source_failed++;state.failures.push({source:value,reason:'source_identity_unconfirmed',detail:receipt.error||'搜索词实际读回失败'});continue;}
   state.counts.sources_succeeded++;
   state.candidates.push(...found);state.counts.cards+=found.length;
  }
  if(state.counts.source_failed===state.counts.sources) throw new Error('全部发现来源执行失败');
  state.source_complete=true;
  return resultOf();
 }
 async function dedup() {
  if(!state.source_complete) throw new Error('必须先执行取源');
  if(state.dedup_complete)return {counts:{...state.counts},eligible:state.kept.length};
  // 查询失败或未知结构不能降级为空历史。
  const history=await queue('history',{});
  const rows=Array.isArray(history)?history:Array.isArray(history?.videos)?history.videos:null;
  if(!rows) throw new Error('PG历史查询未返回实际视频列表');
  const historic=new Set(rows.map(row=>normalized(row.title)).filter(Boolean));
  const seen=new Set();
  for(const candidate of state.candidates) {
   const title=normalized(candidate.title),author=normalized(candidate.author);
   if(!title||!author){state.counts.missing_identity++;failed(candidate,'missing_identity','视频卡片无可核验标题或作者，不能沿用旧坐标');
    if(sourceKind==='benchmark'&&!state.known_gaps.some(g=>g.kind==='benchmark_identity_unavailable')) state.known_gaps.push({kind:'benchmark_identity_unavailable',detail:'现有对标主页网格不提供标题，稳定身份核验尚未就绪；旧入口不作回退。'});
    continue;}
   if(author && ownNames.has(author)){state.counts.own++;continue;}
   if(historic.has(title)){state.counts.historical++;continue;}
   const key=`${title}\t${author}`;
   if(seen.has(key)){state.counts.duplicate++;continue;}
   seen.add(key);state.kept.push(candidate);
  }
  state.counts.eligible=state.kept.length;state.dedup_complete=true;
  return {counts:{...state.counts},eligible:state.kept.length,known_gaps:[...state.known_gaps]};
 }
 async function locate(candidate,eid,started) {
  checkBoundary(started);
  if(sourceKind==='keyword') {
   await phone('open-search',candidate.sourceEncoded);await pause(3);
   await phone('search-video-tab',`${eid}-vtab`);
   await phone('search-time-layer','six_months',`${eid}-filter`,'latest','unlimited','unlimited',location);await pause(2);
  }else {await phone('open-user-profile',candidate.source,`${eid}-profile`);await pause(2);}
  // 记下的屏号只决定扫描范围；始终按当前标题+作者找，拒绝发现时坐标。
  const maxScreen=Math.min(22,candidate.screen+2);
  for(let screen=0;screen<=maxScreen;screen++) {
   checkBoundary(started);
   const output=await phone(sourceKind==='keyword'?'search-video-cards':'profile-video-cards',`${eid}-loc${screen}`);
   const hit=cardsOf(output,candidate).find(card=>normalized(card.title)===normalized(candidate.title) && normalized(card.author)===normalized(candidate.author));
   if(hit)return hit;
   if(screen<maxScreen){
    if(sourceKind==='keyword')await phone('search-grid-scroll',`${eid}-scroll${screen}`,'up');
    else await phone('swipe','600','2000','600','900','1000');
    await pause(2);
   }
  }
  throw new Error('当前位置扫描找不到候选的标题和作者');
 }
 async function write_videos() {
  if(!state.dedup_complete) throw new Error('必须先执行过滤去重');
  if(state.write_complete)return {counts:{...state.counts},videos:[...state.persisted],failures:[...state.failures],known_gaps:[...state.known_gaps]};
  const started=Date.now(),seenIds=new Set();
  for(const [index,candidate] of state.kept.entries()) {
   checkBoundary(started);
   if(state.counts.persisted>=limit){state.counts.limit_skipped=state.kept.length-index;break;}
   state.counts.attempted++;const eid=`${run}-candidate${index+1}`;
   let hit;
   try {hit=await locate(candidate,eid,started);} catch(error){failed(candidate,'position_unconfirmed',error);continue;}
   try {await phone('tap-evidence',String(hit.x),String(hit.y),`${eid}-open`);await pause(3);state.counts.opened++;}catch(error){failed(candidate,'open_failed',error);continue;}
   let output;
   try {output=await phone('current-video-link',`${eid}-link`);}catch(error){failed(candidate,'link_failed',error);continue;}
   const parsed=fieldsOf(output),id=parsed.video_id,url=parsed.short_url||parsed.resolved_url;
   if(parsed.content_type && parsed.content_type!=='video'){failed(candidate,'non_video','当前对象不是视频');continue;}
   if(!/^\d{16,24}$/.test(id??'')||!validVideoUrl(url,id)){failed(candidate,'link_invalid','未取得实际视频ID和有效视频链接');continue;}
   if(seenIds.has(id)){state.counts.duplicate++;continue;}seenIds.add(id);state.counts.linked++;
   const video={videoId:id,videoUrl:url,title:candidate.title,keyword:candidate.keyword,author:candidate.author,harvestBatch:run};
   let receipt;
   try {receipt=await queue('discover',{video});}catch(error){failed(candidate,'persistence_failed',error);continue;}
   const status=receipt?.status??receipt?.judgment_status;
   if(!['pending','matched','rejected'].includes(status)){failed(candidate,'persistence_failed',receipt?.error||'PG未返回实际状态回执');continue;}
   state.persisted.push({...video,status});state.counts.persisted++;writeProgress();
  }
  state.write_complete=true;
  writeProgress();
  return {counts:{...state.counts},videos:[...state.persisted],failures:[...state.failures],known_gaps:[...state.known_gaps]};
 }
 return {source,dedup,write_videos,state};
}
