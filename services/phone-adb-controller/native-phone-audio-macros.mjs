import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
// Code-only read-only audio observation. This macro never starts/stops playback or recording.
const helper='native-phone-audio-step.py',commands=Object.freeze(['native-audio-evidence']);
const suffixes=Object.freeze(['audio.txt','package-uid.txt','uid-owners.txt','foreground.txt','media-session.txt','native-audio.json','native-sdk.txt']);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>Object.assign(Error('NATIVE_AUDIO_'+code),{code:'NATIVE_AUDIO_'+code});
const observers=new WeakMap(),canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
export function isNativePhoneAudioMacros(value,{source,scope}={}){const r=observers.get(value);if(!r||r.source!==canonical(source)||r.scope!==canonical(scope))return false;try{return r.check()===true;}catch{return false;}}
export function createNativePhoneAudioMacros({context,io,source,scope}={}){
 const c=Object.freeze(structuredClone(context)),observationScope=structuredClone(scope);
 if(c?.package!=='com.ss.android.ugc.aweme'||!/^[-A-Za-z0-9_.]{1,80}$/.test(c.profile||'')||typeof c.serial!=='string'||!c.serial||!io||['command','readEvidence','local','wait','writeEvidence','archiveEvidence'].some(k=>typeof io[k]!=='function')||typeof io.assertObservationAllowed!=='function'&&typeof io.noActiveCapture!=='function')throw fail('DEPENDENCY');
 let busy=false,unsafe=false;let verifyObserver,observerBinding;
 if(source!==undefined||scope!==undefined){
  const src=structuredClone(source),fixed=structuredClone(scope),base=dirname(fileURLToPath(import.meta.url));
  if(!/^[a-f0-9]{40}$/.test(src?.commit||'')||!Array.isArray(src.files)||fixed?.source_commit!==src.commit||fixed.workflow!=='douyin_video_processing'||!['qualification','collection','cleanup'].includes(fixed.activity)||fixed.run!==c.run||fixed.profile!==c.profile||fixed.serial!==c.serial)throw fail('OBSERVER_SCOPE');
  observerBinding={source:canonical(src),scope:canonical(fixed)};
  verifyObserver=()=>{if(unsafe)return false;try{for(const name of ['native-phone-audio-macros.mjs','native-phone-audio-step.py','douyin-phone-adb']){const rows=src.files.filter(f=>f.path===name),path=join(base,name),st=lstatSync(path);if(rows.length!==1||!st.isFile()||st.isSymbolicLink()||![0,process.getuid()].includes(st.uid)||st.mode&0o022||realpathSync(path)!==path||hash(readFileSync(path))!==rows[0].sha256)throw fail('OBSERVER_SOURCE');}return true;}catch(error){unsafe=true;throw error;}};verifyObserver();
 }

 const uncertain=e=>e?.executionStopped===false||e?.execution_unknown===true||e?.resourceUnknown===true||e?.externalEffect==='unknown';
 const local=(operation,args)=>io.local(helper,{operation,args});
 async function command(operation,args=[]){const result=await io.command(operation,args);if(!result||!Object.hasOwn(result,'stdout')||!(typeof result.stdout==='string'||Buffer.isBuffer(result.stdout)))throw fail('COMMAND_RECEIPT');return result.stdout.toString();}
 async function save(eid,suffix,text){const artifact=await io.writeEvidence(eid,suffix,text);const readback=await io.readEvidence(artifact);if(!readback||!Buffer.isBuffer(readback.bytes)||!readback.bytes.equals(Buffer.from(text)))throw fail('EVIDENCE_READBACK');return artifact;}
 // This is Code permission for a read-only observation, never a stop fact.
 // A managed recorder may permit its exact owned session's original end read;
 // independent restored evidence still belongs after its genuine closure.
 async function noCapture(evidenceId){const allow=io.assertObservationAllowed||io.noActiveCapture;if(await allow({scope:structuredClone(observationScope),evidenceId})!==true)throw fail('CAPTURE_NOT_STOPPED');}
 async function observe(eid){
  if(!/^[A-Za-z0-9._-]{1,160}$/.test(eid))throw fail('INPUT');
  await noCapture(eid);const foreground=await command('foreground'),media=await command('media-session'),session=await local('session',[media,foreground]);
  await save(eid,'foreground.txt',foreground+'\n');await save(eid,'media-session.txt',media+'\n');
  const sdk=(await command('sdk')).replace(/\r/g,'').replace(/\n+$/,'');await save(eid,'native-sdk.txt',sdk+'\n');
  const packages=await command('package-uid'),uidResult=await local('uid',[packages]),uid=uidResult?.uid;
  if(typeof uid!=='string'||uid&&!/^[1-9][0-9]*$/.test(uid))throw fail('UID_RESULT');
  const owners=uid?await command('uid-owners',[uid]):'',audio=await command('audio-dump');
  const artifacts={};for(const [suffix,text]of[['package-uid.txt',packages],['uid-owners.txt',owners],['audio.txt',audio]])artifacts[suffix]=await save(eid,suffix,text);
  const parsed=await local('native',[audio,owners,uid,foreground,sdk]);if(typeof parsed?.fields!=='string'||typeof parsed.evidence_json!=='string'||!parsed.evidence||parsed.evidence.kind!=='native_audio'||typeof parsed.evidence.state!=='string')throw fail('NATIVE_RESULT');
  await save(eid,'native-audio.json',parsed.evidence_json);
  const refs={};for(const suffix of ['audio.txt','package-uid.txt','uid-owners.txt']){const r=await io.readEvidence(artifacts[suffix]);if(!Buffer.isBuffer(r.bytes)||typeof r.sha256!=='string'||hash(r.bytes)!==r.sha256)throw fail('EVIDENCE_READBACK');refs[suffix]=r.sha256;}
  await noCapture(eid);return {fields:parsed.fields,evidence:parsed.evidence,session:session.state,refs,eid};
 }
 function receipt(r){return r.fields+' media_session_state='+r.session+' native_audio_evidence_file='+r.eid+'.audio.txt native_audio_evidence_sha256='+r.refs['audio.txt']+' native_audio_package_uid_file='+r.eid+'.package-uid.txt native_audio_package_uid_sha256='+r.refs['package-uid.txt']+' native_audio_uid_owners_file='+r.eid+'.uid-owners.txt native_audio_uid_owners_sha256='+r.refs['uid-owners.txt']+'\n';}
 async function settled(eid){let current=await observe(eid);if(current.evidence.state!=='unknown'||current.evidence.transient_notification!==true)return current;
  await io.archiveEvidence(eid,eid+'-initial',suffixes);
  for(let attempt=1;attempt<=4;attempt++){if(current.evidence.state!=='unknown'||current.evidence.transient_notification!==true)break;await io.wait(500);current=await observe(eid+'-wait'+attempt);}
  if(current.evidence.state==='unknown')return current;
  return observe(eid);
 }
 async function run(commandName,args=[]){if(commandName!=='native-audio-evidence'||!Array.isArray(args)||args.length!==1||!/^[A-Za-z0-9._-]{1,160}$/.test(args[0]))throw fail('INPUT');if(busy||unsafe)throw fail(unsafe?'UNKNOWN':'BUSY');busy=true;try{await noCapture(args[0]);const fresh=await command('foreground');if((await local('foreground',[fresh]))?.accepted!==true)throw fail('WRONG_FOREGROUND');return receipt(await settled(args[0]));}catch(e){if(uncertain(e))unsafe=true;throw e;}finally{busy=false;}}
 const api=Object.freeze({commands,run});if(verifyObserver)observers.set(api,{...observerBinding,check:verifyObserver});return api;
}
