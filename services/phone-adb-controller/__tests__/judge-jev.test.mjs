import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeContent, JudgeApiError } from "../judge-jev.js";

function decisionsResp(choice, confidence) {
  return { answers: { verdict: { type: "choice", choice, confidence, probabilities: {} } } };
}

function fakeHttpPost(responses) {
  let i = 0;
  return async () => responses[i++];
}

test("judgeContent: 主判matched且高置信度 → 直接返回,不调复核官", async () => {
  const calls = [];
  const httpPost = async (url, body) => {
    calls.push(url);
    return decisionsResp("matched", 0.95);
  };
  const r = await judgeContent("内容", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.verdict, "matched");
  assert.equal(calls.length, 1, "高置信度matched不应该触发复核官调用");
  assert.equal(calls[0], "https://openrouter.ai/api/alpha/decisions");
  // 0929修复(DoD审计发现): 之前主判直接matched时reason是null,markVideoJudgment落库时
  // judgment_reason必为NULL,违反契约"judgment_reason非空"的断言且代码毫无感知。
  assert.ok(r.reason && r.reason.trim(), `matched也必须有非空reason,实际=${JSON.stringify(r.reason)}`);
});

test("judgeContent: 主判rejected且高置信度 → 直接返回,不调复核官", async () => {
  const httpPost = async () => decisionsResp("rejected", 0.9);
  const r = await judgeContent("内容", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.verdict, "rejected");
});

test("judgeContent: 主判低置信度 → 转复核官终审(准→matched)", async () => {
  const httpPost = fakeHttpPost([
    decisionsResp("matched", 0.3),
    { choices: [{ message: { content: "准" } }] },
  ]);
  const r = await judgeContent("内容", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.verdict, "matched");
  assert.match(r.reason, /commander:准/);
});

test("judgeContent: 主判低置信度 → 复核官判不准→rejected", async () => {
  const httpPost = fakeHttpPost([
    decisionsResp("rejected", 0.2),
    { choices: [{ message: { content: "不准" } }] },
  ]);
  const r = await judgeContent("内容", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.verdict, "rejected");
});

test("judgeContent: 主判response格式不对(answers.verdict缺失) → 当UNCERTAIN处理,交复核官", async () => {
  const httpPost = fakeHttpPost([
    { id: "x", answers: {} },
    { choices: [{ message: { content: "不准" } }] },
  ]);
  const r = await judgeContent("内容", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.verdict, "rejected");
  assert.match(r.reason, /parse_fallback/);
});

test("judgeContent: 主判choice不在matched/rejected内(脏数据) → 当UNCERTAIN处理", async () => {
  const httpPost = fakeHttpPost([
    decisionsResp("something_else", 0.9),
    { choices: [{ message: { content: "准" } }] },
  ]);
  const r = await judgeContent("内容", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.verdict, "matched");
});

// 0929 改口径: 复核官调用失败(网络/超时/402余额/429限流)是 API 故障,不是"内容不相关"。
// 旧实现保守判 rejected 并落库,等于把 OpenRouter 故障写成判定结论、误杀线索;
// 现在必须抛 JudgeApiError,由调用方保持 pending 留待重判。
test("judgeContent: 主判有key、复核官调用抛错(网络/超时) → 抛JudgeApiError,不冒充rejected", async () => {
  let call = 0;
  const httpPost = async () => {
    call++;
    if (call === 1) return decisionsResp("matched", 0.1);
    throw new Error("ECONNRESET");
  };
  await assert.rejects(
    () => judgeContent("内容", "画像", { httpPost, apiKey: "k" }),
    (e) => e instanceof JudgeApiError && /ECONNRESET/.test(e.message)
  );
});

test("judgeContent: 主判本身就没有key → 直接抛错(整条链条压根没法判,不该假装判成了rejected)", async () => {
  const httpPost = async () => decisionsResp("matched", 0.95);
  await assert.rejects(
    () => judgeContent("内容", "画像", { httpPost, env: { OPENROUTER_API_KEY_FILE: "/tmp/nope-xyz" } }),
    /找不到OPENROUTER_API_KEY/
  );
});

test("judgeContent: 复核官回复解析不出来 → 保守判rejected", async () => {
  const httpPost = fakeHttpPost([
    decisionsResp("rejected", 0.1),
    { choices: [{ message: { content: "这段话既不说准也不说不准" } }] },
  ]);
  const r = await judgeContent("内容", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.verdict, "rejected");
});

// ── 0929: OpenRouter 故障不许当成判定结论 ─────────────────────────────
// OpenRouter 账户 09-29 余额耗尽,所有调用回 402 {error:{code:402}}。旧实现:主判拿不到
// answers → parse_fallback → 复核官也 402 → "无法解析" → rejected,整批视频被静默判死。

test("judgeContent: 主判返回OpenRouter错误体(402余额不足) → 抛JudgeApiError,不调复核官", async () => {
  const calls = [];
  const httpPost = async (url) => { calls.push(url); return { error: { code: 402, message: "Insufficient credits" } }; };
  await assert.rejects(
    () => judgeContent("内容", "画像", { httpPost, apiKey: "k" }),
    (e) => e instanceof JudgeApiError && /402/.test(e.message)
  );
  assert.equal(calls.length, 1, "主判已经 API 故障,不该再去打复核官");
});

test("judgeContent: 复核官返回错误体(429限流) → 抛JudgeApiError,不冒充rejected", async () => {
  const httpPost = fakeHttpPost([
    decisionsResp("rejected", 0.2),
    { error: { code: 429, message: "Rate limit exceeded" } },
  ]);
  await assert.rejects(
    () => judgeContent("内容", "画像", { httpPost, apiKey: "k" }),
    (e) => e instanceof JudgeApiError && /429/.test(e.message)
  );
});

test("judgeContent: 默认HTTP层遇到非2xx(402) → 抛JudgeApiError", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false, status: 402,
    json: async () => ({ error: { code: 402, message: "Insufficient credits" } }),
    text: async () => '{"error":{"code":402}}',
  });
  try {
    await assert.rejects(
      () => judgeContent("内容", "画像", { apiKey: "k" }),
      (e) => e instanceof JudgeApiError && /402/.test(e.message)
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
