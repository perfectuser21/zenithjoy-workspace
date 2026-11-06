// Independent Code Judge. No worker entry, write SQL, model POST, or old-domain reopening.
import {readFileSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {Socket} from 'node:net';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';
import {readNativeScoringReceipts} from './native-scoring-runtime.mjs';import {createNativeActivityAuthority,readNativeAuthorityProjection,nativeAuthorityProjectionMatches} from './native-activity-authority.mjs';import {startNativeScoringProducers} from './native-scoring-producers.mjs';import {verifyRpcSource} from './leadgen-rpc.mjs';import {runProbes,runSteps,resolveLineKey} from './verify-step.mjs';
const require=createRequire(import.meta.url),{queueRequest}=require('./leadgen-queue.js'),{loadChecks}=require('./checks/probes-lib.js');
const fail=reason=>Error('NATIVE_103_JUDGE_'+reason),sha=b=>createHash('sha256').update(b).digest('hex'),canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort().map(k=>[k,x[k]])):x);
const allowed=new Set(['score_readback','score_exclusion_readback','policy_review','mark_readback','bridge_readback']);
export async function readNativeScoringActivity({root,source,scope,request,frozen,records,directory,python,credentials,createPool,createAuthorityControl,requestImpl,verify,previousEffect,deadlineMs,signal}={}){
 const end=Math.min(request.receipt_deadline_ms,deadlineMs??request.receipt_deadline_ms);let sealed=false,unknown=false,originalUnknown=previousEffect==='unknown',pending=0,allocation,client,stream,streamClosed=false,authority,producer,dependencies,txn=false,output,problem;
 const active=()=>{if(sealed||signal?.aborted||Date.now()>=end)throw fail('DEADLINE');verify();verifyRpcSource(source,{base:root});const row=source.files.filter(f=>f.path==='native-scoring-readback.mjs');if(dirname(fileURLToPath(import.meta.url))!==root||row.length!==1||sha(readFileSync(join(root,'native-scoring-readback.mjs')))!==row[0].sha256)throw fail('SOURCE');if(sealed||signal?.aborted||Date.now()>=end)throw fail('DEADLINE');};
 const checkedRecords=readNativeScoringReceipts(records,{source,scope});
 const journal=openSync(join(directory,'readonly-journal.jsonl'),'wx',0o600),parent=openSync(directory,'r');fsyncSync(parent);closeSync(parent);
 const record=value=>{writeFileSync(journal,JSON.stringify(value)+'\n');fsyncSync(journal);};
 record({event:'create',role:'independent-code-judge/v1',request_sha256:sha(canonical(request)),source_commit:source.commit,records_sha256:sha(canonical(checkedRecords)),activity:scope.activity});
 let rejectDeadline;const expired=new Promise((_,reject)=>{rejectDeadline=reject;});expired.catch(()=>{});
 const cancel=()=>{sealed=true;unknown=true;stream?.destroy();rejectDeadline(fail('DEADLINE'));};
 const timer=setTimeout(cancel,Math.max(1,end-Date.now()));signal?.addEventListener('abort',cancel,{once:true});
 const owned=async fn=>{active();pending++;const work=Promise.resolve().then(()=>{active();return fn();}).finally(()=>{pending--;});work.catch(()=>{});const value=await Promise.race([work,expired]);active();return value;};
 async function authorized(){active();const cap=await owned(()=>authority.readClaim()),projection=readNativeAuthorityProjection(cap,{request,source});if(!nativeAuthorityProjectionMatches(projection,{source,scope}))throw fail('AUTHORITY');active();}
 async function query(text,args){if(!/^SELECT\s/i.test(String(text).trim()))throw fail('SQL_UNSUPPORTED');await authorized();const value=await owned(()=>client.query(text,args));await authorized();await owned(()=>dependencies.stageRows(value.rows));await authorized();return value;}
 const queue=async(op,input)=>{if(!allowed.has(op))throw fail('UNSUPPORTED');await authorized();const pool={query,connect:async()=>({query,release(){}})};const value=await owned(()=>queueRequest(pool,{...input,op,line:scope.line,run:scope.run,source_run:scope.source_run},{...dependencies,sourceCommit:source.commit}));await authorized();return value;};
 function selected(){return checkedRecords.map(r=>r.value).filter(r=>r.activity_scope?.activity===scope.activity&&r.activity_scope?.authorized_request_sha256===sha(canonical(request)));}
 try{
  active();if(!['scoring','mark_leads'].includes(scope.activity)||!Number.isSafeInteger(end)||end<=Date.now()+2)throw fail('SCOPE');
  const rows=selected(),intents=rows.filter(r=>r.request&&r.op),results=rows.filter(r=>r.result&&r.op);if(!rows.length)throw fail('NO_ISSUED_TARGETS');
  for(const intent of intents)if(!results.some(r=>r.id===intent.id&&r.op===intent.op))originalUnknown=true;
  try{authority=createNativeActivityAuthority({runtimeRoot:root,source,request,frozen,directory,...(createAuthorityControl?{createControl:createAuthorityControl}:{})});}catch(error){unknown=true;throw error;}await authorized();
  // The reader's deadline is the original receipt horizon, never a new Activity budget.
  try{producer=await owned(()=>startNativeScoringProducers({root,source,scope,directory:join(directory,'producer'),python,deadlineMs:end-1,receiptDeadlineMs:end,readOnly:true,brainCredential:()=>credentials.brainToken,assertAuthority:async()=>{await authorized();return true;},...(requestImpl?{requestImpl}:{})}));}catch(error){unknown=true;throw error;}
  dependencies=await producer.queueDependencies(credentials);await authorized();
  try{allocation=await owned(async()=>{const value=await createPool({deadlineMs:end,cleanupDeadlineMs:end});if(sealed){unknown=true;try{await value.pool.end();await value.transport.seal();}catch{}throw fail('ALLOCATION_LATE');}return value;});}catch(error){unknown=true;throw error;}
  if(!allocation?.expectedIdentity?.database||!allocation.expectedIdentity.role||!allocation.transport?.seal||!allocation.pool?.connect)throw fail('POOL');
  client=await owned(()=>allocation.pool.connect());stream=client?.connection?.stream;if(!(stream instanceof Socket))throw fail('SOCKET');stream.once('close',()=>{streamClosed=true;});
  await authorized();await owned(()=>client.query('BEGIN READ ONLY'));txn=true;
  const identity=(await query(allocation.expectedIdentity.system_identifier?'SELECT current_database() AS database, current_user AS role, system_identifier::text FROM pg_control_system()':'SELECT current_database() AS database, current_user AS role')).rows;
  if(identity.length!==1||Object.entries(allocation.expectedIdentity).some(([k,v])=>identity[0][k]!==v))throw fail('IDENTITY');
  if((await query("SELECT current_setting('transaction_read_only') AS readonly")).rows[0]?.readonly!=='on')throw fail('READONLY');
  let metrics,readbacks;
  if(scope.activity==='scoring'){
   const proof=rows.filter(r=>r.op==='score_scope'&&r.data);if(proof.length!==1)throw fail('SCOPE_TARGET');const fixed=proof[0].data;
   const scored=results.filter(r=>r.op==='score').flatMap(r=>r.result.ids||[]),excluded=results.filter(r=>r.op==='score').flatMap(r=>r.result.excluded_ids||[]);
   const uncertain=intents.filter(i=>i.op==='score'&&!results.some(r=>r.id===i.id)).flatMap(i=>i.request.ids);if(uncertain.some(id=>!fixed.ids.includes(id)))throw fail('TARGET_SCOPE');if(uncertain.length){const observed=(await query("SELECT id,process_status,judgment_config FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND id=ANY($2::uuid[])",[resolveLineKey(scope.line),uncertain])).rows;for(const id of uncertain){const row=observed.find(r=>r.id===id);if(!row||row.judgment_config?.run_id!==scope.run)throw fail('COMMIT_READBACK_UNVERIFIED');(row.process_status==='已排除'?excluded:scored).push(id);}}const all=[...scored,...excluded];
   if(new Set(all).size!==all.length||all.length!==fixed.ids.length||all.some(id=>!fixed.ids.includes(id)))throw fail('INCOMPLETE');
   const fields=ids=>({ids,sources:Object.fromEntries(ids.map(id=>[id,fixed.sources[id]]))});
   const scores=await queue('score_readback',fields(scored)),exclusions=excluded.length?await queue('score_exclusion_readback',fields(excluded)):{verified:true,failures:0,ids:[]},policy=scored.length?await queue('policy_review',{...fields(scored),claim:scope.run,require_dual_review:true}):{verified:excluded.length>0,rows:[]};
   metrics={scored:scored.length,excluded:excluded.length,scoring_readback_failures:scores.verified===true?scores.failures:Math.max(1,scores.failures||0),exclusion_readback_failures:exclusions.verified===true?exclusions.failures||0:Math.max(1,exclusions.failures||0),policy_review_failures:policy.verified===true?0:1};readbacks={scores,exclusions,policy};
  }else{
   const markResults=results.filter(r=>r.op==='mark_leads'),bridgeResults=results.filter(r=>r.op==='bridge_outreach');if(markResults.length>1||bridgeResults.length>1)throw fail('TARGET_AMBIGUOUS');
   let marked=markResults[0]?.result,bridge=bridgeResults[0]?.result,observedBridge=[];
   if(!marked){const issued=intents.filter(r=>r.op==='mark_leads');if(issued.length!==1||!Array.isArray(issued[0].request.ids))throw fail('TARGET_AMBIGUOUS');const ids=issued[0].request.ids,leads=(await query('SELECT id,comment_id FROM zenithjoy.leadgen_leads WHERE line_key=$1 AND comment_id=ANY($2::uuid[])',[resolveLineKey(scope.line),ids])).rows;marked={ids,lead_ids:leads.map(r=>r.id),marked:ids.length};originalUnknown=true;}
   if(!bridge){const issued=intents.filter(r=>r.op==='bridge_outreach');if(issued.length!==1||!Array.isArray(issued[0].request.comment_ids)||issued[0].request.comment_ids.some(id=>!marked.ids.includes(id)))throw fail('TARGET_AMBIGUOUS');observedBridge=(await query('SELECT id,comment_id,lead_id,state,attempted_at FROM zenithjoy.leadgen_bridge_outbox WHERE line_key=$1 AND run_tag=$2 AND comment_id=ANY($3::uuid[])',[resolveLineKey(scope.line),scope.run,issued[0].request.comment_ids])).rows;bridge={ids:observedBridge.map(r=>r.id),verified:false};originalUnknown=true;}
   if(!Array.isArray(marked.ids)||!Array.isArray(marked.lead_ids)||!Array.isArray(bridge.ids))throw fail('INCOMPLETE');
   const mark=await queue('mark_readback',{ids:marked.ids,lead_ids:marked.lead_ids}),delivery=await queue('bridge_readback',{ids:bridge.ids});
   metrics={marked:marked.marked,mark_leads_readback_failures:mark.verified===true?mark.failures||0:Math.max(1,mark.failures||0),bridge_readback_failures:(bridge.verified===false?1:0)+(delivery.verified===true?delivery.failures||0:Math.max(1,delivery.failures||0))};readbacks={mark,delivery,observed_bridge:observedBridge};
  }
  // Readback may preserve evidence about an unknown write; it never resolves it.
  const {doc,errors}=loadChecks(join(root,'checks/douyin-comment-scoring.yaml'),join(root,'checks/schema.json')),spec=JSON.parse(readFileSync(join(root,'plans/douyin_comment_scoring.steps.json'),'utf8'));
  if(errors.length||doc.probes.filter(p=>p.stage===scope.activity).some(p=>p.probe.type!=='metric')||spec.steps.filter(s=>(s.at||s.activity)===scope.activity).some(s=>['sql','http'].includes(s.readback?.type)))throw fail('CHECKS_UNSUPPORTED');
  const params={runTag:scope.run,lineKey:resolveLineKey(scope.line),metrics,word:''},probes=await runProbes({doc,stage:scope.activity,params,timeoutMs:Math.max(1,end-Date.now())}),steps=await runSteps({spec,stage:scope.activity,params,timeoutMs:Math.max(1,end-Date.now())});active();output={...probes,steps,metrics,readbacks};if(originalUnknown)problem=fail('ORIGINAL_EFFECT_UNKNOWN');record({event:'readback',metrics,readbacks});
 }catch(error){problem=error;}
 finally{
  // Only owned transaction cleanup may run after admission is sealed. Never COMMIT.
  sealed=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);
  const cleanup=async fn=>{const remaining=end-Date.now();if(remaining<=0){unknown=true;return;}let timer;try{await Promise.race([fn(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('CLOSE_DEADLINE')),remaining);})]);}catch{unknown=true;}finally{clearTimeout(timer);}};
  if(client){if(txn)await cleanup(()=>client.query('ROLLBACK'));try{client.release(unknown);}catch{unknown=true;}}
  if(allocation)await cleanup(async()=>{await allocation.pool.end();const proof=await allocation.transport.seal();if(proof?.execution_stopped!==true)throw fail('TRANSPORT_CLOSE');});
  if(stream&&!streamClosed&&!stream.closed)await cleanup(()=>new Promise(resolve=>stream.once('close',resolve)));
  if(stream&&!streamClosed&&!stream.closed)unknown=true;
  if(producer)await cleanup(async()=>{if((await producer.close()).execution_stopped!==true)throw fail('PRODUCER_CLOSE');});
  if(authority)await cleanup(async()=>{const p=await authority.close();if(!authority.verifyStopped(p))throw fail('AUTHORITY_CLOSE');});
  if(pending)unknown=true;record({event:'final',role:'independent-code-judge/v1',execution_stopped:!unknown,pending,problem:problem?.message||null});closeSync(journal);
 }
 const stop={role:'independent-code-judge/v1',execution_stopped:!unknown,execution_unknown:unknown,original_external_effect:previousEffect};
 if(problem||unknown)return {ok:true,result:{...output,stage:scope.activity,gate:{verdict:'unknown',action:'fail_stage'},steps:[],probes:[{key:'independent_readback',pass:null,error:problem?.message||'JUDGE_STOP_UNVERIFIED'}],code_native_readback:stop}};
 return {ok:true,result:{...output,code_native_readback:stop}};
}
