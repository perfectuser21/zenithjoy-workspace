import {nativeAuthorityProjectionMatches} from './native-activity-authority.mjs';
// 103父Code业务域；原队列/政策决定业务结果，Agent不能提供SQL/来源/依赖。
import {createRequire} from 'node:module';
import {Socket} from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,openSync,writeFileSync,closeSync,fsyncSync,readdirSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyRpcSource} from './leadgen-rpc.mjs';
import {nativeScoringDependenciesMatch} from './native-scoring-producers.mjs';
const require=createRequire(import.meta.url),{queueRequest}=require('./leadgen-queue.js');
const runtimes=new WeakSet(),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),sha=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>Object.assign(Error('NATIVE_103_'+code),{code:'NATIVE_103_'+code});
const operations={scoring:new Set(['company_config','score_scope','score','score_readback','score_exclusion_readback','policy_review']),mark_leads:new Set(['mark_leads','mark_readback','bridge_outreach','bridge_readback'])};
const writes=new Set(['company_config','score','mark_leads','bridge_outreach']);
const readbacks={company_config:[],score:['score_readback','score_exclusion_readback'],mark_leads:['mark_readback'],bridge_outreach:['bridge_readback']};
export const isNativeScoringRuntime=value=>runtimes.has(value);
export function createNativeScoringRuntime({root,source,scope,directory,createPool,assertAuthority,readSource,queueDependencies={},requireProjectedAuthority=false}={}){
 const fixed=structuredClone(scope),src=structuredClone(source);let prepared=false,sealed=false,unknown=false,effectUnknown=false,current=null,claim=null,scoreScope=null,marked=null;
 const pending=new Set(),reasons=new Set(),streams=new Map();
 const taint=reason=>{unknown=true;reasons.add(reason);};
 const snapshot=()=>Object.freeze({domain:'native-103-parent/v1',prepared,sealed,pending:pending.size,execution_unknown:unknown||pending.size>0,external_effect:effectUnknown?'unknown':'observed',execution_stopped:sealed&&!unknown&&pending.size===0&&[...streams.values()].every(Boolean),unknown_reasons:[...reasons]});
 const verify=()=>{
  try{
   if(!src||realpathSync(root)!==dirname(fileURLToPath(import.meta.url))||new Set(src.files.map(f=>f.path)).size!==src.files.length)throw Error();
   for(const name of ['native-scoring-runtime.mjs','native-scoring-producers.mjs',...(requireProjectedAuthority?['native-activity-authority.mjs']:[])]){const self=src.files.filter(f=>f.path===name),file=join(root,name),s=lstatSync(file);if(self.length!==1||!s.isFile()||s.isSymbolicLink()||(s.mode&0o022)||sha(readFileSync(file))!==self[0].sha256)throw Error();}
   verifyRpcSource(src,{base:root,...(readSource?{read:readSource}:{})});
  }catch{throw fail('SOURCE');}
 };
 const active=(readOnly=false)=>{if(!prepared||sealed||!current||Date.now()>=current.deadline_ms)throw fail('CLOSED');if(unknown)throw fail('RESOURCE_UNKNOWN');if(effectUnknown&&!readOnly)throw fail('COMMIT_UNKNOWN_READBACK_REQUIRED');};
 const authorize=async(readOnly=false)=>{
  active(readOnly);verify();active(readOnly);let task;try{task=await assertAuthority(structuredClone(fixed));}catch{throw fail('AUTHORITY');}active(readOnly);
  if(nativeScoringDependenciesMatch(queueDependencies,src)){
   const state=queueDependencies.snapshot();if(state.external_effect==='unknown'){effectUnknown=true;reasons.add('model_or_crm_effect_unknown');}
   queueDependencies.assertActive({readOnly});active(readOnly);
  }
  const p=task?.payload,s=p?.scope;
  if(requireProjectedAuthority&&!nativeAuthorityProjectionMatches(task,{source:src,scope:current}))throw fail('AUTHORITY');
  if(task?.id!==fixed.task_id||task.status!=='in_progress'||!task.claimed_by||!Number.isFinite(Date.parse(task.claimed_at))
   ||(!requireProjectedAuthority&&(p?.workflow_key!==fixed.workflow||p.source_commit!==src.commit||p.run_tag!==fixed.run||p.profile!==fixed.profile||p.company_line!==fixed.line||p.device_serial!=null
   ||(s?.source_run??null)!==fixed.source_run||s.limit!==fixed.limit)))throw fail('AUTHORITY');
  const actual=[task.claimed_by,task.claimed_at];if(claim&&!same(claim,actual))throw fail('CLAIM_CHANGED');claim??=actual;active(readOnly);
 };
 function durable(name,value){const file=join(directory,name),fd=openSync(file,'wx',0o600);try{writeFileSync(fd,JSON.stringify(value));fsyncSync(fd);}finally{closeSync(fd);}const parent=openSync(directory,'r');try{fsyncSync(parent);}finally{closeSync(parent);}return file;}
 async function prepare(){
  verify();if(fixed?.workflow!=='douyin_comment_scoring'||fixed.profile!=='mmv-scoring'||fixed.serial!=='none'||fixed.source_commit!==src.commit||!Number.isSafeInteger(fixed.limit)||fixed.limit<1||fixed.limit>50||typeof createPool!=='function'||typeof assertAuthority!=='function')throw fail('DEPENDENCY');
  const st=lstatSync(directory);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o077)||readdirSync(directory).length)throw fail('PREVIOUS_CALLER_UNKNOWN');
  durable('caller.json',{source_commit:src.commit,scope:fixed,caller_id:randomUUID()});prepared=true;
 }
 async function begin(activity){
  if(current||sealed||unknown||effectUnknown||!operations[activity?.activity])throw fail('SCOPE');
  for(const k of ['workflow','run','run_id','task_id','binding_id','source_commit','profile','serial','line','source_run','limit'])if(activity[k]!==fixed[k])throw fail('SCOPE');
  if(!Number.isSafeInteger(activity.deadline_ms)||activity.deadline_ms>fixed.deadline_ms||Date.now()>=activity.deadline_ms)throw fail('DEADLINE');
  current=structuredClone(activity);await authorize();
 }
 async function runQueue(op,input={}){
  if(!current||!operations[current.activity].has(op))throw fail('UNSUPPORTED');
  if(!input||Array.isArray(input)||Object.getPrototypeOf(input)!==Object.prototype)throw fail('SCOPE');
  const prior=readdirSync(directory).filter(n=>n.endsWith('.intent.json')).map(n=>JSON.parse(readFileSync(join(directory,n)))).filter(r=>!readdirSync(directory).includes(r.id+'.result.json'));
  if(prior.length)effectUnknown=true;
  const readOnly=effectUnknown&&prior.length===1&&readbacks[prior[0].op]?.includes(op);
  active(readOnly);await authorize(readOnly);
  const ownedDependencies=nativeScoringDependenciesMatch(queueDependencies,src);
  if((['score','policy_review','mark_leads','bridge_outreach'].includes(op))&&!ownedDependencies)throw fail('DEPENDENCY');
  for(const k of ['line','run','source_run','limit','source_commit','task_id'])if(Object.hasOwn(input,k)&&input[k]!==({line:fixed.line,run:fixed.run,source_run:fixed.source_run,limit:fixed.limit,source_commit:src.commit,task_id:fixed.task_id})[k])throw fail('SCOPE');
  const request={...structuredClone(input),op,line:fixed.line,run:fixed.run,source_run:fixed.source_run,limit:fixed.limit};
  if(op==='company_config'){if(Object.keys(input).some(k=>k!=='step')||input.step!=='103')throw fail('SCOPE');}
  if(['score','score_readback','score_exclusion_readback','policy_review'].includes(op)){
   if(!scoreScope||!Array.isArray(input.ids)||new Set(input.ids).size!==input.ids.length||input.ids.some(id=>!scoreScope.ids.includes(id)))throw fail('IDS');
   request.sources=Object.fromEntries(input.ids.map(id=>[id,scoreScope.sources[id]]));request.limit=Math.min(fixed.limit,input.ids.length);
   if(op==='score')request.budget_max=fixed.limit;
   if(op==='policy_review'){request.claim=fixed.run;request.require_dual_review=true;}
  }
  if(op==='mark_leads'){if(!scoreScope)throw fail('IDS');request.ids=[...scoreScope.ids];}
  if(op==='bridge_outreach'){if(!marked)throw fail('IDS');request.comment_ids=[...marked.ids];}
  if(readOnly){const expected=prior[0].request;if(op==='mark_readback'&&!same(input.ids,expected.ids)||op==='bridge_readback'&&!same(input.ids,prior[0].bridge_ids||[])||op.startsWith('score_')&&!same(input.ids,expected.ids))throw fail('READBACK_SCOPE');}
  const id=randomUUID(),write=writes.has(op);if(write)durable(id+'.intent.json',{id,op,request,scope:fixed});
  const job={id};pending.add(job);let allocation,writeSent=false,commitSent=false;
  try{
   try{allocation=await createPool({deadlineMs:current.deadline_ms,cleanupDeadlineMs:current.receipt_deadline_ms??fixed.receipt_deadline_ms});}catch{taint('allocation_unknown');throw fail('RESOURCE_UNKNOWN');}
   active(readOnly);const expected=allocation?.expectedIdentity;if(!expected?.database||!expected.role||!allocation.pool?.connect||!allocation.transport?.close||!allocation.transport?.seal){taint('allocation_unverified');throw fail('RESOURCE_UNKNOWN');}
   const ownClient=async()=>{
    await authorize(readOnly);const client=await allocation.pool.connect(),stream=client?.connection?.stream;
    if(!(stream instanceof Socket)){taint('socket_unverified');client?.release?.(true);throw fail('RESOURCE_UNKNOWN');}
    if(!streams.has(stream)){streams.set(stream,false);stream.once('close',()=>streams.set(stream,true));}
    let txn=false,dirty=false;
    return {release:(...args)=>client.release(...args),async query(text,args){
     const rollback=String(text).trim().toUpperCase()==='ROLLBACK';
     if(!rollback)await authorize(readOnly);else if(Date.now()>fixed.receipt_deadline_ms)throw fail('CLEANUP_DEADLINE');
     const kind=String(text).trim().split(/\s/)[0].toUpperCase();if(!['SELECT','INSERT','UPDATE','BEGIN','COMMIT','ROLLBACK','WITH'].includes(kind))throw fail('SQL');
     if(readOnly&&!['SELECT','BEGIN','ROLLBACK','COMMIT'].includes(kind))throw fail('READBACK_WRITE');
     if(kind==='COMMIT'&&dirty)commitSent=true;
     if(['INSERT','UPDATE','WITH'].includes(kind)){writeSent=true;dirty=true;}
     if(kind==='BEGIN')txn=true;
     let value;try{value=await client.query(text,args);}catch(error){if(commitSent||!txn&&writeSent)effectUnknown=true;throw error;}
     if(kind==='COMMIT'||kind==='ROLLBACK'){txn=false;dirty=false;}
     if(!rollback){await authorize(readOnly);if(ownedDependencies)await queueDependencies.stageRows(value.rows);await authorize(readOnly);}return value;
    }};
   };
   const identity=await ownClient();try{const rows=(await identity.query(expected.system_identifier?'SELECT current_database() AS database, current_user AS role, system_identifier::text FROM pg_control_system()':'SELECT current_database() AS database, current_user AS role')).rows;if(rows.length!==1||Object.keys(expected).some(k=>rows[0][k]!==expected[k]))throw fail('IDENTITY');}finally{identity.release();}
   const pool={connect:ownClient,async query(text,args){const c=await ownClient();try{return await c.query(text,args);}finally{c.release();}}};
   const forbidden=()=>{throw fail('DEPENDENCY');};
   const dependencies=ownedDependencies?queueDependencies:{sampledAdmission:{readProof:forbidden,verifyRecipient:forbidden}};
   const result=await queueRequest(pool,request,{...dependencies,sourceCommit:src.commit});await authorize(readOnly);
   if(op==='score_scope'){const ids=result.ids.slice(0,fixed.limit);scoreScope={...result,ids,sources:Object.fromEntries(ids.map(id=>[id,result.sources[id]]))};if(ids.some(id=>typeof scoreScope.sources[id]!=='string'||!scoreScope.sources[id]||fixed.source_run!==null&&scoreScope.sources[id]!==fixed.source_run))throw fail('IDS');durable(id+'.scope.json',scoreScope);return structuredClone(scoreScope);}
   if(op==='mark_leads')marked=structuredClone(result);
   if(write)durable(id+'.result.json',{id,result});else if(readOnly)durable(id+'.readback.json',{original_intent:prior[0].id,result,continues_execution:false});
   return result;
  }catch(error){if(write&&(writeSent||commitSent)){effectUnknown=true;reasons.add('commit_unknown');}if(effectUnknown)throw Object.assign(fail('COMMIT_UNKNOWN_READBACK_REQUIRED'),{externalEffect:'unknown'});if(/^NATIVE_103_/.test(error?.message||''))throw error;const safe=fail('OPERATION_FAILED');safe.operation=op;safe.sqlstate=/^[0-9A-Z]{5}$/.test(error?.code||'')?error.code:null;safe.message+=':'+op+':'+(safe.sqlstate||'internal');throw safe;}
  finally{
   if(allocation)try{await allocation.pool.end();const stopped=await allocation.transport.seal();if(stopped?.execution_stopped!==true)taint('pool_stop_unknown');}catch{taint('pool_stop_unknown');}
   // Never equate Pool.end() with actual close: each connected socket must return.
   for(const [stream,closed] of streams)if(!closed&&stream.closed!==true){await new Promise(r=>{const timer=setTimeout(r,Math.max(0,fixed.receipt_deadline_ms-Date.now()));stream.once('close',()=>{clearTimeout(timer);r();});});if(!streams.get(stream))taint('socket_close_unknown');}
   pending.delete(job);
  }
 }
 async function queue(op,input={}){
  if(!current||pending.size)throw fail('CLOSED');
  let cancel;
  const interrupted=new Promise((_,reject)=>{cancel=()=>reject(fail('CLOSED'));});interrupted.catch(()=>{});
  const admission={cancel};pending.add(admission);
  const timer=setTimeout(()=>{unknown=true;effectUnknown ||= writes.has(op);reasons.add('deadline_inflight');seal();for(const stream of streams.keys())if(!stream.closed)stream.destroy();},Math.max(1,current.deadline_ms-Date.now()));
  const work=runQueue(op,input).finally(()=>{clearTimeout(timer);pending.delete(admission);});work.catch(()=>{});
  return Promise.race([work,interrupted]);
 }
 async function closeActivity(){if(pending.size||unknown||effectUnknown)throw fail('STOP_UNVERIFIED');current=null;return snapshot();}
 function seal(){sealed=true;for(const job of pending)job.cancel?.();return snapshot();}
 function bindDependencies(next){
  if(!prepared||sealed||current||pending.size||unknown||effectUnknown)throw fail('SCOPE');
  if(!nativeScoringDependenciesMatch(next,src))throw fail('DEPENDENCY');
  if(nativeScoringDependenciesMatch(queueDependencies,src)){const old=queueDependencies.snapshot();if(old.execution_stopped!==true||old.sealed!==true||old.pending!==0||old.execution_unknown||old.external_effect==='unknown')throw fail('PREVIOUS_PRODUCER_UNVERIFIED');}
  queueDependencies=next;
 }
 const api={prepare,begin,queue,closeActivity,seal,snapshot,bindDependencies,supports:activity=>prepared&&!sealed&&!unknown&&!effectUnknown&&nativeScoringDependenciesMatch(queueDependencies,src)&&['scoring','mark_leads'].includes(activity?.key)};runtimes.add(api);return Object.freeze(api);
}
