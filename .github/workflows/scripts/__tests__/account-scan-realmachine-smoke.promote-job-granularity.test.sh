#!/usr/bin/env bash
# account-scan-realmachine-smoke.promote-job-granularity.test.sh — TDD Red 阶段
#
# 用户拍板方案B（2026-08-03）：promote-all-prod 证据②从 workflow 级 conclusion 改 job 粒度——
# 真微信/真抖音 job 最近2晚绿=阻塞证据；真安卓红不阻塞但大字警告 summary（互不连坐）。
set -uo pipefail
WF="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/.github/workflows/promote-all-prod.yml"
echo "━━ promote 证据② job 粒度结构性测试 ━━"
[ -f "$WF" ] || { echo "❌ $WF 不存在"; exit 1; }
FAIL=0

grep -q '/jobs' "$WF" || { echo "❌ FAIL: 证据②未按 job 粒度查询(缺 /jobs API)"; FAIL=1; }
grep -q '真微信' "$WF" || { echo "❌ FAIL: 缺真微信 job 阻塞判定"; FAIL=1; }
grep -q '真抖音' "$WF" || { echo "❌ FAIL: 缺真抖音 job 阻塞判定"; FAIL=1; }
grep -q '真安卓' "$WF" || { echo "❌ FAIL: 缺真安卓 job 警告呈现"; FAIL=1; }
if grep -q '{c:\.conclusion' "$WF"; then
  echo "❌ FAIL: 仍在用 workflow 级 conclusion 判定（连坐模式）"; FAIL=1
fi
grep -q 'ANDROID_WARN' "$WF" || { echo "❌ FAIL: 真安卓应为警告不阻塞(缺 ANDROID_WARN 逻辑)"; FAIL=1; }
grep -q 'AGE_H" -gt 36' "$WF" || { echo "❌ FAIL: 36h 新鲜度判定丢失（AGE_H -gt 36 比较不存在，注释里的36不算）"; FAIL=1; }

[ "$FAIL" -eq 0 ] && { echo "✅ PASS"; exit 0; } || { echo "❌ RED/FAIL"; exit 1; }
