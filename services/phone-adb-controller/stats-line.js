// stats-line.js —— 落池/分拣脚本的机器可读统计行（一行 `TAG {json}`）。
// 脚本原有的人读输出一字不改，只在末尾再打一行统计；batch2.sh 从 ssh 输出里取最后一行喂账本工件
// （delivery 的 leads_written/duplicates_skipped/videos_pushed、scoring 的各等级计数），
// 让探针对账的是脚本真实做了什么，而不是 TSV 里有几行。
"use strict";

function statsLine(tag, obj) {
  return `${tag} ${JSON.stringify(obj)}`;
}

// 在多行文本里找**最后一行**以 `${tag} ` 开头且后面是合法 JSON 对象的行；坏 JSON 行跳过继续找更早的；没有返回 null。
function parseStats(text, tag) {
  if (typeof text !== "string" || !text) return null;
  const prefix = `${tag} `;
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].replace(/\r$/, "");
    if (!line.startsWith(prefix)) continue;
    try {
      const v = JSON.parse(line.slice(prefix.length));
      if (v && typeof v === "object" && !Array.isArray(v)) return v;
    } catch { /* 坏 JSON（被截断的输出等）：跳过，继续找更早的 */ }
  }
  return null;
}

module.exports = { statsLine, parseStats };
