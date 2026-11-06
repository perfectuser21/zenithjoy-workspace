// Same frozen link method, asynchronously orchestrated by the Code-owned IO.
// No Worker text creates a nonce, pathname, source/stop proof or clipboard state.
import {randomBytes} from 'node:crypto';
const fail=(code,extra={})=>Object.assign(Error('NATIVE_LINK_'+code),{code:'NATIVE_LINK_'+code,...extra});
const helper='native-phone-link-step.py',commands=Object.freeze(['current-video-link']);
const nativeIme='com.android.adbkeyboard/.AdbIME';
export function createNativePhoneLinkMacros({context,io}={}){
 const c=structuredClone(context);
 if(c?.package!=='com.ss.android.ugc.aweme'||![c.width,c.height].every(v=>Number.isSafeInteger(v)&&v>0&&v<=10000)||!Array.isArray(c.keywords)||!Number.isSafeInteger(c.deviceSdk)||c.deviceSdk<0||c.deviceSdk>100||!io||['command','captureXml','snapshot','foreground','wait','local','resolveShareLink','writeEvidence','readClipState','writeClipState','restoreResults','primeMetrics'].some(k=>typeof io[k]!=='function'))throw fail('DEPENDENCY');
 let busy=false,unsafe=false;
 const local=(operation,q={})=>io.local(helper,{...q,operation,width:c.width,height:c.height});
 const xml=(eid,policy='standard')=>io.captureXml(eid,{policy});
 const wait=ms=>io.wait(ms),key=code=>io.command('keyevent',[String(code)]),tap=center=>io.command('tap',center.map(String));
 const foreground=async()=>{const f=await io.foreground();if(typeof f!=='string'||!f.includes(c.package+'/'))throw fail('WRONG_FOREGROUND');return f;};
 const unknown=e=>e?.executionStopped===false||e?.execution_unknown===true||e?.externalEffect==='unknown'||e?.resourceUnknown===true;
 const requireResult=(r,code)=>{if(r?.accepted!==true)throw fail(code);return r;};
 async function field(eid,{expected='',strict=false}={}){const r=await xml(eid);return {...await local('field',{xml:r.xml,expected,strict}),evidence:r};}
 async function detail(eid){for(let wave=1;wave<=2;wave++){try{return await local('detail',{xml:(await xml(eid+'-w'+wave)).xml});}catch(e){if(unknown(e))throw e;if(wave===2)throw fail('UI_TREE_UNAVAILABLE');await wait(2500);}}}
 async function leaveScratch(eid,mode='detail',witness){
  for(let backs=1;backs<=5;backs++){
   await key(4);await wait(700);const fg=await foreground();if(fg.includes('SearchResultActivity'))continue;
   if(mode==='results-only')return true;
   await io.command('pause',[]);await wait(600);
   for(let wave=1;wave<=3;wave++){
    let evidence;try{evidence=await xml(`${eid}-b${backs}w${wave}`);}catch(e){if(unknown(e))throw e;if(wave<3){await wait(1200);continue;}return false;}
    if(wave===1&&(await local('copy-guide',{xml:evidence.xml})).accepted){await key(4);await wait(300);await foreground();await io.command('pause',[]);await wait(600);evidence=await xml(`${eid}-guide-dismiss-b${backs}`,'paused-detail');}
    if((await local('detail',{xml:evidence.xml})).accepted){if(mode==='detail'){await key(126);await wait(300);}if(witness&&(await local('fresh-share',{xml:evidence.xml})).accepted)await io.writeEvidence(witness,'xml',evidence.xml);return true;}
    if(wave<3)await wait(1200);
   }
   return false;
  }
  return false;
 }
 async function restoreIme(original){for(let attempt=1;attempt<=2;attempt++){try{await io.command('ime-set',[original]);}catch(e){if(unknown(e))throw e;}if(String(await io.command('current-ime',[])).trim()===original)return;await wait(300);}throw fail('NONCE_IME_RESTORE_FAILED',{executionStopped:false,resourceUnknown:true});}
 async function enterNonce(nonce,eid){
  requireResult(await field(eid+'-seed-ready',{strict:true}),'NONCE_FOCUS_UNVERIFIED');
  const original=String(await io.command('current-ime',[])).trim();if(!original||original==='null')throw fail('NONCE_IME_UNREADABLE');
  let problem;
  try{
   const enabled=String(await io.command('ime-enable',[nativeIme]));if(!/now enabled|already enabled/.test(enabled))throw fail('NONCE_IME_ENABLE_UNVERIFIED');
   await io.command('ime-set',[nativeIme]);if(String(await io.command('current-ime',[])).trim()!==nativeIme)throw fail('NONCE_IME_SET_UNVERIFIED');
   requireResult(await field(eid+'-seed-ime-ready',{strict:true}),'NONCE_FOCUS_UNVERIFIED');
   await io.command('clear-nonce',[]);await io.command('broadcast-nonce',[Buffer.from(nonce).toString('base64')]);await wait(300);
  }catch(e){problem=e;}
  try{await restoreIme(original);}catch(e){throw fail('NONCE_IME_RESTORE_FAILED',{executionStopped:false,resourceUnknown:true,cause:e});}
  if(problem)throw problem;
  requireResult(await field(eid+'-seed-input-verified',{expected:nonce,strict:true}),'NONCE_INPUT_READBACK');
 }
 async function nativeCopy(nonce,eid){
  await foreground();const f=requireResult(await field(eid+'-seed-copy-field',{expected:nonce,strict:true}),'NONCE_COPY_FIELD');
  for(const phase of ['selected','copied']){if(phase==='selected')await io.command('long-press',[...f.center.map(String),'650']);else await key(278);await wait(300);await foreground();requireResult(await field(eid+'-seed-copy-'+phase,{expected:nonce,strict:true}),'NONCE_COPY_FIELD');}
  await key(123);for(let i=0;i<nonce.length;i++)await key(67);
 }
 async function seedOnce(eid,mode){
  const nonce='clipnonce'+randomBytes(16).toString('hex');
  await io.command('scratch-search',[]);await wait(900);await tap(requireResult(await field(eid+'-seed-field'),'NONCE_FIELD_ABSENT').center);
  if(c.deviceSdk===31)await enterNonce(nonce,eid);else{await io.command('input-select-all',[]);await io.command('input-nonce',[nonce]);}
  for(const phase of ['typed','empty','pasted']){
   await wait(300);const strict=c.deviceSdk===31||[0,33].includes(c.deviceSdk)&&phase!=='typed';const f=await field(eid+'-seed-'+phase,{strict});
   if(!f.accepted){if(phase==='empty'&&f.absent)throw fail('NONCE_WIDGET',{widget:true});throw fail('NONCE_FIELD_UNVERIFIED');}
   if(phase==='empty'){
    if([0,31,33].includes(c.deviceSdk)){if(f.text&&nonce.startsWith(f.text))throw fail('NONCE_CLEAR_UNVERIFIED');await io.writeEvidence(eid+'-seed-empty-proof','txt','empty_proof=pending_nonce_append\n');await key(123);}
    else if(f.text&&(!f.hint||f.text!==f.hint||f.text.startsWith('clipnonce')))throw fail('NONCE_CLEAR_UNVERIFIED');
    await key(279);
   }else{
    if(f.text!==nonce)throw fail('NONCE_READBACK_MISMATCH');
    if(phase==='typed')await nativeCopy(nonce,eid);
    else if([0,31,33].includes(c.deviceSdk))await io.writeEvidence(eid+'-seed-empty-proof-verified','txt','empty_proof=verified_by_exact_nonce_append\n');
   }
  }
  if(!await leaveScratch(eid+'-seed-leave',mode,eid+'-seed-detail-verified'))throw fail('NONCE_ORIGINAL_DETAIL_UNVERIFIED');
  return nonce;
 }
 async function cancelWidget(eid){
  const fg=await io.foreground();await io.writeEvidence(eid+'-widget-foreground','txt',fg);await io.snapshot(eid+'-widget-confirm');const f=await xml(eid+'-widget-confirm');
  const result=requireResult(await local('widget',{xml:f.xml,foreground:fg}),'WIDGET_UNVERIFIED');if(await io.foreground()!==fg)throw fail('WIDGET_FOREGROUND_CHANGED');await tap(result.center);
  let returned=false;for(let i=0;i<30;i++){const now=await io.foreground();if(now.includes(c.package+'/')){returned=true;break;}await wait(100);}if(!returned)throw fail('WIDGET_RETURN_UNVERIFIED');
  requireResult(await field(eid+'-widget-return',{strict:true}),'WIDGET_FIELD_UNVERIFIED');
 }
 async function seed(eid,mode){try{return await seedOnce(eid,mode);}catch(e){if(unknown(e)||!e.widget)throw e;await cancelWidget(eid);return seedOnce(eid+'-widget-retry',mode);}}
 async function once(eid,keyword,previous){
  await foreground();let nonce='';if(previous)nonce=await seed(eid,keyword?'detail-paused':'detail');
  await io.command('pause',[]);await wait(600);
  let share,shareCenter;
  for(let attempt=1;attempt<=3;attempt++){share=await xml(`${eid}-share-c${attempt}`);const d=await local('detail',{xml:share.xml});if(d.accepted){shareCenter=d.center;break;}if(attempt<3)await wait(1500);else throw fail('SHARE_BUTTON_PENDING',{retryable:true});}
  // Preserve exactly the same detail XML for identity-linked metrics. The
  // attempt files remain untouched; the canonical evidence is published once.
  const metricsPath=await io.writeEvidence(eid+'-share','xml',share.xml);
  await io.primeMetrics(share);
  await tap(shareCenter);await wait(700);const panel=await xml(eid+'-panel');
  const target=requireResult(await local('share-target',{xml:panel.xml}),'SHARE_PANEL_TARGET_UNVERIFIED');await tap(target.center);await wait(800);const copied=await io.snapshot(eid+'-link-copied');
  await io.command('scratch-search',[]);await wait(900);await tap(requireResult(await field(eid+'-scratch'),'SCRATCH_FIELD_UNVERIFIED').center);await wait(200);for(const k of [123,67,67,279])await key(k);await wait(500);
  const pasted=requireResult(await field(eid+'-scratch-result'),'CLIPBOARD_FIELD_UNVERIFIED'),link=requireResult(await local('extract-link',{text:pasted.text}),'COPIED_LINK_UNVERIFIED');
  if(previous&&link.shared_url===previous&&!/^clipnonce[a-f0-9]{32}$/.test(nonce))throw fail('COPY_STALE');
  const resolved=link.canonical_url||await io.resolveShareLink(link.short_url),url=typeof resolved==='string'?resolved:resolved?.canonical_url;
  const identity=/^https:\/\/www\.douyin\.com\/(video|note)\/([0-9]{16,24})$/.exec(url||'');if(!identity)throw fail('LINK_IDENTITY_UNVERIFIED');const type=identity[1],id=identity[2];
  let returned='';
  if(keyword){await leaveScratch(eid+'-leave','results-only');await foreground();const result=await io.restoreResults(keyword,eid+'-results');if(result?.verified!==true)throw fail('RESULTS_RESTORE_UNVERIFIED');returned='return_mode=results\n'+(result.recovered_via==='research'?'return_recovered_via=research\n':'');}
  else if(type==='video'){
   const mode=c.detailPlayback==='continuous_identity'?'detail-paused':'detail';let restored=await leaveScratch(eid+'-leave',mode);
   for(let attempt=1;!restored&&attempt<=2;attempt++){await io.command('open-detail',[id]);if(mode==='detail-paused')await io.command('pause',[]);for(let poll=1;poll<=3;poll++){await wait(900);await foreground();if((await detail(`${eid}-restore-t${attempt}p${poll}`)).accepted){restored=true;break;}}}
   if(!restored)throw fail('DETAIL_RESTORE_UNVERIFIED');if(mode==='detail-paused')await key(126);
  }else{await key(4);await wait(250);await key(4);await wait(900);await foreground();}
  await io.writeClipState(link.shared_url);
  return returned+`shared_url=${link.shared_url}\nshare_url_kind=${link.share_url_kind}\ncontent_type=${type}\n`+(type==='video'?`content_id=${id}\nvideo_id=${id}\nmetrics_evidence=${typeof metricsPath==='string'?metricsPath:metricsPath.path}\nmetrics_evidence_id=${eid}\nshort_url=${link.short_url}\nresolved_url=${url}\nreopen_url=snssdk1128://aweme/detail/${id}\n`:`excluded_non_video=true\nnote_id=${id}\nshort_url=${link.short_url}\nresolved_url=${url}\n`)+`evidence=${copied.path}\n`;
 }
 async function run(command,args=[]){
  if(command!=='current-video-link'||!Array.isArray(args)||args.length<1||args.length>2||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,160}$/.test(args[0]||'')||args[1]&&!c.keywords.includes(args[1]))throw fail('COMMAND');if(unsafe)throw fail('PREVIOUS_UNKNOWN',{executionStopped:false});if(busy)throw fail('BUSY');busy=true;
  const input=structuredClone(args);
  try{await foreground();await io.command('pause',[]);await wait(300);if(!(await detail(input[0]+'-detail-guard')).accepted)throw fail('NOT_ON_VIDEO_DETAIL');const value=await io.readClipState();if(value!=null&&typeof value!=='string')throw fail('CLIP_STATE_INVALID');const previous=value||'';
   for(let attempt=1;attempt<=3;attempt++)try{return await once(input[0]+'-t'+attempt,input[1]||'',previous);}catch(e){if(unknown(e)||!e.retryable||attempt===3)throw e;await foreground();if(!(await detail(input[0]+'-t'+attempt+'-recovery-guard')).accepted)throw fail('RECOVERY_NOT_DETAIL');}
  }catch(error){if(unknown(error))unsafe=true;throw error;}finally{busy=false;}
 }
 return Object.freeze({commands,run});
}
