#!/usr/bin/env bash
# CI-CAPABLE: line-a
# line04-scan-unread-offscreen-smoke.sh — scan_unread 滚动找【视口外未读】修法 防回归 smoke
#
# 标记 `# CI-CAPABLE: line-a`（第 2 行）= 声明可在 clean CI 跑（纯源码契约 + python 纯函数，无真机）。
#
# 真因（rog 真机铁证 2026-07-01）：微信会话列表 Qt 虚拟滚动一次只渲染可见 ~5-6 条 ListItem，
# 频繁自检狂发「文件传输助手」把客户未读会话顶到视口外没渲染 → 旧 scan_unread 只读可见区角标 →
# unread=0 → 客户发消息永远不回。修法：scan_unread 复用已有滚动机制滚整列表，只读收集所有 [N条]
# 未读（绝不开会话/群），滚完原子归位回顶。
#
# 本 smoke 守住三件：① 源码契约（scan_unread 真接了滚动收集 + 归位 + 复用累计器，防回退）；
# ② AST 纯度守卫放开 scan_unread 也能滚（且回复主循环仍绝不直接滚）；③ 纯函数行为（多屏收集去重到底）。
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
command -v node >/dev/null    2>&1 || { echo "FAIL: 缺 node"; exit 6; }
command -v python3 >/dev/null 2>&1 || { echo "FAIL: 缺 python3"; exit 6; }

RPA="$ROOT/services/agent/wechat-rpa"

# ① 源码契约：发货源 + build-modules 基线两份都要接对（防只改一份 / 防回退）。
for SRC in \
  "$RPA/listen_chat.py" \
  "$ROOT/services/agent/build-modules/line04/wechat-rpa/listen_chat.py"; do
  [ -f "$SRC" ] || { echo "FAIL: 缺 $SRC"; exit 2; }
  node -e '
    const fs = require("fs");
    const src = fs.readFileSync(process.argv[1], "utf8");
    const errs = [];
    // scan_unread 函数体（到下一个顶层 def 为止）必须真接滚动收集 + 归位 + 复用未读累计器
    const m = src.match(/\ndef scan_unread\([\s\S]*?\n(?=def \w)/);
    if (!m) { console.error("FAIL: 找不到 scan_unread 定义"); process.exit(1); }
    const body = m[0];
    if (!/_UnreadScrollAccumulator\(/.test(body)) errs.push("scan_unread 未用 _UnreadScrollAccumulator 收集未读");
    if (!/_scroll_session_list_wheel\(mw\)/.test(body)) errs.push("scan_unread 未滚动找视口外未读（_scroll_session_list_wheel）");
    if (!/_reset_session_list_to_top\(mw\)/.test(body)) errs.push("scan_unread 滚完未原子归位回顶（_reset_session_list_to_top）");
    if (!/_read_visible_item_pairs\(/.test(body)) errs.push("scan_unread 未用 _read_visible_item_pairs 拿名字+活引用");
    if (!/_SCROLL_PROBE_MIN_ITEMS/.test(body)) errs.push("scan_unread 未用首屏满阈值 _SCROLL_PROBE_MIN_ITEMS（小账号该直读不滚）");
    // 死约束：scan_unread 滚动里绝不开会话/群——_open_chat 只允许在 N>1 聚合段（滚动结束后），
    // 不允许在 for 滚动循环内出现。粗校验：滚动 for 循环到 _reset 之间不得有 _open_chat。
    const scrollSeg = body.match(/for _ in range\(_SCROLL_MAX_PAGES\)[\s\S]*?_reset_session_list_to_top\(mw\)/);
    if (scrollSeg && /_open_chat\(/.test(scrollSeg[0])) errs.push("scan_unread 滚动段内出现 _open_chat（绝不开会话/群，防破坏 SPI 树）");
    if (errs.length) { console.error("FAIL " + process.argv[1] + ":\n  - " + errs.join("\n  - ")); process.exit(1); }
    console.log("  OK " + process.argv[1].split("/").slice(-3).join("/") + " scan_unread 接了滚动收集+归位、滚动段不开会话");
  ' "$SRC" || exit 1
done

# ② AST 纯度守卫 + ③ 纯函数行为（多屏收集去重到底 / 端到端滚动找视口外未读）。
cd "$RPA" || { echo "FAIL: 进不去 $RPA"; exit 2; }
python3 -m pip install --quiet pytest 2>/dev/null || true
python3 -m pytest tests/test_scan_unread_scroll.py tests/test_reply_loop_purity.py -q \
  || { echo "FAIL: scan_unread 滚动纯函数 / AST 纯度守卫 pytest 未过"; exit 1; }

echo "PASS line04-scan-unread-offscreen-smoke"
