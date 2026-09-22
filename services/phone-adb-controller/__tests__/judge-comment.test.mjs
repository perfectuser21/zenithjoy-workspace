import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeComment, extractGrade, extractReason } from "../judge-comment.js";

test("extractGrade: 识别A/B/C/不相关/UNCERTAIN,不要求在第一行", () => {
  assert.equal(extractGrade("随便一行\nA"), "A");
  assert.equal(extractGrade("B\n原因：中等"), "B");
  assert.equal(extractGrade("C"), "C");
  assert.equal(extractGrade("不相关\n原因：广告号"), "不相关");
  assert.equal(extractGrade("UNCERTAIN\n原因：信息不足"), "UNCERTAIN");
  assert.equal(extractGrade("完全解析不出来的一段话"), null);
});

test("extractReason: 提取原因行", () => {
  assert.equal(extractReason("不相关\n原因：广告号"), "广告号");
  assert.equal(extractReason("不相关\n原因:广告号"), "广告号");
});

function fakeHttpPost(responses) {
  let i = 0;
  return async () => responses[i++];
}

test("judgeComment: 主判A档 → 直接返回,不调复核官", async () => {
  const calls = [];
  const httpPost = async (url, body) => { calls.push(body.model); return { choices: [{ message: { content: "A" } }] }; };
  const r = await judgeComment("怎么报名这个证书", "视频文案", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.grade, "A");
  assert.equal(r.relevance, "相关");
  assert.equal(calls.length, 1);
});

test("judgeComment: 主判不相关 → relevance派生为不相关", async () => {
  const httpPost = async () => ({ choices: [{ message: { content: "不相关\n原因：企业号" } }] });
  const r = await judgeComment("我们公司也做培训欢迎咨询", "视频文案", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.grade, "不相关");
  assert.equal(r.relevance, "不相关");
  assert.equal(r.reason, "企业号");
});

test("judgeComment: 主判UNCERTAIN → 复核官终审,必须给出A/B/C/不相关四选一(不能再回UNCERTAIN)", async () => {
  const httpPost = fakeHttpPost([
    { choices: [{ message: { content: "UNCERTAIN\n原因：语义模糊" } }] },
    { choices: [{ message: { content: "B" } }] },
  ]);
  const r = await judgeComment("这个", "视频文案", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.grade, "B");
  assert.equal(r.relevance, "相关");
});

test("judgeComment: 复核官调用失败 → 保守落C档,不是直接丢弃也不是冒充高意向", async () => {
  let call = 0;
  const httpPost = async () => { call++; if (call === 1) return { choices: [{ message: { content: "UNCERTAIN" } }] }; throw new Error("timeout"); };
  const r = await judgeComment("这个", "视频文案", "画像", { httpPost, apiKey: "k" });
  assert.equal(r.grade, "C");
  assert.equal(r.relevance, "相关");
  assert.match(r.reason, /调用失败/);
});

test("judgeComment: 复核官解析不出来(既不含ABC也不含不相关) → 保守落C档", async () => {
  const httpPost = fakeHttpPost([
    { choices: [{ message: { content: "UNCERTAIN" } }] },
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
