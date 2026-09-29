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

// 0929 改口径: 复核官调用失败是 API 故障,不能静默降为 C 档写进线索表——
// 抛 JudgeApiError,sort-comments.js 计「判定异常N条(留待分拣)」,池行保持「待分拣」下轮重判。
test("judgeComment: 复核官调用失败 → 抛JudgeApiError(留待分拣),不静默降C档", async () => {
  let call = 0;
  const httpPost = async () => { call++; if (call === 1) return decisionsResp("A", 0.1); throw new Error("timeout"); };
  await assert.rejects(
    () => judgeComment("这个", "视频文案", "画像", { httpPost, apiKey: "k" }),
    (e) => e instanceof JudgeApiError && /timeout/.test(e.message)
  );
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

// ── 0929: OpenRouter 故障(402余额耗尽/429)不许静默降为 C 档 ──────────

test("judgeComment: 主判返回OpenRouter错误体(402) → 抛JudgeApiError,不调复核官", async () => {
  const calls = [];
  const httpPost = async (url) => { calls.push(url); return { error: { code: 402, message: "Insufficient credits" } }; };
  await assert.rejects(
    () => judgeComment("怎么报名", "视频文案", "画像", { httpPost, apiKey: "k" }),
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
    () => judgeComment("这个", "视频文案", "画像", { httpPost, apiKey: "k" }),
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
      () => judgeComment("x", "y", "z", { apiKey: "k" }),
      (e) => e instanceof JudgeApiError && /429/.test(e.message)
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
