#!/usr/bin/env bash
# 守卫：无障碍自检必须查「服务真的在跑(Bound)」，不能只查「设置里写了(Enabled)」。
#
# 真机实证（2026-08-19，小白 realme RMX3478/ColorOS/安卓14）：
#   settings get secure enabled_accessibility_services  → 三个服务都在（看起来成功）
#   dumpsys accessibility 的 Bound services            → 一个都没有
# 三台对比铁证：小粉 Enabled3/Bound3、小黄 Enabled3/Bound3、小白 Enabled3/Bound0。
#
# 后果是连锁的：DouyinCollectService.onServiceConnected() 从没执行 → 广播接收器从没注册
# → dispatchTask 每 30 秒发一次广播无人接 → 任务永远 running。而且系统设置页写明
# 「开启无障碍辅助功能后，应用将获得自启动权限，不受自启动管理页面设置项的影响」——
# 所以「抖音拉不起来(WRONG_FOREGROUND)」也是同一根因的下游症状。
#
# 最要命的是 agent 自检当时一直显示「无障碍 ✅ 已开启」，因为它只读 Secure Settings
# 字符串。ColorOS 不认 adb 写入：settings get 读得回（假成功），系统却从不绑定服务。
# 排查因此被误导整整一天。
#
# 正确姿势：AccessibilityManager.getEnabledAccessibilityServiceList(FEEDBACK_ALL_MASK)
# 返回的是【真正运行中】的服务，Enabled 但未 Bound 的不会出现在里面。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
KROOT="$ROOT/services/agent-android/app/src/main/kotlin/com/zenithjoy/agent"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad() { FAIL=$((FAIL+1)); echo "  ❌ $1"; }

# 1. 必须存在基于运行态的判定（纯函数可测）
if [ -f "$KROOT/onboarding/AccessibilityRuntimeCheck.kt" ]; then
  ok "存在运行态自检模块 AccessibilityRuntimeCheck"
else
  bad "缺少运行态自检模块 —— 自检仍只看 Secure Settings 字符串，Enabled≠Bound 时会谎报已开启"
fi

# 2. AgentService 启动自检必须用 AccessibilityManager 查运行态
if grep -q 'getEnabledAccessibilityServiceList' "$KROOT/AgentService.kt" 2>/dev/null; then
  ok "AgentService 自检查询真正运行中的服务"
else
  bad "AgentService 自检未用 getEnabledAccessibilityServiceList —— 只读设置字符串会被 ColorOS 假成功骗过"
fi

# 3. 诊断页展示也必须基于运行态
if grep -q 'getEnabledAccessibilityServiceList' "$KROOT/MainActivity.kt" 2>/dev/null \
   || grep -q 'AccessibilityRuntimeCheck' "$KROOT/MainActivity.kt" 2>/dev/null; then
  ok "诊断页基于运行态展示"
else
  bad "诊断页仍按 Secure Settings 展示「已开启」—— 正是今天误导排查一整天的那行字"
fi

# 4. 未真正绑定时必须报错到日志（环境接缝要显式可观测）
if grep -qE 'Log\.e\(.*(未绑定|NOT_BOUND|未运行)' "$KROOT/AgentService.kt" 2>/dev/null; then
  ok "未绑定时打 error 日志，状态显式可观测"
else
  bad "未绑定时无 error 日志 —— 又回到「广播发了没人收」的隐蔽失败"
fi

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
