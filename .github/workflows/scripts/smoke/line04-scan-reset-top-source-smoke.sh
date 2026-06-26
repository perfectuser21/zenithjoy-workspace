#!/usr/bin/env bash
# CI-CAPABLE: line-a
# line04-scan-reset-top-source-smoke.sh — 「扫描随缘」三件套修法源契约 smoke（线 A glob-runner 自动发现）
#
# 标记 `# CI-CAPABLE: line-a`（第 2 行）= 声明可在 clean CI 跑（纯源码契约校验，无真机/RPA）。
#
# 背景（rog 真机 + 用户屏前实证）：scan_recent_contacts 扫好友"随缘"——列表停哪从哪往下扫一个
# 局部窗口，够不到上半截（文件传输助手/崔华/于瑾/微信ClawBot/冬瓜MGL 全漏）。真因：微信 4.1.8 Qt
# 会话列表只认向下滚轮，向上滚/Home/Ctrl+Home/WM_VSCROLL/拖滚动条全失效。三件套修法（1.0.69）：
#   ① 扫前切「通讯录」→「微信」tab 回真顶（_reset_session_list_to_top，唯一可靠回顶法）；
#   ② 只读左列会话项（_read_visible_item_names 经 _filter_left_column 按 x<460 滤右侧消息噪音）；
#   ③ 鲁棒到底（_should_stop_scroll_robust：末项连续不变才停，不被列表重排骗到半路漏底部）。
#
# 本 smoke 守住「发货源里这三件套真在、且 scan 循环真的用上了」——防回归（真机点击/滚动不可 CI 测，
# 但源代码用对修法可契约校验，两份 listen_chat.py 都查）。
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
    // 取 scan_recent_contacts 函数体（到下一个顶层 def 为止）
    const m = src.match(/def scan_recent_contacts\([\s\S]*?(?=\ndef )/);
    if (!m) { console.error("FAIL: 找不到 scan_recent_contacts"); process.exit(1); }
    const body = m[0];

    // ① 回顶：函数定义存在 + scan 循环前真调用 + 切的是通讯录/微信两个 tab
    if (!/def _reset_session_list_to_top\(/.test(src)) errs.push("缺 _reset_session_list_to_top（切 tab 回顶）");
    if (!/_reset_session_list_to_top\(mw\)/.test(body)) errs.push("scan 未调用 _reset_session_list_to_top（扫前回顶）");
    if (!/通讯录/.test(src) || !/微信/.test(src)) errs.push("回顶未按「通讯录」「微信」tab 名定位");

    // ② 只读左列：_filter_left_column 存在 + _read_visible_item_names 真用它
    if (!/def _filter_left_column\(/.test(src)) errs.push("缺 _filter_left_column（左列过滤纯函数）");
    const rv = src.match(/def _read_visible_item_names\([\s\S]*?(?=\ndef )/);
    if (!rv || !/_filter_left_column\(/.test(rv[0])) errs.push("_read_visible_item_names 未经 _filter_left_column 滤右侧噪音");

    // ③ 鲁棒到底：_should_stop_scroll_robust 存在 + scan 循环真用它 + 阈值放宽到 ≥10
    if (!/def _should_stop_scroll_robust\(/.test(src)) errs.push("缺 _should_stop_scroll_robust（鲁棒到底判定）");
    if (!/_should_stop_scroll_robust\(/.test(body)) errs.push("scan 循环未用 _should_stop_scroll_robust（仍可能半路提前停漏底）");
    const t = src.match(/_SCROLL_BOTTOM_UNCHANGED_MAX\s*=\s*(\d+)/);
    if (!t || parseInt(t[1], 10) < 10) errs.push("_SCROLL_BOTTOM_UNCHANGED_MAX 必须 >=10（放宽，绝不退回 2 半路漏底）");

    if (errs.length) { console.error("FAIL " + process.argv[1] + ":\n  - " + errs.join("\n  - ")); process.exit(1); }
    console.log("  OK " + process.argv[1].split("/").slice(-3).join("/") + " 三件套(回顶/只读左列/鲁棒到底)在位");
  ' "$SRC" || exit 1
done

echo "PASS line04-scan-reset-top-source-smoke"
