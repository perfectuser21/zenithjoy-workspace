#!/usr/bin/env bash
# CI-CAPABLE: line-a
# line04-scroll-wheel-source-smoke.sh — A1 翻屏修法源契约 smoke（线 A glob-runner 自动发现）
#
# 标记 `# CI-CAPABLE: line-a`（第 2 行）= 声明可在 clean CI 跑（纯源码契约校验，无真机/RPA）。
#
# 背景（rog 真机实证）：会话列表翻屏用 PostMessageW(主窗口, WM_KEYDOWN, VK_NEXT) 的 PageDown
# 完全滚不动（微信 Qt 键盘事件只派发给有焦点 widget，会话列表没焦点）→ 只扫到一屏 ~6-9 个，
# 漏掉十几二十个私聊。修法：改投 WM_MOUSEWHEEL（0x020A）+ 负 delta + 会话列表屏幕坐标 lParam。
#
# 本 smoke 守住「发货源里翻屏用的是 WM_MOUSEWHEEL，不是回退成 PageDown」——防回归。
# 真机滚动行为不可 CI 测，但「发货源代码用对消息」可契约校验（node 读 build 脚本真 rsync 的源）。
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
command -v node >/dev/null 2>&1 || { echo "FAIL: 缺 node"; exit 6; }

# 发货 Python 源（build-line-module.sh rsync 它）+ build-modules 基线，两份都要对。
for SRC in \
  "$ROOT/services/agent/wechat-rpa/listen_chat.py" \
  "$ROOT/services/agent/build-modules/line04/wechat-rpa/listen_chat.py"; do
  [ -f "$SRC" ] || { echo "FAIL: 缺 $SRC"; exit 2; }
  node -e '
    const fs = require("fs");
    const src = fs.readFileSync(process.argv[1], "utf8");
    const errs = [];
    // 1) 必须有 WM_MOUSEWHEEL 翻屏函数 + 0x020A
    if (!/_scroll_session_list_wheel/.test(src)) errs.push("缺 _scroll_session_list_wheel（翻屏修法函数）");
    if (!/0x020A/.test(src)) errs.push("缺 WM_MOUSEWHEEL(0x020A)");
    // 2) scan_recent_contacts 滚动循环必须调 wheel，不能回退 pagedown
    if (!/_scroll_session_list_wheel\(mw\)/.test(src)) errs.push("scan 循环未调用 _scroll_session_list_wheel");
    if (/_scroll_session_list_pagedown/.test(src)) errs.push("仍残留 PageDown 翻屏（真机实证滚不动，禁止回退）");
    // 3) 负 delta 下滚（_WHEEL_DELTA = 负数）
    if (!/_WHEEL_DELTA\s*=\s*-\d+/.test(src)) errs.push("缺负 _WHEEL_DELTA（下滚）");
    if (errs.length) { console.error("FAIL " + process.argv[1] + ":\n  - " + errs.join("\n  - ")); process.exit(1); }
    console.log("  OK " + process.argv[1].split("/").slice(-3).join("/") + " 翻屏用 WM_MOUSEWHEEL");
  ' "$SRC" || exit 1
done

echo "PASS line04-scroll-wheel-source-smoke"
