#!/usr/bin/env bash
# CI-CAPABLE: line-a
# line04-real-wheel-source-smoke.sh — 滚动改真硬件滚轮 防回归 smoke（线 A glob-runner 自动发现）
#
# 标记 `# CI-CAPABLE: line-a`（第 2 行）= 声明可在 clean CI 跑（纯源码 + python 纯函数，无真机）。
#
# 真因（用户实证 + rog 真机）：长列表 PostMessage WM_MOUSEWHEEL 合成滚轮滚到一半卡死（Qt 虚拟列表
# 不 fetch 下一批，只覆盖 16 条），手鼠标硬件滚轮能滚全 → 合成消息非硬件级输入。改真硬件滚轮
# SetCursorPos(列表中心)+mouse_event(MOUSEEVENTF_WHEEL,负 delta)，扫前后存还原光标，无输入权回退 PostMessage。
# 本 smoke 守住：① 源码 _scroll_session_list_wheel 用 mouse_event(0x0800)+SetCursorPos+GetCursorPos(存还原)+回退；
# ② 纯函数 _session_list_center_point 算列表中心中位坐标。
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
command -v node >/dev/null    2>&1 || { echo "FAIL: 缺 node"; exit 6; }
command -v python3 >/dev/null 2>&1 || { echo "FAIL: 缺 python3"; exit 6; }

RPA="$ROOT/services/agent/wechat-rpa"

# ① 源码契约：真硬件滚轮主路径 + 存还原光标 + 回退。
node -e '
  const fs = require("fs");
  const src = fs.readFileSync(process.argv[1], "utf8");
  const m = src.match(/def _scroll_session_list_wheel\([\s\S]*?(?=\ndef [a-zA-Z_])/);
  if (!m) { console.error("FAIL: 找不到 _scroll_session_list_wheel"); process.exit(1); }
  const body = m[0];
  const errs = [];
  if (!/mouse_event/.test(body))        errs.push("缺真硬件滚轮 mouse_event");
  if (!/0x0800/.test(body))             errs.push("缺 MOUSEEVENTF_WHEEL(0x0800)");
  if (!/SetCursorPos/.test(body))       errs.push("缺 SetCursorPos（移光标到列表中心）");
  if (!/GetCursorPos/.test(body))       errs.push("缺 GetCursorPos（存原光标位置）");
  if (!/PostMessageW/.test(body) || !/WM_MOUSEWHEEL/.test(body))
    errs.push("缺 PostMessage 回退路径（无桌面输入权时）");
  if (errs.length) { console.error("FAIL:\n  - " + errs.join("\n  - ")); process.exit(1); }
  console.log("  OK 源码：真硬件滚轮 + 存还原光标 + PostMessage 回退");
' "$RPA/listen_chat.py" || exit 1

# ② 纯函数：会话列表中心中位坐标。
python3 - "$RPA" <<'PY' || exit 1
import sys, types
from unittest.mock import MagicMock
sys.path.insert(0, sys.argv[1])
for n in ["pywinauto","pywinauto.application","pywinauto.controls","pywinauto.controls.uia_controls"]:
    m = types.ModuleType(n); m.Desktop = MagicMock(); sys.modules.setdefault(n, m)
import listen_chat as lc

class _Rect:
    def __init__(s,l,t,r,b): s.left,s.top,s.right,s.bottom=l,t,r,b
mw = MagicMock()
items = []
for rc in [(100,180,457,240),(100,240,457,300),(100,300,457,360)]:
    it = MagicMock(); it.rectangle.return_value = _Rect(*rc); items.append(it)
mw.descendants.return_value = items
pt = lc._session_list_center_point(mw)
# 中位 x=(100+457)//2=278；中位 y 在三项中心 [210,270,330] 取中位 270
assert pt == (278, 270), f"FAIL: 列表中心 {pt}"
print("  OK 纯函数：会话列表中心中位坐标 = (278,270)")
PY

echo "PASS line04-real-wheel-source-smoke"
