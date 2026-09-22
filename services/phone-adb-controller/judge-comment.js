// judge-comment.js —— 评论判定:Jev主判A/B/C/不相关四档 + 大模型兜底疑难案例
//
// 0922拍板:去掉sort-comments.js里原有的正则规则闸(GOLD/JUNK_WORDS/CHITCHAT/WRONG_AI)——
// 生产实测这套规则只判掉8.3%~9.1%的评论,九成以上早就在走模型判定,规则闸已无实际价值。
// 改成评论原文(+视频文案+目标人群)直接送Jev判A/B/C/不相关,拿不准的转大模型终审
// (终审只能在A/B/C/不相关里选一个,不再有第五态,防止判定死循环)。
//
// ⚠️ JEV_MODEL的OpenRouter model slug是占位,部署前需要真实OPENROUTER_API_KEY核对。
"use strict";
const fs = require("fs");

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const JEV_MODEL = "typesafe/jev"; // TODO: 部署前核对OpenRouter真实model slug(同judge-jev.js)
const COMMANDER_MODEL = "google/gemini-2.5-flash-official";
const GRADES = ["A", "B", "C", "不相关"];

function resolveOpenRouterKey(env = process.env) {
  if (env.OPENROUTER_API_KEY) return env.OPENROUTER_API_KEY;
  const keyfile = env.OPENROUTER_API_KEY_FILE || `${env.HOME || ""}/.credentials/openrouter.env`;
  try {
    const content = fs.readFileSync(keyfile, "utf8");
    const m = content.match(/^OPENROUTER_API_KEY=(.+)$/m);
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}

async function defaultHttpPost(url, body, apiKey) {
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

function buildPrimaryPrompt(comment, videoCaption, targetProfile) {
  return `你是一个评论意向分档助手。这条评论来自下面这个视频的评论区。

目标客户画像:
${targetProfile}

视频文案:
${videoCaption || "(无)"}

评论原文:
${comment}

判断规则,按意向从强到弱四档:
A = 主动问价/问报名/求资料/明确求助(高意向)
B = 表达兴趣/相关讨论但没有明确行动意图(中意向)
C = 纯寒暄/表情互动,但确实是画像内人群(低意向,不是垃圾,不要丢)
不相关 = 同行企业号/广告引流号/完全跑题

如果拿不准落在哪一档,回复UNCERTAIN,并说明为什么拿不准(不超过30字)。

请严格按格式回复:
第一行:A 或 B 或 C 或 不相关 或 UNCERTAIN
如果不是明确档位,第二行:原因:...`;
}

function extractGrade(text) {
  for (const line of (text || "").trim().split("\n")) {
    const t = line.trim();
    if (/^UNCERTAIN\b/i.test(t)) return "UNCERTAIN";
    if (t === "A" || t.startsWith("A ") || t.startsWith("A,") || t.startsWith("A、")) return "A";
    if (t === "B" || t.startsWith("B ") || t.startsWith("B,") || t.startsWith("B、")) return "B";
    if (t === "C" || t.startsWith("C ") || t.startsWith("C,") || t.startsWith("C、")) return "C";
    if (t.startsWith("不相关")) return "不相关";
  }
  return null;
}

function extractReason(text) {
  const line = (text || "").trim().split("\n").find((l) => l.includes("原因：") || l.includes("原因:"));
  return line ? line.replace(/^原因[：:]/, "").trim() : null;
}

async function judgePrimary(comment, videoCaption, targetProfile, { httpPost = defaultHttpPost, apiKey, env } = {}) {
  const key = apiKey || resolveOpenRouterKey(env);
  if (!key) throw new Error("judgePrimary: 找不到OPENROUTER_API_KEY");
  const resp = await httpPost(
    OPENROUTER_ENDPOINT,
    { model: JEV_MODEL, messages: [{ role: "user", content: buildPrimaryPrompt(comment, videoCaption, targetProfile) }] },
    key
  );
  const raw = resp && resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
  const grade = extractGrade(raw);
  if (!grade) return { grade: "UNCERTAIN", reason: "parse_fallback" };
  return { grade, reason: grade === "不相关" ? extractReason(raw) || "不相关" : null };
}

// 复核官只在A/B/C/不相关四档里选一个,不允许再回UNCERTAIN——终审必须给出终态。
// 无法解析/调用失败一律保守落在"C"(留档但低优先级,不是直接丢弃也不是冒充高意向,
// 跟评论判定"相关即留档"的0914理念一致——存疑不代表要扔)。
async function judgeCommander(comment, videoCaption, targetProfile, primaryReason, { httpPost = defaultHttpPost, apiKey, env } = {}) {
  const key = apiKey || resolveOpenRouterKey(env);
  if (!key) return { grade: "C", reason: `commander:no_api_key|${primaryReason || ""}` };
  const prompt = `你是评论意向分档的复核官。主判对下面这条评论拿不准,现在交给你终审。
你必须在 A/B/C/不相关 四个里选一个,不能再回答"拿不准"。

目标客户画像:
${targetProfile}

视频文案:
${videoCaption || "(无)"}

评论原文:
${comment}

主判为什么拿不准:${primaryReason || "未知"}

请严格只回一个词:A 或 B 或 C 或 不相关`;
  let resp;
  try {
    resp = await httpPost(OPENROUTER_ENDPOINT, { model: COMMANDER_MODEL, messages: [{ role: "user", content: prompt }] }, key);
  } catch (e) {
    return { grade: "C", reason: `commander:调用失败(${String(e.message || e).slice(0, 60)})|${primaryReason || ""}` };
  }
  const raw = resp && resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
  const t = (raw || "").trim();
  if (t.includes("不相关")) return { grade: "不相关", reason: `commander:不相关|${primaryReason || ""}` };
  if (t.includes("A")) return { grade: "A", reason: `commander:A|${primaryReason || ""}` };
  if (t.includes("B")) return { grade: "B", reason: `commander:B|${primaryReason || ""}` };
  if (t.includes("C")) return { grade: "C", reason: `commander:C|${primaryReason || ""}` };
  return { grade: "C", reason: `commander:无法解析|${primaryReason || ""}` };
}

// 对外统一入口:永远返回A/B/C/不相关四档之一,relevance派生自grade(不相关=不相关,其余=相关)。
async function judgeComment(comment, videoCaption, targetProfile, opts = {}) {
  const primary = await judgePrimary(comment, videoCaption, targetProfile, opts);
  const final = primary.grade === "UNCERTAIN"
    ? await judgeCommander(comment, videoCaption, targetProfile, primary.reason, opts)
    : primary;
  return {
    grade: final.grade,
    relevance: final.grade === "不相关" ? "不相关" : "相关",
    reason: final.reason,
  };
}

module.exports = {
  judgeComment,
  judgePrimary,
  judgeCommander,
  extractGrade,
  extractReason,
  resolveOpenRouterKey,
  GRADES,
  JEV_MODEL,
  COMMANDER_MODEL,
};
