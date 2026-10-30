import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {policy,sourceRun} from './fixtures/leadgen-103-v14.mjs';

const require=createRequire(import.meta.url);
const {queueRequest,reviewBoundComment}=require('../leadgen-queue.js');
const run='double_policy_test';
const id='00000000-0000-4000-8000-000000000301';
const title='FDE证书刚出第二张';
const comment='FDE到底有几张证，哪张才是能查的';

function fixture(secondPass){
 const row={id,line_key:'jinuo',harvest_batch:sourceRun,comment_body:comment,source_video:title,
  source_video_url:'https://www.douyin.com/video/7617837149999841201',process_status:'待分拣',
  relevance:null,intent_grade:null,collected_at:new Date('2026-10-20T00:00:00Z')};
 const committed={...row},writes=[];let pending=null,policyCalls=0,scoreCalls=0;
 const client={release(){},async query(sql,args=[]){
  if(sql==='BEGIN'){pending=[];return {rows:[]};}
  if(sql==='COMMIT'){for(const write of pending)write();pending=null;return {rows:[]};}
  if(sql==='ROLLBACK'){pending=null;return {rows:[]};}
  if(sql.includes('SELECT * FROM zenithjoy.leadgen_comments')&&sql.includes('FOR UPDATE'))
   return {rows:(args[2]||[]).includes(id)||committed.relevance!==null?[]:[{...committed}]};
  if(sql.includes('FROM zenithjoy.leadgen_videos'))return {rows:[{video_id:'7617837149999841201',
   video_url:row.source_video_url,title,judgment_status:'matched'}]};
  if(sql.includes('UPDATE zenithjoy.leadgen_comments')){writes.push(args);
   pending.push(()=>Object.assign(committed,{relevance:args[1],intent_grade:args[2],
    judgment_reason:args[3],judgment_config:JSON.parse(args[4])}));return {rows:[],rowCount:1};}
  throw Error(`unexpected SQL ${sql}`);
 }};
 const deps={freezeCompanyConfig:async()=>policy,
  judgeComment:async()=>{scoreCalls++;return {relevance:'相关',grade:'A',reason:'直接询问证书',
   audit:{model:'scoring-model',response_id:'score-response'}};},
  judgePolicy:async()=>{policyCalls++;return {grade:'A',audit:{model:'policy-model',
   response_id:`policy-response-${policyCalls}`,policy_evidence:{audience_id:'recvvcNzUv5rzl',
    matched_rule:'考证视频',comment_signal:policyCalls===2&&!secondPass?'FDE证书':comment,
    video_signal:'FDE证书',exclusion_rule:null,reason:'按冻结政策核实直接提问'}}};}};
 return {pool:{connect:async()=>client},deps,committed,writes,
  counts:()=>({policyCalls,scoreCalls})};
}

test('同一评论首审通过、独立二审缺个人意向证据时整笔评分回滚',async()=>{
 const f=fixture(false);
 const result=await queueRequest(f.pool,{op:'score',line:'jinuo',run,source_run:sourceRun,limit:1},f.deps);
 assert.deepEqual(f.counts(),{policyCalls:2,scoreCalls:1});
 assert.equal(result.scored,0);
 assert.deepEqual(result.blocked_reasons,[{id,code:'POLICY_SCORE_NOT_VERIFIED',
  policy_review_reason:'personal_intent_evidence_missing'}]);
 assert.equal(f.committed.relevance,null);
 assert.equal(f.committed.intent_grade,null);
 assert.equal(f.committed.judgment_config,undefined);
 assert.equal(f.writes.length,0);
});

test('两份独立政策模型证据均通过才持久评分与两份可重验身份',async()=>{
 const f=fixture(true);
 const result=await queueRequest(f.pool,{op:'score',line:'jinuo',run,source_run:sourceRun,limit:1},f.deps);
 assert.deepEqual(f.counts(),{policyCalls:2,scoreCalls:1});
 assert.equal(result.scored,1);
 assert.equal(f.committed.relevance,'相关');
 assert.equal(f.committed.intent_grade,'A');
 assert.equal(f.writes.length,1);
 assert.equal(f.committed.judgment_config.policy_reviews.length,2);
 assert.deepEqual(f.committed.judgment_config.policy_reviews.map(v=>v.response_id),
  ['policy-response-1','policy-response-2']);
 assert.equal(f.committed.judgment_config.policy_reviews.every(v=>v.status==='pass'),true);
});

const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function storedPolicyRow(){
 const config={run_id:run,company_id:policy.company_id,tenant_id:policy.tenant_id,
  version:policy.version,policy_id:policy.policy_id};
 const proof={audience_id:'recvvcNzUv5rzl',matched_rule:'考证视频',comment_signal:comment,
  video_signal:'FDE证书',exclusion_rule:null,reason:'按冻结政策核实直接提问'};
 const original=sha({relevance:'相关',intent_grade:'A',judgment_reason:'直接询问证书',judgment_config:config});
 const reviews=[1,2].map(n=>({id,status:'pass',reason:'policy_match',grade:'A',
  model:'policy-model',response_id:`policy-response-${n}`,policy_evidence:{...proof},
  evidence_sha256:sha({model:'policy-model',response_id:`policy-response-${n}`,proof}),
  original_sha256:original}));
 const row={id,line_key:'jinuo',harvest_batch:sourceRun,comment_body:comment,source_video:title,
  source_video_url:'https://www.douyin.com/video/7617837149999841201',process_status:'待分拣',
  relevance:'相关',intent_grade:'A',judgment_reason:'直接询问证书',
  judgment_config:{...config,model_audit:{model:'scoring-model',response_id:'score-response'},
   policy_audit:reviews[0],policy_reviews:reviews}};
 const pool={async query(sql){
  if(sql.includes('FROM zenithjoy.company_config_runs'))return {rows:[{snapshot:policy,
   company_id:policy.company_id,tenant_id:policy.tenant_id,version:policy.version,run_id:run}]};
  if(sql.includes('FROM zenithjoy.leadgen_comments'))return {rows:[row]};
  if(sql.includes('FROM zenithjoy.leadgen_videos'))return {rows:[{video_url:row.source_video_url,
   title,line_key:'jinuo',judgment_status:'matched'}]};
  throw Error('unexpected SQL '+sql);
 }};
 return {row,pool};
}

test('评分后及mark_leads独立重验原文、冻结v14和双身份，不产生第三次政策模型调用',async()=>{
 const f=storedPolicyRow();let modelCalls=0;
 const judgePolicy=async()=>{modelCalls++;throw Error('third model call forbidden');};
 const input={op:'policy_review',line:'jinuo',run,claim:run,source_run:sourceRun,ids:[id]};
 const scoringReview=await queueRequest(f.pool,input,{judgePolicy});
 assert.equal(scoringReview.verified,true);
 const markReview=await reviewBoundComment(f.pool,'jinuo',id,{run,source_run:sourceRun,
  source_video:title,source_video_url:f.row.source_video_url},{judgePolicy});
 assert.equal(markReview.status,'pass');
 assert.equal(modelCalls,0);
 f.row.judgment_config.policy_reviews[1].policy_evidence.comment_signal='FDE证书';
 const tampered=await reviewBoundComment(f.pool,'jinuo',id,{run,source_run:sourceRun,
  source_video:title,source_video_url:f.row.source_video_url},{judgePolicy});
 assert.equal(tampered.status,'unknown');
 assert.equal(modelCalls,0);
});
