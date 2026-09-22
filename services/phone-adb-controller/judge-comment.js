// judge-comment.js —— 评论判定:Jev主判A/B/C/不相关四档 + 大模型兜底疑难案例
//
// 0922拍板:去掉sort-comments.js里原有的正则规则闸(GOLD/JUNK_WORDS/CHITCHAT/WRONG_AI)——
// 生产实测这套规则只判掉8.3%~9.1%的评论,九成以上早就在走模型判定,规则闸已无实际价值。
// 改成评论原文(+视频文案+目标人群)直接送Jev判A/B/C/不相关,拿不准的转大模型终审
// (终审只能在A/B/C/不相关里选一个,不再有第五态,防止判定死循环)。
//
// 0923真机实证修正(同judge-jev.js):Jev不走/chat/completions,走OpenRouter专用的
// POST /api/alpha/decisions,choice题型直接给四选一的criteria,输出choice+confidence,
// 不用再拿正则从自由文本里抠档位。已用真实OPENROUTER_API_KEY实测跑通。
"use strict";
const fs = require("fs");

const DECISIONS_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const COMMANDER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const JEV_MODEL = "typesafe/jev-1.13"; // 0923真机核对过,真实可用
const COMMANDER_MODEL = "google/gemini-2.5-flash-official";
const CONFIDENCE_THRESHOLD = 0.6; // 低于此值视为"拿不准",转复核官(与judge-jev.js同一阈值口径)
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

// 主判:调Jev的Decisions端点,choice题型四选一(A/B/C/不相关)。
// confidence低于阈值,或response格式不对(answers.grade缺失/choice不在四档内) → 当UNCERTAIN
// 处理,转复核官,不直接判死。
async function judgePrimary(comment, videoCaption, targetProfile, { httpPost = defaultHttpPost, apiKey, env } = {}) {
  const key = apiKey || resolveOpenRouterKey(env);
  if (!key) throw new Error("judgePrimary: 找不到OPENROUTER_API_KEY");
  const resp = await httpPost(
    DECISIONS_ENDPOINT,
    {
      model: JEV_MODEL,
      state: `目标客户画像:\n${targetProfile}\n\n视频文案:\n${videoCaption || "(无)"}\n\n评论原文:\n${comment}`,
      questions: {
        grade: {
          type: "choice",
          instructions: "这条评论按意向从强到弱分档",
          criteria: {
            A: "主动问价/问报名/求资料/明确求助(高意向)",
            B: "表达兴趣/相关讨论但没有明确行动意图(中意向)",
            C: "纯寒暄/表情互动,但确实是画像内人群(低意向,不是垃圾,不要丢)",
            "不相关": "同行企业号/广告引流号/完全跑题",
          },
        },
      },
    },
    key
  );
  const ans = resp && resp.answers && resp.answers.grade;
  if (!ans || !GRADES.includes(ans.choice)) {
    return { grade: "UNCERTAIN", reason: "parse_fallback" };
  }
  if ((ans.confidence ?? 0) < CONFIDENCE_THRESHOLD) {
    return { grade: "UNCERTAIN", reason: `低置信度(${ans.confidence})` };
  }
  return { grade: ans.choice, reason: ans.choice === "不相关" ? `confidence=${ans.confidence}` : null };
}

// 复核官只在A/B/C/不相关四档里选一个,不允许再回UNCERTAIN——终审必须给出终态。
// 无法解析/调用失败一律保守落在"C"(留档但低优先级,不是直接丢弃也不是冒充高意向,
// 跟评论判定"相关即留档"的0914理念一致——存疑不代表要扔)。这一段走普通chat completions,
// 跟Jev的Decisions端点无关,不受本次API修正影响。
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
    resp = await httpPost(COMMANDER_ENDPOINT, { model: COMMANDER_MODEL, messages: [{ role: "user", content: prompt }] }, key);
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
  resolveOpenRouterKey,
  GRADES,
  JEV_MODEL,
  COMMANDER_MODEL,
  DECISIONS_ENDPOINT,
  CONFIDENCE_THRESHOLD,
};
