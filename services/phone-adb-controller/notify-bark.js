// notify-bark.js —— 触达告警通道(mmv 上跑,由 xian-m4 上的 outreach-tick.sh 经 ssh 调用)
// 用法: node notify-bark.js <title_b64> <body_b64> [level]
//   token 读 ~/.credentials/bark.env 里的 BARK_TOKEN(格式 `export BARK_TOKEN=...`,自己解析,绝不打印)。
//   成功打印 BARK_OK;任何失败只 console.error 一行原因并 exit 0——告警失败不得影响调用方。
// 0928 由来: 熔断/平台风控发生后没有任何告警,无人知道触达停了。
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

// 解析 bark.env 文本里的 BARK_TOKEN(支持 export 前缀、单/双引号、注释与空行);缺失/空值返回 null
function parseBarkToken(text) {
  if (typeof text !== "string") return null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?BARK_TOKEN\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[1];
    if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) v = v.slice(1, -1);
    return v ? v : null;
  }
  return null;
}

function buildBarkUrl(token, title, body, level) {
  return `https://api.day.app/${token}/${encodeURIComponent(title)}/${encodeURIComponent(body)}?group=leadgen&level=${level || "timeSensitive"}`;
}

async function main() {
  const [, , titleB64, bodyB64, level] = process.argv;
  if (!titleB64 || !bodyB64) { console.error("notify-bark: 缺少参数 <title_b64> <body_b64>"); return; }
  let token;
  try { token = parseBarkToken(fs.readFileSync(path.join(os.homedir(), ".credentials", "bark.env"), "utf8")); }
  catch (e) { console.error("notify-bark: 读取 ~/.credentials/bark.env 失败(" + e.code + ")"); return; }
  if (!token) { console.error("notify-bark: bark.env 里没有 BARK_TOKEN"); return; }
  const title = Buffer.from(titleB64, "base64").toString("utf8");
  const body = Buffer.from(bodyB64, "base64").toString("utf8");
  try {
    const res = await fetch(buildBarkUrl(token, title, body, level), { signal: AbortSignal.timeout(8000) });
    if (res.ok) console.log("BARK_OK");
    else console.error("notify-bark: Bark 返回 HTTP " + res.status);
  } catch (e) {
    console.error("notify-bark: 请求失败(" + String(e && e.name || "error") + ")");
  }
}

module.exports = { buildBarkUrl, parseBarkToken };

if (require.main === module) {
  main().then(() => process.exit(0), () => process.exit(0));
}
