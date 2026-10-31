import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {policy} from './fixtures/leadgen-103-v14.mjs';
import {createScoringHandler} from '../leadgen-scoring-handler.mjs';

const require=createRequire(import.meta.url);
const {queueRequest}=require('../leadgen-queue.js');
const ID='f5e16a6d-9183-4606-b840-9698bd710eed';
const SOURCE='accept6cc22_jinuo102l_20261031T0047';
const OLD='acceptd052_103l_20261031t1423';
const NEW='accept103lrepair_20261031t2233';
const TASK='70a56d85-3b88-451b-a683-7112284eca6d';
const PROJECT='68ca6b4f-5e53-4ccf-a2aa-874e5c32bbe6';
const BASE='d052dedd5cdd49f331c1354cfdb359ce66503151';
const CANDIDATE='a'.repeat(40);
const TITLE='想入行AI的注意了！人工智能训练工程师，20天就能拿下，报考流程一条给你说清楚。#人工智能训练工程师 #AI行业 #考证 #人工智能';
const COMMENT='怎么找机构，可以发一下流程吗？ 首评';
const VIDEO_URL='https://www.douyin.com/video/7699344115351688872';
const hash=value=>createHash('sha256').update(value).digest('hex');
const request={op:'recover_false_exclusion_102l',line:'jinuo',run:NEW,source_run:SOURCE,
 comment_id:ID,old_run:OLD,maintenance_task_id:TASK,candidate_source_commit:CANDIDATE};

function rig({authorized=true,outbox=false,lead=false,leadIdentityOnly=false,source=SOURCE,failAt=null}={}){
 const prior={run_id:OLD,company_id:policy.company_id,tenant_id:policy.tenant_id,
  version:14,policy_id:policy.policy_id,exclusion_reason:'personal_intent_evidence_missing',
  exclusion_source:{harvest_batch:SOURCE,comment_sha256:hash(COMMENT),video_sha256:hash(TITLE),video_url_sha256:hash(VIDEO_URL)},
  policy_reviews:[1,2].map(n=>({status:'unknown',reason:'personal_intent_evidence_missing',
   candidate_grade:'A',model:'google/gemini-2.5-flash',response_id:`response-${n}`,
   evidence_sha256:hash(`evidence-${n}`),original_sha256:hash('original')}))};
 const row={id:ID,line_key:'jinuo',harvest_batch:source,source_video:TITLE,source_video_url:VIDEO_URL,
  comment_body:COMMENT,nickname:'fixture-nickname',douyin_id:'fixture-douyin',profile_url:'https://douyin.example/fixture',
  process_status:'已排除',relevance:null,intent_grade:null,
  judgment_reason:'policy_excluded:personal_intent_evidence_missing',judgment_config:prior};
 const audit=[],writes=[];let pending=[];
 const query=async(sql,args=[])=>{
  if(failAt==='update'&&sql.includes('UPDATE zenithjoy.leadgen_comments'))throw Error('password=fixture-secret');
  if(failAt==='audit'&&sql.includes('INSERT INTO zenithjoy.db_audit'))throw Error('password=fixture-secret');
  if(failAt==='commit'&&sql==='COMMIT')throw Error('password=fixture-secret');
  if(sql==='BEGIN'){pending=[];return {rows:[]};}
  if(sql==='COMMIT'){for(const f of pending)f();pending=[];return {rows:[]};}
  if(sql==='ROLLBACK'){pending=[];return {rows:[]};}
  if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
  if(sql.includes('FROM zenithjoy.leadgen_comments'))return {rows:[{...row}]};
  if(sql.includes('FROM zenithjoy.company_config_runs'))return {rows:[OLD,NEW].map(run_id=>({company_id:policy.company_id,
   tenant_id:policy.tenant_id,version:14,run_id,source_run:SOURCE,snapshot:policy}))};
  if(sql.includes('FROM zenithjoy.leadgen_videos'))return {rows:[{line_key:'jinuo',video_id:'7699344115351688872',
   video_url:VIDEO_URL,title:TITLE,harvest_batch:SOURCE,process_status:'评论已采',judgment_status:'matched'}]};
  if(sql.includes('FROM zenithjoy.leadgen_bridge_outbox'))return {rows:outbox?[{comment_id:ID}]:[]};
  if(sql.includes('FROM zenithjoy.leadgen_leads'))return {rows:lead||leadIdentityOnly
   &&sql.includes('douyin_id')&&sql.includes('profile_url')&&args.includes(row.douyin_id)
    ?[{id:'lead-already-exists'}]:[]};
  if(sql.includes('FROM zenithjoy.db_audit'))return {rows:audit};
  if(sql.includes('INSERT INTO zenithjoy.db_audit')){pending.push(()=>audit.push({id:args[0],org_id:args[1],
   member_id:args[2],action:args[3],detail:JSON.parse(args[4])}));return {rows:[],rowCount:1};}
  if(sql.includes('UPDATE zenithjoy.leadgen_comments')){pending.push(()=>{
   row.process_status='待分拣';row.relevance=null;row.intent_grade=null;writes.push(sql);
   const config=args.find(a=>typeof a==='string'&&a.startsWith('{'));
   if(config)row.judgment_config=JSON.parse(config);
  });return {rows:[],rowCount:1};}
  throw Error('unexpected SQL: '+sql);
 };
 const deps={sourceCommit:CANDIDATE,recovery103l:{
  readTask:async()=>({id:TASK,project_id:PROJECT,status:authorized?'in_progress':'queued',
   claimed_by:'codex:103-false-exclusion-fix',payload:{repo:'zenithjoy-workspace',base_sha:BASE,
    source_commit:BASE,source_run_id:`douyin_comment_scoring-${OLD}__a1`,company_line:'jinuo',
    change_kind:'bugfix',comment_id:ID,allow_direct_messages:false}}),
  inspectOldRun:async()=>({run_id:`douyin_comment_scoring-${OLD}__a1`,source_commit:BASE,
   status:'completed',execution_stopped:true,observed_at:Date.now(),evidence_sha256:hash('completed')})}};
 return {pool:{connect:async()=>({query,release(){}}),query},deps,row,audit,writes,prior};
}

test('103 恢复写入阶段失败只给固定安全阶段码，事务不产生假成功',async()=>{
 for(const [failAt,code] of [['update','FALSE_EXCLUSION_UPDATE_FAILED'],
   ['audit','FALSE_EXCLUSION_AUDIT_WRITE_FAILED'],
   ['commit','FALSE_EXCLUSION_COMMIT_UNKNOWN_READBACK_REQUIRED']]){
  const f=rig({failAt});
  await assert.rejects(queueRequest(f.pool,request,f.deps),error=>error.message===code);
  assert.equal(f.audit.length,0);
  assert.equal(f.writes.length,0);
  assert.equal(f.row.process_status,'已排除');
 }
});

test('102l仅精确授权单条可原子重开，旧双审审计留在恢复链且读回可验',async()=>{
 const f=rig();const result=await queueRequest(f.pool,request,f.deps);
 assert.equal(result.status,'applied');assert.equal(result.comment_id,ID);
 assert.equal(f.row.process_status,'待分拣');assert.equal(f.row.relevance,null);
 assert.equal(f.audit.length,1);assert.equal(f.writes.length,1);
 assert.equal(f.row.judgment_config.recovery_prior.policy_reviews.length,2);
 const readback=await queueRequest(f.pool,{...request,op:'recover_false_exclusion_102l_readback'},f.deps);
 assert.equal(readback.verified,true);
 const again=await queueRequest(f.pool,request,f.deps);
 assert.equal(again.status,'already_applied');assert.equal(f.audit.length,1);assert.equal(f.writes.length,1);
});

test('102l恢复拒绝来源不匹配、无任务授权及已有线索或outbox',async()=>{
 for(const [change,rigOpts] of [
  [{source_run:'wrong-source'},{}],
  [{}, {authorized:false}],
  [{}, {outbox:true}],
  [{}, {lead:true}],
  [{}, {leadIdentityOnly:true}],
  [{}, {source:'wrong-source'}],
 ]){
  const f=rig(rigOpts);
  await assert.rejects(queueRequest(f.pool,{...request,...change},f.deps),/FALSE_EXCLUSION_/);
  assert.equal(f.row.process_status,'已排除');assert.equal(f.audit.length,0);assert.equal(f.writes.length,0);
 }
});

test('103正式handler先受控重开并独立读回，然后只评分该CID一次',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'leadgen-103l-recovery-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const calls=[];
 const queue=async(op,fields={})=>{calls.push({op,fields});
  if(op==='company_config')return policy;
  if(op==='recover_false_exclusion_102l')return {status:'applied',comment_id:ID};
  if(op==='recover_false_exclusion_102l_readback')return {verified:true,comment_id:ID,new_run:NEW};
  if(op==='score_recovery')return {verified:true,scored:0,ids:[],excluded_ids:[]};
  if(op==='score'){assert.deepEqual(fields.ids,[ID]);assert.equal(fields.budget_max,1);
   return {scored:1,ids:[ID],excluded:0,excluded_ids:[],blocked_ids:[]};}
  if(op==='score_readback')return {verified:true,failures:0,ids:[ID]};
  if(op==='policy_review')return {verified:true,rows:[{id:ID,status:'pass'}]};
  assert.fail('不应调 '+op);
 };
 const env={LEADGEN_SOURCE_RUN:SOURCE,LEADGEN_LIMIT:'1',LEADGEN_SEND:'0',
  LEADGEN_103L_RECOVERY_ID:ID,LEADGEN_103L_RECOVERY_TASK_ID:TASK,WFR_RUN_DIR:dir};
 const result=await createScoringHandler({env,run:NEW,line:'jinuo',state:{source_commit:CANDIDATE},queue})();
 assert.equal(result.scored,1);
 assert.deepEqual(calls.map(c=>c.op).slice(0,3),['company_config','recover_false_exclusion_102l',
  'recover_false_exclusion_102l_readback']);
 assert.equal(calls.some(c=>c.op==='score_scope'),false);
});

test('真实PG scratch：单条重开与审计同事务提交，独立读回原来源与双审',
 {skip:process.env.ZJ_METRICS_PG_REQUIRED!=='1'},async()=>{
  const {Pool}=require('pg'),pool=new Pool(),admin=await pool.connect();
  const schema=`leadgen_103l_${randomUUID().replaceAll('-','')}`;let created=false;
  try{
   assert.match((await admin.query('SELECT current_database() AS db')).rows[0].db,/scratch$/);
   await admin.query(`CREATE SCHEMA ${schema}`);created=true;
   const base=readFileSync(new URL('../../../apps/api/db/migrations/20260922_220000_leadgen_ssot_tables.sql',import.meta.url),'utf8');
   for(const table of ['leadgen_videos','leadgen_comments']){
    const ddl=base.match(new RegExp(`CREATE TABLE IF NOT EXISTS zenithjoy\\.${table} \\([\\s\\S]+?\\n\\);`))[0];
    await admin.query(ddl.replaceAll('zenithjoy.',`${schema}.`));
   }
   await admin.query(`ALTER TABLE ${schema}.leadgen_comments ADD COLUMN judgment_config jsonb`);
   const migration=readFileSync(new URL('../../../apps/api/db/migrations/20261031_180000_leadgen_comment_policy_exclusion.sql',import.meta.url),'utf8');
   await admin.query(migration.replaceAll('zenithjoy.',`${schema}.`));
   const auditSql=readFileSync(new URL('../../../apps/api/db/migrations/20260820_120000_structured_workbench.sql',import.meta.url),'utf8')
    .match(/CREATE TABLE IF NOT EXISTS zenithjoy\.db_audit \([\s\S]+?\n\);/)[0];
   await admin.query(auditSql.replaceAll('zenithjoy.',`${schema}.`));
   await admin.query(`CREATE TABLE ${schema}.leadgen_bridge_outbox(comment_id uuid,line_key text)`);
   await admin.query(`CREATE TABLE ${schema}.leadgen_leads(id uuid,line_key text,nickname text,
     douyin_id text,profile_url text,comment_body text,source_video text)`);
   await admin.query(`CREATE TABLE ${schema}.company_config_runs(company_id uuid,tenant_id uuid,version int,
     run_id text,source_run text,snapshot jsonb)`);
   await admin.query(`INSERT INTO ${schema}.leadgen_videos(line_key,video_id,video_url,title,harvest_batch,process_status,judgment_status)
     VALUES('jinuo','7699344115351688872',$1,$2,$3,'评论已采','matched')`,[VIDEO_URL,TITLE,SOURCE]);
   const f=rig();
   await admin.query(`INSERT INTO ${schema}.leadgen_comments(id,line_key,dedup_key,harvest_batch,
     source_video,source_video_url,comment_body,nickname,process_status,judgment_reason,judgment_config)
     VALUES($1,'jinuo','103l-false-exclusion',$2,$3,$4,$5,'fixture-nickname','已排除',
     'policy_excluded:personal_intent_evidence_missing',$6::jsonb)`,
     [ID,SOURCE,TITLE,VIDEO_URL,COMMENT,JSON.stringify(f.prior)]);
   for(const run_id of [OLD,NEW])await admin.query(`INSERT INTO ${schema}.company_config_runs
     VALUES($1,$2,14,$3,$4,$5::jsonb)`,[policy.company_id,policy.tenant_id,run_id,SOURCE,JSON.stringify(policy)]);
   const rewrite=sql=>sql.replaceAll('zenithjoy.',`${schema}.`);
   const scoped={query:(sql,args)=>pool.query(rewrite(sql),args),connect:async()=>{
    const client=await pool.connect();return {query:(sql,args)=>client.query(rewrite(sql),args),release:x=>client.release(x)};
   }};
   const applied=await queueRequest(scoped,request,f.deps);assert.equal(applied.status,'applied');
   const readback=await queueRequest(scoped,{...request,op:'recover_false_exclusion_102l_readback'},f.deps);
   assert.equal(readback.verified,true);
   let reviews=0;
   const judged=await queueRequest(scoped,{op:'score',line:'jinuo',run:NEW,source_run:SOURCE,
    ids:[ID],budget_max:1,limit:1},{freezeCompanyConfig:async()=>policy,
    judgeComment:async()=>({relevance:'相关',grade:'A',reason:'求流程',
     audit:{model:'score-model',response_id:'score-recovery'}}),
    judgePolicy:async()=>({grade:'A',audit:{model:'policy-model',response_id:`review-${++reviews}`,
     policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:'求资料',comment_signal:'找机构',
      video_signal:'人工智能训练工程师',exclusion_rule:null,reason:'请求报考流程'}}})});
   assert.equal(judged.scored,1);assert.equal(judged.excluded,0);assert.equal(reviews,2);
   const policyReadback=await queueRequest(scoped,{op:'policy_review',line:'jinuo',run:NEW,
    claim:NEW,source_run:SOURCE,ids:[ID]},{});
   assert.equal(policyReadback.verified,true);
   const row=(await scoped.query('SELECT process_status,relevance,intent_grade,judgment_config FROM zenithjoy.leadgen_comments WHERE id=$1',[ID])).rows[0];
   assert.deepEqual([row.process_status,row.relevance,row.intent_grade],['待分拣','相关','A']);
   assert.equal(row.judgment_config.recovery_prior.policy_reviews.length,2);
   const receipt=(await scoped.query('SELECT id,org_id,action,detail FROM zenithjoy.db_audit WHERE id=$1',[TASK])).rows;
   assert.equal(receipt.length,1);assert.equal(receipt[0].detail.comment_id,ID);
  }finally{if(created)await admin.query(`DROP SCHEMA ${schema} CASCADE`);admin.release();await pool.end();}
 });
