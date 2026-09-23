// keyword-enabled-lib.js —— 「这个关键词要不要跑」的判定。
//
// 单独成文件而不是挂在 next-keywords.js 上：那个脚本**顶层就读 clawdbot.json、
// 顶层就发飞书请求**，一旦被 require 立刻炸（CI 机器上没有那份凭据），
// 而且会真打网络。纯判定抽出来，测试才跑得起来。
// （第一版就是直接给 next-keywords.js 加 module.exports，CI 上
//   `ENOENT: /Users/administrator/.openclaw/clawdbot.json` 当场报红。）
//
// 0923 真机实测两家「是否启用」列的实际填法：
//   金诺 58 条：是 37 / 启用 9 / 暂停 7 / 否 5
//   悦升 35 条：启用 35
// 原实现写死 `=== "是"`，填「启用」的一律被静默过滤——同一份表只换判定，
// 金诺取词数 31 → 40（那 9 条被埋的词回来了）。
// 被埋时不报错：日志只显示"本批取 N 词"，没有任何东西指出有词因写法被过滤。
//
// 所以认一类说法，不认某一个字。但两头都要收住：
//  · 空值/未填一律不跑——没表态就别去动客户的号，宁可漏跑一个词
//  · 白名单**默认即拒**：不在 ENABLED 里的一律不跑（金诺表里 7 条「暂停」就靠这条挡住）

const ENABLED = ['是', '启用', '开', '开启', 'y', 'yes', 'true', '1', '✅', '√'];
const DISABLED = ['否', '停', '暂停', '关', '关闭', 'n', 'no', 'false', '0', '✖', '❌'];

function isKeywordEnabled(raw) {
  const v = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!v) return false;
  // 下面两道在**当前白名单实现下是冗余的**——变异实测：把它俩全删掉，
  // 「暂停」「停用」「未启用」照样返回 false，因为白名单里本就没有它们。
  // 留着只为一个目的：万一将来有人嫌白名单不灵活、改成宽松匹配（含「启」就算），
  // 这两道会先把它们否掉。别以为它们现在在挡什么——真正挡住的是最后那行默认即拒。
  if (DISABLED.includes(v)) return false;
  if (/暂停|停用|未启用|暂不/.test(v)) return false;
  return ENABLED.includes(v);   // ← 真正起作用的：不在白名单一律不跑
}

module.exports = { isKeywordEnabled, ENABLED, DISABLED };
