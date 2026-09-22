import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeContent, extractVerdict, extractReason } from "../judge-jev.js";

test("extractVerdict: 从多行文本里找MATCHED/REJECTED/UNCERTAIN,不要求在第一行", () => {
  assert.equal(extractVerdict("第一行随便\nMATCHED"), "MATCHED");
  assert.equal(extractVerdict("REJECTED\n原因：不相关"), "REJECTED");
  assert.equal(extractVerdict("没有任何关键词"), null);
});

test("extractReason: 提取原因行,支持中英文冒号", () => {
  assert.equal(extractReason("REJECTED\n原因：广告号"), "广告号");
  assert.equal(extractReason("REJECTED\n原因:广告号"), "广告号");
  assert.equal(extractReason("REJECTED"), null);
});

function fakeHttpPost(responses) {
  let i = 0;
  return async () => responses[i++];
}

test("judgeContent: 主判MATCHED直接返回,不调复核官", async () => {
  const calls = [];
  const httpPost = async (url, body) => {
    calls.push(body.model);
    return { choices: [{ message: { content: "MATCHED" } }] };
  };
  const r = await judgeContent("内容", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.verdict, "matched");
  assert.equal(calls.length, 1, "MATCHED不应该触发复核官调用");
});

test("judgeContent: 主判REJECTED直接返回,不调复核官", async () => {
  const httpPost = async () => ({ choices: [{ message: { content: "REJECTED\n原因：广告号" } }] });
  const r = await judgeContent("内容", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.verdict, "rejected");
  assert.equal(r.reason, "广告号");
});

test("judgeContent: 主判UNCERTAIN → 转复核官终审(准→matched)", async () => {
  const httpPost = fakeHttpPost([
    { choices: [{ message: { content: "UNCERTAIN\n原因：信息不足" } }] },
    { choices: [{ message: { content: "准" } }] },
  ]);
  const r = await judgeContent("内容", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.verdict, "matched");
});

test("judgeContent: 主判UNCERTAIN → 复核官判不准→rejected", async () => {
  const httpPost = fakeHttpPost([
    { choices: [{ message: { content: "UNCERTAIN" } }] },
    { choices: [{ message: { content: "不准" } }] },
  ]);
  const r = await judgeContent("内容", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.verdict, "rejected");
});

test("judgeContent: 主判输出解析不出来(格式错乱) → 当UNCERTAIN处理,交复核官", async () => {
  const httpPost = fakeHttpPost([
    { choices: [{ message: { content: "这是一段模型瞎说的话,没有任何关键词" } }] },
    { choices: [{ message: { content: "不准" } }] },
  ]);
  const r = await judgeContent("内容", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.verdict, "rejected");
  assert.match(r.reason, /parse_fallback/);
});

test("judgeContent: 主判有key、复核官调用抛错(网络/超时) → 保守判rejected,不让异常炸穿整条判定链", async () => {
  let call = 0;
  const httpPost = async () => {
    call++;
    if (call === 1) return { choices: [{ message: { content: "UNCERTAIN" } }] };
    throw new Error("ECONNRESET");
  };
  const r = await judgeContent("内容", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.verdict, "rejected");
  assert.match(r.reason, /调用失败/);
});

test("judgeContent: 主判本身就没有key → 直接抛错(整条链条压根没法判,不该假装判成了rejected)", async () => {
  const httpPost = async () => ({ choices: [{ message: { content: "MATCHED" } }] });
  await assert.rejects(
    () => judgeContent("内容", "画像", { httpPost, env: { OPENROUTER_API_KEY_FILE: "/tmp/nope-xyz" } }),
    /找不到OPENROUTER_API_KEY/
  );
});

test("judgeContent: 复核官回复解析不出来 → 保守判rejected", async () => {
  const httpPost = fakeHttpPost([
    { choices: [{ message: { content: "UNCERTAIN" } }] },
    { choices: [{ message: { content: "这段话既不说准也不说不准" } }] },
  ]);
  const r = await judgeContent("内容", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.verdict, "rejected");
});
