// Parent executes the preflight sequence; only fixed ADB/local leaves cross the native boundary.
import {readFileSync,writeFileSync,lstatSync,renameSync,chmodSync} from 'node:fs';import {join} from 'node:path';import {randomUUID} from 'node:crypto';import {inflateSync} from 'node:zlib';
const packageName='com.ss.android.ugc.aweme';
export function createPreflightPhoneDriver({adb,local,evidenceRoot,owner,profile,serial,model,expectedAccount,deadlineMs,assertResources,purpose='preflight'}){
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
 const foreground=async()=>String(await call('shell','dumpsys','window','displays')).replaceAll('\r','').split('\n').find(line=>/^\s*(mCurrentFocus|mFocusedApp)\s*=/.test(line)&&!/=null(?:\s|$)/.test(line))?.trim()||'unknown';
 const focusedPackage=focus=>String(focus).match(/\s([A-Za-z0-9_.]+)\/[^\s}]+/)?.[1]||null;
 const isDouyin=text=>focusedPackage(text)===packageName;
 const target=async()=>{if((await call('get-state')).trim()!=='device')throw Error('PREFLIGHT_TARGET_OFFLINE');if((await call('shell','getprop','ro.product.model')).replaceAll('\r','').trim()!==model)throw Error('PREFLIGHT_TARGET_MODEL');};
 const run=async(command,...args)=>{
  await active();
  if(['foreground','window','status'].includes(command)){
   if(args.length)throw Error('PREFLIGHT_PHONE_COMMAND');
   if(command==='status'){await target();return `${serial} device ${model}\n`;}
   return command==='foreground'?`foreground=${(await foreground()).trim()}\n`:call('shell','dumpsys','window');
  }
  if(command==='ui-evidence'){
   if(args.length!==1)throw Error('PREFLIGHT_PHONE_COMMAND');const screen=await capture(args[0]),path=evidence(args[0])+'.xml';renameSync(screen.path,path);return path+'\n';
  }
  if(command==='snapshot-evidence'){
   if(args.length!==1)throw Error('PREFLIGHT_PHONE_COMMAND');const path=evidence(args[0])+'.png',temp=path+'.'+randomUUID()+'.tmp',remote='/sdcard/preflight-'+randomUUID()+'.png';
   await call('shell','screencap','-p',remote);await call('pull',remote,temp);await active();const st=lstatSync(temp);if(!st.isFile()||st.isSymbolicLink()||st.size>12*1024*1024)throw Error('PREFLIGHT_PNG_INVALID');
   const png=readFileSync(temp);assertPreflightPng(png);chmodSync(temp,0o600);renameSync(temp,path);return path+'\n';
  }
  if(command==='open-app'&&purpose==='preflight'){
   if(args.length)throw Error('PREFLIGHT_PHONE_COMMAND');await target();await call('shell','monkey','-p',packageName,'-c','android.intent.category.LAUNCHER','1');
   for(let i=0;i<10;i++){const focus=await foreground();if(isDouyin(focus))return `foreground=${focus.trim()}\n`;await wait(500);}throw Error('PREFLIGHT_WRONG_FOREGROUND');
  }
  if(['wake','unlock'].includes(command)&&purpose==='preflight'){
   if(args.length)throw Error('PREFLIGHT_PHONE_COMMAND');await target();await call('shell','input','keyevent','224');if(command==='unlock')await call('shell','wm','dismiss-keyguard');return '';
  }
  if(['close-app','return-safe-desktop'].includes(command)&&purpose==='cleanup'){
   if(args.length)throw Error('PREFLIGHT_PHONE_COMMAND');await target();
   if(command==='close-app'){await call('shell','am','force-stop',packageName);const focus=await foreground();if(!focusedPackage(focus)||isDouyin(focus))throw Error('PREFLIGHT_CLEANUP_FOREGROUND');return `foreground=${focus.trim()}\n`;}
   const resolved=(await call('shell','cmd','package','resolve-activity','--brief','-a','android.intent.action.MAIN','-c','android.intent.category.HOME')).trim().split('\n').at(-1),match=resolved.match(/^([A-Za-z0-9_.]+)\/[A-Za-z0-9_.$]+$/);
   if(!match||match[1]===packageName)throw Error('PREFLIGHT_CLEANUP_HOME');const launcher=match[1];await call('shell','input','keyevent','3');const focus=await foreground();
   if(focusedPackage(focus)!==launcher||isDouyin(focus))throw Error('PREFLIGHT_CLEANUP_HOME');return `launcher=${launcher}\nforeground_package=${launcher}\nforeground=${focus.trim()}\n`;
  }
  if(command==='preflight'&&purpose==='preflight'){
   if(args.length)throw Error('PREFLIGHT_PHONE_COMMAND');await target();
   const states=[...(await call('shell','dumpsys','telephony.registry')).matchAll(/mCallState=(\d+)/g)].map(x=>x[1]);
   if(!states.length||states.some(x=>x!=='0'))throw Error('PREFLIGHT_CALL_NOT_IDLE');
   const focus=await foreground();return `profile=${profile}\nserial=${serial}\nmodel=${model}\nstate=device\ncall_state=0\nforeground=${focus.trim()}\n`;
  }
  if(purpose!=='preflight'||command!=='account-current'||args.length!==1)throw Error('PREFLIGHT_PHONE_COMMAND');
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


export function assertPreflightPng(png){
 const invalid=()=>{throw Error('PREFLIGHT_PNG_INVALID');};
 try{
  if(!Buffer.isBuffer(png)||png.length<45||png.length>12*1024*1024||!png.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))invalid();
  const crc=bytes=>{let value=0xffffffff;for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;};
  let at=8,width,height,channels,phase=0,ended=false;const compressed=[];
  while(at<png.length){
   if(at+12>png.length)invalid();const size=png.readUInt32BE(at),kind=png.subarray(at+4,at+8).toString('ascii');if(size>png.length-at-12||!/[A-Za-z]{4}/.test(kind))invalid();
   const bytes=png.subarray(at+8,at+8+size);if(crc(png.subarray(at+4,at+8+size))!==png.readUInt32BE(at+8+size))invalid();
   if(kind==='IHDR'){
    if(at!==8||size!==13)invalid();width=bytes.readUInt32BE(0);height=bytes.readUInt32BE(4);channels=bytes[9]===2?3:bytes[9]===6?4:0;
    if(!width||!height||width*height>16000000||bytes[8]!==8||!channels||bytes[10]||bytes[11]||bytes[12])invalid();
   }else if(kind==='IDAT'){if(!width||phase===2)invalid();phase=1;compressed.push(bytes);}
   else if(kind==='IEND'){if(size||!compressed.length||at+12!==png.length)invalid();ended=true;}
   else{if(!width||kind[0]===kind[0].toUpperCase()&&kind!=='PLTE')invalid();if(phase===1)phase=2;}
   at+=size+12;if(ended)break;
  }
  if(!ended)invalid();const row=width*channels+1,expected=row*height,raw=inflateSync(Buffer.concat(compressed),{maxOutputLength:expected+1});if(raw.length!==expected)invalid();for(let y=0;y<height;y++)if(raw[y*row]>4)invalid();return {width,height};
 }catch{invalid();}
}
