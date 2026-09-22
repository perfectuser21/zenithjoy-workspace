import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeContent } from "../judge-jev.js";

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

test("judgeContent: 主判有key、复核官调用抛错(网络/超时) → 保守判rejected,不让异常炸穿整条判定链", async () => {
  let call = 0;
  const httpPost = async () => {
    call++;
    if (call === 1) return decisionsResp("matched", 0.1);
    throw new Error("ECONNRESET");
  };
  const r = await judgeContent("内容", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.verdict, "rejected");
  assert.match(r.reason, /调用失败/);
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
