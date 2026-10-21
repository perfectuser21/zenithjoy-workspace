#!/usr/bin/env bash
# account-scan-realmachine-smoke.envfail-red.test.sh — TDD Red 阶段
#
# decision 2f11ae25（invariant，用户拍板 2026-08-03）：envfail(exit 3) 必须 job 红+报警，
# 不准映射成 job success(infra-skip)。supersede sprint 07292330 合同"infra-skip 不计绿/红"条款。
# 断言 nightly-real-machine-staging.yml 刀D step：
#   1. 不存在 "-eq 3 → exit 0" 包装分支
#   2. exit "$CODE" 真实退出码保留
#   3. outputs.code 写入保留（nightly-report 靠它区分 envfail 标签）
#   4. nightly-report 根据真实result判定；failure/cancelled/skipped均红，不依赖code
set -uo pipefail
WF="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/.github/workflows/nightly-real-machine-staging.yml"
echo "━━ envfail-red 结构性测试 ━━"
[ -f "$WF" ] || { echo "❌ $WF 不存在"; exit 1; }
FAIL=0

# "-eq 3" 条件后 6 行内出现 exit 0 = 包装还在（窗口放宽防中间夹 echo 漏检）
WRAP=$(awk '/-eq 3/{found=NR} found && NR<=found+6 && /exit 0/{print NR; exit}' "$WF")
if [ -n "$WRAP" ]; then
  echo "❌ FAIL: 刀D 仍有 envfail(exit 3)→exit 0 包装 (line $WRAP)——违反 decision 2f11ae25"; FAIL=1
else
  echo "✅ 无 exit 3→exit 0 包装"
fi
grep -q 'exit "\$CODE"' "$WF" || { echo "❌ FAIL: exit \"\$CODE\" 真实退出码丢失"; FAIL=1; }
grep -q 'code=\$CODE.*GITHUB_OUTPUT' "$WF" || { echo "❌ FAIL: outputs.code 写入丢失"; FAIL=1; }
CONDITION=$(grep '^[[:space:]]*if .*"\$ACCOUNT_SCAN".*; then' "$WF" | head -1)
if [ -z "$CONDITION" ]; then
  echo "❌ FAIL: nightly-report 缺少真实result判定"; FAIL=1
else
  for STATE in success failure cancelled skipped; do
    EXPECTED=red; [ "$STATE" = success ] && EXPECTED=green
    ACTUAL=$(WECHAT=success DOUYIN=success ACCOUNT_SCAN="$STATE" bash -c "$CONDITION echo red; else echo green; fi")
    if [ "$ACTUAL" = "$EXPECTED" ]; then
      echo "✅ nightly account-scan=$STATE → $ACTUAL"
    else
      echo "❌ FAIL: account-scan=$STATE 期望$EXPECTED，实际$ACTUAL"; FAIL=1
    fi
  done
fi

[ "$FAIL" -eq 0 ] && { echo "✅ PASS"; exit 0; } || { echo "❌ RED/FAIL"; exit 1; }
