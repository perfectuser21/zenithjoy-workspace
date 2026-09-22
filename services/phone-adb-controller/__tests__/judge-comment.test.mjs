import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeComment } from "../judge-comment.js";

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
  const r = await judgeComment("怎么报名这个证书", "视频文案", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.grade, "A");
  assert.equal(r.relevance, "相关");
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "https://openrouter.ai/api/alpha/decisions");
});

test("judgeComment: 主判不相关且高置信度 → relevance派生为不相关", async () => {
  const httpPost = async () => decisionsResp("不相关", 0.85);
  const r = await judgeComment("我们公司也做培训欢迎咨询", "视频文案", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.grade, "不相关");
  assert.equal(r.relevance, "不相关");
});

test("judgeComment: 主判低置信度 → 复核官终审,必须给出A/B/C/不相关四选一(不能再回UNCERTAIN)", async () => {
  const httpPost = fakeHttpPost([
    decisionsResp("A", 0.2),
    { choices: [{ message: { content: "B" } }] },
  ]);
  const r = await judgeComment("这个", "视频文案", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.grade, "B");
  assert.equal(r.relevance, "相关");
});

test("judgeComment: 主判response格式不对(answers.grade缺失) → 当UNCERTAIN处理,交复核官", async () => {
  const httpPost = fakeHttpPost([
    { id: "x", answers: {} },
    { choices: [{ message: { content: "B" } }] },
  ]);
  const r = await judgeComment("这个", "视频文案", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.grade, "B");
});

test("judgeComment: 复核官调用失败 → 保守落C档,不是直接丢弃也不是冒充高意向", async () => {
  let call = 0;
  const httpPost = async () => { call++; if (call === 1) return decisionsResp("A", 0.1); throw new Error("timeout"); };
  const r = await judgeComment("这个", "视频文案", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.grade, "C");
  assert.equal(r.relevance, "相关");
  assert.match(r.reason, /调用失败/);
});

test("judgeComment: 复核官解析不出来(既不含ABC也不含不相关) → 保守落C档", async () => {
  const httpPost = fakeHttpPost([
    decisionsResp("A", 0.1),
    { choices: [{ message: { content: "我也不知道" } }] },
  ]);
  const r = await judgeComment("这个", "视频文案", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.grade, "C");
});

test("judgeComment: 主判没有key → 抛错,不冒充判成了任何一档", async () => {
  await assert.rejects(
    () => judgeComment("x", "y", "z", { httpPost: async () => ({}), env: { OPENROUTER_API_KEY_FILE: "/tmp/nope-xyz" } }),
    /找不到OPENROUTER_API_KEY/
  );
});
