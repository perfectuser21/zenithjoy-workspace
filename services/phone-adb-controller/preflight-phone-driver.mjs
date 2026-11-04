// Parent executes the preflight sequence; only fixed ADB/local leaves cross the native boundary.
import {readFileSync,writeFileSync,lstatSync,renameSync,chmodSync} from 'node:fs';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
const packageName='com.ss.android.ugc.aweme';
export function createPreflightPhoneDriver({adb,local,evidenceRoot,owner,profile,serial,model,expectedAccount,deadlineMs,assertResources}){
 let sealed=false;
 const active=async()=>{if(sealed||Date.now()>=deadlineMs)throw Error('PREFLIGHT_PHONE_CLOSED');await assertResources();if(sealed||Date.now()>=deadlineMs)throw Error('PREFLIGHT_PHONE_CLOSED');};
 const call=async(...args)=>{await active();return adb(...args);};
 const wait=async ms=>{await active();await new Promise(r=>setTimeout(r,Math.max(0,Math.min(ms,deadlineMs-Date.now()))));await active();};
 const evidence=id=>{if(!/^[-A-Za-z0-9_.]{1,160}$/.test(id||'')||!id.startsWith(owner+'-'))throw Error('PREFLIGHT_EVIDENCE_SCOPE');return join(evidenceRoot,id);};
 const capture=async id=>{
  const prefix=evidence(id),remote='/sdcard/preflight-'+randomUUID()+'.xml',path=prefix+'-'+randomUUID()+'.xml';
  await call('shell','uiautomator','dump',remote);await call('pull',remote,path);await active();
  const st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink()||st.size>5*1024*1024)throw Error('PREFLIGHT_UI_INVALID');chmodSync(path,0o600);
  const text=readFileSync(path,'utf8'),facts=JSON.parse(await local.run('ui',text));await active();return {path,text,facts};
 };
 const foreground=()=>call('shell','dumpsys','window');
 const isDouyin=text=>String(text).split('\n').some(s=>/mCurrentFocus/.test(s)&&new RegExp('\\s'+packageName.replaceAll('.','\\.')+'/').test(s));
 const target=async()=>{if((await call('get-state')).trim()!=='device')throw Error('PREFLIGHT_TARGET_OFFLINE');if((await call('shell','getprop','ro.product.model')).replaceAll('\r','').trim()!==model)throw Error('PREFLIGHT_TARGET_MODEL');};
 const run=async(command,...args)=>{
  await active();
  if(command==='preflight'){
   if(args.length)throw Error('PREFLIGHT_PHONE_COMMAND');await target();
   const states=[...(await call('shell','dumpsys','telephony.registry')).matchAll(/mCallState=(\d+)/g)].map(x=>x[1]);
   if(!states.length||states.some(x=>x!=='0'))throw Error('PREFLIGHT_CALL_NOT_IDLE');
   const focus=await foreground();return `profile=${profile}\nserial=${serial}\nmodel=${model}\nstate=device\ncall_state=0\nforeground=${focus.trim()}\n`;
  }
  if(command!=='account-current'||args.length!==1)throw Error('PREFLIGHT_PHONE_COMMAND');
  const id=args[0];evidence(id);if(!isDouyin(await foreground()))throw Error('PREFLIGHT_ACCOUNT_NAVIGATION_REFUSED');
  let screen=await capture(id+'-before');
  if(['foreign','partial'].includes(screen.facts.kind))throw Error('PREFLIGHT_ACCOUNT_NAVIGATION_REFUSED');
  if(screen.facts.kind!=='own'){
   if(!screen.facts.me)throw Error('PREFLIGHT_ACCOUNT_NAVIGATION_REFUSED');
   const {x,y}=screen.facts.me;await call('shell','input','tap',String(x),String(y));await wait(1200);
   screen=await capture(id+'-profile');if(screen.facts.kind!=='own')throw Error('PREFLIGHT_ACCOUNT_NAVIGATION_REFUSED');
  }
  if(!screen.facts.account?.douyin_id||screen.facts.account.douyin_id!==expectedAccount)throw Error('PREFLIGHT_ACCOUNT_MISMATCH');
  const path=evidence(id+'-profile')+'.xml',temporary=path+'.'+randomUUID()+'.tmp';
  // Publish only the independently parsed, verified own-account screen.
  writeFileSync(temporary,screen.text,{flag:'wx',mode:0o600});renameSync(temporary,path);
  return `nickname=${screen.facts.account.nickname}\ndouyin_id=${screen.facts.account.douyin_id}\nprofile_xml=${path}\n`;
 };
 return {run,seal:()=>{sealed=true;},capture};
}
