import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {companyFixture} from './company-config-fixture.mjs';
import {policy as originalPolicy} from './fixtures/leadgen-103-v14.mjs';
const require=createRequire(import.meta.url);
const judge=require('../judge-comment.js');
const policy=require('../leadgen-policy-review.js');
const {queueRequest}=require('../leadgen-queue.js');
const id='00000000-0000-4000-8000-000000000221';
const snapshot=companyFixture();snapshot.runtime_config.routing={line_key:'jinuo'};snapshot.runtime_config.comment_scoring=originalPolicy.runtime_config.comment_scoring;
const row={id,line_key:'jinuo',harvest_batch:'batch102',source_video:'人工智能训练师怎么报名',source_video_url:'https://www.douyin.com/video/7706472682887367936',comment_body:'怎么报名？',collected_at:new Date('2026-11-12T00:00:00Z')};
const audit={model:'google/gemini-2.5-flash',response_id:'single-response',stage:'single',policy_evidence:{comment_signal:'怎么报名？'}};
const verdict={grade:'A',relevance:'相关',reason:'报名咨询',audit};

test('normal score commits one evaluation without invoking policy models',async()=>{
 let selected=false,calls=0,reviewCalls=0,saved;
 const client={async query(sql,args=[]){
  if(sql.includes('SELECT * FROM zenithjoy.leadgen_comments'))return {rows:selected?[]:(selected=true,[row])};
  if(sql.includes('FROM zenithjoy.leadgen_videos'))return {rows:[{video_url:row.source_video_url,title:row.source_video,judgment_status:'matched'}]};
  if(sql.includes('UPDATE zenithjoy.leadgen_comments'))saved={relevance:args[1],intent_grade:args[2],judgment_reason:args[3],judgment_config:JSON.parse(args[4])};
  return {rows:[]};},release(){}};
 const result=await queueRequest({connect:async()=>client},{op:'score',line:'jinuo',run:'once103',source_run:'batch102',limit:1},{freezeCompanyConfig:async()=>snapshot,
  judgeComment:async()=>{calls++;return verdict;},judgePolicy:async()=>{reviewCalls++;throw Error('must not review');}});
 assert.equal(result.scored,1);assert.equal(calls,1);assert.equal(reviewCalls,0);assert.equal(saved.intent_grade,'A');
 assert.equal(saved.judgment_config.scoring_mode,'single-evaluation-v1');assert.equal(saved.judgment_config.policy_reviews,undefined);
 const stored={...row,...saved};assert.equal(policy.verifyStoredScore(stored,snapshot).status,'pass');
 assert.equal(policy.verifyStoredScore({...stored,comment_body:'别的评论'},snapshot).status,'unknown');
 assert.equal(policy.verifyStoredScore(stored,{...snapshot,tenant_id:'other-tenant'}).status,'unknown');
});

test('single scoring uses one structured model request even on low confidence',async()=>{
 const rules=snapshot.runtime_config.comment_scoring;const audience=rules.audiences[0];const signal=String(audience.fields['意向信号']).split(/[\/、，,；;\n]/).find(s=>s.trim());let calls=0;
 const result=await judge.judgeCommentOnce('怎么报名？',row.source_video,'公司画像',{scoringRules:rules,apiKey:'fixture-only',httpPost:async()=>{calls++;return {id:'one-response',model:judge.COMMANDER_MODEL,choices:[{message:{content:JSON.stringify({grade:'A',policy_evidence:{audience_id:audience.id,matched_rule:signal,comment_signal:'怎么报名？',video_signal:'怎么报名',exclusion_rule:null,reason:'本人询问报名'}})}}]};}});
 assert.equal(result.grade,'A');assert.equal(calls,1);assert.equal(result.audit.response_id,'one-response');
});

test('invalid single model response stops without calling a fallback model',async()=>{
 let calls=0;await assert.rejects(judge.judgeCommentOnce('怎么报名？',row.source_video,'公司画像',{scoringRules:snapshot.runtime_config.comment_scoring,apiKey:'fixture-only',httpPost:async()=>{calls++;return {id:'bad',model:judge.COMMANDER_MODEL,choices:[{message:{content:'not json'}}]};}}));assert.equal(calls,1);
});

test('post-score policy readback never starts a model for unadapted legacy rows',async()=>{
 let calls=0;const config={run_id:'once103',company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,version:snapshot.version,policy_id:snapshot.policy_id,model_audit:audit};
 const pool={async query(sql){if(sql.includes('company_config_runs'))return {rows:[{run_id:'once103',company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,version:snapshot.version,snapshot}]};if(sql.includes('leadgen_videos'))return {rows:[{...row,video_url:row.source_video_url,title:row.source_video,judgment_status:'matched'}]};return {rows:[{...row,relevance:'相关',intent_grade:'A',judgment_config:config}]};}};
 const r=await queueRequest(pool,{op:'policy_review',line:'jinuo',run:'once103',claim:'once103',source_run:'batch102',ids:[id]},{judgePolicy:async()=>{calls++;throw Error('must not review');}});
 assert.equal(calls,0);assert.equal(r.verified,false);
});

test('recipient projection consumes a saved score and native UID proof with zero model requests',async()=>{
 const comment={...row,douyin_id:'actual-uid',nickname:'本人',relevance:'相关',intent_grade:'A',judgment_reason:verdict.reason,recipient_evidence:{sha256:{profile:'native-profile-hash'}}};
 comment.judgment_config=policy.makeSingleScoreAudit(comment,snapshot,verdict,{run_id:'once103',company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,version:snapshot.version,policy_id:snapshot.policy_id});
 const {qualifyRecipientFromScore}=require('../judge-recipient.js');let modelCalls=0,nativeChecks=0;
 const options={verifyRecipient:()=>{nativeChecks++;return {native_profile_verified:true};},httpPost:()=>{modelCalls++;throw Error('must not call');}};
 const result=await qualifyRecipientFromScore(comment,snapshot,options);assert.equal(result.status,'passed');assert.equal(result.model_call_count,0);assert.equal(modelCalls,0);assert.equal(nativeChecks,1);
 const changed=await qualifyRecipientFromScore({...comment,comment_body:'篡改评论'},snapshot,options);assert.equal(changed.status,'unknown');
 const missing=await qualifyRecipientFromScore(comment,snapshot,{verifyRecipient:()=>{throw Error('no proof');}});assert.equal(missing.status,'unknown');assert.equal(missing.model_call_count,0);
});

test('lost score reply recovers the exact stored score without scoring again',async()=>{
 const comment={...row,relevance:verdict.relevance,intent_grade:verdict.grade,judgment_reason:verdict.reason,process_status:'待分拣'};
 comment.judgment_config=policy.makeSingleScoreAudit(comment,snapshot,verdict,{run_id:'once103',company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,version:snapshot.version,policy_id:snapshot.policy_id});let modelCalls=0;
 const pool={async query(sql){return {rows:sql.includes('company_config_runs')?[{run_id:'once103',company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,version:snapshot.version,snapshot}]:[comment]};}};
 const result=await queueRequest(pool,{op:'score_recovery',line:'jinuo',run:'once103',source_run:'batch102',ids:[id]},{judgeComment:()=>{modelCalls++;throw Error('must not score');}});assert.deepEqual(result.ids,[id]);assert.equal(modelCalls,0);
 comment.comment_body='changed';await assert.rejects(queueRequest(pool,{op:'score_recovery',line:'jinuo',run:'once103',source_run:'batch102',ids:[id]}),/RECOVERY_AMBIGUOUS/);
});

test('single response invented quotes are rejected without an extra model call',async()=>{
 const rules=snapshot.runtime_config.comment_scoring,audience=rules.audiences[0];const signal=String(audience.fields['意向信号']).split(/[\/、，,；;\n]/).find(s=>s.trim());let calls=0;
 await assert.rejects(judge.judgeCommentOnce('怎么报名？',row.source_video,'画像',{scoringRules:rules,apiKey:'fixture-only',httpPost:async()=>{calls++;return {id:'fabricated',model:judge.COMMANDER_MODEL,choices:[{message:{content:JSON.stringify({grade:'A',policy_evidence:{audience_id:audience.id,matched_rule:signal,comment_signal:'我想购买课程',video_signal:'不存在的标题',exclusion_rule:null,reason:'引用依据'}})}}]};}}),/COMMANDER_EVIDENCE_INVALID/);assert.equal(calls,1);
});
