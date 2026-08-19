#!/usr/bin/env bash
# 守卫：真机 smoke 的设备就绪判据必须用「不会撒谎的那个」。
#
# 落账依据：decision 2dc450f7（category=invariant，五条验收断言）
#          decision 6d0a4be7（归位：工厂 · F3 夜间体检 的加厚）
#
# 五条断言各自对应 2026-08-19 一次真实误判：
# [1] 无障碍真绑定 —— smoke 原用 `settings get secure enabled_accessibility_services`，
#     小白 realme RMX3478 实测 Enabled=3 / Bound=0 时它照样 ok "无障碍已开"，
#     随后采集/私信/账号扫描全静默失效，误导排查整整一天。
#     正确判据只有 `dumpsys accessibility` 的 Bound services。三台对照：小粉3/3 小黄3/3 小白3/0。
# [2] 包与身份唯一 —— 0819 早上 CI 显示绿、实际跑的是 prod 2.1.21 老代码（两包共用 agent_id 互抢）。
# [3] 注册真成功 —— 小黄注册 404 降级 fallback 后心跳照常 online，却拿不到 ws_token、收不到任务推送。
# [4] 前台拉起可用 —— ColorOS 静默拦截 startActivity（不抛异常、return true），
#     一路错到 NO_SEARCH_INPUT：错误码指向搜索框，真凶却是拉起。
# [5] 队列无僵尸 —— pending-collect-tasks 只返回 pending，任务被拉走标 running 后若未执行成功，
#     后续轮询再也看不见它、永久卡死；0819 清掉 13 条（最早卡 8 小时），小白三次被堵。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SRC="$ROOT/.github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad() { FAIL=$((FAIL+1)); echo "  ❌ $1"; }
[ -f "$SRC" ] || { echo "❌ 找不到 $SRC"; exit 1; }

# [1] 无障碍必须查 Bound，且不得再用 settings get 作为「已开」的判据
if grep -qE 'dumpsys accessibility' "$SRC" && grep -qE 'Bound services' "$SRC"; then
  ok "无障碍就绪查 dumpsys 的 Bound services"
else
  bad "无障碍判据未查 Bound —— settings get 会在 Enabled≠Bound 时谎报已开（小白实证）"
fi
if grep -qE 'ok "无障碍已开"' "$SRC" && ! grep -qE 'Bound' "$SRC"; then
  bad "仍以 settings get 结果直接判「无障碍已开」"
else
  ok "未用 settings get 单独下「已开」结论"
fi

# [3] 注册真成功：必须排除 fallback 降级
if grep -qE 'license key fallback|registered — tier=|registered - tier=|REGISTER_FALLBACK' "$SRC"; then
  ok "校验注册真成功（排除 fallback 降级）"
else
  bad "未校验注册降级 —— 心跳 online 但拿不到 ws_token 时会假绿（小黄实证）"
fi

# [4] 前台拉起：必须断言抖音真到前台
if grep -qE '抖音到前台|WRONG_FOREGROUND' "$SRC"; then
  ok "断言抖音真到前台"
else
  bad "未断言抖音到前台 —— ColorOS 静默拦截时错误码会指向搜索框，掩盖真凶"
fi

# [5] 队列僵尸：跑之前要看有没有卡死任务
if grep -qE '僵尸|STALE|stale' "$SRC"; then
  ok "开跑前检查僵尸任务"
else
  bad "未检查僵尸任务 —— 队列被卡死任务堵住时新任务永远排不上（小白三次被堵）"
fi

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
