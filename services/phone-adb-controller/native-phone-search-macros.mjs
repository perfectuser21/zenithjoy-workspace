// The Runner owns IO and authority. These fixed macros never select an Activity
// or accept an executable, callback, coordinate, policy or success flag from AI.
import {isAbsolute,resolve,dirname} from 'node:path';
const helper='native-phone-search-step.py',pkg='com.ss.android.ugc.aweme';
const fail=(code,detail='')=>Object.assign(Error('NATIVE_PHONE_SEARCH_'+code+(detail?': '+detail:'')),{code:'NATIVE_PHONE_SEARCH_'+code,returned:true});
const unknown=e=>e?.executionStopped===false||e?.execution_stopped===false||e?.externalEffect==='unknown'||e?.unknown===true||e?.returned!==true;
export const NATIVE_PHONE_SEARCH_COMMANDS=Object.freeze(['open-search','search-time-layer','search-video-tab','search-video-cards','search-grid-scroll','search-kw-matches','back-to-results']);
export function createNativePhoneSearchMacros({context,io}={}){
 if(!context||context.package!==pkg||!isAbsolute(context.evidenceRoot||'')||!Array.isArray(context.keywords)||!context.keywords.length||context.keywords.some(k=>typeof k!=='string'||!k)||!['width','height'].every(k=>Number.isSafeInteger(context[k])&&context[k]>0)||!io||['command','captureXml','snapshot','foreground','wait','local'].some(k=>typeof io[k]!=='function'))throw fail('DEPENDENCY');
 const fixed=structuredClone(context);let busy=false,sealed=false,trace={},failureSequence=0;
 const eid=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(value))throw fail('EVIDENCE_ID');return value;};
 const path=value=>{if(typeof value!=='string'||dirname(resolve(value))!==resolve(fixed.evidenceRoot))throw fail('EVIDENCE_PATH');return value;};
 const foreground=async()=>{const focus=await io.foreground();trace.foreground=focus;if(typeof focus!=='string'||!new RegExp('(?:^|[^A-Za-z0-9_.])'+pkg.replaceAll('.','\\.')+'/').test(focus))throw fail('WRONG_FOREGROUND');return focus;};
 const local=async(operation,args,{allowFailure=false}={})=>{const r=await io.local(helper,{operation,args});if(!r||!Number.isInteger(r.code)||typeof r.stdout!=='string'||typeof r.stderr!=='string')throw fail('LOCAL_RECEIPT');if(r.code!==0&&!allowFailure)throw Object.assign(fail('LOCAL',r.stderr||operation),{returned:true});return r;};
 const coords=text=>{const m=String(text).trim().match(/^([0-9]+) ([0-9]+)$/);if(!m||Number(m[1])>=fixed.width||Number(m[2])>=fixed.height)throw fail('COORDINATE');return m.slice(1);};
 const tap=async xy=>{await foreground();return io.command('tap',xy);};
 const capture=async(name,policy='standard')=>{const r=await io.captureXml(eid(name),{policy});if(!r||typeof r.xml!=='string'||typeof r.sha256!=='string')throw fail('XML_RECEIPT');path(r.path);trace.xml=r.path;trace.xml_sha256=r.sha256;return r;};
 const shot=async name=>{const r=await io.snapshot(eid(name));if(!r||!r.path)throw fail('SNAPSHOT_RECEIPT');path(r.path);trace.screenshot=r.path;trace.screenshot_sha256=r.sha256;return r;};
 const locate=async(key,prompt,name)=>{if(typeof io.locate!=='function')throw fail('VISION_UNAVAILABLE');const r=await io.locate({key,prompt,evidence_id:eid(name),clear_cache:true});return coords(r?.coordinate??r);};
 async function videoTab(name){
  eid(name);let source='tree',before,xy,query='',selected=0,relocalized=0;
  const read=async tree=>{const r=await local('tab',[tree.path,query]);const p=r.stdout.trim().split(/\s+/);if(p.length!==4||!['0','1'].includes(p[2]))throw fail('TAB_RECEIPT');xy=coords(p.slice(0,2).join(' '));selected=Number(p[2]);query=p[3];};
  try{before=await capture(name+'-tabs','opportunistic-search-tab');}catch(error){if(unknown(error))throw error;await foreground();xy=await locate('vtab','顶部搜索结果标签栏中的「视频」标签',name+'-vtab');source='vision';}
  if(before)await read(before);await tap(xy);await io.wait(1500);let after=await capture(name+'-aftertab');await foreground();await read(after);
  const first=after;
  if(!selected){await read(await capture(name+'-tabs-retry','opportunistic-search-tab'));source='tree';relocalized=1;await tap(xy);await io.wait(1500);after=await capture(name+'-aftertab-retry','opportunistic-search-tab');await foreground();await read(after);}
  if(!selected)throw fail('TAB_NOT_SELECTED');
  if(relocalized){if(typeof io.publishXml!=='function')throw fail('CHECKPOINT_PUBLISHER_REQUIRED');after=await io.publishXml(eid(name+'-aftertab'),{source:after,first});if(after?.path!==resolve(fixed.evidenceRoot,name+'-aftertab.xml'))throw fail('CHECKPOINT_PATH');await read(after);if(!selected)throw fail('CHECKPOINT_TAB_NOT_SELECTED');}
  return `video_tab=1\nvideo_tab_relocalized=${relocalized}\ncoord_source=${source}\ntapped=${xy.join(' ')}\nevidence=${after.path}\n`;
 }
 async function filter(args){
  if(args.length!==2&&args.length!==6)throw fail('INPUT');const [time,name,sort='comprehensive',duration='unlimited',scope='unlimited',location='unlimited']=args;eid(name);
  for(const [k,v]of [['time',time],['sort',sort],['duration',duration],['scope',scope],['location',location]])await local('filter-index',[k,v]);
  await local('filter-ready',[]);
  await foreground();await shot(name+'-pretab');let tree,xy,button,coordSource='tree';
  try{tree=await capture(name+'-pretab-guard');}catch(error){if(unknown(error))throw error;}
  if(tree&&(!/text="综合"/.test(tree.xml)||!/text="视频"/.test(tree.xml)))throw fail('NOT_ON_SEARCH_RESULTS');
  const controls=tree?await local('controls',[tree.path],{allowFailure:true}):null;
  if(controls?.code===0){const rows=Object.fromEntries(controls.stdout.trim().split('\n').map(s=>s.split('=')));xy=coords(rows.vtab);button=coords(rows.fbtn);}else{xy=await locate('vtab','顶部搜索结果标签栏中的「视频」标签',name+'-vtab');coordSource='vision';}
  await tap(xy);await io.wait(1200);let panel;
  for(let attempt=1;attempt<=4;attempt++){
   let target;if(button&&attempt<=2)target=button;else try{target=await locate('fbtn','右上角的筛选按钮（漏斗图标）',name+'-fbtn-r'+attempt);}catch(error){if(unknown(error))throw error;await io.wait(1500);continue;}
   await tap(target);await io.wait(2200);panel=await shot(name+'-panel'+attempt);const checked=await local('filter-verify',['panel',panel.path,sort,time,duration,scope,location],{allowFailure:true});if(checked.code===0)break;panel=null;
  }
  if(!panel)throw fail('PANEL_NOT_OPEN');
  const option=async(category,value)=>{const index=(await local('filter-index',[category,value])).stdout.trim().split(' ');const p=await local('filter-option',[panel.path,...index]);await tap(coords(p.stdout));await io.wait(300);};
  for(let attempt=0;attempt<2;attempt++)try{for(const[k,v]of [['sort',sort],['time',time],['duration',duration],['scope',scope]])await option(k,v);break;}catch(error){if(unknown(error)||attempt)throw error;await io.wait(700);panel=await shot(name+'-panel-retry');await local('filter-verify',['panel',panel.path,sort,time,duration,scope,location]);}
  let effective=location,unavailable=false;
  try{await option('location',location);}catch(error){if(unknown(error)||!String(error.message).includes('NO_LOCATION_ROW'))throw error;if(location==='same_city'){effective='unlimited';unavailable=true;}}
  await io.wait(600);const selected=await shot(name+'-selected');await local('filter-verify',['selected',selected.path,sort,time,duration,scope,effective]);
  await tap(coords((await local('filter-action',[selected.path])).stdout));await io.wait(1400);const results=await shot(name+'-results');await local('filter-verify',['results',results.path,sort,time,duration,scope,effective]);await foreground();
  return `sort=${sort}\ntime_layer=${time}\nduration=${duration}\nscope=${scope}\nlocation=${unavailable?'unavailable':effective}\n${unavailable?'location_requested='+location+'\n':''}coord_source=${coordSource}\npanel_evidence=${panel.path}\nselected_evidence=${selected.path}\nresults_evidence=${results.path}\n`;
 }
 async function cards(name){
  eid(name);let tree,result;
  for(let attempt=1;attempt<=3;attempt++){
   try{tree=await capture(name+'-grid');}catch(error){if(unknown(error))throw error;await tap(await locate('vtab','顶部搜索结果标签栏中的「视频」标签',name+'-autotab'));await io.wait(1800);tree=await capture(name+'-grid-after-autotab');}
   result=(await local('cards',[tree.path])).stdout;if(result)break;
   if(/text="(?:搜索结果为空|暂时没有更多了|没有更多了|暂无更多(?:，查看所有内容)?|已经到底了|到底了)[！!。…~ ]*"/.test(tree.xml))return `cards=0\nempty_results=true\nvideo_tab=${/<node[^>]*text="视频"[^>]*selected="true"/.test(tree.xml)?1:0}\nloading=0\nend_of_results=1\nevidence=${tree.path}\n`;
   if(attempt<3)await io.wait(15000);
  }
  if(!result)throw fail('CARDS_UNAVAILABLE');
  return result+`evidence=${tree.path}\nvideo_tab=${/<node[^>]*text="视频"[^>]*selected="true"/.test(tree.xml)?1:0}\nloading=${/text="(?:加载中[.。…~ ]*|正在加载[.。…~ ]*|加载失败|网络异常)"/.test(tree.xml)?1:0}\nend_of_results=${/text="(?:暂时没有更多了|没有更多了|暂无更多(?:，查看所有内容)?|已经到底了|到底了)[！!。…~ ]*"/.test(tree.xml)?1:0}\n`;
 }
 async function restore(args){
  if(args.length!==3||!/^\d+$/.test(args[0])||Number(args[0])<1||Number(args[0])>8||!fixed.keywords.includes(args[1]))throw fail('INPUT');const [limit,keyword,name]=args;eid(name);
  const selectedTab=async(tree,suffix)=>{const r=await local('tab',[tree.path,'']);if(r.stdout.trim().split(/\s+/)[2]!=='1')await videoTab(name+suffix);};
  for(let i=0;i<=Number(limit);i++){const focus=await foreground();if((await local('results-focus',[focus],{allowFailure:true})).code===0){const tree=await capture(name+'-check'+i);if((await local('keyword',[keyword,tree.path],{allowFailure:true})).code===0){await selectedTab(tree,'-return-vtab');return `back_to_results=1 backs=${i}\n`;}}if(i<Number(limit)){await io.command('keyevent',['4']);await io.wait(1500);}}
  for(let i=1;i<=2;i++){await io.command('search',[encodeURIComponent(keyword)]);await io.wait(1800);await foreground();const tree=await capture(name+'-recover'+i);if((await local('keyword',[keyword,tree.path],{allowFailure:true})).code===0){await selectedTab(tree,'-return-vtab-recover'+i);return `back_to_results=1 backs=${limit} recovered_via=research\n`;}}
  throw fail('RESULTS_RESTORE_FAILED');
 }
 async function run(command,args=[]){
  if(sealed||busy)throw fail('CLOSED');if(!NATIVE_PHONE_SEARCH_COMMANDS.includes(command)||!Array.isArray(args)||args.some(a=>typeof a!=='string'))throw fail('INPUT');busy=true;trace={};
  try{
   if(command==='open-search'){if(args.length!==1||!fixed.keywords.some(k=>encodeURIComponent(k)===args[0]))throw fail('KEYWORD_SCOPE');return await io.command('search',args);}
   if(command==='search-time-layer')return await filter(args);
   if(command==='search-video-tab'){if(args.length!==1)throw fail('INPUT');return await videoTab(args[0]);}
   if(command==='search-video-cards'){if(args.length!==1)throw fail('INPUT');return await cards(args[0]);}
   if(command==='search-kw-matches'){if(args.length!==2||!fixed.keywords.includes(args[0]))throw fail('KEYWORD_SCOPE');path(args[1]);return `kw_matches=${(await local('keyword',args,{allowFailure:true})).code===0?1:0}\n`;}
   if(command==='back-to-results')return await restore(args);
   if(command==='search-grid-scroll'){if(args.length!==2||!['up','down'].includes(args[1]))throw fail('INPUT');eid(args[0]);await foreground();const x=Math.floor(fixed.width/2),hi=Math.floor(fixed.height*85/100),lo=Math.floor(fixed.height*15/100);await io.command('swipe',[String(x),String(args[1]==='up'?hi:lo),String(x),String(args[1]==='up'?lo:hi),'1000']);await io.wait(1200);return `scrolled=${args[1]} evidence_id=${args[0]}\n`;}
  }catch(cause){
   const error=cause&&typeof cause==='object'?cause:Object.assign(fail('IO'),{executionStopped:false});let uncertain=unknown(error);
   // The original tab failure path retains a screenshot and foreground beside
   // its XML. Unknown channels are sealed first and never reopened for diagnostics.
   if(!uncertain&&command==='search-video-tab'&&trace.xml)try{await shot(args[0]+'-failure-'+(++failureSequence));await foreground();}catch(diagnostic){error.diagnostic_error=diagnostic?.code||'diagnostic_failed';if(unknown(diagnostic)){uncertain=true;error.executionStopped=false;}}
   error.evidence=Object.freeze({...trace,last_observed_only:uncertain});if(uncertain)sealed=true;throw error;
  }finally{busy=false;}
 }
 return Object.freeze({run,commands:NATIVE_PHONE_SEARCH_COMMANDS,snapshot:()=>Object.freeze({busy,sealed,authority:'Code-owned-IO-only',execution_stopped:'not_attested'})});
}
