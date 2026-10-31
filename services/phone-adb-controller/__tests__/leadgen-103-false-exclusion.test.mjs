import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {policy} from './fixtures/leadgen-103-v14.mjs';

const require=createRequire(import.meta.url);
const {dualPolicyReview}=require('../leadgen-policy-review.js');
const {judgeCommander}=require('../judge-comment.js');

const title='想入行AI的注意了！人工智能训练工程师，20天就能拿下，报考流程一条给你说清楚。#人工智能训练工程师 #AI行业 #考证 #人工智能';
const binding={company_id:policy.company_id,tenant_id:policy.tenant_id,version:policy.version,
 policy_id:policy.policy_id,run_id:'accept103102lrepair'};
const row=body=>({id:'f5e16a6d-9183-4606-b840-9698bd710eed',comment_body:body,
 source_video:title,source_video_url:'https://www.douyin.com/video/7699344115351688872',
 relevance:'相关',intent_grade:'A',judgment_reason:'候选A',judgment_config:binding});
const answer=(body,id)=>({grade:'A',audit:{model:'google/gemini-2.5-flash',response_id:id,
 policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:'求资料',comment_signal:body,
 video_signal:'人工智能训练工程师',exclusion_rule:null,reason:'请求报考流程'}}});

test('真实102l评论明确索取流程，双独立A复核不能误排除',async()=>{
 let calls=0;
 const actual=await dualPolicyReview(row('怎么找机构，可以发一下流程吗？ 首评'),policy,
  {judgePolicy:async()=>answer('找机构',`review-${++calls}`)});
 assert.equal(calls,2);
 assert.equal(actual.status,'pass');
 assert.equal(actual.reviews.length,2);
});

test('泛问句和无流程标题不因A候选自动通过',async()=>{
 for(const [candidate,signal] of [[row('这个怎么弄？ 首评'),'这个怎么弄？'],
  [row('不用发流程，我只是围观'),'只是围观'],
  [{...row('怎么找机构，可以发一下流程吗？ 首评'),source_video:'人工智能训练工程师介绍'},'找机构']]){
  let calls=0;
  const actual=await dualPolicyReview(candidate,policy,{judgePolicy:async()=>answer(signal,`review-${++calls}`)});
  assert.equal(actual.status,'exclude');
  assert.equal(actual.reason,'personal_intent_evidence_missing');
 }
});

test('政策Commander证据非法时返回固定安全字段码，不回显原评论或模型正文',async()=>{
 const body='怎么找机构，可以发一下流程吗？ 首评';
 const bad={grade:'A',policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:'伪造规则',
  comment_signal:'怎么找机构',video_signal:'人工智能训练工程师',exclusion_rule:null,reason:'请求流程'}};
 const httpPost=async()=>({id:'model-response',model:'google/gemini-2.5-flash',
  choices:[{message:{content:JSON.stringify(bad)}}]});
 await assert.rejects(judgeCommander(body,title,'冻结画像','policy semantic verification',
  {apiKey:'fixture-only',scoringRules:policy.runtime_config.comment_scoring,httpPost}),error=>{
   assert.equal(error.message,'COMMANDER_EVIDENCE_INVALID');
   assert.equal(error.evidence_check,'matched_rule_not_frozen');
   assert.equal(JSON.stringify(error).includes(body),false);
   return true;
  });
});
