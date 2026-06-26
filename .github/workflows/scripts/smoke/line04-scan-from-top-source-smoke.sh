#!/usr/bin/env bash
# CI-CAPABLE: line-a
# line04-scan-from-top-source-smoke.sh — 扫全三件套 防回归 smoke（线 A glob-runner 自动发现）
#
# 标记 `# CI-CAPABLE: line-a`（第 2 行）= 声明可在 clean CI 跑（纯源码 + python 纯函数，无真机）。
#
# 真因（rog 真机实证）：scan_recent_contacts 没先回列表真顶（向上滚彻底失效），列表停哪从哪扫 →
# 上半截会话常漏，扫描"随缘"。修法三件套：① 扫前切 tab 回真顶 ② 只读左列会话 ③ 末项连续≥10 次不变才到底。
# 本 smoke 守住三件套都在（防回退）：① 源码 scan 循环调 _reset_session_list_to_top + 用 _bottom_reached_by_last_item；
# ② 纯函数左列过滤剔右侧噪音、导航按钮按左列定位、末项不变 streak 终止；③ 硬上限≥35。
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
command -v node >/dev/null    2>&1 || { echo "FAIL: 缺 node"; exit 6; }
command -v python3 >/dev/null 2>&1 || { echo "FAIL: 缺 python3"; exit 6; }

RPA="$ROOT/services/agent/wechat-rpa"

# ① 源码契约：scan 循环回顶 + 末项不变终止（防回退旧"2 屏无新增即停"）。
node -e '
  const fs = require("fs");
  const src = fs.readFileSync(process.argv[1], "utf8");
  const errs = [];
  if (!/_reset_session_list_to_top\(mw\)/.test(src)) errs.push("scan 未先切 tab 回顶（_reset_session_list_to_top）");
  if (!/_bottom_reached_by_last_item\(/.test(src)) errs.push("scan 未用末项不变鲁棒终止");
  if (!/_read_visible_item_names/.test(src)) errs.push("缺左列会话读取");
  if (errs.length) { console.error("FAIL:\n  - " + errs.join("\n  - ")); process.exit(1); }
  console.log("  OK 源码：扫前回顶 + 末项不变终止");
' "$RPA/listen_chat.py" || exit 1

# ② 纯函数行为：左列过滤 / 导航按钮定位 / 末项终止 / 硬上限。
python3 - "$RPA" <<'PY' || exit 1
import sys, types
from unittest.mock import MagicMock
sys.path.insert(0, sys.argv[1])
for n in ["pywinauto","pywinauto.application","pywinauto.controls","pywinauto.controls.uia_controls"]:
    m = types.ModuleType(n); m.Desktop = MagicMock(); sys.modules.setdefault(n, m)
import listen_chat as lc

# 左列过滤：x<460 留，右侧噪音剔
got = lc._filter_left_column_item_names([("莫易",278),("08:22",900),("[preflight]",760)], x_max=460)
assert got == ["莫易"], f"FAIL: 左列过滤 {got}"

# 导航按钮按左列 x<90 定位
class R:
    def __init__(s,l,t,r,b): s.left,s.top,s.right,s.bottom=l,t,r,b
pt = lc._find_left_nav_button_point([("微信",R(20,100,60,140)),("微信",R(500,100,560,140))],"微信",left_max=90)
assert pt == (40,120), f"FAIL: 导航按钮定位 {pt}"

# 末项不变 streak 终止：>=10 才到底，旧的 2 不停
assert lc._bottom_reached_by_last_item(10,10) is True, "FAIL: 末项不变 10 应到底"
assert lc._bottom_reached_by_last_item(2,10) is False, "FAIL: 末项不变 2 不应到底（半路停漏底）"

# 硬上限放宽
assert lc._SCROLL_MAX_PAGES >= 35, "FAIL: 硬上限应>=35"
assert lc._SCROLL_LAST_ITEM_UNCHANGED_MAX >= 10, "FAIL: 末项不变阈值应>=10"
print("  OK 纯函数：左列过滤/导航定位/末项终止/硬上限")
PY

echo "PASS line04-scan-from-top-source-smoke"
