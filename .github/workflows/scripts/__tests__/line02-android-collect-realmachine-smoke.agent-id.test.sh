#!/usr/bin/env bash
# agent-id.test.sh — 动态取 agent_id 的两阶段编排变异测试（无需真机，CI linux runner 可跑）
#
# 防的退化：
#  1) 回到"只读历史 logcat"——设备跑久了启动日志会被环形缓冲冲掉，守卫必然误报
#     "设备可能从没跑完 initAgent"（08-15/16/17 三晚 nightly 就死在这一步，
#      而 Agent 实际健康：pid 在、中台心跳 online、无障碍已授权）
#  2) 冷启动后忘记写回无障碍授权——荣耀 force-stop 会撤销它（08-17 实测变 null，
#     随后两个 job 都误报"无障碍未开"）
#  3) 两次都取不到时静默放行——会把任务派给错的 agent_id，采集永远 pending 卡死
#     （2026-07-09 / 07-16 两次真机踩过同一坑）
#  4) 提取逻辑依赖 em dash——rog 上 PowerShell 路径会把它编码破坏成乱码（08-17 实测
#     codepage 936 下变 U+9225 U+003F），判据不该建立在这种字符上
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../smoke" && pwd)/line02-android-collect-realmachine-smoke.sh"
# shellcheck source=/dev/null
source "$SCRIPT" --source-only

PASS=0; FAIL=0
check() { # check DESC EXPECT ACTUAL
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✅ $1";
  else FAIL=$((FAIL+1)); echo "  ❌ $1 (期望=$2 实际=$3)"; fi
}

UUID='e017953c-bc65-47e0-913e-a2ed5eb54993'

echo "== extract_agent_id：纯字符串提取 =="

LOG_HIT="08-17 18:48:01.942 16122 16175 I AgentService: agent started — agentId=${UUID} machineId=4f637d68"
check "提取 uuid" "$UUID" "$(extract_agent_id "$LOG_HIT")"

LOG_MULTI="I AgentService: agent started — agentId=aaaaaaaa-1111-2222-3333-444444444444
I AgentService: agent started — agentId=${UUID}"
check "多条取最后一条（最新那次启动）" "$UUID" "$(extract_agent_id "$LOG_MULTI")"

# 08-17 实测：rog 的 PowerShell（codepage 936/GB2312）会把 em dash 破坏成 U+9225 U+003F。
# 判据不该依赖这个字符——只认 agentId=<uuid> 才是稳的。
LOG_GBK="I AgentService: agent started ?agentId=${UUID} machineId=e86800e3"
check "em dash 被编码破坏时仍能提取" "$UUID" "$(extract_agent_id "$LOG_GBK")"

check "无匹配返回空" "" "$(extract_agent_id 'I AgentService: polling tick')"
check "非 uuid 格式不误取" "" "$(extract_agent_id 'agentId=not-a-uuid')"

echo "== resolve_live_agent_id：两阶段编排 =="

TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT

# 场景 A：首次就有日志 → 必须直接返回，且**不触发**冷启动（零副作用路径）
fetch_hit()  { printf '%s' "$LOG_HIT"; }
cold_mark()  { echo called >> "$TMPD/cold_a"; printf '%s' "$LOG_HIT"; }
check "日志在时取到 uuid" "$UUID" "$(resolve_live_agent_id fetch_hit cold_mark)"
check "日志在时不触发冷启动" "0" "$(wc -l < "$TMPD/cold_a" 2>/dev/null | tr -d ' ' || echo 0)"

# 场景 B：首次空、冷启动后有 → 取到，且冷启动只被调用一次
fetch_empty() { printf ''; }
cold_ok()     { echo called >> "$TMPD/cold_b"; printf '%s' "$LOG_HIT"; }
check "日志不在→冷启动后取到" "$UUID" "$(resolve_live_agent_id fetch_empty cold_ok)"
check "冷启动只调用一次" "1" "$(wc -l < "$TMPD/cold_b" 2>/dev/null | tr -d ' ')"

# 场景 C：两次都空 → 返回空（调用方 envfail），绝不静默给个假 uuid
cold_empty() { printf ''; }
check "两次都取不到返回空" "" "$(resolve_live_agent_id fetch_empty cold_empty)"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
