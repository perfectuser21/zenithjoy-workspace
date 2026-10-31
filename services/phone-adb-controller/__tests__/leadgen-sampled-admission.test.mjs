import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
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
  process_status:'待分拣',relevance:null,intent_grade:null,douyin_id:`uid${i}`,nickname:`person${i}`,comment_body:'想考证',recipient_evidence:{scope:{run:SOURCE,source_run:UPSTREAM,video_id:videoId}}}));
 const proof={run_id:`douyin_video_processing-${SOURCE}__a1`,source_commit:OLD_SHA,source_run:UPSTREAM,
  business_outcome:'pass',evidence_status:'verified',gaps:[],span_count:31,expected_count:31,
  collection_outcome:'pass',collection_verified:true,sampling_input:{workflow_key:'douyin_video_processing',run_tag:SOURCE,source_run:UPSTREAM,comment_limit:5,line:'jinuo'}};
 Object.assign(video,changes.video);Object.assign(proof,changes.proof);if(changes.comments)changes.comments(comments);
 const pool={async query(sql,args){
  if(sql.includes('FROM zenithjoy.company_config_runs'))return {rows:[{company_id:'company',tenant_id:'tenant',version:14,run_id:args[0],source_run:args[0]===SOURCE?UPSTREAM:SOURCE,snapshot}]};
  if(sql.includes('FROM zenithjoy.leadgen_comments'))return {rows:sql.includes("v.process_status='评论已采'")?[]:comments};
  if(sql.includes('FROM zenithjoy.leadgen_videos'))return {rows:[video]};
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
  {proof:{business_outcome:'partial'}},{proof:{evidence_status:'unverified'}},
  {proof:{collection_outcome:'fail'}},{proof:{sampling_input:{workflow_key:'douyin_video_processing',run_tag:SOURCE,source_run:UPSTREAM,comment_limit:0,line:'jinuo'}}},
  {video:{judgment_status:'pending'}},{video:{process_status:'待人工核验'}},
  {comments:rows=>{rows[0].harvest_batch='other';}},
 ]){
  const f=fixture(changes);
  await assert.rejects(admittedRows(f.pool,{lineKey:'jinuo',run:'new103',sourceRun:SOURCE,sourceCommit:NEW_SHA,
   readProof:async()=>f.proof,verifyRecipient:()=>true}),/SAMPLED_ADMISSION_/);
 }
});
