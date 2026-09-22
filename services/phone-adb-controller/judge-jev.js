// judge-jev.js —— 视频/评论内容判定:Jev主判 + 大模型兜底疑难案例
//
// Jev(TypeSafe AI 2026-09-15发布的"System One"决策模型,经OpenRouter接入)对文本判定
// MATCHED/REJECTED/UNCERTAIN三态,响应70-500ms、比同类大模型快40-200倍/便宜400倍;
// UNCERTAIN的才转一次大模型(如gemini-2.5-flash-official)复核,复核只能返回matched或
// rejected两态之一,不再有第三态——避免判定在"拿不准"上无限循环。
//
// ⚠️ JEV_MODEL 是OpenRouter上的model slug占位——Jev是2026-09-22当天刚查到的全新产品,
// 本PR没有真实凭据/真机环境核对过它在OpenRouter上的准确注册名和判定输出的确切字段
// 形状,部署前必须先用真实OPENROUTER_API_KEY跑一次核对,如有出入以真机为准调整。
"use strict";
const fs = require("fs");

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const JEV_MODEL = "typesafe/jev"; // TODO: 部署前核对OpenRouter真实model slug
const COMMANDER_MODEL = "google/gemini-2.5-flash-official"; // 复核官,跟系统①content-judgment.ts同款选型

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

function buildPrimaryPrompt(text, targetProfile) {
  return `你是一个内容判决助手。根据以下目标客户画像,判断这段内容是否匹配目标客户群体。

目标客户画像:
${targetProfile}

内容:
${text}

判断规则:
1. 高度相关 → 回复:MATCHED
2. 明显不相关 → 回复:REJECTED,并简短说明原因(不超过30字)
3. 拿不准 → 回复:UNCERTAIN,并简短说明为什么拿不准(不超过30字)

请严格按格式回复:
第一行:MATCHED 或 REJECTED 或 UNCERTAIN
如果不是MATCHED,第二行:原因:...`;
}

function extractVerdict(text) {
  for (const line of (text || "").trim().split("\n")) {
    const m = line.trim().toUpperCase().match(/\b(MATCHED|REJECTED|UNCERTAIN)\b/);
    if (m) return m[1];
  }
  return null;
}

function extractReason(text) {
  const line = (text || "").trim().split("\n").find((l) => l.includes("原因：") || l.includes("原因:"));
  return line ? line.replace(/^原因[：:]/, "").trim() : null;
}

// 主判:Jev,输出MATCHED/REJECTED/UNCERTAIN之一。解析不出来(格式不对/网络异常等)
// 一律当UNCERTAIN处理,交给复核官兜底,不直接放行也不直接丢弃。
async function judgePrimary(text, targetProfile, { httpPost = defaultHttpPost, apiKey, env } = {}) {
  const key = apiKey || resolveOpenRouterKey(env);
  if (!key) throw new Error("judgePrimary: 找不到OPENROUTER_API_KEY");
  const resp = await httpPost(
    OPENROUTER_ENDPOINT,
    { model: JEV_MODEL, messages: [{ role: "user", content: buildPrimaryPrompt(text, targetProfile) }] },
    key
  );
  const raw = resp && resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
  const verdict = extractVerdict(raw);
  if (!verdict) return { verdict: "UNCERTAIN", reason: "parse_fallback" };
  return { verdict, reason: verdict === "MATCHED" ? null : extractReason(raw) || verdict };
}

// 复核官:大模型,只回答"准"或"不准",无法解析一律保守判"不准"(存疑不放行,
// 跟系统①content-judgment.ts的commanderReview同一分寸)。
async function judgeCommander(text, targetProfile, primaryReason, { httpPost = defaultHttpPost, apiKey, env } = {}) {
  const key = apiKey || resolveOpenRouterKey(env);
  if (!key) return { verdict: "rejected", reason: "no_api_key" };
  const prompt = `你是内容判决的复核官。主判对下面这段内容拿不准、判为"存疑",现在交给你终审。
你只需回答:这段内容是否匹配目标客户画像——只回"准"(匹配)或"不准"(不匹配)。

目标客户画像:
${targetProfile}

内容:
${text}

主判为什么拿不准:${primaryReason || "未知"}

请严格只回一个词:准 或 不准`;
  // 复核官是最后一道关卡,任何调用失败(网络/超时/网关错误)都不能让异常往上抛出把
  // 整条判定链断掉——保守判rejected,跟"解析不出来"同样处理,绝不能因为复核官挂了
  // 就把一条UNCERTAIN悄悄放行成matched。
  let resp;
  try {
    resp = await httpPost(OPENROUTER_ENDPOINT, { model: COMMANDER_MODEL, messages: [{ role: "user", content: prompt }] }, key);
  } catch (e) {
    return { verdict: "rejected", reason: `commander:调用失败(${String(e.message || e).slice(0, 60)})|${primaryReason || ""}` };
  }
  const raw = resp && resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
  const t = (raw || "").trim();
  if (t.includes("不准") || t.includes("不匹配")) return { verdict: "rejected", reason: `commander:不准|${primaryReason || ""}` };
  if (t.includes("准") || t.includes("匹配")) return { verdict: "matched", reason: `commander:准|${primaryReason || ""}` };
  return { verdict: "rejected", reason: `commander:无法解析|${primaryReason || ""}` };
}

// 对外统一入口:永远只返回 matched 或 rejected 两态,内部处理完UNCERTAIN转复核的逻辑。
async function judgeContent(text, targetProfile, opts = {}) {
  const primary = await judgePrimary(text, targetProfile, opts);
  if (primary.verdict === "MATCHED") return { verdict: "matched", reason: primary.reason };
  if (primary.verdict === "REJECTED") return { verdict: "rejected", reason: primary.reason };
  // UNCERTAIN(或解析失败) → 复核官终审
  return judgeCommander(text, targetProfile, primary.reason, opts);
}

module.exports = {
  judgeContent,
  judgePrimary,
  judgeCommander,
  extractVerdict,
  extractReason,
  resolveOpenRouterKey,
  JEV_MODEL,
  COMMANDER_MODEL,
};
