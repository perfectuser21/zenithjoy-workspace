import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {queueRequest}=require('../leadgen-queue.js');
const {createHash}=require('node:crypto');

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
  process_status:'待分拣',relevance:null,intent_grade:null,douyin_id:`uid${i}`,nickname:`person${i}`,comment_body:'想考证',recipient_evidence:{status:'verified',scope:{run:SOURCE,source_run:UPSTREAM,video_id:videoId,video_url:videoUrl}}}));
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
 const spans=Array.from({length:31},(_,i)=>({run_id:runId,run_binding_id:binding,step_id:i===0||i===2?null:`step${i}`,
  outcome:'pass',evidence:{activity_key:i<2?'collection':i<4?'qualification':'cleanup',
   artifact:i===0?'activity-collection.json':i===2?'activity-qualification.json':'step.json',
   step_key:i===1?'douyin_video_processing.collection.collect_comments':`step${i}`,sampling_input:sample}}));
 spans[2].evidence.qualification_identity_v1={run_id:runId,run_binding_id:binding,source_commit:OLD_SHA,
  source_run:UPSTREAM,line:'jinuo',videos:[{video_id:videoId,mode:'fresh',prior_judgment_run:SOURCE,
   identity_verified:true,identity_sha256:'a'.repeat(64)}]};
 try{
  process.env.BRAIN_URL='http://brain.invalid';process.env.BRAIN_INTERNAL_TOKEN='test-only';
  globalThis.fetch=async url=>({ok:true,json:async()=>url.endsWith('/definition')
   ?{binding:{id:binding,run_id:runId,release_id:'release',workflow_definition_version_id:'workflow'},workflow:{id:'workflow',source_commit:OLD_SHA}}
   :url.endsWith('/reconciliation')?{run_id:runId,run_binding_id:binding,release_id:'release',business_outcome:'pass',evidence_status:'verified',gaps:[],span_count:31,expected_count:31}
   :{spans}});
  const proof=await readRunProof(SOURCE);
  assert.equal(proof.identity_bound,true);assert.equal(proof.collection_verified,true);assert.equal(proof.qualification_verified,true);
  assert.equal(proof.qualification_identity_v1.videos[0].video_id,videoId);
  spans[2].run_binding_id='foreign';
  assert.equal((await readRunProof(SOURCE)).identity_bound,false);
  spans[2].run_binding_id=binding;spans[3].outcome='fail';
  assert.equal((await readRunProof(SOURCE)).qualification_verified,false);
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
test('mark_leads 在来源正式验收失效时不建线索或配送',async()=>{
 const f=fixture({proof:{business_outcome:'partial'}}),calls=[];
 f.comments[0].relevance='相关';f.comments[0].intent_grade='A';
 const query=f.pool.query.bind(f.pool);
 f.pool.query=async(sql,args)=>{
  calls.push(sql);
  if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'||sql.includes('pg_advisory_xact_lock'))return {rows:[]};
  if(sql.includes('ORDER BY collected_at,id LIMIT 1 FOR UPDATE SKIP LOCKED'))return {rows:[f.comments[0]]};
  return query(sql,args);
 };
 f.pool.connect=async()=>({query:f.pool.query.bind(f.pool),release(){}});
 await assert.rejects(queueRequest(f.pool,{op:'mark_leads',line:'jinuo',run:'new103',source_run:SOURCE,limit:1},
  {sourceCommit:NEW_SHA,freezeCompanyConfig:async()=>({company_id:'company',tenant_id:'tenant',version:14}),
   sampledAdmission:{readProof:async()=>f.proof,verifyRecipient:()=>true}}),/SAMPLED_ADMISSION_RUN_PROOF_INVALID/);
 assert.equal(calls.some(sql=>/INSERT INTO zenithjoy\.leadgen_(?:leads|bridge_outbox)/.test(sql)),false);
});

test('正式102跨机回执精确接纳多个视频及旧批次历史评论',async()=>{
 const {admittedRows}=require('../leadgen-sampled-admission.js');
 const source='sample102multi',upstream='sample101multi',run='score103multi',vid2='7700992800439717606',url2=`https://www.douyin.com/video/${vid2}`;
 const videos=[
  {video_id:videoId,video_url:videoUrl,title:'AI考证一',line_key:'jinuo',harvest_batch:source,process_status:'待判定',judgment_status:'matched',judgment_config:{company_id:'company',tenant_id:'tenant',version:14,policy_id:'policy',run_id:source}},
  {video_id:vid2,video_url:url2,title:'AI考证二',line_key:'jinuo',harvest_batch:source,process_status:'待判定',judgment_status:'matched',judgment_config:{company_id:'company',tenant_id:'tenant',version:14,policy_id:'policy',run_id:source}}
 ];
 const comments=ids.slice(0,4).map((id,i)=>({id,line_key:'jinuo',harvest_batch:i===3?'old102batch':source,
  source_video_url:i<2?videoUrl:url2,source_video:i<2?'AI考证一':'AI考证二',process_status:'待分拣',
  relevance:null,douyin_id:`uid${i}`,nickname:`person${i}`,comment_body:`想考证${i}`,
  recipient_evidence:{status:'verified',scope:{run:i===3?'old102batch':source,source_run:upstream,video_id:i<2?videoId:vid2,video_url:i<2?videoUrl:url2}}}));
 const receipt=videos.map((v,index)=>{const found=comments.filter(c=>c.source_video_url===v.video_url);
  const pgRows=found.map(c=>({id:c.id,douyinId:c.douyin_id,commentBody:c.comment_body,sourceVideoUrl:c.source_video_url}));
  return {video_id:v.video_id,video_url:v.video_url,stop_reason:'quota_reached',coverage:2,
   comments_inserted:index===0?2:1,history_verified:index===0?0:1,comment_ids:found.map(c=>c.id),
   qualification:{mode:'fresh',prior_judgment_run:source,identity_verified:true,identity_sha256:'b'.repeat(64)},
   pg_rows_sha256:createHash('sha256').update(JSON.stringify(pgRows)).digest('hex')};});
 for(const [video_id,stop_reason] of [['7700992800439717607','footer_reached'],['7700992800439717608','no_comments']])
  receipt.push({video_id,video_url:`https://www.douyin.com/video/${video_id}`,stop_reason,coverage:0,
   comments_inserted:0,history_verified:0,comment_ids:[],pg_rows_sha256:createHash('sha256').update('[]').digest('hex'),
   qualification:{mode:'fresh',prior_judgment_run:source,identity_verified:true,identity_sha256:'d'.repeat(64)}});
 const proof={run_id:`douyin_video_processing-${source}__a1`,source_commit:NEW_SHA,source_run:upstream,
  binding_id:'11111111-1111-4111-8111-111111111111',identity_bound:true,business_outcome:'pass',evidence_status:'verified',gaps:[],span_count:31,expected_count:31,
  collection_outcome:'pass',collection_verified:true,qualification_verified:true,sampling_input:{workflow_key:'douyin_video_processing',run_tag:source,source_run:upstream,comment_limit:2,line:'jinuo'},
  qualification_identity_v1:{run_id:`douyin_video_processing-${source}__a1`,run_binding_id:'11111111-1111-4111-8111-111111111111',source_commit:NEW_SHA,
   source_run:upstream,line:'jinuo',videos:receipt.map(v=>({video_id:v.video_id,...v.qualification}))},
  sampling_admission_v1:{run_id:`douyin_video_processing-${source}__a1`,run_binding_id:'11111111-1111-4111-8111-111111111111',source_commit:NEW_SHA,source_run:upstream,line:'jinuo',comment_limit:2,videos:receipt}};
 const snap={company_id:'company',tenant_id:'tenant',version:14,policy_id:'policy',runtime_config:{routing:{line_key:'jinuo'}}};
 const pool={async query(sql,args){if(sql.includes('FROM zenithjoy.leadgen_videos'))return {rows:sql.includes("process_status='评论已采'")?[]:videos};
  if(sql.includes('FROM zenithjoy.company_config_runs'))return {rows:[{company_id:'company',tenant_id:'tenant',version:14,run_id:args[0],source_run:args[0]===source?upstream:source,snapshot:snap}]};
  if(sql.includes('FROM zenithjoy.leadgen_comments'))return {rows:sql.includes('EXISTS (SELECT 1 FROM zenithjoy.leadgen_videos')?[]:comments};throw Error('unexpected SQL '+sql);}};
 const admitted=await admittedRows(pool,{lineKey:'jinuo',run,sourceRun:source,sourceCommit:NEW_SHA,readProof:async()=>proof,verifyRecipient:()=>true});
 assert.deepEqual(admitted.map(c=>c.id),comments.map(c=>c.id));
 videos.push(...receipt.slice(2).map(v=>({video_id:v.video_id,video_url:v.video_url,title:'无评论或已到页尾',line_key:'jinuo',
  harvest_batch:source,process_status:'待判定',judgment_status:'matched',
  judgment_config:{company_id:'company',tenant_id:'tenant',version:14,policy_id:'policy',run_id:source}})));
 assert.equal((await admittedRows(pool,{lineKey:'jinuo',run,sourceRun:source,sourceCommit:NEW_SHA,
  readProof:async()=>proof,verifyRecipient:()=>true})).length,4);
 videos[1].judgment_config.run_id='old102batch';
 receipt[1].qualification={mode:'cached',prior_judgment_run:'old102batch',identity_verified:true,identity_sha256:'c'.repeat(64)};
 proof.qualification_identity_v1.videos[1]={video_id:vid2,...receipt[1].qualification};
 assert.equal((await admittedRows(pool,{lineKey:'jinuo',run,sourceRun:source,sourceCommit:NEW_SHA,
  readProof:async()=>proof,verifyRecipient:()=>true})).length,4);
 proof.qualification_verified=false;
 await assert.rejects(admittedRows(pool,{lineKey:'jinuo',run,sourceRun:source,sourceCommit:NEW_SHA,
  readProof:async()=>proof,verifyRecipient:()=>true}),/SAMPLED_ADMISSION_/);
 proof.qualification_verified=true;
 for(const mutation of [
  ()=>{videos[1].judgment_config.company_id='foreign';},
  ()=>{videos[1].judgment_config.tenant_id='foreign';},
  ()=>{videos[1].judgment_config.version=15;},
  ()=>{videos[1].judgment_config.policy_id='foreign';},
  ()=>{proof.qualification_identity_v1.videos[1].video_id='7700992800439717699';},
  ()=>{proof.qualification_identity_v1.source_commit=OLD_SHA;},
  ()=>{proof.qualification_identity_v1.run_binding_id='foreign';},
 ]){
  const savedVideo=structuredClone(videos[1].judgment_config),savedIdentity=structuredClone(proof.qualification_identity_v1);
  mutation();
  await assert.rejects(admittedRows(pool,{lineKey:'jinuo',run,sourceRun:source,sourceCommit:NEW_SHA,
   readProof:async()=>proof,verifyRecipient:()=>true}),/SAMPLED_ADMISSION_/);
  videos[1].judgment_config=savedVideo;proof.qualification_identity_v1=savedIdentity;
 }
 receipt[1].qualification.prior_judgment_run='foreign102';
 await assert.rejects(admittedRows(pool,{lineKey:'jinuo',run,sourceRun:source,sourceCommit:NEW_SHA,
  readProof:async()=>proof,verifyRecipient:()=>true}),/SAMPLED_ADMISSION_/);
 receipt[1].qualification.prior_judgment_run='old102batch';
 proof.qualification_identity_v1.videos[1].prior_judgment_run='foreign102';
 await assert.rejects(admittedRows(pool,{lineKey:'jinuo',run,sourceRun:source,sourceCommit:NEW_SHA,
  readProof:async()=>proof,verifyRecipient:()=>true}),/SAMPLED_ADMISSION_ADMISSION_QUALIFICATION_INVALID/);
 proof.qualification_identity_v1.videos[1].prior_judgment_run='old102batch';
 const alias='https://v.douyin.com/old-short-video/';
 comments[3].source_video_url=alias;comments[3].recipient_evidence.scope.video_url=alias;
 receipt[1].pg_rows_sha256=createHash('sha256').update(JSON.stringify(comments.slice(2,4).map(c=>({
  id:c.id,douyinId:c.douyin_id,commentBody:c.comment_body,sourceVideoUrl:c.source_video_url})))).digest('hex');
 assert.equal((await admittedRows(pool,{lineKey:'jinuo',run,sourceRun:source,sourceCommit:NEW_SHA,
  readProof:async()=>proof,verifyRecipient:()=>true})).length,4);
 comments[3].recipient_evidence.scope.video_id='7700992800439717699';
 await assert.rejects(admittedRows(pool,{lineKey:'jinuo',run,sourceRun:source,sourceCommit:NEW_SHA,
  readProof:async()=>proof,verifyRecipient:()=>true}),/SAMPLED_ADMISSION_RECIPIENT_SCOPE_INVALID/);
 comments[3].recipient_evidence.scope.video_id=vid2;
 const scope=await queueRequest(pool,{op:'score_scope',line:'jinuo',run,source_run:source},
  {sourceCommit:NEW_SHA,sampledAdmission:{readProof:async()=>proof,verifyRecipient:()=>true}});
 assert.deepEqual(scope.ids,comments.map(c=>c.id));
 assert.equal(scope.sources[comments[3].id],'old102batch');
 comments.forEach(c=>{c.judgment_config={run_id:run};});
 const review=await queueRequest(pool,{op:'policy_review',line:'jinuo',run,source_run:source,claim:run,
  ids:comments.map(c=>c.id),require_dual_review:true},{sourceCommit:NEW_SHA,
   sampledAdmission:{readProof:async()=>proof,verifyRecipient:()=>true}});
 assert.deepEqual(review.rows.map(r=>r.reason),Array(4).fill('policy_evidence_invalid'));
 // 标记阶段必须再次用同一精确回执核历史行，原harvest_batch保持不动。
 const originalQuery=pool.query.bind(pool);let selected=false,marked=false;
 comments[3].relevance='不相关';comments[3].judgment_config={run_id:run};comments[3].dedup_key='history-dedup';
 pool.query=async(sql,args)=>{
  if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'||sql.includes('pg_advisory_xact_lock'))return {rows:[]};
  if(sql.includes('ORDER BY collected_at,id LIMIT 1 FOR UPDATE SKIP LOCKED')){
   if(selected)return {rows:[]};selected=true;return {rows:[comments[3]]};
  }
  if(sql.includes("SET process_status = '已分拣'")){marked=true;return {rows:[]};}
  return originalQuery(sql,args);
 };
 pool.connect=async()=>({query:pool.query.bind(pool),release(){}});
 const markedResult=await queueRequest(pool,{op:'mark_leads',line:'jinuo',run,source_run:source,limit:1},
  {sourceCommit:NEW_SHA,freezeCompanyConfig:async()=>snap,
   sampledAdmission:{readProof:async()=>proof,verifyRecipient:()=>true}});
 assert.equal(markedResult.marked,1);assert.equal(marked,true);
 assert.equal(comments[3].harvest_batch,'old102batch');
 pool.query=originalQuery;delete pool.connect;comments[3].relevance=null;delete comments[3].dedup_key;
 comments.forEach(c=>{delete c.judgment_config;});
 proof.sampling_admission_v1.videos[1].comment_ids[0]=ids[4];
 await assert.rejects(admittedRows(pool,{lineKey:'jinuo',run,sourceRun:source,sourceCommit:NEW_SHA,readProof:async()=>proof,verifyRecipient:()=>true}),/SAMPLED_ADMISSION_/);
 proof.sampling_admission_v1.videos[1].comment_ids[0]=comments[2].id;
 comments[3].relevance='相关';comments[3].judgment_config={run_id:'old103run'};
 await assert.rejects(admittedRows(pool,{lineKey:'jinuo',run,sourceRun:source,sourceCommit:NEW_SHA,readProof:async()=>proof,verifyRecipient:()=>true}),/SAMPLED_ADMISSION_COMMENT_SCOPE_INVALID/);
 comments[3].relevance=null;delete comments[3].judgment_config;
 proof.sampling_admission_v1.videos[1].comment_ids[0]=comments[0].id;
 await assert.rejects(admittedRows(pool,{lineKey:'jinuo',run,sourceRun:source,sourceCommit:NEW_SHA,readProof:async()=>proof,verifyRecipient:()=>true}),/SAMPLED_ADMISSION_ADMISSION_IDS_INVALID/);
});

test('102 qualification 与 collection 主 span 各发表同源原生身份和精确 PG 身份，坏回执拒绝',async()=>{
 const {samplingAdmissionEvidence,qualificationIdentityEvidence}=await import('../runtime-receipts.mjs');
 const {freezeQualificationIdentity}=await import('../qualification-identity-snapshot.mjs');
 const dir=mkdtempSync(join(tmpdir(),'sampling-span-'));
 const run='sample102span',runId=`douyin_video_processing-${run}__a1`;
 const sample={workflow_key:'douyin_video_processing',run_tag:run,source_run:'sample101span',line:'jinuo',comment_limit:2};
 const pgRows=ids.slice(0,2).map((id,i)=>({id,douyinId:`uid${i}`,commentBody:`想考证${i}`,sourceVideoUrl:videoUrl}));
 const publicReceipt={video_url:videoUrl,video_id:videoId,source_run:sample.source_run,comment_limit:2,
  stop_reason:'quota_reached',coverage:2,comments:1,comments_inserted:1,history_verified:1,all_comments_scanned:false};
 const file=join(dir,`${run}-sampling-readback.json`);
 const frozen={sampling_input:sample,deployment:{source_commit:NEW_SHA}},binding={run_id:runId,id:'11111111-1111-4111-8111-111111111111'};
 const artifact={result:{sampling_required_count:1,sampling_receipts:[publicReceipt]}};
 try{
  assert.equal(samplingAdmissionEvidence({dir,artifact:{result:{sampling_required_count:0,sampling_receipts:[]}},frozen,binding}),null);
  const identityFile=join(dir,`${run}-identity-${videoId}.json`);
  const identity={verified:true,expected_video_id:videoId,observed_video_id:videoId,content_type:'video',
   excluded_non_video:false,evidence_id:`${run}-v${videoId}-qualification-identity`};
  writeFileSync(identityFile,JSON.stringify(identity),{mode:0o600});
  const snapshot=freezeQualificationIdentity({dir,run,videoId});
  writeFileSync(join(dir,`${run}-qualification-progress.json`),JSON.stringify({run,source_commit:NEW_SHA,
   qualified_video_ids:[videoId],videos:[{video_id:videoId,settled:true,recordingsRequired:1,
    cached_judgment_run:null,identity_snapshot_sha256:snapshot.sha256}]}),{mode:0o600});
  writeFileSync(file,JSON.stringify({run_id:runId,sampling_input:sample,verified:true,videos:[{...publicReceipt,pg_rows:pgRows}]}),{mode:0o600});
  const qualification=qualificationIdentityEvidence({dir,frozen,binding});
  const evidence=samplingAdmissionEvidence({dir,artifact,frozen,binding});
  assert.deepEqual({video_id:videoId,...evidence.videos[0].qualification},qualification.videos[0]);
  writeFileSync(identityFile,JSON.stringify({...identity,evidence_id:'old-run-identity'}));
  assert.deepEqual(qualificationIdentityEvidence({dir,frozen,binding}),qualification);
  assert.deepEqual(samplingAdmissionEvidence({dir,artifact,frozen,binding}),evidence);
  writeFileSync(identityFile,JSON.stringify({...identity,expected_video_id:'7700992800439717699'}));
  assert.deepEqual(qualificationIdentityEvidence({dir,frozen,binding}),qualification);
  assert.deepEqual(samplingAdmissionEvidence({dir,artifact,frozen,binding}),evidence);
  const snapshotFile=join(dir,`${run}-qualification-identity-${videoId}-${snapshot.sha256}.json`);
  writeFileSync(snapshotFile,JSON.stringify({...identity,expected_video_id:'7700992800439717699'}));
  assert.throws(()=>qualificationIdentityEvidence({dir,frozen,binding}),/SAMPLING_ADMISSION_IDENTITY_INVALID/);
  writeFileSync(snapshotFile,JSON.stringify(identity));
  writeFileSync(identityFile,JSON.stringify(identity));
  assert.deepEqual(evidence.videos[0].comment_ids,ids.slice(0,2));
  assert.deepEqual(evidence.videos[0].qualification.mode,'fresh');
  assert.equal(evidence.videos[0].pg_rows_sha256,createHash('sha256').update(JSON.stringify(pgRows)).digest('hex'));
  writeFileSync(file,JSON.stringify({run_id:runId,sampling_input:sample,verified:true,videos:[{...publicReceipt,coverage:1,pg_rows:pgRows}]}));
  assert.throws(()=>samplingAdmissionEvidence({dir,artifact,frozen,binding}),/SAMPLING_ADMISSION_RECEIPT_INVALID/);
  writeFileSync(file,'x'.repeat(3000001));
  assert.throws(()=>samplingAdmissionEvidence({dir,artifact,frozen,binding}),/SAMPLING_ADMISSION_RECEIPT_INVALID/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('102 资格身份在采集覆写可变路径后仍由冻结原件生成 span',async()=>{
 const {qualificationIdentityEvidence}=await import('../runtime-receipts.mjs');
 const dir=mkdtempSync(join(tmpdir(),'qualification-snapshot-'));
 const run='snapshot102',sample={run_tag:run,source_run:'source101',line:'jinuo',comment_limit:5};
 const frozen={sampling_input:sample,deployment:{source_commit:NEW_SHA}};
 const binding={run_id:`douyin_video_processing-${run}__a1`,id:'11111111-1111-4111-8111-111111111111'};
 const identity={verified:true,expected_video_id:videoId,observed_video_id:videoId,content_type:'video',
  excluded_non_video:false,evidence_id:`${run}-v${videoId}-identity-identity`};
 const bytes=JSON.stringify(identity),sha=createHash('sha256').update(bytes).digest('hex');
 try{
  writeFileSync(join(dir,`${run}-qualification-identity-${videoId}-${sha}.json`),bytes,{mode:0o600});
  writeFileSync(join(dir,`${run}-qualification-progress.json`),JSON.stringify({run,source_commit:NEW_SHA,
   qualified_video_ids:[videoId],videos:[{video_id:videoId,settled:true,recordingsRequired:0,
    cached_judgment_run:'prior102',identity_snapshot_sha256:sha}]}),{mode:0o600});
  writeFileSync(join(dir,`${run}-identity-${videoId}.json`),JSON.stringify({...identity,
   evidence_id:`${run}-v${videoId}-collection-after-card8`}),{mode:0o600});
  const proof=qualificationIdentityEvidence({dir,frozen,binding});
  assert.equal(proof.videos[0].identity_sha256,sha);
  assert.equal(proof.videos[0].prior_judgment_run,'prior102');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
