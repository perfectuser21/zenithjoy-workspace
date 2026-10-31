import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {policy} from './fixtures/leadgen-103-v14.mjs';

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
const URL='https://www.douyin.com/video/7699344115351688872';
const hash=value=>createHash('sha256').update(value).digest('hex');
const request={op:'recover_false_exclusion_102l',line:'jinuo',run:NEW,source_run:SOURCE,
 comment_id:ID,old_run:OLD,maintenance_task_id:TASK,candidate_source_commit:CANDIDATE};

function rig({authorized=true,outbox=false,lead=false,source=SOURCE}={}){
 const prior={run_id:OLD,company_id:policy.company_id,tenant_id:policy.tenant_id,
  version:14,policy_id:policy.policy_id,exclusion_reason:'personal_intent_evidence_missing',
  exclusion_source:{harvest_batch:SOURCE,comment_sha256:hash(COMMENT),video_sha256:hash(TITLE),video_url_sha256:hash(URL)},
  policy_reviews:[1,2].map(n=>({status:'unknown',reason:'personal_intent_evidence_missing',
   candidate_grade:'A',model:'google/gemini-2.5-flash',response_id:`response-${n}`,
   evidence_sha256:hash(`evidence-${n}`),original_sha256:hash('original')}))};
 const row={id:ID,line_key:'jinuo',harvest_batch:source,source_video:TITLE,source_video_url:URL,
  comment_body:COMMENT,nickname:'fixture-nickname',process_status:'已排除',relevance:null,intent_grade:null,
  judgment_reason:'policy_excluded:personal_intent_evidence_missing',judgment_config:prior};
 const audit=[],writes=[];let pending=[];
 const query=async(sql,args=[])=>{
  if(sql==='BEGIN'){pending=[];return {rows:[]};}
  if(sql==='COMMIT'){for(const f of pending)f();pending=[];return {rows:[]};}
  if(sql==='ROLLBACK'){pending=[];return {rows:[]};}
  if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
  if(sql.includes('FROM zenithjoy.leadgen_comments'))return {rows:[{...row}]};
  if(sql.includes('FROM zenithjoy.company_config_runs'))return {rows:[{company_id:policy.company_id,
   tenant_id:policy.tenant_id,version:14,run_id:args.includes(OLD)?OLD:NEW,
   source_run:SOURCE,snapshot:policy}]};
  if(sql.includes('FROM zenithjoy.leadgen_videos'))return {rows:[{line_key:'jinuo',video_id:'7699344115351688872',
   video_url:URL,title:TITLE,harvest_batch:SOURCE,process_status:'评论已采',judgment_status:'matched'}]};
  if(sql.includes('FROM zenithjoy.leadgen_bridge_outbox'))return {rows:outbox?[{comment_id:ID}]:[]};
  if(sql.includes('FROM zenithjoy.leadgen_leads'))return {rows:lead?[{id:'lead-already-exists'}]:[]};
  if(sql.includes('FROM zenithjoy.db_audit'))return {rows:audit};
  if(sql.includes('INSERT INTO zenithjoy.db_audit')){pending.push(()=>audit.push({detail:JSON.parse(args.at(-1))}));return {rows:[],rowCount:1};}
  if(sql.includes('UPDATE zenithjoy.leadgen_comments')){pending.push(()=>{
   row.process_status='待分拣';row.relevance=null;row.intent_grade=null;writes.push(sql);
   const config=args.find(a=>typeof a==='string'&&a.startsWith('{'));
   if(config)row.judgment_config=JSON.parse(config);
  });return {rows:[],rowCount:1};}
  throw Error('unexpected SQL: '+sql);
 };
 const deps={sourceCommit:CANDIDATE,recovery103l:{
  readTask:async()=>({id:TASK,project_id:PROJECT,status:authorized?'in_progress':'queued',claimed_by:'interactive-dev-skill'}),
  inspectOldRun:async()=>({run_id:`douyin_comment_scoring-${OLD}__a1`,source_commit:BASE,
   status:'completed',execution_stopped:true,observed_at:Date.now()})}};
 return {pool:{connect:async()=>({query,release(){}}),query},deps,row,audit,writes,prior};
}

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
  [{}, {source:'wrong-source'}],
 ]){
  const f=rig(rigOpts);
  await assert.rejects(queueRequest(f.pool,{...request,...change},f.deps),/FALSE_EXCLUSION_/);
  assert.equal(f.row.process_status,'已排除');assert.equal(f.audit.length,0);assert.equal(f.writes.length,0);
 }
});
