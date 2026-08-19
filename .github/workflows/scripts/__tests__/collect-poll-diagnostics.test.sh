#!/usr/bin/env bash
# 守卫：采集任务轮询的每个丢弃点都必须留下日志，不得静默吞任务。
#
# 真机实证（2026-08-19，小黄 荣耀MAA-AN00/安卓16/prod 2.1.26）：
#   中台：任务 status=running、agent=e017953c（说明 agent 确实拉走了它）
#   设备：DouyinCollectService 零日志、抖音没被拉起、AcquisitionCollectPollLoop 零日志
# 排查耗掉数小时才发现无从下手——因为 pollOnce() 的成功路径完全静默，
# 而它有 5 个 `return@forEach` / 隐式丢弃分支：
#   task_id 空 / stage_1 无 keywords / stage_2 无 video_urls /
#   when(stage) 没有 else（未知 stage 直接吞） / eligibleUrls 判决后为空
# 任务被吞在哪一个分支，外部完全看不见。
#
# 叠加服务端的结构性死锁：pending-collect-tasks 只返回 pending 状态，任务被拉走标成
# running 后若未执行成功，后续轮询再也看不见它 —— 静默吞任务 = 永久卡死且无迹可查。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SRC="$ROOT/services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AcquisitionCollectPollLoop.kt"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad() { FAIL=$((FAIL+1)); echo "  ❌ $1"; }
[ -f "$SRC" ] || { echo "❌ 找不到 $SRC"; exit 1; }

BODY=$(awk '/fun pollOnce\(\)/{f=1} f{print} f&&/^    \}$/{c++; if(c>=1) exit}' "$SRC")

# 1. 拉到任务后必须记录条数（否则无法区分"没任务"与"任务被吞"）
if grep -qE 'logI\(.*(tasks|任务).*(size|count|条|个)' <<< "$BODY" || grep -qE 'logI\("poll' <<< "$BODY"; then
  ok "轮询记录拉到的任务条数"
else
  bad "轮询未记录拉到几个任务 —— 无法区分「服务端没派」与「拉到了却被吞」"
fi

# 2. when(task.stage) 必须有 else 分支，未知 stage 不得静默吞
if grep -qE 'else ->' <<< "$BODY"; then
  ok "when(stage) 有 else 分支，未知 stage 会留痕"
else
  bad "when(task.stage) 无 else 分支 —— 未知 stage 的任务被静默吞掉，外部零线索"
fi

# 3. 每个静默丢弃点必须先打日志：统计 return@forEach 与其前面的日志调用
DROPS=$(grep -c 'return@forEach' <<< "$BODY" || true)
LOGGED=$(grep -B 1 'return@forEach' <<< "$BODY" | grep -cE 'logW\(|logI\(' || true)
if [ "${DROPS:-0}" -gt 0 ] && [ "${LOGGED:-0}" -ge "${DROPS:-0}" ]; then
  ok "全部 $DROPS 个丢弃点都先记日志再丢"
else
  bad "有 $DROPS 个 return@forEach 丢弃点，只有 $LOGGED 个记了日志 —— 任务被吞时无迹可查"
fi

# 4. 分发成功也要留痕（证明确实派给了采集服务，而不是拉到就没下文）
if grep -qE 'logI\(.*(dispatch|派发|stage_1|stage_2)' <<< "$BODY"; then
  ok "任务分发成功有日志"
else
  bad "分发成功无日志 —— 无法证明任务真的交给了采集服务"
fi

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
