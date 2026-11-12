import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {companyFixture} from './company-config-fixture.mjs';
const require=createRequire(import.meta.url),judge=require('../judge-comment.js'),policy=require('../leadgen-policy-review.js');
// Anonymous v26-shaped original fields: no 意向信号/人群描述/排除信号 keys.
const rules={criteria:{A:'明确咨询服务和实施',B:'咨询企业AI应用',C:'了解AI工具',不相关:'与公司AI服务无关的广告和跑题'},confidence_threshold:.6,audiences:[{id:'frozen-business-id-v26',name:'业务画像',fields:{状态:'管理专属待复核',优先级:'管理专属优先级P1',企业规模:'一人公司、小微企业及创业者',决策岗位:'创业者及企业老板',决策阻力:'担心方案过于复杂',客户行业:'咨询、电商及内容行业',所在地区:'全国',核心痛点:'希望AI自动化日常资料整理',画像名称:'小微企业AI应用用户',购买触发:'需要降低重复工作耗时',常用搜索词:'AI工具、AI自动化'}}]};
const body='我是创业者想了解这个AI工具',video='企业AI自动化办公教程';
const proof=()=>({audience_id:rules.audiences[0].id,matched_rule:'创业者',comment_signal:'创业者想了解',exclusion_rule:null,reason:'询问经营工具'});
async function score(answer={grade:'B',policy_evidence:proof()},capture=()=>{},comment=body){let calls=0;const result=await judge.judgeCommentOnce(comment,video,'opaque profile without audience IDs',{scoringRules:structuredClone(rules),apiKey:'fixture-only',httpPost:async(_url,request)=>{calls++;capture(request);return {id:'single-frozen-response',model:judge.COMMANDER_MODEL,choices:[{message:{content:JSON.stringify(answer)}}]};}});return {result,calls};}

test('one-pass v26 field-shape prompt exposes exact frozen IDs and business references',async()=>{
 let prompt;const {result,calls}=await score(undefined,r=>prompt=r.messages[0].content);assert.equal(result.grade,'B');assert.equal(calls,1);assert.ok(prompt.includes(rules.audiences[0].id));assert.ok(prompt.includes('希望AI自动化日常资料整理'));assert.ok(prompt.includes('原不相关criteria'));assert.ok(!prompt.includes('管理专属待复核'));assert.ok(!prompt.includes('管理专属优先级P1'));assert.equal(result.audit.policy_reference_mode,'frozen-fields-v1');
});
test('A remains bound to original comment/video quotes and real frozen business fields',async()=>{
 const a={grade:'A',policy_evidence:{...proof(),matched_rule:'AI自动化',comment_signal:'怎么用AI自动化',video_signal:'AI自动化办公'}};
 const {result,calls}=await score(a,()=>{},'怎么用AI自动化？');assert.equal(result.grade,'A');assert.equal(calls,1);
});
test('unrelated without an audience uses explicit null pair and original exclusion criterion quote',async()=>{
 const a={grade:'不相关',policy_evidence:{audience_id:null,matched_rule:null,comment_signal:'与业务无关',exclusion_rule:'跑题',reason:'没有业务需求'}};
 const {result,calls}=await score(a,()=>{},'这是一段与业务无关的评论');assert.equal(result.relevance,'不相关');assert.equal(calls,1);
});
for(const [name,change,grade='B'] of [
 ['invented audience',p=>p.audience_id='invented-id'],
 ['unknown audience label instead of ID',p=>p.audience_id='业务画像'],
 ['management status',p=>p.matched_rule='管理专属待复核'],
 ['management priority',p=>p.matched_rule='管理专属优先级P1'],
 ['invented business reference',p=>p.matched_rule='不存在的新意向条件'],
 ['invented exclusion',p=>p.exclusion_rule='模型临时新增排除项','不相关'],
 ['wrong comment quote',p=>p.comment_signal='不是原文'],
 ['wrong video quote',p=>p.video_signal='不是原视频'],
 ['related null audience',p=>{p.audience_id=null;p.matched_rule=null;p.exclusion_rule='跑题';}],
 ['unrelated null missing exclusion',p=>{p.audience_id=null;p.matched_rule=null;p.exclusion_rule=null;},'不相关'],
 ['unrelated null wrong matched rule',p=>{p.audience_id=null;p.matched_rule='创业者';p.exclusion_rule='跑题';},'不相关'],
 ['unrelated null missing comment quote',p=>{p.audience_id=null;p.matched_rule=null;p.exclusion_rule='跑题';delete p.comment_signal;},'不相关'],
])test('frozen field references reject '+name+' without a model retry',async()=>{let calls=0;const p=proof();change(p);await assert.rejects(score({grade,policy_evidence:p},()=>calls++),/COMMANDER_EVIDENCE_INVALID/);assert.equal(calls,1);});

test('saved single score and recipient projection re-use strict frozen reference validation',async()=>{
 const {result}=await score();const snapshot=companyFixture('yuesheng');snapshot.runtime_config.comment_scoring=structuredClone(rules);
 const row={id:'00000000-0000-4000-8000-000000000631',line_key:'yuesheng',harvest_batch:'source102',comment_body:body,source_video:video,source_video_url:'https://www.douyin.com/video/7704584547186793910',douyin_id:'actual-fixture-uid',nickname:'原评论人',recipient_evidence:{sha256:{profile:'fixture-profile-hash'}}};
 const e={run_id:'score103',company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,version:snapshot.version,policy_id:snapshot.policy_id};
 const audit=policy.makeSingleScoreAudit(row,snapshot,result,e);const saved={...row,relevance:'相关',intent_grade:'B',judgment_reason:result.reason,judgment_config:audit};assert.equal(policy.verifyStoredScore(saved,snapshot).status,'pass');
 let nativeCalls=0;const r=await require('../judge-recipient.js').qualifyRecipientFromScore(saved,snapshot,{verifyRecipient:()=>{nativeCalls++;return {};}});assert.equal(r.status,'passed');assert.equal(r.model_call_count,0);assert.equal(nativeCalls,1);
 const bad={...result,audit:{...result.audit,policy_evidence:{...result.audit.policy_evidence,matched_rule:'管理专属待复核'}}};assert.throws(()=>policy.makeSingleScoreAudit(row,snapshot,bad,e),/FROZEN_POLICY_EVIDENCE_INVALID/);
 const oldSnapshot=structuredClone(snapshot);oldSnapshot.runtime_config.comment_scoring.audiences[0].fields.企业规模='另一类人群';oldSnapshot.runtime_config.comment_scoring.audiences[0].fields.决策岗位='另一职位';assert.equal(policy.verifyStoredScore(saved,oldSnapshot).status,'unknown');
});
test('legacy explicit signal fields remain accepted by the same single-pass mapper',async()=>{
 const legacy=structuredClone(rules);legacy.audiences=[{id:'old-id',fields:{意向信号:'怎么报名',人群描述:'职业学习',排除信号:'广告'}}];let calls=0;
 const r=await judge.judgeCommentOnce('怎么报名？','职业学习怎么报名','画像',{scoringRules:legacy,apiKey:'fixture-only',httpPost:async()=>{calls++;return {id:'legacy-response',model:judge.COMMANDER_MODEL,choices:[{message:{content:JSON.stringify({grade:'A',policy_evidence:{audience_id:'old-id',matched_rule:'怎么报名',comment_signal:'怎么报名',video_signal:'怎么报名',exclusion_rule:null,reason:'本人咨询'}})}}]};}});assert.equal(r.grade,'A');assert.equal(calls,1);
});

test('legacy deterministic saved-policy evaluation uses the same v26 business-reference mapper',async()=>{
 const snapshot=companyFixture('yuesheng');snapshot.runtime_config.comment_scoring=structuredClone(rules);
 const row={id:'00000000-0000-4000-8000-000000000632',comment_body:body,source_video:video,source_video_url:'https://www.douyin.com/video/7704584547186793910',relevance:'相关',intent_grade:'B',judgment_config:{run_id:'stored103',company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,version:snapshot.version,policy_id:snapshot.policy_id}};
 const verdict={grade:'B',audit:{model:judge.COMMANDER_MODEL,response_id:'stored-reference',policy_evidence:proof()}};
 assert.equal((await policy.evaluatePolicy(row,snapshot,{judgePolicy:async()=>verdict})).status,'pass');
 verdict.audit.policy_evidence.matched_rule='管理专属待复核';assert.equal((await policy.evaluatePolicy(row,snapshot,{judgePolicy:async()=>verdict})).status,'unknown');
});
