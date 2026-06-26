#!/usr/bin/env bash
# CI-CAPABLE: line-a
# line04-group-by-header-source-smoke.sh — 群判定改读标题(N) 防回归 smoke（线 A glob-runner 自动发现）
#
# 标记 `# CI-CAPABLE: line-a`（第 2 行）= 声明可在 clean CI 跑（纯源码 + python 纯函数，无真机）。
#
# 业务规则（用户拍板）：群不进 CRM，客户=纯一对一私聊。唯一可靠信号 = 打开会话右上角标题带 "(人数)"。
# 删名字关键词规则1（"李立群"误伤），群/私聊由 _is_group_by_header(标题) 判，enrich 层剔群。
# 本 smoke 守住：① 源码已删名字关键词判群（不再 `kw in sender ... SKIP_GROUP_KEYWORDS return`）；
# ② 纯函数 _is_group_by_header 半/全角(N)判群、无括号判私聊；③ enrich 真调读标题判群。
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
command -v node >/dev/null    2>&1 || { echo "FAIL: 缺 node"; exit 6; }
command -v python3 >/dev/null 2>&1 || { echo "FAIL: 缺 python3"; exit 6; }

RPA="$ROOT/services/agent/wechat-rpa"

# ① 源码契约：解析端不再按名字关键词判群（防回退规则1）+ enrich 真读标题判群。
node -e '
  const fs = require("fs");
  const src = fs.readFileSync(process.argv[1], "utf8");
  const errs = [];
  if (/kw in sender for kw in SKIP_GROUP_KEYWORDS/.test(src))
    errs.push("源码仍按名字关键词判群（规则1 回退，误伤人名/客户小群）");
  if (!/def _is_group_by_header\(/.test(src)) errs.push("缺纯函数 _is_group_by_header");
  if (!/_is_group_by_header\(_read_chat_header_texts\(mw\)\)/.test(src))
    errs.push("enrich 未读标题判群（_is_group_by_header(_read_chat_header_texts(mw))）");
  if (errs.length) { console.error("FAIL:\n  - " + errs.join("\n  - ")); process.exit(1); }
  console.log("  OK 源码：无名字关键词判群 + enrich 读标题判群");
' "$RPA/listen_chat.py" || exit 1

# ② 纯函数行为：半/全角 (N) 判群、无括号判私聊。
python3 - "$RPA" <<'PY' || exit 1
import sys, types
from unittest.mock import MagicMock
sys.path.insert(0, sys.argv[1])
for n in ["pywinauto","pywinauto.application","pywinauto.controls","pywinauto.controls.uia_controls"]:
    m = types.ModuleType(n); m.Desktop = MagicMock(); sys.modules.setdefault(n, m)
import listen_chat as lc

assert lc._is_group_by_header(["华涛数码、徐先生企业自媒体-Ai助力(3)"]) == 3, "FAIL: 半角(3)应判群"
assert lc._is_group_by_header(["某客户群（5）"]) == 5, "FAIL: 全角（5）应判群"
assert lc._is_group_by_header(["中瑞家具 冯涛18192241985"]) is None, "FAIL: 无括号应私聊"
assert lc._is_group_by_header(["客户A(VIP)"]) is None, "FAIL: 非数字括号不应判群"
# 解析端不再按名字含"群"删（人名/小群）
assert lc._parse_item_name("李立群\n[1条] \n你好\n10:00\n") == {"sender":"李立群","content":"你好"}, "FAIL: 人名含群被误删"
print("  OK 纯函数：半/全角(N)判群、无括号/非数字判私聊、名字含群不再误删")
PY

echo "PASS line04-group-by-header-source-smoke"
