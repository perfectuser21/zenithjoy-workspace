// A command string is not a remote-source or stop capability. Agent input never selects a program.
import {isCanonicalTcpDeviceSerial} from './runtime-definition.mjs';
import {isNativePhoneAdbRead,nativePhoneAdbReadMatches} from './native-phone-adb-read.mjs';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const sources=new WeakMap();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const sourceFail=()=>{throw Object.assign(Error('NATIVE_PHONE_COMMAND_SOURCE'),{code:'NATIVE_PHONE_COMMAND_SOURCE'});};
const fail=()=>{throw Object.assign(Error('NATIVE_PHONE_COMMAND'),{code:'NATIVE_PHONE_COMMAND'});};
const quote=value=>"'"+value+"'";
const nonce=value=>typeof value==='string'&&/^clipnonce[a-f0-9]{32}$/.test(value);
const component=value=>typeof value==='string'&&/^[A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+$/.test(value);
const preflightPath=(value,ext)=>typeof value==='string'&&new RegExp('^/sdcard/preflight-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\\.'+ext+'$').test(value);
const integer=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,4})$/.test(value);
export function compileNativePhoneCommand(operation,args,context){
 if(!Array.isArray(args)||!context||!/^[-A-Za-z0-9_.]{1,80}$/.test(context.profile||'')||!(/^[-A-Za-z0-9_.]{1,80}$/.test(context.serial||'')||isCanonicalTcpDeviceSerial(context.serial))||context.package!=='com.ss.android.ugc.aweme'||![context.width,context.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=10000)||!Array.isArray(context.keywords)||context.keywords.some(k=>typeof k!=='string'||!k||k.length>500))fail();
 let program,argv;
 if(operation==='pause'&&args.length===0){program='/system/bin/input';argv=['keyevent','127'];}
 else if(operation==='dump'&&args.length===0){program='/system/bin/uiautomator';argv=['dump','--compressed','/sdcard/douyin-leadgen-ui-'+context.profile+'.xml'];}
 else if(operation==='tap'&&args.length===2&&args.every(a=>typeof a==='string'&&/^(0|[1-9][0-9]{0,4})$/.test(a))&&Number(args[0])<context.width&&Number(args[1])<context.height){program='/system/bin/input';argv=['tap',...args];}
 else if(operation==='search'&&args.length===1&&typeof args[0]==='string'&&context.keywords.some(keyword=>encodeURIComponent(keyword)===args[0])&&/^[A-Za-z0-9_.%~-]+$/.test(args[0])){program='/system/bin/am';argv=['start','-a','android.intent.action.VIEW','-d','snssdk1128://search/tabs?keyword='+args[0]];}
 else if(operation==='media-volume'&&args.length===0){program='/system/bin/cmd';argv=['media_session','volume','--stream','3','--get'];}
 else if(operation==='media-session'&&args.length===0){program='/system/bin/dumpsys';argv=['media_session'];}
 else if(operation==='audio-dump'&&args.length===0){program='/system/bin/dumpsys';argv=['audio'];}
 else if(operation==='package-uid'&&args.length===0){program='/system/bin/cmd';argv=['package','list','packages','-U',context.package];}
 else if(operation==='uid-owners'&&args.length===1&&typeof args[0]==='string'&&/^[1-9][0-9]{0,9}$/.test(args[0])&&Number(args[0])<=2147483647){program='/system/bin/cmd';argv=['package','list','packages','-U','--uid',args[0]];}
 else if(operation==='foreground'&&args.length===0){program='/system/bin/dumpsys';argv=['window','displays'];}
 else if(operation==='screenshot'&&args.length===0){program='/system/bin/screencap';argv=['-p'];}
 else if(operation==='sdk'&&args.length===0){program='/system/bin/getprop';argv=['ro.build.version.sdk'];}
 else if(operation==='keyevent'&&args.length===1&&['3','4','67','85','123','126','127','224','278','279'].includes(args[0])){program='/system/bin/input';argv=['keyevent',args[0]];}
 else if(operation==='swipe'&&args.length===5&&args.every(integer)&&Number(args[0])<context.width&&Number(args[2])<context.width&&Number(args[1])<context.height&&Number(args[3])<context.height&&Number(args[4])>=100&&Number(args[4])<=2000){program='/system/bin/input';argv=['swipe',...args];}
 else if(operation==='long-press'&&args.length===3&&args.slice(0,2).every(integer)&&Number(args[0])<context.width&&Number(args[1])<context.height&&args[2]==='650'){program='/system/bin/input';argv=['swipe',args[0],args[1],args[0],args[1],'650'];}
 else if(operation==='current-ime'&&args.length===0){program='/system/bin/settings';argv=['get','secure','default_input_method'];}
 else if(operation==='ime-enable'&&args.length===1&&args[0]==='com.android.adbkeyboard/.AdbIME'){program='/system/bin/ime';argv=['enable',args[0]];}
 else if(operation==='ime-set'&&args.length===1&&component(args[0])&&[context.originalIme,'com.android.adbkeyboard/.AdbIME'].includes(args[0])){program='/system/bin/ime';argv=['set',args[0]];}
 else if(operation==='clear-nonce'&&args.length===0){program='/system/bin/am';argv=['broadcast','-a','ADB_CLEAR_TEXT'];}
 else if(operation==='broadcast-nonce'&&args.length===1&&/^[A-Za-z0-9+/]+={0,2}$/.test(args[0])&&nonce(Buffer.from(args[0],'base64').toString('utf8'))){program='/system/bin/am';argv=['broadcast','-a','ADB_INPUT_B64','--es','msg',args[0]];}
 else if(operation==='input-nonce'&&args.length===1&&nonce(args[0])){program='/system/bin/input';argv=['text',args[0]];}
 else if(operation==='input-select-all'&&args.length===0&&Number(context.deviceSdk)>31){program='/system/bin/input';argv=['keycombination','113','29'];}
 else if(operation==='scratch-search'&&args.length===0){program='/system/bin/am';argv=['start','-a','android.intent.action.VIEW','-d','snssdk1128://search'];}
 else if(operation==='open-detail'&&args.length===1&&/^\d{16,24}$/.test(args[0])){program='/system/bin/am';argv=['start','-a','android.intent.action.VIEW','-d','snssdk1128://aweme/detail/'+args[0]];}
 else if(operation==='remove-ui'&&args.length===0){program='/system/bin/toybox';argv=['rm','-f','/sdcard/douyin-leadgen-ui-'+context.profile+'.xml'];}
 else if(operation==='stat-ui'&&args.length===0){program='/system/bin/toybox';argv=['stat','-c','%s','/sdcard/douyin-leadgen-ui-'+context.profile+'.xml'];}
 else if(operation==='model'&&args.length===0){program='/system/bin/getprop';argv=['ro.product.model'];}
 else if(operation==='telecom'&&args.length===0){program='/system/bin/dumpsys';argv=['telephony.registry'];}
 else if(operation==='window'&&args.length===0){program='/system/bin/dumpsys';argv=['window'];}
 else if(operation==='wake'&&args.length===0){program='/system/bin/input';argv=['keyevent','224'];}
 else if(operation==='unlock'&&args.length===0){program='/system/bin/wm';argv=['dismiss-keyguard'];}
 else if(operation==='open-app'&&args.length===0){program='/system/bin/monkey';argv=['-p',context.package,'-c','android.intent.category.LAUNCHER','1'];}
 else if(operation==='close-app'&&args.length===0){program='/system/bin/am';argv=['force-stop',context.package];}
 else if(operation==='home-resolve'&&args.length===0){program='/system/bin/cmd';argv=['package','resolve-activity','--brief','-a','android.intent.action.MAIN','-c','android.intent.category.HOME'];}
 else if(operation==='dump-file'&&args.length===1&&preflightPath(args[0],'xml')){program='/system/bin/uiautomator';argv=['dump',args[0]];}
 else if(operation==='screenshot-file'&&args.length===1&&preflightPath(args[0],'png')){program='/system/bin/screencap';argv=['-p',args[0]];}
 else if(operation==='stat-ui-mtime'&&args.length===0){program='/system/bin/toybox';argv=['stat','-c','%Y','/sdcard/douyin-leadgen-ui-'+context.profile+'.xml'];}
 else if(['ui-exists','ui-symlink'].includes(operation)&&args.length===0){program='/system/bin/toybox';argv=['test',operation==='ui-exists'?'-e':'-L','/sdcard/douyin-leadgen-ui-'+context.profile+'.xml'];}
 else if(operation==='device-date'&&args.length===0){program='/system/bin/toybox';argv=['date','+%s'];}
 else fail();
 return 'exec '+program+' '+argv.map(quote).join(' ');
}
export function readNativePhoneCommandSource(capability,{scope,source}={}){
 const value=sources.get(capability);
 if(!value||scope&&canonical(scope)!==value.scopeKey||source&&canonical(source)!==value.sourceKey)sourceFail();
 value.verify();return structuredClone(value.value);
}

// The reviewed policy is a fixed repository artifact, never an Agent flag. The
// capability proves finite program source bytes; it is not a phone stop proof.
export function createNativePhoneSourceIssuer({runtimeRoot,source,scope,context,reader}={}){
 if(!isNativePhoneAdbRead(reader)||!nativePhoneAdbReadMatches(reader,source,scope))sourceFail();
 const fixed=structuredClone(scope),src=structuredClone(source),ctx=structuredClone(context),scopeKey=canonical(fixed),sourceKey=canonical(src),policyPath='config/native-phone-command-sources.json';
 if(fixed?.protocol!=='native-phone-adb-read/v1'||fixed.source_commit!==src?.commit||!/^[-a-f0-9]{36}$/.test(fixed.task_id||'')||fixed.profile!==ctx?.profile||fixed.serial!==ctx?.serial||!Number.isSafeInteger(fixed.worker_deadline_ms)||Date.now()>=fixed.worker_deadline_ms)sourceFail();
 let attempted=false,prepared=false,sealed=false,unknown=false;
 const pin=path=>{
  if(!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path)||path.split('/').some(s=>s==='.'||s==='..'))sourceFail();
  const rows=src.files?.filter(f=>f.path===path);if(rows?.length!==1||!/^[a-f0-9]{64}$/.test(rows[0].sha256||''))sourceFail();
  const file=resolve(runtimeRoot,path),st=lstatSync(file);if(realpathSync(file)!==file||!st.isFile()||st.isSymbolicLink()||![0,process.getuid()].includes(st.uid)||(st.mode&0o022))sourceFail();
  const bytes=readFileSync(file);if(sha(bytes)!==rows[0].sha256)sourceFail();return bytes;
 };
 function verify(action=false){
  if(sealed||unknown||Date.now()>=(action?fixed.worker_deadline_ms:fixed.cleanup_deadline_ms)||realpathSync(runtimeRoot)!==dirname(fileURLToPath(import.meta.url))||!Array.isArray(src.files)||new Set(src.files.map(f=>f.path)).size!==src.files.length)sourceFail();
  for(const f of src.files)pin(f.path);
  for(const p of ['native-phone-command-source.mjs','native-phone-adb-read.mjs','adb-shell-v2-protocol.mjs','runtime-definition.mjs',policyPath])pin(p);
 }
 verify();const policy=JSON.parse(pin(policyPath)),matches=policy?.device_sources?.filter(row=>row.profile===ctx.profile&&row.serial===ctx.serial);
 if(policy.schema_version!==1||!Array.isArray(policy.device_sources)||matches?.length!==1)sourceFail();const row=structuredClone(matches[0]);
 if(row.package!==ctx.package||ctx.package!=='com.ss.android.ugc.aweme'||row.width!==ctx.width||row.height!==ctx.height||!Number.isInteger(row.device_sdk)||row.device_sdk<21||!row.review?.path?.startsWith('config/native-phone-reviews/')||sha(pin(row.review.path))!==row.review.sha256||!Array.isArray(row.program_files)||row.program_files.length<1||row.program_files.length>64||new Set(row.program_files.map(f=>f.path)).size!==row.program_files.length||row.program_files.some(f=>!/^\/system\/(?:bin|framework)\/[A-Za-z0-9_.-]+$/.test(f.path)||!/^[a-f0-9]{64}$/.test(f.sha256))||!Array.isArray(row.commands)||!row.commands.length||new Set(row.commands).size!==row.commands.length||row.commands.some(c=>typeof c!=='string'||!/^[-a-z]+$/.test(c)))sourceFail();
 if(row.pillow&&(!row.pillow.path?.startsWith('config/')||sha(pin(row.pillow.path))!==row.pillow.sha256))sourceFail();
 const value={...(row.pillow?{pillow:row.pillow}:{}),protocol:'native-phone-command-source/v1',task_id:fixed.task_id,binding_id:fixed.binding_id,run_id:fixed.run_id,source_commit:fixed.source_commit,profile:fixed.profile,serial:fixed.serial,epoch:fixed.epoch,endpoint:fixed.endpoint,claim:structuredClone(fixed.claim),worker_deadline_ms:fixed.worker_deadline_ms,cleanup_deadline_ms:fixed.cleanup_deadline_ms,device_sdk:row.device_sdk,commands:row.commands,program_files:row.program_files,review:row.review,remote_execution_stopped:'not_attested'};
 async function prepare(){
  verify(true);if(attempted)sourceFail();attempted=true;
  try{
   for(const file of row.program_files){verify(true);const cap=await reader.read(file.path),r=reader.readReceipt(cap,{scope:fixed});verify();if(r.path!==file.path||r.sha256!==file.sha256||sha(r.bytes)!==file.sha256)sourceFail();}
   const closed=await reader.close();verify();if(closed.channel_stopped!==true||closed.unknown||closed.pending!==0)sourceFail();prepared=true;
   const proof=Object.freeze({});sources.set(proof,{scopeKey,sourceKey,context:ctx,verify:()=>{verify();if(!prepared||reader.snapshot().channel_stopped!==true)sourceFail();},value});return proof;
  }catch(error){unknown=true;try{await reader.close();}catch{}sourceFail();}
 }
 return Object.freeze({prepare,seal(){sealed=true;return this.snapshot();},async close(){sealed=true;return reader.close();},snapshot:()=>Object.freeze({prepared,sealed,unknown,ingress:reader.snapshot()})});
}
export function compileVerifiedNativePhoneCommand(capability,operation,args,context){
 const owned=sources.get(capability);if(!owned)sourceFail();readNativePhoneCommandSource(capability);
 if(!owned.value.commands.includes(operation)||['profile','serial','package','width','height','keywords'].some(key=>canonical(context?.[key])!==canonical(owned.context[key])))sourceFail();
 if(Date.now()>=owned.value.worker_deadline_ms)sourceFail();
 const command=compileNativePhoneCommand(operation,args,context),program=command.match(/^exec (\/system\/bin\/[A-Za-z0-9_.-]+) /)?.[1];
 if(!owned.value.program_files.some(file=>file.path===program))sourceFail();return command;
}
