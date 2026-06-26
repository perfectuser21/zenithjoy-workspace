#!/usr/bin/env bash
# CI-CAPABLE: line-a
# line04-drop-rule3-source-smoke.sh — 删规则3（冒号前缀猜群）防回归 smoke（线 A glob-runner 自动发现）
#
# 标记 `# CI-CAPABLE: line-a`（第 2 行）= 声明可在 clean CI 跑（纯源码 + python 纯函数校验，无真机）。
#
# 背景（rog 真机 + 用户确认）：_parse_item_name/_collect_recent_contacts 末尾"规则3"按
# "消息预览有 词+冒号+空格"瞎猜群 → 误删带冒号私聊("链接: http")+客户小群(名字无"群")。已删。
# 本 smoke 守住「不再回退冒号前缀猜群」：① 源码里两处 scan 函数体不含 [：:]\s 群前缀正则；
# ② python 直接调纯函数验带冒号私聊 + 名字无"群"的小群都收进、真群/系统号照排。防回归。
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
command -v node >/dev/null    2>&1 || { echo "FAIL: 缺 node"; exit 6; }
command -v python3 >/dev/null 2>&1 || { echo "FAIL: 缺 python3"; exit 6; }

RPA="$ROOT/services/agent/wechat-rpa"

# ① 源码契约：两处 scan 函数不得再含冒号前缀猜群正则（防回退）。
node -e '
  const fs = require("fs");
  const src = fs.readFileSync(process.argv[1], "utf8");
  // 旧规则3 特征：在 _parse_item_name / _collect_recent_contacts 里用 [：:]\s 当群前缀判定
  if (/\[：:\]\\s/.test(src)) {
    console.error("FAIL: 源码仍含 [：:]\\s 冒号前缀猜群正则（规则3 回退，会误删真客户）");
    process.exit(1);
  }
  console.log("  OK 源码无冒号前缀猜群正则");
' "$RPA/listen_chat.py" || exit 1

# ② 纯函数行为：带冒号私聊 + 名字无"群"的客户小群都收；真群/系统号排除。
python3 - "$RPA" <<'PY' || exit 1
import sys, types
from unittest.mock import MagicMock
sys.path.insert(0, sys.argv[1])
for n in ["pywinauto","pywinauto.application","pywinauto.controls","pywinauto.controls.uia_controls"]:
    m = types.ModuleType(n); m.Desktop = MagicMock(); sys.modules.setdefault(n, m)
import listen_chat as lc

names = [
    "张三\n链接: http://x.com\n15:00\n",                  # 带冒号私聊 → 收
    "客户名、徐先生企业自媒体-Ai助力\n小明: 收到\n14:00\n",  # 小群名字无"群" → 收
    "老乡交流群\n大家好\n13:00\n",                         # 名字含"群" → 排除
    "公众号\n推广\n12:00\n",                              # 系统号 → 排除
]
got = [c["name"] for c in lc._collect_recent_contacts(names, limit=100)]
exp = ["张三", "客户名、徐先生企业自媒体-Ai助力"]
assert got == exp, f"FAIL: 期望 {exp} 实际 {got}"
# _parse_item_name 直证带冒号私聊不被删
assert lc._parse_item_name("李四\n[1条] \n链接: http://x\n11:00\n") == {"sender":"李四","content":"链接: http://x"}, "FAIL: 带冒号私聊被误删"
assert lc._parse_item_name("学习指导群\n[1条] \n你好\n10:00\n") is None, "FAIL: 名字含群应排除"
print("  OK 纯函数：带冒号私聊+无群字小群收进，真群/系统号排除")
PY

echo "PASS line04-drop-rule3-source-smoke"
