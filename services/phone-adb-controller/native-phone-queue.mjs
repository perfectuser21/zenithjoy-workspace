// Code-owned 101 persistence. Neither Worker JSON nor a closed model grants PG authority.
import {createRequire} from 'node:module';
import {Socket} from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,openSync,writeFileSync,closeSync,fsyncSync,readdirSync,fstatSync,constants} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyRpcSource} from './leadgen-rpc.mjs';
import {nativeAuthorityProjectionMatches} from './native-activity-authority.mjs';
import {runProbes,runSteps,resolveLineKey} from './verify-step.mjs';
const require=createRequire(import.meta.url),{queueRequest}=require('./leadgen-queue.js'),{routeOf}=require('./line-routes.js');
const packets=new WeakMap(),instances=new WeakSet(),sha=v=>createHash('sha256').update(v).digest('hex');
const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const fail=code=>Object.assign(Error('NATIVE_PHONE_QUEUE_'+code),{code:'NATIVE_PHONE_QUEUE_'+code});
function fixedChecks(root,checks,metrics,limit){
 if(!checks||Object.keys(checks).sort().join()!=='doc,spec'||!metrics||Object.keys(metrics).sort().join()!=='persisted,videos_pushed'||Object.values(metrics).some(n=>!Number.isSafeInteger(n)||n<0||n>limit))throw fail('CHECKS');
 const {doc,errors}=require('./checks/probes-lib.js').loadChecks(join(root,'checks/douyin-video-discovery.yaml'),join(root,'checks/schema.json')),spec=JSON.parse(readFileSync(join(root,'plans/douyin_video_discovery.steps.json')));
 if(errors.length||canonical(checks)!==canonical({doc,spec}))throw fail('CHECKS');
 const probes=doc.probes.filter(p=>p.stage==='collect_videos'&&p.probe.type!=='metric'),steps=spec.steps.filter(s=>(s.at||s.activity)==='collect_videos'&&['sql','http'].includes(s.readback?.type));
 if(probes.map(p=>p.key).join()!=='disc_candidates_persisted,videos_readback,line_key_not_null'||probes.some(p=>p.probe.type!=='sql')||steps.length!==1||steps[0].key!=='douyin_video_discovery.collect_videos.push_videos'||steps[0].readback.type!=='sql')throw fail('CHECKS');
 return async(pool,scope,end)=>{const params={runTag:scope.run,lineKey:resolveLineKey(scope.line),metrics:structuredClone(metrics),word:''};let tail=Promise.resolve();const owned={query:(...args)=>{const result=tail.then(()=>pool.query(...args));tail=result.catch(()=>{});return result;}};const result=await runProbes({doc:{...doc,probes},stage:'collect_videos',params,deps:{pool:owned},timeoutMs:Math.max(1,end-Date.now())}),readSteps=await runSteps({spec:{...spec,steps},stage:'collect_videos',params,deps:{pool:owned},timeoutMs:Math.max(1,end-Date.now())});await tail;return {...result,steps:readSteps};};
}
export const isNativePhoneQueue=value=>instances.has(value);
function verifySource(root,source){
 try{if(realpathSync(root)!==dirname(fileURLToPath(import.meta.url))||new Set(source.files.map(f=>f.path)).size!==source.files.length)throw Error();
  for(const name of ['native-phone-queue.mjs','native-activity-authority.mjs']){const rows=source.files.filter(f=>f.path===name),path=join(root,name),s=lstatSync(path);if(rows.length!==1||!s.isFile()||s.isSymbolicLink()||(s.mode&0o022)||sha(readFileSync(path))!==rows[0].sha256)throw Error();}
  verifyRpcSource(source,{base:root});
 }catch{throw fail('SOURCE');}
}
function validateScope(scope,source){
 if(scope?.workflow!=='douyin_video_discovery'||scope.activity!=='collect_videos'||scope.source_run!==null||scope.serial==='none'||!scope.serial||!scope.profile||scope.source_commit!==source.commit||!Number.isSafeInteger(scope.limit)||scope.limit<1||scope.limit>50||!Number.isSafeInteger(scope.worker_deadline_ms)||!Number.isSafeInteger(scope.receipt_deadline_ms)||scope.worker_deadline_ms>=scope.receipt_deadline_ms)throw fail('SCOPE');
 routeOf(scope.line);
}
function journal(directory){
 const identity=lstatSync(directory),issued=new Map();if(!identity.isDirectory()||identity.isSymbolicLink()||identity.uid!==process.getuid()||(identity.mode&0o777)!==0o700||realpathSync(directory)!==resolve(directory)||readdirSync(directory).length)throw fail('JOURNAL');
 const check=()=>{const d=lstatSync(directory);if(d.isSymbolicLink()||d.dev!==identity.dev||d.ino!==identity.ino||d.uid!==identity.uid||(d.mode&0o777)!==0o700)throw fail('JOURNAL');const names=readdirSync(directory);if(names.length!==issued.size||names.some(n=>!issued.has(n)))throw fail('JOURNAL');for(const[n,p]of issued){const fd=openSync(join(directory,n),constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=fstatSync(fd),b=readFileSync(fd);if(!s.isFile()||s.dev!==p.dev||s.ino!==p.ino||s.uid!==process.getuid()||(s.mode&0o777)!==0o600||s.nlink!==1||sha(b)!==p.hash)throw fail('JOURNAL');}finally{closeSync(fd);}}};
 const record=(name,value)=>{check();const b=Buffer.from(canonical(value)),fd=openSync(join(directory,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,b);fsyncSync(fd);const d=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(d);}finally{closeSync(d);}const s=fstatSync(fd);issued.set(name,{dev:s.dev,ino:s.ino,hash:sha(b),value:structuredClone(value)});}finally{closeSync(fd);}check();};
 return {check,record,values:()=>{check();return [...issued.values()].map(v=>structuredClone(v.value));}};
}
// One allocated pool belongs to one operation. Keep ownership until real close,
// even when the caller's original per-Activity receipt horizon has elapsed.
function createDomain({root,source,scope,directory,createPool,assertAuthority,queueDependencies,readOnly=false,deadlineMs,expectedClaim,codeChecks}){
 const sourceCopy=structuredClone(source),fixed=structuredClone(scope),end=Math.min(deadlineMs??(readOnly?fixed.receipt_deadline_ms:fixed.worker_deadline_ms),readOnly?fixed.receipt_deadline_ms:fixed.worker_deadline_ms),cleanupEnd=fixed.receipt_deadline_ms,log=journal(directory);
 let sealed=false,unknown=false,effectUnknown=false,active=null,claim=expectedClaim?structuredClone(expectedClaim):null;const jobs=new Set(),streams=new Map(),reasons=new Set();
 const taint=reason=>{unknown=true;reasons.add(reason);};
 const snapshot=()=>Object.freeze({domain:'native-phone-queue/v1',sealed,pending:jobs.size,execution_unknown:unknown,execution_stopped:sealed&&!unknown&&!jobs.size&&[...streams.values()].every(Boolean),external_effect:effectUnknown?'unknown':'observed',unknown_reasons:[...reasons],authority_execution_stopped:'external-Code-owner-not-attested'});
 const guard=()=>{if(sealed||Date.now()>=end)throw fail('DEADLINE');if(unknown)throw fail('RESOURCE_UNKNOWN');verifySource(root,sourceCopy);log.check();if(sealed||Date.now()>=end)throw fail('DEADLINE');};
 const authorized=async()=>{
  guard();let reject;const interrupted=new Promise((_,no)=>{reject=no;});interrupted.catch(()=>{});const job={id:randomUUID(),interrupt:()=>reject(fail('AUTHORITY_DEADLINE'))};jobs.add(job);
  const work=(async()=>{let p;try{p=await assertAuthority(structuredClone(fixed));}catch{throw fail('AUTHORITY');}guard();if(!nativeAuthorityProjectionMatches(p,{source:sourceCopy,scope:fixed})||p.id!==fixed.task_id||p.status!=='in_progress')throw fail('AUTHORITY');const observed={claimed_by:p.claimed_by,claimed_at:p.claimed_at};if(claim&&canonical(claim)!==canonical(observed))throw fail('CLAIM_CHANGED');claim??=observed;return p;})().finally(()=>jobs.delete(job));job.done=work;work.catch(()=>{});
  const timer=setTimeout(()=>{taint('authority_deadline');job.interrupt();},Math.max(1,end-Date.now()));try{return await Promise.race([work,interrupted]);}finally{clearTimeout(timer);}
 };
 const seal=()=>{if(!sealed){sealed=true;if(jobs.size){taint('sealed_inflight');for(const j of jobs)j.interrupt?.();for(const s of streams.keys())s.destroy();}}return snapshot();};
 async function boundedClose(work){const remaining=cleanupEnd-Date.now();if(remaining<=0){taint('pool_close_unknown');return false;}let timer;try{return await Promise.race([work.then(()=>true,()=>{taint('pool_close_unknown');return true;}),new Promise(r=>{timer=setTimeout(()=>r(false),remaining);})]);}finally{clearTimeout(timer);}}
 async function execute(op,input,{forceReadOnly=readOnly}={}){
  guard();if(active)throw fail('BUSY');if(typeof queueDependencies?.prepareMetrics!=='function'||typeof queueDependencies?.nativeMetrics?.parseDescriptions!=='function')throw fail('DEPENDENCY');
  let reject;const interrupted=new Promise((_,no)=>{reject=no;});interrupted.catch(()=>{});const job={id:randomUUID(),interrupt:()=>reject(fail('CLOSED'))};active=job;jobs.add(job);let allocation,client,txn=false,writeDispatched=false,commitDispatched=false;
  log.record(job.id+'.call.json',{id:job.id,op,input,scope:fixed,read_only:forceReadOnly});
  const timer=setTimeout(()=>{taint('deadline_inflight');if(writeDispatched)effectUnknown=true;seal();},Math.max(1,end-Date.now()));
  const work=(async()=>{try{
   await authorized();if(!['inspect_videos','fixed_checks'].includes(op)){await queueDependencies.prepareMetrics(input.video.metrics.evidence.xml);await authorized();}
   try{allocation=await createPool({deadlineMs:end,cleanupDeadlineMs:cleanupEnd});}catch{taint('allocation_unknown');throw fail('RESOURCE_UNKNOWN');}guard();
   if(!allocation?.expectedIdentity?.database||!allocation.expectedIdentity.role||!allocation.pool?.connect||!allocation.pool?.end||!allocation.transport?.seal||!allocation.transport?.close){taint('allocation_unverified');throw fail('RESOURCE_UNKNOWN');}
   allocation.pool.on?.('error',()=>taint('pool_error'));
   await authorized();client=await allocation.pool.connect();const socket=client?.connection?.stream;if(!(socket instanceof Socket)){taint('socket_unverified');throw fail('RESOURCE_UNKNOWN');}streams.set(socket,socket.closed);socket.once('close',()=>streams.set(socket,true));
   const query=async(text,args)=>{const rollback=text==='ROLLBACK';if(!rollback)await authorized();else if(Date.now()>cleanupEnd)throw fail('CLEANUP_DEADLINE');
    const kind=String(text).trim().split(/\s+/)[0].toUpperCase();if(!['SELECT','INSERT','BEGIN','COMMIT','ROLLBACK'].includes(kind)||forceReadOnly&&(!['SELECT','BEGIN','ROLLBACK'].includes(kind)||kind==='BEGIN'&&text!=='BEGIN READ ONLY'))throw fail('SQL');
    if(kind==='INSERT')writeDispatched=true;if(kind==='COMMIT')commitDispatched=true;
    let result;try{result=await client.query(text,args);}catch(error){if(commitDispatched||writeDispatched&&!txn)effectUnknown=true;throw error;}if(kind==='BEGIN')txn=true;if(kind==='COMMIT'||rollback)txn=false;
    if(!rollback)await authorized();return result;};
   await query(forceReadOnly?'BEGIN READ ONLY':'BEGIN');
   const expected=allocation.expectedIdentity,id=(await query(expected.system_identifier?'SELECT current_database() AS database,current_user AS role,system_identifier::text FROM pg_control_system()':'SELECT current_database() AS database,current_user AS role')).rows;
   if(id.length!==1||Object.entries(expected).some(([k,v])=>id[0][k]!==v))throw fail('IDENTITY');
   if(forceReadOnly&&(await query("SELECT current_setting('transaction_read_only') AS readonly")).rows[0]?.readonly!=='on')throw fail('READONLY');
   const execution={run:fixed.run,run_id:fixed.run_id,profile:fixed.profile,line:fixed.line};const result=op==='fixed_checks'&&readOnly&&codeChecks?await codeChecks({query},fixed,end):await queueRequest({query,connect:async()=>({query,release(){}})},{...input,op,line:fixed.line,run:fixed.run,source_run:null,limit:fixed.limit},{sourceCommit:sourceCopy.commit,execution,nativeMetrics:queueDependencies.nativeMetrics});
   await authorized();await query(forceReadOnly?'ROLLBACK':'COMMIT');log.record(job.id+'.result.json',{id:job.id,op,result});return result;
  }catch(error){if(commitDispatched)effectUnknown=true;log.record(job.id+'.failure.json',{id:job.id,op,unknown:effectUnknown,reason:/^NATIVE_PHONE_QUEUE_/.test(error.message)?error.message:'operation_failed'});if(effectUnknown)throw fail('COMMIT_UNKNOWN');throw error;}
  finally{
   clearTimeout(timer);const closing=(async()=>{if(client){if(txn&&Date.now()<=cleanupEnd)try{await client.query('ROLLBACK');}catch{taint('rollback_unknown');}try{client.release(unknown);}catch{taint('release_unknown');}}
    if(allocation){try{await allocation.pool.end();}catch{taint('pool_close_unknown');}try{if((await allocation.transport.seal())?.execution_stopped!==true)taint('transport_close_unknown');}catch{taint('transport_close_unknown');}}
    for(const[s,closed]of streams)if(!closed&&!s.closed)await new Promise(r=>s.once('close',r));
   })().finally(()=>{jobs.delete(job);if(active===job)active=null;});
   if(!await boundedClose(closing))taint('pool_close_unknown');
  }})();job.done=work;work.catch(()=>{});const value=await Promise.race([work,interrupted]);if(unknown)throw fail('RESOURCE_UNKNOWN');return value;
 }
 async function close(){seal();if(jobs.size)await boundedClose(Promise.allSettled([...jobs].map(j=>j.done)));return snapshot();}
 // The original operation owns all callbacks too; no async authorization/parser
 // promise is detached when a caller receives a timeout.
 const run=async(...args)=>execute(...args);
 return {run,close,seal,snapshot,authorized,log,source:sourceCopy,scope:fixed,claim:()=>structuredClone(claim)};
}
export function createNativePhoneQueue({root,source,scope,directory,createPool,assertAuthority,queueDependencies}={}){
 const src=structuredClone(source),fixed=structuredClone(scope);verifySource(root,src);validateScope(fixed,src);if(typeof createPool!=='function'||typeof assertAuthority!=='function')throw fail('DEPENDENCY');
 const domain=createDomain({root,source:src,scope:fixed,directory,createPool,assertAuthority,queueDependencies}),issued=new Map();let prepared=false,current=false,closedActivity=false;
 async function prepare(){if(prepared)throw fail('SCOPE');domain.log.record('caller.json',{scope:fixed,source_sha256:sha(canonical(src))});prepared=true;}
 async function begin(activity){if(!prepared||current||closedActivity||canonical(activity)!==canonical(fixed))throw fail('SCOPE');await domain.authorized();domain.log.record('claim.json',domain.claim());current=true;}
 async function queue(op,input={}){
  if(!current||!['discover','discover_readback','inspect_videos'].includes(op))throw fail('UNSUPPORTED');if(!input||Array.isArray(input)||Object.getPrototypeOf(input)!==Object.prototype)throw fail('SCOPE');
  const unknown=domain.snapshot().external_effect==='unknown';if(unknown&&op==='discover')throw fail('COMMIT_UNKNOWN');
  if(op==='inspect_videos'){if(Object.keys(input).join()!=='video_ids'||!Array.isArray(input.video_ids)||new Set(input.video_ids).size!==input.video_ids.length||input.video_ids.some(id=>!issued.has(id)))throw fail('TARGET_SCOPE');return domain.run(op,structuredClone(input),{forceReadOnly:true});}
  const video=input.video,vid=video?.videoId??video?.video_id;if(Object.keys(input).join()!=='video'||!/^\d{16,24}$/.test(vid||'')||(video.videoUrl??video.video_url)!=='https://www.douyin.com/video/'+vid)throw fail('TARGET_SCOPE');
  if(op==='discover'){
   if(video.metrics?.comment_total?.value===0)throw fail('CONFIRMED_ZERO_COMMENTS');if(issued.has(vid))throw fail('DUPLICATE');if(issued.size>=fixed.limit)throw fail('LIMIT');const original=structuredClone(video);domain.log.record('video-'+vid+'.intent.json',{op,video:original,scope:fixed});issued.set(vid,original);return domain.run(op,{video:original});
  }
  if(!issued.has(vid)||canonical(video)!==canonical(issued.get(vid)))throw fail('TARGET_SCOPE');return domain.run(op,{video:structuredClone(issued.get(vid))},{forceReadOnly:true});
 }
 async function closeActivity(){if(domain.snapshot().pending||domain.snapshot().execution_unknown)throw fail('STOP_UNKNOWN');current=false;closedActivity=true;return {execution_stopped:true,external_effect:domain.snapshot().external_effect};}
 function issuedReceipts(){if(current&&!domain.snapshot().sealed||domain.snapshot().pending)throw fail('STOP_UNKNOWN');const entries=domain.log.values(),packet=Object.freeze({});packets.set(packet,{source:canonical(src),scope:structuredClone(fixed),claim:domain.claim(),entries,issued:[...issued.values()].map(v=>structuredClone(v)),check:domain.log.check,external_effect:domain.snapshot().external_effect,execution_unknown:domain.snapshot().execution_unknown});return packet;}
 const api=Object.freeze({prepare,begin,queue,closeActivity,seal:domain.seal,close:domain.close,snapshot:domain.snapshot,issuedReceipts});instances.add(api);return api;
}
export function readNativePhoneQueueReceipts(packet,{source,scope}={}){const r=packets.get(packet);if(!r)throw fail('RECEIPTS_UNBRANDED');if(r.source!==canonical(source)||canonical(r.scope)!==canonical(scope))throw fail('RECEIPTS_SCOPE');r.check();return {entries:structuredClone(r.entries),videos:structuredClone(r.issued),claim:structuredClone(r.claim),external_effect:r.external_effect,execution_unknown:r.execution_unknown};}
export async function readNativePhoneQueueActivity({root,source,scope,records,directory,createPool,assertAuthority,queueDependencies,deadlineMs,checks,metrics}={}){
 verifySource(root,source);validateScope(scope,source);const codeChecks=checks===undefined?undefined:fixedChecks(root,checks,metrics,scope.limit),original=readNativePhoneQueueReceipts(records,{source,scope}),domain=createDomain({root,source,scope,directory,createPool,assertAuthority,queueDependencies,readOnly:true,deadlineMs,expectedClaim:original.claim,codeChecks});let verified=0,problem,pgChecks;const observations=[];
 try{if(original.execution_unknown)throw fail('ORIGINAL_STOP_UNKNOWN');if(!original.videos.length)throw fail('NO_ISSUED_TARGETS');for(const video of original.videos){const result=await domain.run('discover_readback',{video},{forceReadOnly:true});if(result?.metrics_verified!==true||result.metrics_digest!==video.metrics.digest)throw fail('READBACK_MISMATCH');observations.push({video_id:video.videoId??video.video_id,result:structuredClone(result)});verified++;}if(codeChecks){pgChecks=await domain.run('fixed_checks',{}, {forceReadOnly:true});if(pgChecks.gate.verdict!=='pass')throw fail('CHECKS_FAILED');}}
 catch(error){problem=error;}
 finally{await domain.close();}
 const stopped=domain.snapshot().execution_stopped,unknown=original.external_effect==='unknown'||original.execution_unknown||!stopped||pgChecks?.gate.verdict==='unknown';
 return {ok:true,result:{...(pgChecks?{probes:pgChecks.probes,steps:pgChecks.steps}:{}),gate:{verdict:unknown?'unknown':problem?'fail':'pass',action:unknown||problem?'fail_stage':'continue'},metrics:{discovery_metrics_verified:!problem&&verified===original.videos.length?1:0,video_manifest_readback_failures:problem?1:0},readbacks:{videos:verified,observations,targets:original.videos.map(v=>v.videoId??v.video_id)},code_native_readback:{execution_stopped:stopped,execution_unknown:!stopped,original_external_effect:original.external_effect,authority_execution_stopped:'external-Code-owner-not-attested'},...(problem?{reason:/^NATIVE_PHONE_QUEUE_/.test(problem.message)?problem.message:'independent_readback_failed'}:{})}};
}
