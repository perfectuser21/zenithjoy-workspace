// 103 评分终态与恢复读回；所有写入由调用方已有事务包裹。
'use strict';
const {createHash}=require('node:crypto');
const {openSync,readFileSync,closeSync,fstatSync,constants}=require('node:fs');
const {join}=require('node:path');
const {homedir}=require('node:os');
const {execFileSync}=require('node:child_process');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashText=value=>createHash('sha256').update(String(value)).digest('hex');
const recoveryScope=Object.freeze({line:'jinuo',comment_id:'f5e16a6d-9183-4606-b840-9698bd710eed',
 source_run:'accept6cc22_jinuo102l_20261031T0047',old_run:'acceptd052_103l_20261031t1423',
 old_source_commit:'d052dedd5cdd49f331c1354cfdb359ce66503151',
 company_id:'ef8e14b0-4018-4e54-bc7a-866e51a0ce0b',tenant_id:'a4ca8914-f5a7-4928-b1e3-6b69f9c0ab61',
 policy_id:'jinoshengyuan-existing-acquisition-rules-v1',version:14,
 task_id:'70a56d85-3b88-451b-a683-7112284eca6d',project_id:'68ca6b4f-5e53-4ccf-a2aa-874e5c32bbe6',
 video_url:'https://www.douyin.com/video/7699344115351688872',
 comment_sha256:'f3e924983dae90c07a358570c3527de2b5dae16af4b84018d6c0816d724ba591',
 video_sha256:'45febab1ce4450192d11b9e69307ea4a0fa1207581b21675d49a0b5111ff8889'});
const recoveryAction='leadgen_103l_false_exclusion_reopen';
const recoveryActor='codex:103-false-exclusion-fix';
const recoveryFail=reason=>{const e=Error(`FALSE_EXCLUSION_${reason}`);e.code=e.message;throw e;};
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
const hashObject=value=>hashText(JSON.stringify(stable(value)));

function validateRecoveryInput(input,sourceCommit){
 const keys=['candidate_source_commit','comment_id','line','maintenance_task_id','old_run','op','run','source_run'];
 if(!input||Object.keys(input).sort().join(',')!==keys.join(',')
   ||!['recover_false_exclusion_102l','recover_false_exclusion_102l_readback'].includes(input.op)
   ||input.line!==recoveryScope.line||input.comment_id!==recoveryScope.comment_id
   ||input.source_run!==recoveryScope.source_run||input.old_run!==recoveryScope.old_run
   ||input.maintenance_task_id!==recoveryScope.task_id
   ||typeof input.run!=='string'||!/^accept[a-zA-Z0-9_-]{1,110}$/.test(input.run)
   ||input.run===recoveryScope.old_run||input.run===recoveryScope.source_run
   ||!/^[a-f0-9]{40}$/.test(input.candidate_source_commit||'')
   ||input.candidate_source_commit!==sourceCommit)recoveryFail('SCOPE_INVALID');
}
async function readRecoveryTask(){
 try{const response=await fetch(`http://localhost:5221/api/brain/tasks/${recoveryScope.task_id}`,
   {redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok)recoveryFail('AUTHORITY_UNAVAILABLE');
  const body=await response.json();return body.task||body;
 }catch{recoveryFail('AUTHORITY_UNAVAILABLE');}
}
function readFixedArtifact(path){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const s=fstatSync(fd);if(!s.isFile()||s.uid!==process.getuid()||s.size<1||s.size>1024*1024)
   recoveryFail('OLD_RUN_UNKNOWN');return readFileSync(fd,'utf8');}
 finally{closeSync(fd);}
}
function inspectOldScoringRun(){
 const runId=`douyin_comment_scoring-${recoveryScope.old_run}__a1`;
 const dir=join(homedir(),'.local/share/zenithjoy/phone-candidate-runs',recoveryScope.old_source_commit,
  'ledger',`douyin_comment_scoring-${recoveryScope.old_run}`);
 let raw,receipt,ps;
 try{raw=readFixedArtifact(join(dir,'split-result.json'));receipt=JSON.parse(raw);
  ps=execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024});}
 catch{recoveryFail('OLD_RUN_UNKNOWN');}
 const records=ps.trim().split('\n').map(line=>{const m=line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
  if(!m)recoveryFail('OLD_RUN_UNKNOWN');return {pid:Number(m[1]),ppid:Number(m[2]),command:m[3]};});
 const parents=new Map(records.map(r=>[r.pid,r.ppid])),ancestors=new Set();
 for(let pid=process.pid;pid>1&&!ancestors.has(pid);pid=parents.get(pid)||0)ancestors.add(pid);
 const tagged=records.filter(r=>!ancestors.has(r.pid)&&r.command.includes(recoveryScope.old_run));
 return {run_id:receipt.run_id,source_commit:receipt.source_commit,status:receipt.status,
  execution_stopped:tagged.length===0,observed_at:Date.now(),evidence_sha256:hashText(raw)};
}
function checkRecoveryAuthority(task,stop,input){
 if(task?.id!==recoveryScope.task_id||task.project_id!==recoveryScope.project_id
   ||task.status!=='in_progress'||task.claimed_by!==recoveryActor
   ||task.payload?.repo!=='zenithjoy-workspace'||task.payload.base_sha!==recoveryScope.old_source_commit
   ||task.payload.comment_id!==recoveryScope.comment_id||task.payload.source_commit!==recoveryScope.old_source_commit
   ||task.payload.source_run_id!==`douyin_comment_scoring-${recoveryScope.old_run}__a1`
   ||task.payload.company_line!==recoveryScope.line||task.payload.change_kind!=='bugfix'
   ||task.payload.allow_direct_messages!==false)recoveryFail('AUTHORITY_INVALID');
 if(stop?.run_id!==`douyin_comment_scoring-${recoveryScope.old_run}__a1`
   ||stop.source_commit!==recoveryScope.old_source_commit||stop.status!=='completed'
   ||stop.execution_stopped!==true||!Number.isSafeInteger(stop.observed_at)
   ||Date.now()-stop.observed_at>5000||stop.observed_at>Date.now()+1000
   ||!/^[a-f0-9]{64}$/.test(stop.evidence_sha256||''))recoveryFail('OLD_RUN_UNKNOWN');
}
function checkRecoveryRow(row){
 const c=row?.judgment_config,r=c?.policy_reviews;
 if(row?.id!==recoveryScope.comment_id||row.line_key!==recoveryScope.line
   ||row.harvest_batch!==recoveryScope.source_run||row.source_video_url!==recoveryScope.video_url
   ||hashText(row.comment_body)!==recoveryScope.comment_sha256
   ||hashText(row.source_video)!==recoveryScope.video_sha256
   ||row.process_status!=='已排除'||row.relevance!==null||row.intent_grade!==null
   ||row.judgment_reason!=='policy_excluded:personal_intent_evidence_missing'
   ||c?.run_id!==recoveryScope.old_run||c.company_id!==recoveryScope.company_id
   ||c.tenant_id!==recoveryScope.tenant_id||Number(c.version)!==recoveryScope.version
   ||c.policy_id!==recoveryScope.policy_id||c.exclusion_reason!=='personal_intent_evidence_missing'
   ||c.exclusion_source?.comment_sha256!==recoveryScope.comment_sha256
   ||c.exclusion_source?.video_sha256!==recoveryScope.video_sha256
   ||c.exclusion_source?.video_url_sha256!==hashText(recoveryScope.video_url)
   ||c.exclusion_source?.harvest_batch!==recoveryScope.source_run
   ||!Array.isArray(r)||r.length!==2||r.some(v=>v?.status!=='unknown'
     ||v.reason!=='personal_intent_evidence_missing'||v.candidate_grade!=='A'
     ||!v.model||!v.response_id||!/^[a-f0-9]{64}$/.test(v.evidence_sha256||'')
     ||!/^[a-f0-9]{64}$/.test(v.original_sha256||''))
   ||r[0].response_id===r[1].response_id||r[0].evidence_sha256===r[1].evidence_sha256
   ||r[0].original_sha256!==r[1].original_sha256)recoveryFail('ROW_SCOPE_INVALID');
 return hashObject(c);
}
function checkRecoveryFrozen(rows,input){
 if(rows.length!==2||new Set(rows.map(r=>r.run_id)).size!==2)recoveryFail('POLICY_SCOPE_INVALID');
 const old=rows.find(r=>r.run_id===recoveryScope.old_run),next=rows.find(r=>r.run_id===input.run);
 for(const item of [old,next])if(!item||item.company_id!==recoveryScope.company_id
   ||item.tenant_id!==recoveryScope.tenant_id||Number(item.version)!==recoveryScope.version
   ||item.snapshot?.company_id!==recoveryScope.company_id
   ||item.snapshot.tenant_id!==recoveryScope.tenant_id||Number(item.snapshot.version)!==recoveryScope.version
   ||item.snapshot.policy_id!==recoveryScope.policy_id
   ||item.snapshot.runtime_config?.routing?.line_key!==recoveryScope.line)recoveryFail('POLICY_SCOPE_INVALID');
 if(old.source_run!==recoveryScope.source_run||next.source_run!==recoveryScope.source_run
   ||hashObject(old.snapshot.runtime_config.comment_scoring)!==hashObject(next.snapshot.runtime_config.comment_scoring))
   recoveryFail('POLICY_SCOPE_INVALID');
 return hashObject(next.snapshot.runtime_config.comment_scoring);
}
function checkRecoveryVideo(rows,row){
 if(rows.length!==1||rows[0].line_key!==recoveryScope.line||rows[0].video_id!=='7699344115351688872'
   ||rows[0].video_url!==recoveryScope.video_url
   ||rows[0].title!==row.source_video||rows[0].harvest_batch!==recoveryScope.source_run
   ||rows[0].process_status!=='评论已采'||rows[0].judgment_status!=='matched')recoveryFail('VIDEO_SCOPE_INVALID');
}
function recoveryDetail(input,priorHash,policyHash,stop){return {version:1,comment_id:recoveryScope.comment_id,
 source_run:recoveryScope.source_run,old_run:recoveryScope.old_run,new_run:input.run,
 task_id:recoveryScope.task_id,candidate_source_commit:input.candidate_source_commit,
 prior_audit_sha256:priorHash,policy_sha256:policyHash,stop_sha256:stop.evidence_sha256,
 allow_direct_messages:false};}
function checkRecoveryReceipt(rows,input,row){
 if(rows.length!==1||rows[0].id!==recoveryScope.task_id||rows[0].org_id!==recoveryScope.tenant_id
   ||rows[0].member_id!==recoveryActor||rows[0].action!==recoveryAction
   ||rows[0].detail?.version!==1||rows[0].detail.comment_id!==recoveryScope.comment_id
   ||rows[0].detail.task_id!==recoveryScope.task_id||rows[0].detail.old_run!==recoveryScope.old_run
   ||rows[0].detail.new_run!==input.run||rows[0].detail.allow_direct_messages!==false
   ||rows[0].detail.source_run!==recoveryScope.source_run
   ||rows[0].detail.candidate_source_commit!==input.candidate_source_commit
   ||!/^[a-f0-9]{64}$/.test(rows[0].detail.policy_sha256||'')
   ||!/^[a-f0-9]{64}$/.test(rows[0].detail.stop_sha256||'')
   ||row?.judgment_config?.recovery_prior?.run_id!==recoveryScope.old_run
   ||hashObject(row.judgment_config.recovery_prior)!==rows[0].detail.prior_audit_sha256)
   recoveryFail('RECEIPT_INVALID');
}
async function recoveryReadback(pool,input,sourceCommit){
 validateRecoveryInput(input,sourceCommit);
 const rows=(await pool.query('SELECT * FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND id=$2',
  [recoveryScope.line,recoveryScope.comment_id])).rows;
 const audits=(await pool.query('SELECT * FROM zenithjoy.db_audit WHERE id=$1',[recoveryScope.task_id])).rows;
 checkRecoveryReceipt(audits,input,rows[0]);
 const prior=rows[0]?.judgment_config?.recovery_prior;
 if(prior?.company_id!==recoveryScope.company_id||prior.tenant_id!==recoveryScope.tenant_id
   ||Number(prior.version)!==recoveryScope.version||prior.policy_id!==recoveryScope.policy_id
   ||prior.exclusion_reason!=='personal_intent_evidence_missing'
   ||prior.exclusion_source?.harvest_batch!==recoveryScope.source_run)
   recoveryFail('READBACK_INVALID');
 if(rows.length!==1||!['待分拣','已分拣'].includes(rows[0].process_status)
   ||rows[0].line_key!==recoveryScope.line||rows[0].harvest_batch!==recoveryScope.source_run
   ||hashText(rows[0].comment_body)!==recoveryScope.comment_sha256
   ||hashText(rows[0].source_video)!==recoveryScope.video_sha256)recoveryFail('READBACK_INVALID');
 const frozen=(await pool.query('SELECT * FROM zenithjoy.company_config_runs WHERE company_id=$1 AND run_id=ANY($2::text[])',
  [recoveryScope.company_id,[recoveryScope.old_run,input.run]])).rows;
 if(checkRecoveryFrozen(frozen,input)!==audits[0].detail.policy_sha256)recoveryFail('READBACK_INVALID');
 const videos=(await pool.query('SELECT * FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND video_url=$2',
  [recoveryScope.line,recoveryScope.video_url])).rows;checkRecoveryVideo(videos,rows[0]);
 const outbox=(await pool.query('SELECT comment_id FROM zenithjoy.leadgen_bridge_outbox WHERE line_key=$1 AND comment_id=$2 LIMIT 1',
  [recoveryScope.line,recoveryScope.comment_id])).rows;
 const leads=(await pool.query(`SELECT id FROM zenithjoy.leadgen_leads WHERE line_key=$1
   AND (nickname=$2 OR (douyin_id IS NOT NULL AND douyin_id=$3)
     OR (profile_url IS NOT NULL AND profile_url=$4)
     OR (comment_body=$5 AND source_video=$6)) LIMIT 1`,
  [recoveryScope.line,rows[0].nickname,rows[0].douyin_id,rows[0].profile_url,
   rows[0].comment_body,rows[0].source_video])).rows;
 if(outbox.length||leads.length)recoveryFail('DOWNSTREAM_PRESENT');
 return {verified:true,comment_id:recoveryScope.comment_id,source_run:recoveryScope.source_run,
  old_run:recoveryScope.old_run,new_run:input.run,prior_audit_sha256:audits[0].detail.prior_audit_sha256};
}
async function recoverFalseExclusion(pool,input,{sourceCommit,recovery={}}={}){
 validateRecoveryInput(input,sourceCommit);
 if(input.op==='recover_false_exclusion_102l_readback')return recoveryReadback(pool,input,sourceCommit);
 const authority=recovery.readTask||readRecoveryTask,inspect=recovery.inspectOldRun||inspectOldScoringRun;
 const task=await authority();const stop=await inspect();checkRecoveryAuthority(task,stop,input);
 const client=await pool.connect();let commitStarted=false,committed=false,discard=false;
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`leadgen-reopen:${recoveryScope.comment_id}`]);
  const rows=(await client.query('SELECT * FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND id=$2 FOR UPDATE',
   [recoveryScope.line,recoveryScope.comment_id])).rows;
  if(rows.length!==1)recoveryFail('ROW_SCOPE_INVALID');const row=rows[0];
  const audits=(await client.query(`SELECT * FROM zenithjoy.db_audit WHERE id=$1 OR
    (action=$2 AND detail->>'comment_id'=$3)`,[recoveryScope.task_id,recoveryAction,recoveryScope.comment_id])).rows;
  if(audits.length){checkRecoveryReceipt(audits,input,row);await client.query('ROLLBACK');
   return {status:'already_applied',comment_id:recoveryScope.comment_id};}
  const priorHash=checkRecoveryRow(row);
  const frozen=(await client.query('SELECT * FROM zenithjoy.company_config_runs WHERE company_id=$1 AND run_id=ANY($2::text[])',
   [recoveryScope.company_id,[recoveryScope.old_run,input.run]])).rows;
  const policyHash=checkRecoveryFrozen(frozen,input);
  const videos=(await client.query('SELECT * FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND video_url=$2 FOR SHARE',
   [recoveryScope.line,recoveryScope.video_url])).rows;checkRecoveryVideo(videos,row);
  const outbox=(await client.query('SELECT comment_id FROM zenithjoy.leadgen_bridge_outbox WHERE line_key=$1 AND comment_id=$2 LIMIT 1',
   [recoveryScope.line,recoveryScope.comment_id])).rows;
  const leads=(await client.query(`SELECT id FROM zenithjoy.leadgen_leads WHERE line_key=$1
    AND (nickname=$2 OR (douyin_id IS NOT NULL AND douyin_id=$3)
      OR (profile_url IS NOT NULL AND profile_url=$4)
      OR (comment_body=$5 AND source_video=$6)) LIMIT 1`,
   [recoveryScope.line,row.nickname,row.douyin_id,row.profile_url,row.comment_body,row.source_video])).rows;
  if(outbox.length||leads.length)recoveryFail('DOWNSTREAM_PRESENT');
  const latestTask=await authority(),latestStop=await inspect();checkRecoveryAuthority(latestTask,latestStop,input);
  const reopened={...row.judgment_config,recovery_prior:row.judgment_config,
   recovery_task_id:recoveryScope.task_id,recovery_run_id:input.run};
  const updated=await client.query(`UPDATE zenithjoy.leadgen_comments SET process_status='待分拣',
   relevance=NULL,intent_grade=NULL,judgment_reason=NULL,judgment_config=$3::jsonb,updated_at=now()
   WHERE line_key=$1 AND id=$2 AND process_status='已排除'`,
   [recoveryScope.line,recoveryScope.comment_id,JSON.stringify(reopened)]);
  if(updated.rowCount!==1)recoveryFail('WRITE_FAILED');
  const detail=recoveryDetail(input,priorHash,policyHash,latestStop);
  await client.query('INSERT INTO zenithjoy.db_audit(id,org_id,table_id,member_id,action,detail) VALUES($1,$2,NULL,$3,$4,$5::jsonb)',
   [recoveryScope.task_id,recoveryScope.tenant_id,recoveryActor,recoveryAction,JSON.stringify(detail)]);
  commitStarted=true;await client.query('COMMIT');committed=true;
  return {status:'applied',comment_id:recoveryScope.comment_id,source_run:recoveryScope.source_run};
 }catch(error){
  if(commitStarted&&!committed)recoveryFail('COMMIT_UNKNOWN_READBACK_REQUIRED');
  try{await client.query('ROLLBACK');}catch{discard=true;}
  throw error;
 }finally{client.release(discard||commitStarted&&!committed?true:undefined);}
}

async function scoreRecovery(pool,input,{lineKey,sourceRun,run,validSources}){
 const ids=input.ids;
 if(!sourceRun&&!validSources(ids,input.sources)||!Array.isArray(ids)||ids.length>1000
   ||new Set(ids).size!==ids.length||ids.some(id=>!uuid.test(id)))throw Error('POLICY_SCORE_RECOVERY_SCOPE_INVALID');
 if(!ids.length)return {ids:[],scored:0,excluded:0,excluded_ids:[],excluded_reasons:[],verified:true};
 const frozen=(await pool.query(`SELECT company_id,tenant_id,version,run_id,snapshot FROM zenithjoy.company_config_runs
   WHERE run_id=$1 AND snapshot->'runtime_config'->'routing'->>'line_key'=$2`,[run,lineKey])).rows;
 if(frozen.length!==1||frozen[0].run_id!==run||!frozen[0].snapshot
   ||frozen[0].snapshot.company_id!==frozen[0].company_id||frozen[0].snapshot.tenant_id!==frozen[0].tenant_id
   ||Number(frozen[0].snapshot.version)!==Number(frozen[0].version))throw Error('POLICY_SCORE_RECOVERY_AMBIGUOUS');
 const snapshot=frozen[0].snapshot;
 const rows=(await pool.query(`SELECT id,harvest_batch,line_key,process_status,relevance,intent_grade,
   comment_body,source_video,source_video_url,judgment_config FROM zenithjoy.leadgen_comments
   WHERE line_key=$1 AND ($2::text IS NULL OR harvest_batch=$2) AND id=ANY($3::uuid[])`,[lineKey,sourceRun,ids])).rows;
 if(rows.length!==ids.length||new Set(rows.map(r=>r.id)).size!==ids.length)throw Error('POLICY_SCORE_RECOVERY_AMBIGUOUS');
 const committed=[],excluded=[],excludedReasons=[];
 for(const row of rows){
  if(row.line_key!==lineKey||!ids.includes(row.id)||row.harvest_batch!==(sourceRun||input.sources[row.id]))throw Error('POLICY_SCORE_RECOVERY_AMBIGUOUS');
  const c=row.judgment_config;
  if(c?.run_id!==run)continue;
  if(c.exclusion_reason){
   const reviews=c.policy_reviews;
   if(c.company_id!==snapshot.company_id||c.tenant_id!==snapshot.tenant_id||c.policy_id!==snapshot.policy_id
     ||Number(c.version)!==Number(snapshot.version)||row.process_status!=='已排除'
     ||row.relevance!==null||row.intent_grade!==null
     ||c.exclusion_source?.comment_sha256!==hashText(row.comment_body)
     ||c.exclusion_source?.video_sha256!==hashText(row.source_video)
     ||c.exclusion_source?.video_url_sha256!==hashText(row.source_video_url)
     ||c.exclusion_source?.harvest_batch!==row.harvest_batch
     ||!['personal_intent_evidence_missing','audience_or_topic_evidence_missing'].includes(c.exclusion_reason)
     ||!Array.isArray(reviews)||reviews.length!==2
     ||reviews.some(v=>v?.status!=='unknown'||v.reason!==c.exclusion_reason||!v.model||!v.response_id
       ||!v.evidence_sha256||!v.original_sha256||!['A','B','C'].includes(v.candidate_grade))
     ||reviews[0].candidate_grade!==reviews[1].candidate_grade
     ||reviews[0].response_id===reviews[1].response_id
     ||reviews[0].evidence_sha256===reviews[1].evidence_sha256
     ||reviews[0].original_sha256!==reviews[1].original_sha256)throw Error('POLICY_SCORE_RECOVERY_AMBIGUOUS');
   excluded.push(row.id);excludedReasons.push({id:row.id,reason:c.exclusion_reason});continue;
  }
  if(c.company_id!==snapshot.company_id||c.tenant_id!==snapshot.tenant_id||c.policy_id!==snapshot.policy_id||Number(c.version)!==Number(snapshot.version)
    ||!c.policy_audit||c.policy_audit.status!=='pass'||!c.policy_audit.response_id
    ||!c.model_audit?.response_id||!c.model_audit?.model
    ||!['相关','不相关'].includes(row.relevance)||row.relevance==='相关'&&!['A','B','C'].includes(row.intent_grade))throw Error('POLICY_SCORE_RECOVERY_AMBIGUOUS');
  committed.push(row.id);
 }
 return {ids:committed,scored:committed.length,excluded:excluded.length,excluded_ids:excluded,
   excluded_reasons:excludedReasons,verified:true};
}

async function exclusionReadback(pool,input,context){
 const ids=input.ids;
 if(!Array.isArray(ids)||ids.length>50||ids.some(id=>!uuid.test(id))||new Set(ids).size!==ids.length)
   throw Error('POLICY_SCORE_EXCLUSION_IDS_INVALID');
 const recovery=await scoreRecovery(pool,input,context);
 const outbox=ids.length?(await pool.query(`SELECT comment_id FROM zenithjoy.leadgen_bridge_outbox
   WHERE line_key=$1 AND comment_id=ANY($2::uuid[])`,[context.lineKey,ids])).rows:[];
 const failures=ids.filter(id=>!recovery.excluded_ids.includes(id)).length+outbox.length;
 return {verified:failures===0,failures,ids,excluded_reasons:recovery.excluded_reasons};
}

async function commitExclusion(client,{row,verdict,semantic,evidence,lineKey,nextCursor}){
 const safeReviews=semantic.reviews.map(v=>({status:'unknown',reason:v.reason,candidate_grade:v.candidate_grade,
   model:v.model,response_id:v.response_id,evidence_sha256:v.evidence_sha256,original_sha256:v.original_sha256}));
 const audit={...evidence,...(row.judgment_config?.recovery_prior?{recovery_prior:row.judgment_config.recovery_prior}:{}),
   model_audit:{model:verdict.audit.model,response_id:verdict.audit.response_id},
   exclusion_reason:semantic.reason,policy_reviews:safeReviews,
   exclusion_source:{harvest_batch:row.harvest_batch,comment_sha256:hashText(row.comment_body),
     video_sha256:hashText(row.source_video),video_url_sha256:hashText(row.source_video_url)}};
 const outbox=(await client.query(`SELECT comment_id FROM zenithjoy.leadgen_bridge_outbox
   WHERE line_key=$1 AND comment_id=$2 LIMIT 1`,[lineKey,row.id])).rows;
 if(outbox.length)throw Error('POLICY_SCORE_EXCLUSION_OUTBOX_EXISTS');
 const updated=await client.query(`UPDATE zenithjoy.leadgen_comments SET process_status='已排除',
   relevance=NULL,intent_grade=NULL,judgment_reason=$2,judgment_config=$3::jsonb,updated_at=now()
   WHERE id=$1 AND line_key=$4 AND process_status='待分拣'`,
 [row.id,`policy_excluded:${semantic.reason}`,JSON.stringify(audit),lineKey]);
 if(updated.rowCount!==1)throw Error('POLICY_SCORE_EXCLUSION_WRITE_FAILED');
 return {id:row.id,cursor:nextCursor,excluded:true,reason:semantic.reason};
}

module.exports={scoreRecovery,exclusionReadback,commitExclusion,recoverFalseExclusion,recoveryScope};
