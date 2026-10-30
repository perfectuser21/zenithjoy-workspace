import {scoringRules} from './company-config-fixture.mjs';
import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeComment, JudgeApiError } from "../judge-comment.js";

function decisionsResp(choice, confidence) {
  return { answers: { grade: { type: "choice", choice, confidence, probabilities: {} } } };
}

function fakeHttpPost(responses) {
  let i = 0;
  return async () => responses[i++];
}

test("judgeComment: 主判A档且高置信度 → 直接返回,不调复核官", async () => {
  const calls = [];
  const httpPost = async (url) => { calls.push(url); return decisionsResp("A", 0.9); };
  const r = await judgeComment("怎么报名这个证书", "视频文案", "画像", { scoringRules, httpPost, apiKey: "k" });
  assert.equal(r.grade, "A");
  assert.equal(r.relevance, "相关");
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "https://openrouter.ai/api/alpha/decisions");
});

test("judgeComment: 主判不相关且高置信度 → relevance派生为不相关", async () => {
  const httpPost = async () => decisionsResp("不相关", 0.85);
  const r = await judgeComment("我们公司也做培训欢迎咨询", "视频文案", "画像", { scoringRules, httpPost, apiKey: "k" });
  assert.equal(r.grade, "不相关");
  assert.equal(r.relevance, "不相关");
});

const audited = (grade='B') => ({id:'response-123',model:'google/gemini-2.5-flash',choices:[{message:{content:JSON.stringify({grade,policy_evidence:{audience_id:'audience-1',matched_rule:'意向信号',exclusion_rule:null,reason:'主动咨询考试资料'}})}}]});
const missingExclusion = () => ({id:'response-invalid',model:'google/gemini-2.5-flash',choices:[{message:{content:JSON.stringify({grade:'B',policy_evidence:{audience_id:'audience-1',matched_rule:'意向信号',reason:'主动咨询考试资料'}})}}]});
const evidenceRules = {...scoringRules,audiences:[{id:'audience-1',fields:{'意向信号':'意向信号','排除信号':'泛失业或创业焦虑'}}]};

test('Commander首次省略排除证据后仅重试一次，有效证据才评分且Jev只调用一次',async()=>{
 const calls=[];const replies=[decisionsResp('A',.2),missingExclusion(),audited()];
 const httpPost=async(url,body)=>{calls.push({url,body});return replies.shift();};
 const result=await judgeComment('这个','视频文案','画像',{scoringRules:evidenceRules,httpPost,apiKey:'k'});
 assert.equal(result.grade,'B');assert.equal(result.audit.response_id,'response-123');
 assert.deepEqual(calls.map(c=>c.url),[
  'https://openrouter.ai/api/alpha/decisions',
  'https://openrouter.ai/api/v1/chat/completions',
  'https://openrouter.ai/api/v1/chat/completions',
 ]);
 assert.match(calls[2].body.messages[0].content,/exclusion_rule 必须出现/);
});

test('Commander连续两次省略排除证据仍阻断，不能默认无排除或无限重试',async()=>{
 const calls=[];const replies=[decisionsResp('A',.2),missingExclusion(),missingExclusion()];
 const httpPost=async(url)=>{calls.push(url);return replies.shift();};
 await assert.rejects(judgeComment('这个','视频文案','画像',{scoringRules:evidenceRules,httpPost,apiKey:'k'}),/COMMANDER_EVIDENCE_INVALID/);
 assert.equal(calls.filter(url=>url.endsWith('/decisions')).length,1);
 assert.equal(calls.filter(url=>url.endsWith('/chat/completions')).length,2);
});

test("judgeComment: 低置信度终审必须有独立档位、响应身份和政策依据", async () => {
  const httpPost = fakeHttpPost([
    decisionsResp("A", 0.2),
    audited(),
  ]);
  const r = await judgeComment("这个", "视频文案", "画像", { scoringRules:{...scoringRules,audiences:[{id:'audience-1',fields:{'意向信号':'意向信号','排除信号':'泛失业或创业焦虑'}}]}, httpPost, apiKey: "k" });
  assert.equal(r.grade, "B");
  assert.equal(r.relevance, "相关");
  assert.equal(r.audit.response_id,'response-123');
  assert.equal(r.audit.model,'google/gemini-2.5-flash');
  assert.equal(r.audit.confidence,null);
});

test("judgeComment: 主判response格式不对，终审缺依据即失败", async () => {
  const httpPost = fakeHttpPost([
    { id: "x", answers: {} },
    { choices: [{ message: { content: "B" } }] },
  ]);
  await assert.rejects(judgeComment("这个", "视频文案", "画像", { scoringRules, httpPost, apiKey: "k" }),/COMMANDER_EVIDENCE_INVALID/);
});

// 0929 改口径: 复核官调用失败是 API 故障,不能静默降为 C 档写进线索表——
// 抛 JudgeApiError,sort-comments.js 计「判定异常N条(留待分拣)」,池行保持「待分拣」下轮重判。
test("judgeComment: 复核官调用失败 → 抛JudgeApiError(留待分拣),不静默降C档", async () => {
  let call = 0;
  const httpPost = async () => { call++; if (call === 1) return decisionsResp("A", 0.1); throw new Error("timeout"); };
  await assert.rejects(
    () => judgeComment("这个", "视频文案", "画像", { scoringRules, httpPost, apiKey: "k" }),
    (e) => e instanceof JudgeApiError && /timeout/.test(e.message)
  );
});

test("judgeComment: 复核官解析不出来或reason含A，不能猜档位或默认C", async () => {
  const httpPost = fakeHttpPost([
    decisionsResp("A", 0.1),
    { id:'response-123',model:'google/gemini-2.5-flash',choices: [{ message: { content: '{"reason":"A客户似乎有兴趣"}' } }] },
  ]);
  await assert.rejects(judgeComment("这个", "视频文案", "画像", { scoringRules, httpPost, apiKey: "k" }),/COMMANDER_EVIDENCE_INVALID/);
});

test('终审空排除项或回显整条评论不能成为合格审计依据',async()=>{
 const body='这是一条需要被脱敏的完整私有评论';const rules={...scoringRules,audiences:[{id:'audience-1',fields:{'意向信号':'报名','排除信号':'泛失业或创业焦虑','人群描述':'职场人'}}]};
 for(const policy_evidence of [
  {audience_id:'audience-1',matched_rule:'报名',exclusion_rule:'',reason:'有意向'},
  {audience_id:'audience-1',matched_rule:'报名',exclusion_rule:null,reason:body},
 ]){
  const httpPost=fakeHttpPost([decisionsResp('A',.1),{id:'r1',model:'google/gemini-2.5-flash',choices:[{message:{content:JSON.stringify({grade:'A',policy_evidence})}}]}]);
  await assert.rejects(judgeComment(body,'视频','画像',{scoringRules:rules,httpPost,apiKey:'k'}),/COMMANDER_EVIDENCE_INVALID/);
 }
});
test('空评论和超长评论在模型网络请求前拒绝',async()=>{
 let calls=0;for(const body of ['', '字'.repeat(5000)])await assert.rejects(judgeComment(body,'视频','画像',{scoringRules,httpPost:async()=>{calls++;return decisionsResp('A',.9);},apiKey:'k'}),/COMMENT_INPUT_INVALID/);
 assert.equal(calls,0);
});
test('真实模型HTTP请求必须有超时signal，不能无限等待终审',async()=>{
 const original=globalThis.fetch;let signal;
 globalThis.fetch=async(_url,opts)=>{signal=opts.signal;return {ok:true,json:async()=>decisionsResp('A',.9)};};
 try{await judgeComment('人工智能训练师报名','视频','画像',{scoringRules,apiKey:'fake'});assert.ok(signal instanceof AbortSignal);}finally{globalThis.fetch=original;}
});

test("judgeComment: 主判没有key → 抛错,不冒充判成了任何一档", async () => {
  await assert.rejects(
    () => judgeComment("x", "y", "z", { scoringRules, httpPost: async () => ({}), env: { OPENROUTER_API_KEY_FILE: "/tmp/nope-xyz" } }),
    /找不到OPENROUTER_API_KEY/
  );
});

// ── 0929: OpenRouter 故障(402余额耗尽/429)不许静默降为 C 档 ──────────

test("judgeComment: 主判返回OpenRouter错误体(402) → 抛JudgeApiError,不调复核官", async () => {
  const calls = [];
  const httpPost = async (url) => { calls.push(url); return { error: { code: 402, message: "Insufficient credits" } }; };
  await assert.rejects(
    () => judgeComment("怎么报名", "视频文案", "画像", { scoringRules, httpPost, apiKey: "k" }),
    (e) => e instanceof JudgeApiError && /402/.test(e.message)
  );
  assert.equal(calls.length, 1);
});

test("judgeComment: 复核官返回错误体(402) → 抛JudgeApiError,不落C档", async () => {
  const httpPost = fakeHttpPost([
    decisionsResp("B", 0.2),
    { error: { code: 402, message: "Insufficient credits" } },
  ]);
  await assert.rejects(
    () => judgeComment("这个", "视频文案", "画像", { scoringRules, httpPost, apiKey: "k" }),
    (e) => e instanceof JudgeApiError && /402/.test(e.message)
  );
});

test("judgeComment: 默认HTTP层遇到非2xx(429) → 抛JudgeApiError", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false, status: 429,
    json: async () => ({ error: { code: 429, message: "Rate limit" } }),
    text: async () => '{"error":{"code":429}}',
  });
  try {
    await assert.rejects(
      () => judgeComment("x", "y", "z", { scoringRules, apiKey: "k" }),
      (e) => e instanceof JudgeApiError && /429/.test(e.message)
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
