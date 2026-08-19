#!/usr/bin/env bash
# 守卫：Stage2（抓评论）打开视频后必须【主动等待】评论按钮出现，且探测必须廉价。
#
# 真机实测（2026-08-19，四号机 192.168.1.96，agent 2.1.24-e2e，关键词「装修」）：
#   09:25:29 collect stage_2 task: videos=2      ← Stage2 确实下发
#   09:25:30 stage2 task received videoId=7628…
#   09:25:38 extracted 0 comments                ← 8 秒后 0 条
#   09:25:48 extracted 0 comments                ← 第二个视频同样 0 条
# 两个视频都判定 matched（真装修内容），却一条评论都没抓到 → lead_count_raw=0
# → 无线索 → 无评论打分 → outreach_eligible 恒 false → 私信一条发不出去。
#
# 根因：handleVideoUrlOpened 是纯事件回调，且
#     val root = rootInActiveWindow ?: return
#     val commentBtn = findVisibleCommentButton(root) ?: return
# 拿不到就静默丢弃，没有任何重试/等待——与 NO_SEARCH_INPUT 被修四次的
# 「拿一次界面快照就当目标页面就绪」是同一个病根（PR #1651/#1652/#1653 只迁了搜索链）。
# 深链刚拉起抖音时详情页尚未渲染完，评论按钮还不存在，这一次探测必然扑空。
#
# 另：finder 必须廉价（NodeAwait 的死规矩）。findVisibleCommentButton 原为无界全树 BFS，
# 每个 getChild() 都是跨进程 binder；前台闸就因同样的无界 BFS 在真机上卡死 144 秒。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SRC="$ROOT/services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad() { FAIL=$((FAIL+1)); echo "  ❌ $1"; }

[ -f "$SRC" ] || { echo "❌ 找不到 $SRC"; exit 1; }

# startStage2Collect 函数体（到下一个 private fun 为止）
STAGE2_BODY=$(awk '/private fun startStage2Collect/{f=1} f&&/^    private fun /&&!/startStage2Collect/{exit} f' "$SRC")
# findVisibleCommentButton 函数体
FINDER_BODY=$(awk '/private fun findVisibleCommentButton/{f=1} f&&/^    private fun /&&!/findVisibleCommentButton/{exit} f' "$SRC")

# 1. Stage2 深链拉起后必须主动等评论按钮（awaitNode），不能只靠事件回调撞运气
if grep -q 'awaitNode' <<< "$STAGE2_BODY"; then
  ok "startStage2Collect 主动 awaitNode 等评论按钮就绪"
else
  bad "startStage2Collect 未主动等待评论按钮 —— 深链刚拉起时详情页未渲染完，一次性探测必然扑空(真机 extracted 0 comments ×2)"
fi

# 2. 等待失败必须给出明确错误码，不能静默上报 0 条评论
if grep -qE 'finishWithError\(.*"(NO_COMMENT_BUTTON|NO_WINDOW)"' <<< "$STAGE2_BODY"; then
  ok "等不到评论按钮时报明确错误码，不静默交 0 条"
else
  bad "等不到评论按钮时无 finishWithError —— 会静默上报 0 条评论，任务照常结算 done，链路断点被掩盖"
fi

# 3. finder 必须廉价：评论按钮查找不得用无界全树 BFS
if grep -qE 'NodeTreeFlattener\.flattenDfs|MAX_NODES_PER_PROBE' <<< "$FINDER_BODY"; then
  ok "findVisibleCommentButton 用带上限的遍历"
else
  bad "findVisibleCommentButton 仍是无界全树遍历 —— 违反 finder 必须廉价(前台闸曾因此卡死 144 秒)"
fi

# 4. 不得残留裸的无界 while 队列 BFS
if grep -qE 'while \(queue\.isNotEmpty\(\)\)' <<< "$FINDER_BODY"; then
  bad "findVisibleCommentButton 残留无界 while(queue.isNotEmpty()) BFS"
else
  ok "无残留无界 BFS"
fi

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
