import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {queueRequest}=require('../leadgen-queue.js');

const SOURCE='accept5dfb_jinuo102d_20261101t0354';
const UPSTREAM='accept5dfb_jinuo101d_20261101t0334';
const OLD_SHA='5dfb33dd8ddd11f4063598989e891eec8685fbe3';
const NEW_SHA='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const videoId='7700992800439717605';
const videoUrl=`https://www.douyin.com/video/${videoId}`;
const ids=Array.from({length:5},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
function fixture(changes={}){
 const snapshot={company_id:'company',tenant_id:'tenant',version:14,policy_id:'policy',runtime_config:{routing:{line_key:'jinuo'}}};
 const video={video_id:videoId,video_url:videoUrl,title:'AI考证',line_key:'jinuo',harvest_batch:SOURCE,
  process_status:'待判定',judgment_status:'matched',judgment_config:{company_id:'company',tenant_id:'tenant',version:14,policy_id:'policy',run_id:SOURCE}};
 const comments=ids.map((id,i)=>({id,line_key:'jinuo',harvest_batch:SOURCE,source_video_url:videoUrl,source_video:video.title,
  process_status:'待分拣',relevance:null,intent_grade:null,douyin_id:`uid${i}`,nickname:`person${i}`,comment_body:'想考证',recipient_evidence:{scope:{run:SOURCE,source_run:UPSTREAM,video_id:videoId,video_url:videoUrl}}}));
 const proof={run_id:`douyin_video_processing-${SOURCE}__a1`,source_commit:OLD_SHA,source_run:UPSTREAM,
  binding_id:'92049edd-0cc7-46e3-bba3-5450aa1400ff',identity_bound:true,
  business_outcome:'pass',evidence_status:'verified',gaps:[],span_count:31,expected_count:31,
  collection_outcome:'pass',collection_verified:true,sampling_input:{workflow_key:'douyin_video_processing',run_tag:SOURCE,source_run:UPSTREAM,comment_limit:5,line:'jinuo'}};
 Object.assign(video,changes.video);Object.assign(proof,changes.proof);if(changes.comments)changes.comments(comments);
 const pool={async query(sql,args){
  if(sql.includes('FROM zenithjoy.company_config_runs'))return {rows:[{company_id:'company',tenant_id:'tenant',version:14,run_id:args[0],source_run:args[0]===SOURCE?UPSTREAM:SOURCE,snapshot}]};
  if(sql.includes('FROM zenithjoy.leadgen_comments'))return {rows:sql.includes("v.process_status='评论已采'")?[]:comments};
  if(sql.includes('FROM zenithjoy.leadgen_videos'))return {rows:sql.includes("process_status='评论已采'")?[]:[video]};
  throw Error(`unexpected SQL: ${sql}`);
 }};
 return {pool,proof,comments};
}
test('已验收102配额抽样的五条原生评论进入103，同时视频仍是未采尽',async()=>{
 const f=fixture();
 const scope=await queueRequest(f.pool,{op:'score_scope',line:'jinuo',run:'new103',source_run:SOURCE},
  {sourceCommit:NEW_SHA,sampledAdmission:{readProof:async()=>f.proof,verifyRecipient:()=>true}});
 assert.deepEqual(scope.ids,ids);
 const {admittedRows}=require('../leadgen-sampled-admission.js');
 const rows=await admittedRows(f.pool,{lineKey:'jinuo',run:'new103',sourceRun:SOURCE,sourceCommit:NEW_SHA,
  readProof:async()=>f.proof,verifyRecipient:()=>true});
 assert.deepEqual(rows.map(r=>r.id),ids);
});
test('失败、软预算、来源或公司身份漂移均不能放行',async()=>{
 const {admittedRows}=require('../leadgen-sampled-admission.js');
 for(const changes of [
  {proof:{business_outcome:'partial'}},{proof:{business_outcome:'failed'}},{proof:{evidence_status:'unverified'}},
  {proof:{identity_bound:false}},{proof:{binding_id:'foreign'}},
  {proof:{collection_outcome:'fail'}},{proof:{sampling_input:{workflow_key:'douyin_video_processing',run_tag:SOURCE,source_run:UPSTREAM,comment_limit:0,line:'jinuo'}}},
  {video:{judgment_status:'pending'}},{video:{process_status:'待人工核验'}},
  {video:{judgment_config:{company_id:'other',tenant_id:'tenant',version:14,policy_id:'policy',run_id:SOURCE}}},
  {comments:rows=>{rows[0].harvest_batch='other';}},
 ]){
  const f=fixture(changes);
  await assert.rejects(admittedRows(f.pool,{lineKey:'jinuo',run:'new103',sourceRun:SOURCE,sourceCommit:NEW_SHA,
   readProof:async()=>f.proof,verifyRecipient:()=>true}),/SAMPLED_ADMISSION_/);
 }
});
test('103 独立政策复核确实识别这五条抽样评论，不把视频误报为已采尽',async()=>{
 const f=fixture();
 f.comments.forEach(row=>{row.judgment_config={run_id:'new103'};});
 const review=await queueRequest(f.pool,{op:'policy_review',line:'jinuo',run:'new103',claim:'new103',
  source_run:SOURCE,ids,require_dual_review:true},{sourceCommit:NEW_SHA,
   sampledAdmission:{readProof:async()=>f.proof,verifyRecipient:()=>true}});
 assert.deepEqual(review.rows.map(r=>r.reason),Array(5).fill('policy_evidence_invalid'));
});
test('正式 Brain 定义、绑定、31 条 span 和采样输入须同一 run',async()=>{
 const {readRunProof}=require('../leadgen-sampled-admission.js');
 const oldFetch=globalThis.fetch,oldUrl=process.env.BRAIN_URL,oldToken=process.env.BRAIN_INTERNAL_TOKEN;
 const runId=`douyin_video_processing-${SOURCE}__a1`,binding='92049edd-0cc7-46e3-bba3-5450aa1400ff';
 const sample={workflow_key:'douyin_video_processing',run_tag:SOURCE,source_run:UPSTREAM,
  comment_limit:5,line:'jinuo'};
 const spans=Array.from({length:31},(_,i)=>({run_id:runId,run_binding_id:binding,step_id:i===0?null:`step${i}`,
  outcome:'pass',evidence:{activity_key:i<2?'collection':'cleanup',artifact:i===0?'activity-collection.json':'step.json',
   step_key:i===1?'douyin_video_processing.collection.collect_comments':`step${i}`,sampling_input:sample}}));
 try{
  process.env.BRAIN_URL='http://brain.invalid';process.env.BRAIN_INTERNAL_TOKEN='test-only';
  globalThis.fetch=async url=>({ok:true,json:async()=>url.endsWith('/definition')
   ?{binding:{id:binding,run_id:runId,release_id:'release',workflow_definition_version_id:'workflow'},workflow:{id:'workflow',source_commit:OLD_SHA}}
   :url.endsWith('/reconciliation')?{run_id:runId,run_binding_id:binding,release_id:'release',business_outcome:'pass',evidence_status:'verified',gaps:[],span_count:31,expected_count:31}
   :{spans}});
  const proof=await readRunProof(SOURCE);
  assert.equal(proof.identity_bound,true);assert.equal(proof.collection_verified,true);
  spans[2].run_binding_id='foreign';
  assert.equal((await readRunProof(SOURCE)).identity_bound,false);
 }finally{
  globalThis.fetch=oldFetch;
  if(oldUrl===undefined)delete process.env.BRAIN_URL;else process.env.BRAIN_URL=oldUrl;
  if(oldToken===undefined)delete process.env.BRAIN_INTERNAL_TOKEN;else process.env.BRAIN_INTERNAL_TOKEN=oldToken;
 }
});
test('103 评分事务在待判定视频上经过抽样核验后才调用评分模型',async()=>{
 const f=fixture();let modelCalls=0,selected=false;
 const snapshot={...f.pool.snapshot,company_id:'company',tenant_id:'tenant',version:14,policy_id:'policy',
  wiki:{products:[{id:'course'}],audiences:[{id:'student'}]},
  runtime_config:{routing:{line_key:'jinuo'},comment_scoring:{criteria:{A:'A',B:'B',C:'C','不相关':'无'},confidence_threshold:0.8}}};
 const query=f.pool.query.bind(f.pool);
 f.pool.query=async(sql,args)=>{
  if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
  if(sql.includes('ORDER BY collected_at,id LIMIT 1 FOR UPDATE SKIP LOCKED')){
   if(selected)return {rows:[]};selected=true;return {rows:[f.comments[0]]};
  }
  return query(sql,args);
 };
 f.pool.connect=async()=>({query:f.pool.query.bind(f.pool),release(){}});
 const result=await queueRequest(f.pool,{op:'score',line:'jinuo',run:'new103',source_run:SOURCE,
  ids:[ids[0]],limit:1},{sourceCommit:NEW_SHA,freezeCompanyConfig:async()=>snapshot,
  sampledAdmission:{readProof:async()=>f.proof,verifyRecipient:()=>true},
  judgeComment:async()=>{modelCalls++;throw Error('model unavailable');}});
 assert.equal(modelCalls,1);assert.equal(result.scored,0);
 assert.deepEqual(result.blocked_ids,[ids[0]]);
});
test('MMV RPC 未继承 Brain 变量时从本机 0600 缓存只读取 token',async()=>{
 const {readRunProof}=require('../leadgen-sampled-admission.js');
 const home=mkdtempSync(join(tmpdir(),'sampled-brain-auth-'));
 mkdirSync(join(home,'.credentials'));
 writeFileSync(join(home,'.credentials','brain.env'),'BRAIN_INTERNAL_TOKEN=fixture-token\n',{mode:0o600});
 const prior={home:process.env.HOME,token:process.env.BRAIN_INTERNAL_TOKEN,url:process.env.BRAIN_URL,fetch:globalThis.fetch};
 try{
  process.env.HOME=home;delete process.env.BRAIN_INTERNAL_TOKEN;delete process.env.BRAIN_URL;
  let auth;
  globalThis.fetch=async(_url,{headers})=>{auth=headers.authorization;return {ok:false,status:404};};
  await assert.rejects(readRunProof(SOURCE),/SAMPLED_ADMISSION_BRAIN_PROOF_UNAVAILABLE/);
  assert.equal(auth,'Bearer fixture-token');
 }finally{
  if(prior.home===undefined)delete process.env.HOME;else process.env.HOME=prior.home;
  if(prior.token===undefined)delete process.env.BRAIN_INTERNAL_TOKEN;else process.env.BRAIN_INTERNAL_TOKEN=prior.token;
  if(prior.url===undefined)delete process.env.BRAIN_URL;else process.env.BRAIN_URL=prior.url;
  globalThis.fetch=prior.fetch;rmSync(home,{recursive:true,force:true});
 }
});
