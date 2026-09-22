// judge-jev.js —— 视频/评论内容判定:Jev主判 + 大模型兜底疑难案例
//
// 0923真机实证修正:Jev不是普通聊天模型,不走/chat/completions这条路——它是OpenRouter
// 的"Decisions"专用端点(POST /api/alpha/decisions),输入state(待判定文本)+questions
// (choice/noul/score三种题型定义),输出结构化的choice+confidence+probabilities,不是
// 自由文本。0922那版按chat completions写的prompt+正则解析完全用错了API,已用真实
// OPENROUTER_API_KEY实测correct跑通(见 __tests__/judge-jev.test.mjs 里的live smoke注释)。
//
// UNCERTAIN不再是Jev自己的输出态——Jev固定二选一(matched/rejected),用confidence低于
// 阈值近似原设计里的"拿不准",转大模型复核,复核依然只返回matched/rejected两态。
"use strict";
const fs = require("fs");

const DECISIONS_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const COMMANDER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const JEV_MODEL = "typesafe/jev-1.13"; // 0923真机核对过,真实可用
const COMMANDER_MODEL = "google/gemini-2.5-flash-official"; // 复核官,跟系统①content-judgment.ts同款选型
const CONFIDENCE_THRESHOLD = 0.6; // 低于此值视为"拿不准",转复核官(阈值可调,暂无真机统计支撑,先用保守值)

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

// 主判:调Jev的Decisions端点,choice题型二选一(matched/rejected)。
// confidence低于阈值 → 当UNCERTAIN处理,交复核官;response格式不对(answers.verdict缺失)
// 同样当UNCERTAIN处理,不直接判死。
async function judgePrimary(text, targetProfile, { httpPost = defaultHttpPost, apiKey, env } = {}) {
  const key = apiKey || resolveOpenRouterKey(env);
  if (!key) throw new Error("judgePrimary: 找不到OPENROUTER_API_KEY");
  const resp = await httpPost(
    DECISIONS_ENDPOINT,
    {
      model: JEV_MODEL,
      state: `内容:\n${text}\n\n目标客户画像:\n${targetProfile}`,
      questions: {
        verdict: {
          type: "choice",
          instructions: "这段内容是否匹配目标客户画像,评论区/内容本身是否可能吸引到潜在客户",
          criteria: { matched: "内容与目标客户画像高度相关", rejected: "内容与目标客户画像明显不相关" },
        },
      },
    },
    key
  );
  const ans = resp && resp.answers && resp.answers.verdict;
  if (!ans || (ans.choice !== "matched" && ans.choice !== "rejected")) {
    return { verdict: "UNCERTAIN", reason: "parse_fallback" };
  }
  if ((ans.confidence ?? 0) < CONFIDENCE_THRESHOLD) {
    return { verdict: "UNCERTAIN", reason: `低置信度(${ans.confidence})` };
  }
  return { verdict: ans.choice.toUpperCase(), reason: ans.choice === "matched" ? null : `confidence=${ans.confidence}` };
}

// 复核官:大模型,只回答"准"或"不准",无法解析一律保守判"不准"(存疑不放行,
// 跟系统①content-judgment.ts的commanderReview同一分寸)。这一段走普通chat completions,
// 跟Jev的Decisions端点无关,不受本次API修正影响。
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
  let resp;
  try {
    resp = await httpPost(COMMANDER_ENDPOINT, { model: COMMANDER_MODEL, messages: [{ role: "user", content: prompt }] }, key);
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
  // UNCERTAIN(或解析失败/低置信度) → 复核官终审
  return judgeCommander(text, targetProfile, primary.reason, opts);
}

module.exports = {
  judgeContent,
  judgePrimary,
  judgeCommander,
  resolveOpenRouterKey,
  JEV_MODEL,
  COMMANDER_MODEL,
  DECISIONS_ENDPOINT,
  CONFIDENCE_THRESHOLD,
};
