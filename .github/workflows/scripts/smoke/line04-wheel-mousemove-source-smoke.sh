#!/usr/bin/env bash
# CI-CAPABLE: line-a
# line04-wheel-mousemove-source-smoke.sh — 真凶修法源契约 smoke（线 A glob-runner 自动发现）
#
# 标记 `# CI-CAPABLE: line-a`（第 2 行）= 声明可在 clean CI 跑（纯源码契约校验，无真机/RPA）。
#
# 背景（rog 真机 + 用户屏前实证，1.0.65 滚轮时灵时不灵真凶）：
#   Qt 按「鼠标当前悬停在哪个控件」路由滚轮——只发 WM_MOUSEWHEEL 不更新悬停 →
#   滚轮投给上次悬停的控件（碰巧悬停会话列表才滚得动，否则只扫到一屏）。
#   修法：每次 WM_MOUSEWHEEL 之前先 WM_MOUSEMOVE(0x0200) 到会话列表同一屏幕坐标，建立悬停。
#
# 本 smoke 守住「发货源里 wheel 前真的有 WM_MOUSEMOVE 建立悬停」——防回归（别又退回只发滚轮）。
# 真机滚动不可 CI 测，但「源代码 wheel 前先 mousemove」可契约校验。
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
command -v node >/dev/null 2>&1 || { echo "FAIL: 缺 node"; exit 6; }

for SRC in \
  "$ROOT/services/agent/wechat-rpa/listen_chat.py" \
  "$ROOT/services/agent/build-modules/line04/wechat-rpa/listen_chat.py"; do
  [ -f "$SRC" ] || { echo "FAIL: 缺 $SRC"; exit 2; }
  node -e '
    const fs = require("fs");
    const src = fs.readFileSync(process.argv[1], "utf8");
    const errs = [];
    // 取 _scroll_session_list_wheel 函数体（到下一个顶层 def 为止）
    const m = src.match(/def _scroll_session_list_wheel\([\s\S]*?(?=\ndef )/);
    if (!m) { console.error("FAIL: 找不到 _scroll_session_list_wheel"); process.exit(1); }
    const body = m[0];
    if (!/0x0200/.test(body)) errs.push("wheel 函数体缺 WM_MOUSEMOVE(0x0200)");
    if (!/0x020A/.test(body)) errs.push("wheel 函数体缺 WM_MOUSEWHEEL(0x020A)");
    // WM_MOUSEMOVE 的 PostMessageW 必须出现在 WM_MOUSEWHEEL 之前（建立悬停在前）
    const iMove  = body.indexOf("WM_MOUSEMOVE");
    const iWheel = body.indexOf("WM_MOUSEWHEEL,");
    if (iMove < 0 || iWheel < 0 || iMove > iWheel)
      errs.push("WM_MOUSEMOVE 必须在 WM_MOUSEWHEEL 之前投递（建立悬停在前）");
    if (errs.length) { console.error("FAIL " + process.argv[1] + ":\n  - " + errs.join("\n  - ")); process.exit(1); }
    console.log("  OK " + process.argv[1].split("/").slice(-3).join("/") + " wheel 前先 WM_MOUSEMOVE 建立悬停");
  ' "$SRC" || exit 1
done

echo "PASS line04-wheel-mousemove-source-smoke"
