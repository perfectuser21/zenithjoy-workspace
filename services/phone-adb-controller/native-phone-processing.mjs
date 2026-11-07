// Code composition of the original 102 primitives. The shared Runner owns
// activity order, routing, model termination and every final verdict.
import {readFileSync,lstatSync,fstatSync,realpathSync,mkdirSync,openSync,closeSync,writeFileSync,fsyncSync,linkSync,unlinkSync,constants} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {Socket} from 'node:net';
import {createRequire} from 'node:module';
import {createNative102Queue,readNative102Intake,readNative102Qualification} from './native-102-queue.mjs';
import {assertCommentSampling} from './runtime-definition.mjs';
import {verifyRpcSource} from './leadgen-rpc.mjs';
import {nativeAuthorityProjectionMatches} from './native-activity-authority.mjs';
import {createNativePhoneDetailMacros} from './native-phone-detail-macros.mjs';
import {createNativePhoneAudioMacros} from './native-phone-audio-macros.mjs';
import {startNativePhoneMedia} from './native-phone-media.mjs';
import {createNative102Qualification} from './native-102-qualification.mjs';
import {recordCollectionResult} from './leadgen-agent-artifacts.mjs';
import {readNativeCollectionDependencies,startNativeCollectionDependencies} from './native-collection-dependencies.mjs';
import {createNativeCollectionQueue,readNativeCollectionQueueReceipts} from './native-collection-queue.mjs';
import {createNativePhoneCollectionMacros} from './native-phone-collection-macros.mjs';
import {qualificationIdentityEvidence} from './runtime-receipts.mjs';
import {freezeQualificationIdentity} from './qualification-identity-snapshot.mjs';
import {runProbes,runSteps,resolveLineKey} from './verify-step.mjs';
const require=createRequire(import.meta.url);
const sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const fail=code=>Object.assign(Error('NATIVE_PROCESSING_'+code),{code:'NATIVE_PROCESSING_'+code});
const stable=s=>({...Object.fromEntries(['workflow','run','run_id','task_id','binding_id','source_commit','profile','serial','line','source_run','limit','snapshot_sha256'].map(k=>[k,s[k]])),comment_limit:s.comment_limit??null});
export const NATIVE_PHONE_PROCESSING_ASSEMBLY_FILES=Object.freeze(['native-phone-processing.mjs','native-102-queue.mjs','native-102-qualification.mjs','native-phone-media.mjs','decode-recording.py','native-phone-audio-macros.mjs','native-phone-audio-step.py','native-phone-collection-macros.mjs','native-phone-comment-step.py','native-collection-dependencies.mjs','native-collection-history-proof.mjs','native-phone-credentials.mjs','native-collection-queue.mjs','native-phone-detail-macros.mjs','native-phone-detail-step.py','native-phone-managed-recording.mjs','native-scrcpy-host-producer.mjs','native-scrcpy-adb-bridge.mjs','native-scrcpy-adb-shim.mjs','native-phone-command-source.mjs','native-phone-adb-read.mjs','adb-shell-v2-protocol.mjs','leadgen-agent-artifacts.mjs','qualification-identity-snapshot.mjs','runtime-receipts.mjs','config/own-accounts.json','config/native-scrcpy-hosts.json','runtime/runtime-policy.json']);
export function createNativePhoneProcessing({root,source,env,createPool,frozen,binding,credentials,requestImpl}={}){
 const src=structuredClone(source),fixedEnv=structuredClone(env),entries=new Map();let identity,intakePacket,qualificationPacket,unsafe=false;
 if(!root||realpathSync(root)!==dirname(fileURLToPath(import.meta.url))||!/^[a-f0-9]{40}$/.test(src?.commit||'')||!Array.isArray(src.files)||!fixedEnv?.WFR_RUN_DIR||typeof createPool!=='function')throw fail('SCOPE');
 function verify(){
  const rows=src.files.filter(f=>f.path==='native-phone-processing.mjs'),path=join(root,'native-phone-processing.mjs'),st=lstatSync(path);
  if(rows.length!==1||st.isSymbolicLink()||!st.isFile()||st.mode&0o022||realpathSync(path)!==path||sha(readFileSync(path))!==rows[0].sha256)throw fail('SOURCE');
 }
 verify();

 function pinned(path,digest){const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const a=fstatSync(fd),bytes=readFileSync(fd),z=fstatSync(fd),current=lstatSync(path);if(!a.isFile()||a.mode&0o022||realpathSync(path)!==path||!/^[a-f0-9]{64}$/.test(digest||'')||a.size>512*1024*1024||['dev','ino','size','mtimeMs','ctimeMs'].some(k=>a[k]!==z[k]||a[k]!==current[k])||sha(bytes)!==digest)throw fail('ASSEMBLY_PIN');}finally{closeSync(fd);}}
 function ready(){try{
  verify();if(unsafe||!frozen?.sampling_input||typeof credentials?.openrouter!=='function'||typeof credentials?.dashscope!=='function')return false;
  if(!assertCommentSampling(frozen,fixedEnv))return false;const seconds=Number(fixedEnv.QUEUED_VIDEO_RECORD_SECONDS||25);if(!Number.isSafeInteger(seconds)||seconds<10||seconds>105)return false;
  for(const name of NATIVE_PHONE_PROCESSING_ASSEMBLY_FILES){const rows=src.files.filter(r=>r.path===name);if(rows.length!==1)return false;pinned(join(root,name),rows[0].sha256);}
  verifyRpcSource(src,{base:root});for(const key of ['python','ffmpeg','ffprobe']){const b=frozen.collection_phone_scope?.executables?.[key];if(!b?.path||typeof b.path!=='string')return false;pinned(b.path,b.sha256);}return true;
 }catch{return false;}}
 function entry(scope,{closed=false}={}){verify();const e=entries.get(scope?.activity);if(!e||canonical(e.scope)!==canonical(scope)||unsafe||e.unknown||!closed&&e.closed)throw fail('SCOPE');return e;}
 const directory=(e,name)=>{const path=join(e.directory,name);mkdirSync(path,{mode:0o700});return path;};
 async function resources(e){verify();if(e.closed||e.unknown||unsafe||Date.now()>=e.scope.worker_deadline_ms)throw fail('CLOSED');try{if(await e.hooks.resources()!==true)throw fail('RESOURCES');}catch(error){e.unknown=true;unsafe=true;throw error;}verify();return true;}
 async function authority(e){await resources(e);const p=await e.hooks.assertAuthority();await resources(e);if(!nativeAuthorityProjectionMatches(p,{source:src,scope:e.scope}))throw fail('AUTHORITY');return p;}
 function register(scope,hooks,activities){
  verify();if(!activities.includes(scope?.activity)||scope.workflow!=='douyin_video_processing'||scope.source_commit!==src.commit||!Number.isSafeInteger(scope.worker_deadline_ms)||!Number.isSafeInteger(scope.receipt_deadline_ms)||scope.worker_deadline_ms>=scope.receipt_deadline_ms||Date.now()>=scope.worker_deadline_ms||entries.has(scope.activity)||[...entries.values()].some(e=>!e.closed)||typeof hooks.assertAuthority!=='function'||typeof hooks.resources!=='function')throw fail('SCOPE');
  const tuple=canonical(stable(scope));if(identity&&tuple!==identity)throw fail('IDENTITY');identity??=tuple;
  const ds=lstatSync(hooks.directory);if(!ds.isDirectory()||ds.isSymbolicLink()||ds.uid!==process.getuid()||(ds.mode&0o777)!==0o700||realpathSync(hooks.directory)!==hooks.directory)throw fail('DIRECTORY');
  const e={scope:structuredClone(scope),hooks,directory:hooks.directory,closed:false,unknown:false,leased:[],qualified:new Map(),recordings:new Map(),identities:new WeakMap(),readEids:new Map(),readSequence:0,intake:null};entries.set(scope.activity,e);return e;
 }
 async function prepareActivity(scope,hooks={}){
  const e=register(scope,hooks,['dedup','qualification','collection']);
  if(typeof hooks.refreshOwned!=='function'||typeof hooks.readbackAuthority!=='function')throw fail('ACTIVITY_HOOKS');
  try{
   await authority(e);
   if(scope.activity==='collection'){
    if(!qualificationPacket)throw fail('QUALIFICATION_REQUIRED');
    e.dependencies=await startNativeCollectionDependencies({root,source:src,scope:e.scope,directory:directory(e,'collection-dependencies'),python:hooks.python,deadlineMs:scope.worker_deadline_ms,receiptDeadlineMs:scope.receipt_deadline_ms,assertAuthority:()=>authority(e),...(requestImpl?{requestImpl}:{})});
    e.queue=createNativeCollectionQueue({root,source:src,scope:e.scope,directory:directory(e,'collection-queue'),createPool,assertAuthority:()=>authority(e),qualificationRecords:qualificationPacket,dependencies:e.dependencies,samplingInput:frozen?.sampling_input??null});
    const facts=await e.queue.prepare();e.qualificationFacts=facts;e.leased=facts.videos.map(v=>{const prior=entries.get('qualification')?.leased.find(x=>x.video_id===v.video_id);if(!prior)throw fail('QUALIFICATION_CLAIM');return {...structuredClone(v),title:prior.title||'',keyword:prior.keyword||''};});e.collections=new Map();e.histories=new Map();
   }
   if(scope.activity==='qualification'&&!intakePacket)throw fail('INTAKE_REQUIRED');
   if(intakePacket)e.intakeFacts=readNative102Intake(intakePacket,{source:src,scope:e.scope,authority:await authority(e)});
   const sampleInput=frozen?.sampling_input??null;
   if(scope.activity==='dedup'&&sampleInput)e.dependencies=await startNativeCollectionDependencies({root,source:src,scope:e.scope,directory:directory(e,'intake-dependencies'),python:hooks.python,deadlineMs:scope.worker_deadline_ms,receiptDeadlineMs:scope.receipt_deadline_ms,assertAuthority:()=>authority(e),...(requestImpl?{requestImpl}:{})});
   if(scope.activity!=='collection')e.queue=createNative102Queue({root,source:src,scope:e.scope,directory:directory(e,'queue'),createPool,assertAuthority:()=>authority(e),...(scope.activity==='dedup'?{intakeContext:{env:fixedEnv,sampleInput},intakeDependencies:e.dependencies}:{intakeRecords:intakePacket})});
   if(['qualification','collection'].includes(scope.activity)&&hooks.io){
    const c=structuredClone(hooks.context),io=hooks.io;if(!c||c.run!==scope.run||c.profile!==scope.profile||c.serial!==scope.serial||!c.evidenceRoot||realpathSync(c.evidenceRoot)!==c.evidenceRoot)throw fail('PHONE_CONTEXT');e.context=c;
    e.detail=createNativePhoneDetailMacros({context:c,io:{command:io.command,captureXml:io.ui?.captureXml,snapshot:io.ui?.snapshot,local:io.local,wait:io.wait,locate:q=>io.vision.locate(q)}});
   }
  }catch(error){e.prepareError=error;throw error;}
 }
 async function prepareCleanup(scope,hooks={}){
  const e=register(scope,hooks,['cleanup']);e.cleanup=true;
  e.cleanupIds=[...(entries.get('qualification')?.leased||[])].map(v=>v.video_id);
  if(unsafe||[...entries.values()].some(x=>x!==e&&(x.unknown||x.stop?.external_effect==='unknown'))){e.unknown=true;return;}
  await authority(e);
 }
 async function cleanupLeases(e){
  if(!e.cleanupIds.length)return {video_leases_released:[],video_lease_readback_verified:true};
  const ids=[...e.cleanupIds],end=e.scope.worker_deadline_ms,cleanupEnd=e.scope.receipt_deadline_ms;
  const state={unknown:false,pending:1,sockets:new Map()},released=[];let timer;
  const guard=()=>{verify();if(state.unknown||Date.now()>=end)throw fail('CLEANUP_DEADLINE');};
  let claim;
  const check=async()=>{guard();const p=await e.hooks.assertAuthority();guard();if(!nativeAuthorityProjectionMatches(p,{source:src,scope:e.scope}))throw fail('CLEANUP_AUTHORITY');const pair=canonical({claimed_by:p.claimed_by,claimed_at:p.claimed_at});if(claim&&claim!==pair)throw fail('CLEANUP_CLAIM');claim??=pair;};
  const pg=async(readOnly,fn)=>{
   let allocation,client,txn=false,written=false;
   try{
    await check();allocation=await createPool({deadlineMs:end,cleanupDeadlineMs:cleanupEnd});await check();
    if(!allocation?.expectedIdentity?.database||!allocation.expectedIdentity.role||!allocation.pool?.connect||!allocation.pool?.end||!allocation.transport?.seal||!allocation.transport?.close)throw fail('CLEANUP_PG');
    allocation.pool.on?.('error',()=>{state.unknown=true;});client=await allocation.pool.connect();client.on?.('error',()=>{state.unknown=true;});const socket=client.connection?.stream;if(!(socket instanceof Socket))throw fail('CLEANUP_SOCKET');state.sockets.set(socket,socket.closed);socket.once('close',()=>state.sockets.set(socket,true));
    const query=async(text,args)=>{await check();const kind=text.trim().split(/\s+/)[0];if(!['SELECT','BEGIN','ROLLBACK','COMMIT','UPDATE'].includes(kind)||readOnly&&(!['SELECT','BEGIN','ROLLBACK'].includes(kind)||kind==='BEGIN'&&text!=='BEGIN READ ONLY'))throw fail('CLEANUP_SQL');if(kind==='UPDATE')written=true;let result;try{result=await client.query(text,args);}catch(error){if(kind==='COMMIT'&&written||written&&!txn){state.unknown=true;e.effectUnknown=true;}throw error;}if(kind==='BEGIN')txn=true;if(['COMMIT','ROLLBACK'].includes(kind))txn=false;await check();return result;};
    const id=allocation.expectedIdentity,rows=(await query(id.system_identifier?'SELECT current_database() AS database,current_user AS role,system_identifier::text FROM pg_control_system()':'SELECT current_database() AS database,current_user AS role')).rows;if(rows.length!==1||Object.entries(id).some(([k,v])=>rows[0][k]!==v))throw fail('CLEANUP_PG_IDENTITY');
    await query(readOnly?'BEGIN READ ONLY':'BEGIN');if(readOnly&&(await query("SELECT current_setting('transaction_read_only') AS readonly")).rows[0]?.readonly!=='on')throw fail('CLEANUP_READONLY');
    const result=await fn({query});await query(readOnly?'ROLLBACK':'COMMIT');return result;
   }finally{
    if(client){if(txn&&Date.now()<cleanupEnd)try{await client.query('ROLLBACK');}catch{state.unknown=true;}try{client.release(state.unknown);}catch{state.unknown=true;}}
    if(allocation){try{await allocation.pool.end();}catch{state.unknown=true;}try{if((await allocation.transport.seal())?.execution_stopped!==true)state.unknown=true;}catch{state.unknown=true;}try{if((await allocation.transport.close())?.execution_stopped!==true)state.unknown=true;}catch{state.unknown=true;}}
    for(const [socket,closed] of state.sockets)if(!closed&&!socket.closed)await new Promise(resolve=>socket.once('close',resolve));
   }
  };
  const work=(async()=>{
   try{
    // Immutable Code intent survives a lost COMMIT acknowledgement. It never
    // creates a replay or a new claim, and is not supplied by the Worker.
    const intent=join(e.directory,'owned-video-release.intent.json'),fd=openSync(intent,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,JSON.stringify({scope:e.scope,video_ids:ids}));fsyncSync(fd);}finally{closeSync(fd);}const dir=openSync(e.directory,constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(dir);}finally{closeSync(dir);}
    const lineKey=resolveLineKey(e.scope.line),expected=[];
    await pg(false,async pool=>{const config=await require('./company-config-lib.js').readCollectionAccountBinding(pool,{lineKey,run:e.scope.run,sourceRun:e.scope.source_run});if(config.profile!==e.scope.profile||config.device_serial!==e.scope.serial)throw fail('CLEANUP_BINDING');const rows=(await pool.query('SELECT * FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND video_id=ANY($2::text[]) FOR UPDATE',[lineKey,ids])).rows;if(rows.length!==ids.length)throw fail('CLEANUP_TARGET');for(const row of rows){if(!ids.includes(row.video_id)||row.harvest_batch!==e.scope.run)throw fail('CLEANUP_TARGET');if(row.process_status==='评论已采'){expected.push({id:row.video_id,status:row.process_status});continue;}if(row.process_status!=='处理中:'+e.scope.run)throw fail('CLEANUP_OWNER');const value=await require('./leadgen-queue.js').queueRequest(pool,{op:'release_video',video_id:row.video_id,line:e.scope.line,run:e.scope.run,source_run:e.scope.source_run,limit:e.scope.limit});if(value.released!==true)throw fail('CLEANUP_RELEASE');released.push(row.video_id);expected.push({id:row.video_id,status:'待判定'});}});
    await pg(true,async pool=>{const rows=(await pool.query('SELECT video_id,process_status,harvest_batch FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND video_id=ANY($2::text[])',[lineKey,ids])).rows;if(rows.length!==ids.length||expected.some(w=>!rows.some(r=>r.video_id===w.id&&r.process_status===w.status&&r.harvest_batch===e.scope.run)))throw fail('CLEANUP_READBACK');});
   }catch(error){state.unknown=true;e.cleanupError=error;}finally{state.pending=0;}
  })();work.catch(()=>{});try{await Promise.race([work,new Promise(resolve=>{timer=setTimeout(()=>{state.unknown=true;resolve();},Math.max(1,end-Date.now()));})]);}finally{clearTimeout(timer);}
  if(state.unknown||state.pending||[...state.sockets.values()].some(v=>!v)){e.unknown=true;unsafe=true;throw fail('CLEANUP_STOP_UNKNOWN');}
  entries.get('qualification').leased=[];return {video_leases_released:released,video_lease_readback_verified:true};
 }
 function stripScope(e,input){
  if(!input||Object.getPrototypeOf(input)!==Object.prototype)throw fail('INPUT');const q={...input};
  for(const key of ['line','run','source_run','limit'])if(Object.hasOwn(q,key)){if((key==='source_run'?(q[key]??null):q[key])!==e.scope[key])throw fail('INPUT_SCOPE');delete q[key];}
  if(Object.hasOwn(q,'config_required')){if(q.config_required!==true)throw fail('INPUT_SCOPE');delete q.config_required;}
  return q;
 }
 function fields(raw){if(typeof raw!=='string'||Buffer.byteLength(raw)>128*1024)throw fail('IDENTITY_OUTPUT');const result={};for(const line of raw.trim().split('\n')){const at=line.indexOf('=');if(at<1)continue;const key=line.slice(0,at);if(Object.hasOwn(result,key))throw fail('IDENTITY_OUTPUT');result[key]=line.slice(at+1);}return result;}
 function publish(name,value){
  if(!/^[-A-Za-z0-9_.]{1,240}$/.test(name))throw fail('ARTIFACT_NAME');const rootStat=lstatSync(fixedEnv.WFR_RUN_DIR);if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||rootStat.uid!==process.getuid()||rootStat.mode&0o022)throw fail('ARTIFACT_ROOT');const path=join(fixedEnv.WFR_RUN_DIR,name),bytes=Buffer.from(JSON.stringify(value)),fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}const dir=openSync(fixedEnv.WFR_RUN_DIR,constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(dir);}finally{closeSync(dir);}return {path,sha256:sha(bytes)};
 }
 function evidence(e,path,digest,prior){
  if(typeof path!=='string'||dirname(path)!==e.context.evidenceRoot||!/^[a-f0-9]{64}$/.test(digest||''))throw fail('IDENTITY_EVIDENCE');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const a=fstatSync(fd);if(!a.isFile()||a.uid!==process.getuid()||a.nlink!==1||(a.mode&0o777)!==0o600||a.size<1||a.size>4*1024*1024||realpathSync(path)!==path)throw fail('IDENTITY_EVIDENCE');const bytes=readFileSync(fd),z=fstatSync(fd),now=lstatSync(path);if(['dev','ino','size','mtimeMs','ctimeMs'].some(k=>a[k]!==z[k]||a[k]!==now[k]||prior&&a[k]!==prior[k])||sha(bytes)!==digest)throw fail('IDENTITY_EVIDENCE');return {path,sha256:digest,identity:a};}finally{closeSync(fd);}
 }
 function readIdentity(e,cap){
  try{verify();const r=e.identities.get(cap);if(!r||e.unknown||Date.now()>=e.scope.receipt_deadline_ms)throw fail('IDENTITY_BRAND');for(const p of r.evidence_refs)evidence(e,p.path,p.sha256,p.identity);return structuredClone({...r,evidence_refs:r.evidence_refs.map(({path,sha256})=>({path,sha256}))});}catch(error){e.unknown=true;unsafe=true;throw error;}
 }
 async function linkIdentity(e,eid){
  await resources(e);const v=e.currentVideo;if(!v||typeof eid!=='string'||!eid.startsWith(`${e.scope.run}-v${v.video_id}-`))throw fail('VIDEO_IDENTITY');
  const raw=await e.hooks.io.link.run('current-video-link',[eid]);await resources(e);const f=fields(raw);
  if(f.content_type!=='video'||f.video_id!==v.video_id||f.resolved_url!==v.video_url||!new RegExp('^'+eid.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'-t[123]$').test(f.metrics_evidence_id||'')||f.metrics_evidence!==join(e.context.evidenceRoot,f.metrics_evidence_id+'-share.xml'))throw fail('VIDEO_IDENTITY');
  const path=f.metrics_evidence,fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let digest;try{digest=sha(readFileSync(fd));}finally{closeSync(fd);}const ref=evidence(e,path,digest),cap=Object.freeze({});
  e.identities.set(cap,{video_id:f.video_id,video_url:f.resolved_url,content_type:f.content_type,evidence_id:eid,controller_stdout:raw,evidence_refs:[ref]});e.currentIdentity=cap;
  if(e.scope.activity==='qualification'&&!e.identityPublished?.has(v.video_id)){publish(`${e.scope.run}-identity-${v.video_id}.json`,{verified:true,expected_video_id:v.video_id,observed_video_id:f.video_id,content_type:f.content_type,excluded_non_video:false,evidence_id:eid,controller_stdout:raw,observed_at:new Date().toISOString(),native_evidence_refs:[{path:ref.path,sha256:ref.sha256}]});e.identityPublished??=new Set();e.identityPublished.add(v.video_id);}
  return {cap,raw};
 }
 function pinnedJson(name){const rows=src.files.filter(x=>x.path===name),path=join(root,name),st=lstatSync(path);if(rows.length!==1||!st.isFile()||st.isSymbolicLink()||st.mode&0o022||realpathSync(path)!==path||sha(readFileSync(path))!==rows[0].sha256)throw fail('POLICY_SOURCE');return JSON.parse(readFileSync(path));}
 function collection(e){
  if(e.scope.activity!=='collection'||!e.currentVideo||!e.currentIdentity)throw fail('COLLECTION_SCOPE');readIdentity(e,e.currentIdentity);const v=e.currentVideo;
  if(!e.collections.has(v.video_id)){
   const io=e.hooks.io,sampling=frozen?.sampling_input,seconds=sampling?.collection_budget_s??480;
   const macro=createNativePhoneCollectionMacros({source:src,scope:e.scope,companyBinding:e.qualificationFacts.company_binding,collectionDeadlineMs:Math.min(e.scope.worker_deadline_ms,Date.now()+seconds*1000),context:{...e.context,videoId:v.video_id,videoUrl:v.video_url,videoTitle:v.title,keyword:v.keyword,commentLimit:sampling?.comment_limit??50,sampling:Boolean(sampling)},io:{command:io.command,foreground:io.foreground,captureXml:(eid,options)=>io.ui.captureXml(eid,e.readEids.get(eid)==='ui-evidence'?{policy:'opportunistic-search-tab'}:options),snapshot:io.ui.snapshot,readArtifact:io.ui.readArtifact,local:io.local,wait:io.wait,locate:q=>io.vision.locate(q),currentVideoIdentity:()=>e.currentIdentity,currentVideoLink:async eid=>(await linkIdentity(e,eid)).cap,readVideoIdentity:cap=>readIdentity(e,cap),isOwnAccount:async(nickname,id)=>{await resources(e);const own=pinnedJson('config/own-accounts.json');if(!Array.isArray(own.nicknames)||!Array.isArray(own.ids))throw fail('OWN_ACCOUNTS');return own.nicknames.includes(String(nickname||'').trim())||own.ids.includes(String(id||'').trim());}}});
   e.collections.set(v.video_id,{macro,receipts:new Map(),person:0,screen:0,rescans:0,failedIdentityRows:new Set()});
  }return e.collections.get(v.video_id);
 }
 async function collectionQueue(e,op,q){
  const v=e.leased.find(v=>v.video_id===q.video_id);if(!v||q.video_url&&q.video_url!==v.video_url)throw fail('COLLECTION_INPUT');
  if(op==='renew_video'){if(Object.keys(q).some(k=>!['video_id','video_url'].includes(k)))throw fail('COLLECTION_INPUT');return e.queue.renew(v.video_id);}
  if(op==='comment_history'){if(Object.keys(q).some(k=>!['video_id','video_url'].includes(k)))throw fail('COLLECTION_INPUT');const value=await e.queue.history(v.video_id);e.histories.set(v.video_id,structuredClone(value));return value;}
  const r=e.collections.get(v.video_id);if(!r)throw fail('COLLECTION_REQUIRED');
  if(op==='sample_readback'||op==='comment_history_readback'){
   if(Object.keys(q).some(k=>!['video_id','video_url'].includes(k))||!r.stored)throw fail('COLLECTION_READBACK');if(op==='sample_readback')return r.readback=await e.queue.readback(v.video_id);if(typeof e.queue.historyReadback!=='function')throw fail('HISTORY_READBACK_UNAVAILABLE');return r.historyReadback=await e.queue.historyReadback(v.video_id);
  }
  if(!['collect','collect_partial'].includes(op)||!Array.isArray(q.comments)||!Array.isArray(q.history)||q.history.length||Object.keys(q).some(k=>!['video_id','video_url','comments','history'].includes(k))||!e.histories.has(v.video_id))throw fail('COLLECTION_INPUT');
  const rows=q.comments.map(ref=>{if(!ref||Object.keys(ref).join()!=='native_receipt'||!r.receipts.has(ref.native_receipt))throw fail('COMMENT_RECEIPT');return r.receipts.get(ref.native_receipt);});
  const cap=await r.macro.capture(),bundle=await r.macro.readCollectionCapture(cap),key=row=>canonical([row.douyinId,row.commentBody]);
  if(new Set(rows.map(key)).size!==rows.length||canonical(rows.map(key).sort())!==canonical(bundle.rows.map(key).sort())||op!==(bundle.partial||bundle.stop_reason==='quota_reached'?'collect_partial':'collect'))throw fail('COLLECTION_COVERAGE');
  if(r.stored)throw fail('COLLECTION_REPLAY');r.capture=cap;r.bundle=bundle;r.stored=await e.queue.collect(v.video_id,cap);return r.stored;
 }
 function recordingNavigation(e,command){
  if(e.scope.activity!=='qualification'||!['open-video','current-video-link','set-playback-speed'].includes(command))return;
  for(const r of e.recordings.values()){
   if(!r.capture||!e.managerModule)throw fail('RECORDING_ACTIVE');
   const stopped=e.managerModule.readNativeManagedCapture(r.capture,{scope:e.scope});
   if(canonical(stopped.scope)!==canonical(e.scope)||stopped.video_id!==r.video_id||stopped.evidence_id!==r.eid||!r.stopped)throw fail('RECORDING_ACTIVE');
  }
 }
 function phoneIO(e){const io=e.hooks.io;if(!e.context||!io||['command','local','wait','foreground'].some(k=>typeof io[k]!=='function')||['captureXml','snapshot','readArtifact','writeEvidence'].some(k=>typeof io.ui?.[k]!=='function')||typeof io.link?.run!=='function'||typeof io.vision?.locate!=='function')throw fail('PHONE_HOOKS');return io;}
 async function validatePhone(e,command,args){
  await resources(e);phoneIO(e);recordingNavigation(e,command);if(!Array.isArray(args)||args.some(a=>typeof a!=='string'))throw fail('PHONE_INPUT');
  if(command==='open-video'){if(args.length!==1||!e.leased.some(v=>v.video_id===args[0]))throw fail('VIDEO_SCOPE');return [args[0],`${e.scope.run}-v${args[0]}-${e.scope.activity}-open`];}
  if(command==='current-video-link'){if(args.length||!e.currentVideo)throw fail('VIDEO_SCOPE');return [`${e.scope.run}-v${e.currentVideo.video_id}-${e.scope.activity}-identity`];}
  if(command==='set-playback-speed'){if(args.length!==1||args[0]!=='3.0'||!e.currentVideo||!e.currentIdentity)throw fail('VIDEO_SCOPE');return ['3.0',`${e.scope.run}-v${e.currentVideo.video_id}-qualification-speed`];}
  if(['record-start','record-status','record-stop','record-extract-audio','native-audio-evidence'].includes(command)){
   if(args.length||e.scope.activity!=='qualification'||!e.currentVideo||!e.currentIdentity)throw fail('VIDEO_SCOPE');readIdentity(e,e.currentIdentity);const eid=`${e.scope.run}-v${e.currentVideo.video_id}-qualification-record`;
   if(command==='record-start'){const seconds=Number(fixedEnv.QUEUED_VIDEO_RECORD_SECONDS||25);if(!Number.isSafeInteger(seconds)||seconds<10||seconds>105||e.scope.worker_deadline_ms-Date.now()<seconds*1000+15000||e.recordings.has(e.currentVideo.video_id))throw fail('RECORD_BUDGET');return [eid,String(seconds),e.currentVideo.video_id];}
   return command==='native-audio-evidence'?[`${e.scope.run}-v${e.currentVideo.video_id}-qualification-native-audio`]:[eid];
  }
  if(e.scope.activity==='collection'){
   const r=collection(e),prefix=`${e.scope.run}-v${e.currentVideo.video_id}-collection-`;
   if(['open-comments','collect-comments','back-evidence'].includes(command)&&!args.length)return [prefix+command+(++r.screen)];
   if(command==='detail-restored'&&!args.length)return [];
   if(command==='commenter-identity'&&args.length===3){const panel=r.macro.readPanel(r.macro.currentPanel()),rows=panel.rows.filter(row=>!row.author&&row.x===args[0]&&row.y===args[1]&&row.nickname_b64===args[2]);if(rows.length!==1)throw fail('COMMENT_SCOPE');return [...args,prefix+'person'+(++r.person)+'-t1'];}
   if(command==='swipe-evidence'&&args.length===1&&['up','down'].includes(args[0])){const p=r.macro.readPanel(r.macro.currentPanel()),v=p.scroll_viewport;if(!v)throw fail('SCROLL_SCOPE');const x=Math.floor((v.left+v.right)/2),m=Math.floor((v.bottom-v.top)/4),top=v.top+m,bottom=v.bottom-m;return [String(x),String(args[0]==='up'?bottom:top),String(x),String(args[0]==='up'?top:bottom),'500',prefix+'swipe'+(++r.screen)];}
  }
  throw fail('PHONE_UNAVAILABLE');
 }
 function audioObserver(e){
  const artifacts=new WeakMap(),paths=new Map(),suffixes=new Set(['audio.txt','package-uid.txt','uid-owners.txt','foreground.txt','media-session.txt','native-audio.json','native-sdk.txt']);
  const read=cap=>{const r=artifacts.get(cap);if(!r)throw fail('AUDIO_ARTIFACT');const fd=openSync(r.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const a=fstatSync(fd),bytes=readFileSync(fd),z=fstatSync(fd),now=lstatSync(r.path);if(!a.isFile()||a.uid!==process.getuid()||a.nlink!==1||(a.mode&0o777)!==0o600||realpathSync(r.path)!==r.path||['dev','ino','size','mtimeMs','ctimeMs'].some(k=>a[k]!==r.identity[k]||a[k]!==z[k]||a[k]!==now[k])||sha(bytes)!==r.sha256)throw fail('AUDIO_ARTIFACT_CHANGED');return {path:r.path,bytes,sha256:r.sha256};}finally{closeSync(fd);}};
  const location=(eid,suffix)=>{if(typeof eid!=='string'||!/^[-A-Za-z0-9_.]{1,160}$/.test(eid)||!eid.startsWith(e.scope.run+'-')||!suffixes.has(suffix))throw fail('AUDIO_EVIDENCE_SCOPE');return join(e.context.evidenceRoot,eid+'.'+suffix);};
  const sync=()=>{const fd=openSync(e.context.evidenceRoot,constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(fd);}finally{closeSync(fd);}};
  return createNativePhoneAudioMacros({source:src,scope:e.scope,context:e.context,io:{command:e.hooks.io.command,local:e.hooks.io.local,wait:e.hooks.io.wait,assertObservationAllowed:request=>e.manager?e.manager.assertAudioObservationAllowed(request):false,readEvidence:read,writeEvidence:(eid,suffix,text)=>{const path=location(eid,suffix),bytes=Buffer.from(text);if(bytes.length>4*1024*1024)throw fail('AUDIO_EVIDENCE_SIZE');const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}sync();const cap=Object.freeze({}),r={path,sha256:sha(bytes),identity:lstatSync(path)};artifacts.set(cap,r);paths.set(path,{cap,r});return cap;},archiveEvidence:(from,to,list)=>{for(const suffix of list){const original=location(from,suffix),target=location(to,suffix),record=paths.get(original);if(!record)throw fail('AUDIO_ARCHIVE_OWNER');read(record.cap);linkSync(original,target);unlinkSync(original);record.r.path=target;record.r.identity=lstatSync(target);paths.delete(original);paths.set(target,record);}sync();}}});
 }
 async function manager(e){
  if(!e.context)throw fail('RECORDING_UNAVAILABLE');
  if(!e.manager){
   const row=src.files.filter(f=>f.path==='native-phone-managed-recording.mjs');if(row.length!==1)throw fail('RECORDING_UNAVAILABLE');
   const path=join(root,row[0].path),st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink()||st.mode&0o022||sha(readFileSync(path))!==row[0].sha256)throw fail('RECORDING_SOURCE');
   e.managerModule=await import('./native-phone-managed-recording.mjs');e.audio=audioObserver(e);
   e.manager=await e.managerModule.createNativePhoneManagedRecording({runtimeRoot:root,source:src,scope:e.scope,context:{...e.context,allowedVideoIds:e.leased.map(v=>v.video_id)},directory:directory(e,'recording'),assertResources:()=>resources(e),audio:e.audio,commandSource:e.hooks.commandSource,readScope:e.hooks.readScope||e.context.adbReadScope});
  }
  if(!e.managerModule.isNativePhoneManagedRecording(e.manager,{source:src,scope:e.scope})){e.unknown=true;unsafe=true;throw fail('RECORDING_BRAND');}return e.manager;
 }
 async function media(e,r){
  if(!r.media){const binaries=frozen?.collection_phone_scope?.executables;if(!binaries?.ffmpeg||!binaries.ffprobe||typeof credentials?.dashscope!=='function')throw fail('MEDIA_UNAVAILABLE');r.media=startNativePhoneMedia({root,source:src,scope:e.scope,context:{run:e.scope.run,serial:e.scope.serial,videoId:r.video_id},directory:directory(e,'media-'+r.video_id),binaries:{ffmpeg:binaries.ffmpeg,ffprobe:binaries.ffprobe},deadlineMs:e.scope.worker_deadline_ms,receiptDeadlineMs:e.scope.receipt_deadline_ms,assertResources:()=>resources(e),readCapture:(cap,{scope,videoId})=>{const facts=e.managerModule.readNativeManagedCapture(cap,{scope});if(facts.video_id!==videoId)throw fail('MEDIA_VIDEO');return facts;},credential:credentials.dashscope,...(requestImpl?{requestImpl}:{})});}return r.media;
 }
 async function phone(e,command,args){
  await resources(e);phoneIO(e);
  try{
   recordingNavigation(e,command);
   if(['foreground','window','ui-evidence','snapshot-evidence'].includes(command)){
    if(!['qualification','collection'].includes(e.scope.activity))throw fail('READ_SCOPE');
    if(command==='foreground'){if(args.length)throw fail('READ_SCOPE');return e.hooks.io.foreground();}
    if(command==='window'){if(args.length)throw fail('READ_SCOPE');const r=await e.hooks.io.command('window',[]);if(r?.reviewed_command_returned!==true||r.code!==0||!Buffer.isBuffer(r.stdout)||!Buffer.isBuffer(r.stderr))throw fail('READ_RECEIPT');return r.stdout.toString();}
    if(args.length!==1||e.readEids.get(args[0])!==command)throw fail('READ_SCOPE');const [eid]=args;
    try{
     if(e.scope.activity==='collection'&&e.currentVideo&&e.currentIdentity){const r=collection(e),raw=await r.macro.run(command,args);if(command==='ui-evidence'&&r.macro.currentPanel()){const p=r.macro.readPanel(r.macro.currentPanel());return {stdout:raw,xml:p.xml,comments:p.rows,footer_reached:p.footer_reached};}return raw;}
     if(command==='snapshot-evidence'){const result=await e.hooks.io.ui.snapshot(eid);if(result?.path!==join(e.context.evidenceRoot,eid+'.png'))throw fail('READ_EVIDENCE');return result.path+'\n';}
     const cap=await e.hooks.io.ui.captureXml(eid,{policy:'opportunistic-search-tab'}),r=e.hooks.io.ui.readArtifact(cap);if(r?.ext!=='xml'||!Buffer.isBuffer(r.bytes)||sha(r.bytes)!==r.sha256||dirname(r.path)!==e.context.evidenceRoot)throw fail('READ_EVIDENCE');return {stdout:r.path+'\n',xml:new TextDecoder('utf-8',{fatal:true}).decode(r.bytes)};
    }finally{e.readEids.delete(eid);}
   }
   if(command==='open-video'){
    const row=e.leased.find(v=>v.video_id===args[0]);if(!row||args.length!==2||args[1]!==`${e.scope.run}-v${row.video_id}-${e.scope.activity}-open`||!e.detail)throw fail('VIDEO_SCOPE');
    e.currentIdentity=null;const raw=await e.detail.run(command,args),f=fields(raw);if(f.video_opened!=='1'||f.video_id!==row.video_id)throw fail('VIDEO_OPEN');e.currentVideo=row;e.openedCount={label:f.comment_count,evidence:evidence(e,f.comment_count_evidence,f.comment_count_evidence_sha256)};return raw;
   }
   if(command==='current-video-link'){if(args.length!==1||args[0]!==`${e.scope.run}-v${e.currentVideo?.video_id}-${e.scope.activity}-identity`)throw fail('VIDEO_SCOPE');return (await linkIdentity(e,args[0])).raw;}
   if(command==='set-playback-speed'){readIdentity(e,e.currentIdentity);if(!e.detail||args.length!==2||args[0]!=='3.0'||args[1]!==`${e.scope.run}-v${e.currentVideo.video_id}-qualification-speed`)throw fail('VIDEO_SCOPE');return e.detail.run(command,args);}
   if(['record-start','record-status','record-stop','record-extract-audio','native-audio-evidence'].includes(command)){
    if(!e.currentVideo||!e.currentIdentity)throw fail('VIDEO_SCOPE');readIdentity(e,e.currentIdentity);const id=e.currentVideo.video_id,eid=`${e.scope.run}-v${id}-qualification-record`;
    if(e.openedCount?.label==='0')throw fail('CONFIRMED_ZERO_NO_RECORDING');
    if(command==='native-audio-evidence'){if(args.length!==1||args[0]!==`${e.scope.run}-v${id}-qualification-native-audio`)throw fail('VIDEO_SCOPE');await manager(e);return e.audio.run(command,args);}
    if(args[0]!==eid)throw fail('VIDEO_SCOPE');const owned=await manager(e);
    if(command==='record-start'){if(args.length!==3||args[2]!==id||e.recordings.has(id))throw fail('RECORD_REPLAY');const volume=await e.hooks.io.command('media-volume',[]);if(volume?.reviewed_command_returned!==true||volume.code!==0||!Buffer.isBuffer(volume.stdout))throw fail('MEDIA_VOLUME_UNKNOWN');const match=/\bvolume is (\d+) in range \[0\.\.(\d+)\]/.exec(volume.stdout.toString());if(!match||Number(match[1])<1||Number(match[1])>Number(match[2]))throw fail('MEDIA_VOLUME_UNVERIFIED');const volumeCap=e.hooks.io.ui.writeEvidence(`${eid}-media-volume`,'txt',volume.stdout),volumeEvidence=e.hooks.io.ui.readArtifact(volumeCap);if(volumeEvidence.ext!=='txt'||!volumeEvidence.bytes.equals(volume.stdout))throw fail('MEDIA_VOLUME_EVIDENCE');const r={video_id:id,eid,expectedSeconds:Number(args[1]),mediaVolume:Number(match[1]),volumeEvidence:{path:volumeEvidence.path,sha256:volumeEvidence.sha256}};e.recordings.set(id,r);r.started=await owned.run(command,args);return r.started;}
    const r=e.recordings.get(id);if(!r?.started||args.length!==1)throw fail('RECORD_REQUIRED');
    if(command==='record-status')return owned.run(command,args);
    if(command==='record-stop'){if(r.stopped)throw fail('RECORD_STOP_REPLAY');r.stopped=await owned.run(command,args);r.capture=owned.captureFor(eid);return r.stopped;}
    if(!r.capture||r.audioCap)throw fail('MEDIA_CAPTURE_REQUIRED');const m=await media(e,r);r.audioCap=await m.extract(r.capture,{evidenceId:eid});const a=m.readAudio(r.audioCap);return `audio_extracted path=${a.path} duration_seconds=${a.duration_seconds} sample_rate=${a.sample_rate} channels=${a.channels}\n`;
   }
   if(e.scope.activity==='collection'){
    const r=collection(e);if(!r.macro.commands.includes(command))throw fail('PHONE_UNAVAILABLE');const startedMs=Math.floor(Date.now()/1000)*1000;let key;if(command==='commenter-identity'){const panel=r.macro.readPanel(r.macro.currentPanel()),rows=panel.rows.filter(row=>!row.author&&row.x===args[0]&&row.y===args[1]&&row.nickname_b64===args[2]);if(rows.length!==1)throw fail('COMMENT_SCOPE');key=canonical([rows[0].nickname,rows[0].body]);if(r.failedIdentityRows.has(key))r.rescans++;}let raw;try{raw=await r.macro.run(command,args);}catch(error){if(key&&error.returned===true&&error.executionStopped!==false&&error.resourceUnknown!==true)r.failedIdentityRows.add(key);throw error;}
    if(command==='commenter-identity'){const cap=r.macro.currentRecipient();if(!cap)throw fail('RECIPIENT_REQUIRED');const facts=await r.macro.readRecipient(cap),observed=fields(raw);if(observed.account_type!=='personal'||facts.evidence_id!==args[3]||observed.douyin_id!==facts.account.douyin_id||observed.nickname!==facts.account.nickname)throw fail('RECIPIENT_CURRENT');const receipt=randomUUID(),own=pinnedJson('config/own-accounts.json');if(own.ids.includes(facts.account.douyin_id)||own.nicknames.includes(facts.account.nickname))throw fail('OWN_ACCOUNT');const row={douyinId:facts.account.douyin_id,commentBody:facts.row.body};r.receipts.set(receipt,{...row,cap,startedMs});return {stdout:raw,native_receipt:receipt,comment:{...facts.row,...row},navigation:{verified_video_id:e.currentVideo.video_id,panel_session_available:true,next_phone_action:'open-comments'}};}
    if(command==='ui-evidence'||command==='collect-comments'){const cap=r.macro.currentPanel();if(cap){const p=r.macro.readPanel(cap);return {stdout:raw,xml:p.xml,comments:p.rows,footer_reached:p.footer_reached};}}
    return raw;
   }
   throw fail('RECORDING_UNAVAILABLE');
  }catch(error){if(error.executionStopped===false||error.resourceUnknown===true){e.unknown=true;unsafe=true;}throw error;}
 }
 async function historyProofRows(e,v,r,deps){
  const consumed=r.historyReadback.consumed_history??[];if(!consumed.length)return [];
  if(!Array.isArray(consumed)||typeof deps.prepareHistoryIdentity!=='function'||typeof deps.verifyHistoryIdentity!=='function')throw fail('HISTORY_PROOF_UNAVAILABLE');
  if(r.provedHistory)return structuredClone(r.provedHistory);
  const receipt=e.histories.get(v.video_id);if(!receipt||receipt.status!=='verified')throw fail('HISTORY_RECEIPT');
  const candidates=[];
  for(const item of consumed){
   const rawrow=r.bundle.rows.find(row=>row.douyinId===item.douyinId&&row.commentBody===item.commentBody&&row.recipientEvidence?.scope?.profile_eid===item.identity_eid);
   if(!rawrow)throw fail('HISTORY_NATIVE_ROW');
   const owners=[...r.receipts.values()].filter(row=>row.douyinId===item.douyinId&&row.commentBody===item.commentBody);let owner,facts;
   for(const value of owners){const current=await r.macro.readRecipient(value.cap);if(current.evidence_id===item.identity_eid){if(owner)throw fail('HISTORY_NATIVE_AMBIGUOUS');owner=value;facts=current;}}
   if(!owner||facts.video_id!==v.video_id||facts.video_url!==v.video_url||facts.account.douyin_id!==item.douyinId||facts.row.body!==item.commentBody||facts.profile.sha256!==item.profile_sha256||facts.returned.sha256!==item.returned_sha256||!item.identity_eid.startsWith(`${e.scope.run}-v${v.video_id}-collection-person`)||!/^[1-9][0-9]*-t[123]$/.test(item.identity_eid.slice(`${e.scope.run}-v${v.video_id}-collection-person`.length)))throw fail('HISTORY_NATIVE_IDENTITY');
   const originals=receipt.rows.filter(row=>row.id===item.id&&row.douyin_id===item.douyinId&&row.comment_body===item.commentBody);if(originals.length!==1)throw fail('HISTORY_ROW');
   const paths=[['profile',facts.profile,item.profile_sha256],['returned',facts.returned,item.returned_sha256]],bytes=[];
   for(const [suffix,raw,digest]of paths){if(raw.path!==join(e.context.evidenceRoot,item.identity_eid+'-'+suffix+'.xml'))throw fail('HISTORY_PATH');const pin=evidence(e,raw.path,digest);if(pin.identity.mtimeMs<owner.startedMs)throw fail('HISTORY_FRESHNESS');const value=readFileSync(pin.path);if(!value.equals(Buffer.from(raw.xml)))throw fail('HISTORY_BYTES');bytes.push(value);}
   await deps.prepareHistoryIdentity(bytes[0],bytes[1],{douyin_id:item.douyinId});await resources(e);if(deps.verifyHistoryIdentity(bytes[0],bytes[1],{douyin_id:item.douyinId})!==true)throw fail('HISTORY_PREDICATE');
   for(const [,raw,digest]of paths)evidence(e,raw.path,digest);
   candidates.push({item,original:originals[0]});
  }
  const file=publish(`${e.scope.run}-history-${v.video_id}.json`,receipt),history=require('./queued-comment-history.js').load(file.path,fixedEnv.WFR_RUN_DIR,{line:e.scope.line,run:e.scope.run,source_run:e.scope.source_run,video_id:v.video_id,video_url:v.video_url}),rows=[];
  for(const {item,original}of candidates){const match=history.rows.get(require('./queued-comment-history.js').key(item.douyinId,item.commentBody));if(match?.id!==item.id)throw fail('HISTORY_LOAD');publish(item.identity_eid+'-history-readback.json',{version:1,verified:true,video_id:v.video_id,id:item.id,douyin_id:item.douyinId,comment_body:item.commentBody,identity_eid:item.identity_eid,history_sha256:history.sha256,profile_sha256:item.profile_sha256,returned_sha256:item.returned_sha256,comment_context_verified:true});rows.push({id:item.id,douyinId:item.douyinId,commentBody:item.commentBody,sourceVideoUrl:original.source_video_url||v.video_url,identity_eid:item.identity_eid,history_sha256:history.sha256});}
  r.provedHistory=rows;return structuredClone(rows);
 }
 async function settleCollection(e){
  const deps=readNativeCollectionDependencies(e.dependencies,{source:src,scope:e.scope});
  const rows=[];for(const v of e.leased){const r=e.collections.get(v.video_id);if(!r?.stored)continue;if(!r.readback||!r.historyReadback)throw fail('COLLECTION_READBACK_REQUIRED');const history=await historyProofRows(e,v,r,deps),historical=new Set(history.map(row=>canonical([row.douyinId,row.commentBody])));const stop=r.bundle.stop_reason,quota=stop==='quota_reached',partial=r.bundle.partial===true;
   if(r.bundle.confirmed_zero)throw fail('CONFIRMED_ZERO_NEEDS_REVIEW');
   rows.push({video_id:v.video_id,video_url:v.video_url,operation:partial||quota?'collect_partial':'collect',comments:r.bundle.rows.filter(row=>!historical.has(canonical([row.douyinId,row.commentBody]))),history,historyReceipt:e.histories.get(v.video_id),stop_reason:partial?'partial':stop,rescan_count:r.rescans,avatar_recovery_count:0,stored:r.stored,historyReadback:r.historyReadback,pgReadback:r.readback,...(stop==='footer_reached'?{footer_evidence:{file:r.bundle.panel_evidence.path,sha256:r.bundle.panel_evidence.sha256}}:{})});
  }
  for(const row of rows.filter(r=>r.stop_reason==='footer_reached')){if(typeof deps.prepareFooter!=='function'||typeof deps.verifyFooter!=='function')throw fail('FOOTER_READER_UNAVAILABLE');const proof=row.footer_evidence;const pin=evidence(e,proof.file,proof.sha256),bytes=readFileSync(pin.path),meta={file:pin.path,sha256:pin.sha256,run:e.scope.run,video_id:row.video_id};await deps.prepareFooter(bytes,meta);await resources(e);evidence(e,pin.path,pin.sha256,pin.identity);}
  return recordCollectionResult({runDir:fixedEnv.WFR_RUN_DIR,evidenceRoot:e.context.evidenceRoot,scope:{run:e.scope.run,run_id:e.scope.run_id,source_commit:src.commit,line:e.scope.line,line_key:resolveLineKey(e.scope.line),source_run:e.scope.source_run,profile:e.scope.profile,serial:e.scope.serial,company_binding:e.qualificationFacts.company_binding},samplingInput:frozen?.sampling_input??null,qualifiedVideoIds:e.leased.map(v=>v.video_id),videos:rows,recipientNative:deps.recipientNative,...(typeof deps.verifyFooter==='function'?{verifyFooter:deps.verifyFooter}:{})});
 }
 function primitives(scope){
  const e=entry(scope);
  return Object.freeze({
   verifyUpstream:async()=>{await resources(e);if(e.scope.activity!=='dedup'||e.intake)throw fail('INTAKE_SCOPE');return e.intake=await e.queue.intake();},
   validateInput:async(op,input)=>{await resources(e);if(e.scope.activity==='collection'){const q=stripScope(e,input);if(!e.leased.some(v=>v.video_id===q.video_id))throw fail('VIDEO_SCOPE');return q;}if(op==='claim_videos'){if(e.scope.activity!=='qualification'||Object.keys(input).length)throw fail('INPUT');return {};}return stripScope(e,input);},
   queue:async(op,input={})=>{await resources(e);const q=stripScope(e,input);if(e.scope.activity==='collection')return collectionQueue(e,op,q);const result=await e.queue.queue(op,q);if(op==='claim_videos')e.leased=structuredClone(result);if(op==='release_video')e.leased=e.leased.filter(v=>v.video_id!==q.video_id);return result;},
   inspect:async()=>{await resources(e);const i=e.currentIdentity?readIdentity(e,e.currentIdentity):null;return {leased_videos:structuredClone(e.leased),qualified_video_ids:e.scope.activity==='collection'?e.leased.map(v=>v.video_id):[...e.qualified.keys()],company:e.intakeFacts?.company_config||null,verified_detail_video_id:i?.video_id||null,native_video_identity_evidence:i?.evidence_refs||[]};},
   evidenceId:command=>{if(!['qualification','collection'].includes(e.scope.activity)||!['ui-evidence','snapshot-evidence'].includes(command))return null;const eid=`${e.scope.run}${e.currentVideo?'-v'+e.currentVideo.video_id:''}-${e.scope.activity}-read${++e.readSequence}`;e.readEids.set(eid,command);return eid;},
   phone:(command,...args)=>phone(e,command,args),
   validatePhone:(command,args)=>validatePhone(e,command,args),
   qualify:async input=>{
    await resources(e);const q=stripScope(e,input),v=e.leased.find(v=>v.video_id===q.video_id);if(e.scope.activity!=='qualification'||Object.keys(q).join()!=='video_id'||!v||!e.currentIdentity||readIdentity(e,e.currentIdentity).video_id!==v.video_id)throw fail('VIDEO_SCOPE');const r=e.recordings.get(v.video_id);if(!r?.audioCap)return {outcome:'pending',needs_review:true,kind:e.openedCount?.label==='0'?'confirmed_zero_without_qualification':'fresh_evidence_required'};
    if(!r.transcriptCap)r.transcriptCap=await r.media.transcribe(r.audioCap);
    if(!e.validator){if(typeof credentials?.openrouter!=='function')throw fail('VALIDATOR_UNAVAILABLE');e.validator=createNative102Qualification({root,source:src,scope:e.scope,directory:directory(e,'validator'),queue:e.queue,readAudio:(cap,x)=>e.recordings.get(x.videoId)?.media?.readAudio(cap,x),readTranscript:(cap,x)=>e.recordings.get(x.videoId)?.media?.readTranscript(cap,x),assertAuthority:()=>authority(e),apiKey:await credentials.openrouter(),...(requestImpl?{requestImpl}:{})});}
    const value=await e.validator.qualify({videoId:v.video_id,audioCap:r.audioCap,transcriptCap:r.transcriptCap});if(value.needs_review===false)e.qualified.set(v.video_id,{result:structuredClone(value),recording:r});return value;
   },
   qualificationReadback:async input=>{await resources(e);const q=stripScope(e,input),r=e.qualified.get(q.video_id);if(Object.keys(q).join()!=='video_id'||!r)throw fail('QUALIFICATION_UNAVAILABLE');const rows=await e.queue.queue('inspect_videos',{video_ids:[q.video_id]});if(rows.length!==1||rows[0].judgment_status!==r.result.outcome||canonical(rows[0].judgment_config)!==canonical(r.result.readback.judgment_config))throw fail('QUALIFICATION_READBACK');r.readback=structuredClone(rows[0]);return rows[0];},
   settle:async()=>{if(e.result){verify();return structuredClone(e.result);}await resources(e);if(e.scope.activity==='collection')return e.result=await settleCollection(e);if(e.scope.activity==='dedup'){if(!e.intake)throw fail('INTAKE_REQUIRED');return e.result=structuredClone(e.intake);}if(e.scope.activity==='qualification'){const failures=e.leased.filter(v=>!e.qualified.get(v.video_id)?.readback).map(v=>({video_id:v.video_id,reason:'AGENT_QUALIFICATION_PENDING'}));const good=[...e.qualified.values()].filter(r=>r.readback),qualified=good.filter(r=>r.result.outcome==='matched');const progress=e.leased.map(v=>{const r=e.qualified.get(v.video_id),valid=Boolean(r?.readback);return {video_id:v.video_id,settled:valid,cached_judgment_run:null,recordingsRequired:valid?1:0,mediaVerified:valid?1:0,recordingSilentRejected:0,recordingOutcomesFailures:0,recordingsUnverified:valid?0:1,attempts:1,...(valid&&r.result.outcome==='matched'?{identity_snapshot_sha256:freezeQualificationIdentity({dir:fixedEnv.WFR_RUN_DIR,run:e.scope.run,videoId:v.video_id}).sha256}:{})};});publish(`${e.scope.run}-qualification-progress.json`,{run:e.scope.run,source_commit:src.commit,leased_video_ids:e.leased.map(v=>v.video_id),qualified_video_ids:qualified.map(r=>r.readback.video_id),videos:progress});return e.result={claimed:e.leased.length,matched:qualified.length,videos_verified:good.length,recordings_required:good.length,media_volume_verified:good.filter(r=>r.recording.mediaVolume>0).length,media_volume_failures:failures.length?null:0,recordings_unverified:failures.length,recordings_silent_rejected:0,recording_outcomes_failures:0,failures,...(failures.length?{status:'partial'}:{})};}throw fail('QUALIFICATION_UNAVAILABLE');},
   heartbeat:async()=>{await authority(e);if(typeof e.hooks.refreshOwned!=='function'||(await e.hooks.refreshOwned())?.renewed!==true)throw fail('PHONE_LEASE');await authority(e);for(const v of e.leased){const r=e.scope.activity==='collection'?await e.queue.renew(v.video_id):await e.queue.queue('renew_video',{video_id:v.video_id});if(r.renewed!==true)throw fail('VIDEO_LEASE');}return {renewed:true,video_ids:e.leased.map(v=>v.video_id)};},
  });
 }
 async function closeActivity(scope){
  // Stop the handles this Code object actually owns even after revocation or
  // Source drift. Those conditions remain sticky; they cannot suppress cleanup.
  const e=entries.get(scope?.activity);
  if(!e){
   if(scope?.workflow!=='douyin_video_processing'||!['dedup','qualification','collection','cleanup'].includes(scope.activity)||scope.source_commit!==src.commit||identity&&canonical(stable(scope))!==identity)throw fail('SCOPE');
   // This describes only this object's actual zero handles. The owner must
   // separately verify Caller/model, wire, preflight and phone-lock domains.
   const known=!unsafe&&[...entries.values()].every(x=>x.closed&&!x.unknown);return {domain:'native-phone-processing/v1',activity:scope.activity,execution_stopped:known,not_started:true,physical_actions:0,external_effect:'none'};
  }
  if(canonical(e.scope)!==canonical(scope))throw fail('SCOPE');if(e.stop)return {...e.stop};
  try{verify();}catch{e.unknown=true;unsafe=true;}let stopped=!e.unknown;
  if(e.validator)try{const p=await e.validator.close();stopped=e.validator.verifyStopped(p)&&stopped;}catch{stopped=false;}
  for(const r of e.recordings.values())if(r.media)try{const p=await r.media.close();stopped=r.media.verifyStopped(p)&&stopped;}catch{stopped=false;}
  if(e.manager)try{const p=await e.manager.close();stopped=e.manager.verifyStopped(p)&&stopped;}catch{stopped=false;}
  let cleanupFacts;if(e.cleanup&&!e.unknown)try{cleanupFacts=await cleanupLeases(e);}catch{stopped=false;}
  if(e.collections)for(const r of e.collections.values())r.macro.seal();
  if(e.queue)try{const proof=await e.queue.close();stopped=e.queue.verifyStopped(proof)&&stopped;}catch{stopped=false;}
  if(e.dependencies)try{const p=await e.dependencies.close();stopped=e.dependencies.verifyStopped(p)&&stopped;}catch{stopped=false;}
  if(stopped&&e.scope.activity==='dedup'&&e.intake)try{intakePacket=e.queue.issuedIntake();}catch{stopped=false;}
  if(stopped&&e.scope.activity==='collection'&&e.qualificationFacts)try{e.collectionPacket=e.queue.issuedReceipts();}catch{stopped=false;}
  if(stopped&&e.scope.activity==='qualification'&&e.queue)try{qualificationPacket=e.queue.issuedQualification();}catch{stopped=false;}
  e.closed=true;e.unknown||=!stopped;unsafe||=e.unknown;e.stop={domain:'native-phone-processing/v1',activity:e.scope.activity,execution_stopped:stopped,external_effect:e.effectUnknown?'unknown':e.queue?.snapshot().external_effect||'none',...cleanupFacts};return {...e.stop};
 }
 async function readbackChecks(activity,{deadlineMs,signal}={}){
  verify();const e=entries.get(activity);if(unsafe||!e?.closed||e.stop?.execution_stopped!==true||[...entries.values()].some(x=>!x.closed)||typeof e.hooks.readbackAuthority!=='function')throw fail('JUDGE_PREVIOUS_STOP');
  if((e.readbacks=(e.readbacks||0)+1)>2)throw fail('JUDGE_BUDGET');
  const end=Math.min(deadlineMs??e.scope.receipt_deadline_ms-1,e.scope.receipt_deadline_ms-1);if(!Number.isSafeInteger(end)||Date.now()>=end||signal?.aborted)throw fail('JUDGE_DEADLINE');
  const state={unknown:false,pending:1,open_sockets:0,authority_stopped:false},claimed=e.scope;let control,allocation,client,socket,judgeDependencies,collectionVerified,transaction=false,result,problem,timer;
  const guard=()=>{verify();if(state.unknown||signal?.aborted||Date.now()>=end)throw fail('JUDGE_DEADLINE');};
  let expectedClaim;
  const check=async()=>{guard();const p=await control.assertAuthority();guard();if(!nativeAuthorityProjectionMatches(p,{source:src,scope:claimed})||expectedClaim&&canonical(expectedClaim)!==canonical({claimed_by:p.claimed_by,claimed_at:p.claimed_at}))throw fail('JUDGE_AUTHORITY');return p;};
  const close=async()=>{
   if(client){if(transaction&&Date.now()<claimed.receipt_deadline_ms)try{await client.query('ROLLBACK');transaction=false;}catch{state.unknown=true;}try{client.release(state.unknown);}catch{state.unknown=true;}}
   if(allocation){try{await allocation.pool.end();}catch{state.unknown=true;}try{if((await allocation.transport.seal())?.execution_stopped!==true)state.unknown=true;}catch{state.unknown=true;}try{if((await allocation.transport.close())?.execution_stopped!==true)state.unknown=true;}catch{state.unknown=true;}}
   if(socket&&!socket.closed)await new Promise(resolve=>socket.once('close',resolve));
   if(judgeDependencies)try{const p=await judgeDependencies.close();if(judgeDependencies.verifyStopped(p)!==true)state.unknown=true;}catch{state.unknown=true;}
   if(control)try{const p=await control.close();state.authority_stopped=control.verifyStopped(p)===true;if(!state.authority_stopped)state.unknown=true;}catch{state.unknown=true;}
  };
  const work=(async()=>{
   try{
    control=await e.hooks.readbackAuthority({deadlineMs:end,signal});if(!control||['assertAuthority','close','verifyStopped'].some(k=>typeof control[k]!=='function'))throw fail('JUDGE_AUTHORITY');
    const projection=await check(),original=activity==='dedup'?readNative102Intake(intakePacket,{source:src,scope:claimed,authority:projection}):readNative102Qualification(qualificationPacket,{source:src,scope:claimed,authority:projection});expectedClaim=original.claim;
    if(activity==='collection'){
     if(!e.collectionPacket)throw fail('COLLECTION_RECEIPTS_REQUIRED');
     judgeDependencies=await startNativeCollectionDependencies({root,source:src,scope:claimed,directory:directory(e,'readonly-parser-'+e.readbacks),python:e.hooks.python,deadlineMs:end,receiptDeadlineMs:claimed.receipt_deadline_ms,assertAuthority:check,...(requestImpl?{requestImpl}:{})});
     collectionVerified=await readNativeCollectionQueueReceipts(e.collectionPacket,{root,source:src,scope:claimed,directory:directory(e,'readonly-collection-'+e.readbacks),createPool,assertAuthority:check,dependencies:judgeDependencies,deadlineMs:end,samplingInput:frozen?.sampling_input??null});if(collectionVerified.verified!==true)throw fail('COLLECTION_READBACK');
    }
    guard();allocation=await createPool({deadlineMs:end,cleanupDeadlineMs:claimed.receipt_deadline_ms});guard();
    if(!allocation?.expectedIdentity?.database||!allocation.expectedIdentity.role||!allocation.pool?.connect||!allocation.pool?.end||!allocation.transport?.seal||!allocation.transport?.close)throw fail('JUDGE_ALLOCATION');
    allocation.pool.on?.('error',()=>{state.unknown=true;});await check();client=await allocation.pool.connect();client.on?.('error',()=>{state.unknown=true;});socket=client.connection?.stream;if(!(socket instanceof Socket))throw fail('JUDGE_SOCKET');state.open_sockets=1;socket.once('close',()=>{state.open_sockets=0;});
    const query=async(text,args)=>{await check();if(!/^SELECT\b/i.test(text.trim())&&!['BEGIN READ ONLY','ROLLBACK'].includes(text))throw fail('JUDGE_READONLY');const value=await client.query(text,args);if(text==='BEGIN READ ONLY')transaction=true;if(text==='ROLLBACK')transaction=false;await check();return value;};
    const id=allocation.expectedIdentity,identityRows=(await query(id.system_identifier?'SELECT current_database() AS database,current_user AS role,system_identifier::text FROM pg_control_system()':'SELECT current_database() AS database,current_user AS role')).rows;if(identityRows.length!==1||Object.entries(id).some(([k,v])=>identityRows[0][k]!==v))throw fail('JUDGE_PG_IDENTITY');
    await query('BEGIN READ ONLY');if((await query("SELECT current_setting('transaction_read_only') AS readonly")).rows[0]?.readonly!=='on')throw fail('JUDGE_READONLY');
    const ids=activity==='qualification'?e.leased.map(v=>v.video_id):original.video_ids,rows=(await query('SELECT * FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND video_id=ANY($2::text[])',[resolveLineKey(claimed.line),ids])).rows;
    if(rows.length!==ids.length||rows.some(r=>!ids.includes(r.video_id)||r.video_url!=='https://www.douyin.com/video/'+r.video_id||activity==='dedup'&&r.harvest_batch!==claimed.source_run))throw fail('JUDGE_TARGETS');
    if(activity==='qualification'){
     for(const v of e.leased){const q=e.qualified.get(v.video_id),r=rows.find(r=>r.video_id===v.video_id);if(!q?.readback||!r||r.judgment_status!==q.result.outcome||r.process_status!=='处理中:'+claimed.run||r.harvest_batch!==claimed.run||canonical(r.judgment_config)!==canonical(q.readback.judgment_config))throw fail('JUDGE_QUALIFICATION');const recording=q.recording,audio=recording.media.readAudio(recording.audioCap,{scope:claimed,videoId:v.video_id}),transcript=recording.media.readTranscript(recording.transcriptCap,{scope:claimed,videoId:v.video_id,audioSha256:audio.sha256});if(!transcript.text?.trim()||r.transcript!==transcript.text||sha(r.transcript)!==transcript.sha256)throw fail('JUDGE_FRESH_TRANSCRIPT');}
     qualificationIdentityEvidence({dir:fixedEnv.WFR_RUN_DIR,frozen:{...frozen,deployment:{source_commit:src.commit}},binding:{id:claimed.binding_id,run_id:claimed.run_id}});
    }
    const trustedMetrics=activity==='dedup'?structuredClone(e.intake):structuredClone(e.result);
    if(!trustedMetrics)throw fail('JUDGE_RESULT');
    const {doc,errors}=require('./checks/probes-lib.js').loadChecks(join(root,'checks/douyin-video-processing.yaml'),join(root,'checks/schema.json')),spec=JSON.parse(readFileSync(join(root,'plans/douyin_video_processing.steps.json')));if(errors.length||doc.probes.some(p=>p.stage===activity&&!['metric','sql'].includes(p.probe.type))||spec.steps.some(s=>(s.at||s.activity)===activity&&s.readback?.type==='http'))throw fail('JUDGE_CHECKS');
    const params={runTag:claimed.run,lineKey:resolveLineKey(claimed.line),word:'',metrics:trustedMetrics};let tail=Promise.resolve();const pool={query:(...a)=>{const p=tail.then(()=>query(...a));tail=p.catch(()=>{});return p;}};
    const probes=await runProbes({doc,stage:activity,params,deps:{pool},timeoutMs:Math.max(1,end-Date.now())}),steps=await runSteps({spec,stage:activity,params,deps:{pool},timeoutMs:Math.max(1,end-Date.now())});await tail;await query('ROLLBACK');
    result={ok:true,result:{...probes,steps,metrics:trustedMetrics,readbacks:{targets:ids,videos:rows.length,...(collectionVerified?{collection:collectionVerified}:{})}}};
   }catch(error){problem=error;if(error.executionStopped===false||error.resourceUnknown===true)state.unknown=true;}finally{await close();state.pending=0;}
  })();work.catch(()=>{});
  try{await Promise.race([work,new Promise(resolve=>{timer=setTimeout(()=>{state.unknown=true;resolve();},Math.max(1,end-Date.now()));})]);}finally{clearTimeout(timer);}
  const stopped=!state.unknown&&!state.pending&&!state.open_sockets&&state.authority_stopped;if(!stopped){e.unknown=true;unsafe=true;}
  const output=result||{ok:true,result:{metrics:{},probes:[],steps:[]}};output.result.code_native_readback={execution_stopped:stopped,execution_unknown:!stopped,authority_execution_stopped:state.authority_stopped,original_external_effect:e.stop.external_effect};if(problem||!stopped){output.result.gate={verdict:stopped?'fail':'unknown',action:'fail_stage'};output.result.reason=problem?.code||'NATIVE_PROCESSING_JUDGE_STOP_UNKNOWN';}return output;
 }
 return Object.freeze({prepareActivity,prepareCleanup,primitives,closeActivity,readbackChecks,ready,snapshot:()=>({execution_unknown:unsafe||[...entries.values()].some(e=>e.unknown),activities:[...entries.values()].map(e=>({activity:e.scope.activity,closed:e.closed,unknown:e.unknown}))})});
}
