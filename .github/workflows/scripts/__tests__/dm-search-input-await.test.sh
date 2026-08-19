#!/usr/bin/env bash
# 守卫：私信链等搜索输入框——finder 必须廉价，且轮询等不到要先做一次兜底再判死。
#
# 真机实证（2026-08-19，四号机 192.168.1.96，e2e 2.1.25，目标 dyv14dcofwjz）：
#   09:56:27 dm_outreach task received
#   09:56:38 A3-diag: NO_SEARCH_INPUT searchBtnFound=true failure=TARGET_ABSENT attempts=8
#   09:56:38 dm_outreach outcome=FAILED error=NO_SEARCH_INPUT
# 搜索按钮已点开（searchBtnFound=true），卡在下一步等输入框：只等 8×500ms=4 秒就判死。
#
# 与采集链（DouyinCollectService.openSearchBar）的差异才是真根因：
#   采集链 同样等 8 次，但【等不到不判死】——继续走，由 typeKeyword 调 findFirstEditText 兜底一次 → 成功
#   私信链 等 8 次【直接 finishWithError】→ FAILED
# 且私信链的 finder 里塞了 findFirstEditText，正是采集链注释明令禁止的：
#   「finder 每轮都会执行，必须廉价……**不能**顺手加 findFirstEditText——那是无界 BFS，
#     getChild() 每次跨进程 binder，在 Lynx 巨树上单次遍历几十秒」（2026-08-18 真机两分钟无进展）
# NodeAwait 的规矩同样写着：昂贵的兜底查找放到轮询【之后】只做一次。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SRC="$ROOT/services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinDmOutreachService.kt"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad() { FAIL=$((FAIL+1)); echo "  ❌ $1"; }

[ -f "$SRC" ] || { echo "❌ 找不到 $SRC"; exit 1; }

# 取「等搜索输入框」那段 awaitNode 的 finder 块（inputOutcome 起、到闭合行）
INPUT_BLOCK=$(awk '/val inputOutcome = awaitNode/{f=1} f{print} f&&/^        \}$/{exit}' "$SRC")

# 1. finder 必须廉价：轮询体内不得出现无界 findFirstEditText
if grep -q 'findFirstEditText' <<< "$INPUT_BLOCK"; then
  bad "等输入框的 finder 里含无界 findFirstEditText —— 每轮跨进程全树 BFS，采集链注释明令禁止"
else
  ok "等输入框的 finder 只走系统索引查询，廉价"
fi

# 2. 轮询等不到必须先做一次昂贵兜底，不能直接判死
if grep -q 'findFirstEditText' "$SRC" && grep -qi '兜底' "$SRC" && ! grep -q 'findFirstEditText' <<< "$INPUT_BLOCK"; then
  ok "轮询等不到时有一次性昂贵兜底再判死"
else
  bad "轮询等不到直接 finishWithError —— 与采集链不一致(采集链靠 typeKeyword 兜底才成功)，真机 attempts=8 判死"
fi

# 3. 跨页面的等待不得用最短的页内控件档
if grep -qE 'val inputOutcome = awaitNode\(AWAIT_WIDGET_ATTEMPTS' "$SRC"; then
  bad "搜索输入框用 AWAIT_WIDGET_ATTEMPTS(4秒) —— 点搜索按钮会跳转页面，输入框是新页元素，档位给短了"
else
  ok "搜索输入框未使用最短的页内控件档"
fi

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
