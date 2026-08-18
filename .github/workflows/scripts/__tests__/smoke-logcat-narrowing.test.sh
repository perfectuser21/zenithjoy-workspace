#!/usr/bin/env bash
# 守卫：真机 smoke 里读 logcat 取 agent_id 必须窄化，不得全量导出。
#
# 真机实测（2026-08-18，四号机 192.168.1.96）：
#   logcat -d                          106495 行 / 200 秒（还被 timeout 截断）
#   logcat -d -t 3000 -s AgentService       4 行 /   6 秒
# 33 倍差距。该命令在冷启动轮询里最多被调 15 次，用全量会把整个 job 预算吃光——
# CI run 32149637369 实测：取 agent_id 耗时 10 分 26 秒，真正的采集只跑 19 秒
# 就撞 timeout-minutes:12 被砍，当天合并的三刀修复一秒都没被验证到。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SRC="$ROOT/.github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ❌ $1"; }

[ -f "$SRC" ] || { echo "❌ 找不到 $SRC"; exit 1; }
BODY=$(cat "$SRC")

# 1. 取 agent_id 的读取必须带 tag 过滤
if grep -q 'logcat -d -t [0-9]\+ -s AgentService' <<< "$BODY"; then
  ok "取 agent_id 的 logcat 带 -s AgentService tag 过滤"
else
  bad "取 agent_id 的 logcat 缺少 -s AgentService —— 全量导出在真机上要 200 秒"
fi

# 2. 必须带行数上限
if grep -q 'logcat -d -t [0-9]\+' <<< "$BODY"; then
  ok "logcat 读取带 -t 行数上限"
else
  bad "logcat 读取缺少 -t 行数上限"
fi

# 3. 不得残留裸的全量导出（读取用途）
if grep -qE 'logcat -d 2>/dev/null' <<< "$BODY"; then
  bad "残留裸 logcat -d 全量导出 —— 这是 10 分 26 秒的来源"
else
  ok "无裸 logcat -d 全量导出"
fi

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
