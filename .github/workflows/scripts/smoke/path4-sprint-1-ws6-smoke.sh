#!/usr/bin/env bash
# Path 4 Sprint 1 ws6 — golden-path-4-smoke + evidence + CI 防作弊 smoke
#
# 静态校验：
#   1) golden-path-4-smoke.sh 文件 + 6 step 标记 + binary ≥ 6 + echo 占位 ≤ 12
#   2) lead-acceptance-path4-sprint-1.md 存在 + Worker Machine 锁 rog-xian
#   3) golden-path-4-smoke.yml workflow 含 needs:[ws1..ws5]
#   4) test-registry.yaml 含 tests/ws1/ ... tests/ws6/
#   5) lint-feature-has-smoke.yml 含 path-4 / golden-path-4 / wechat-rpa 关键字
#   6) 6 个 ws-level smoke 脚本齐
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "=== ws6 Step 1: golden-path-4-smoke.sh 形态 ==="
SMOKE=.github/workflows/scripts/smoke/golden-path-4-smoke.sh
test -f "$SMOKE" || { echo "FAIL: smoke 缺"; exit 1; }
[ -x "$SMOKE" ] || { echo "FAIL: smoke 不可执行"; exit 1; }
LINES=$(wc -l < "$SMOKE")
[ "$LINES" -ge "30" ] || { echo "FAIL: smoke 仅 $LINES 行（< 30，可能仍是占位）"; exit 1; }

BINARY_HITS=$(grep -cE "(curl|psql|node |python3?|ssh|playwright)" "$SMOKE")
[ "$BINARY_HITS" -ge "6" ] \
  || { echo "FAIL: smoke binary 调用 $BINARY_HITS < 6"; exit 1; }

PLACEHOLDER=$(grep -cE "^[[:space:]]*(echo|printf)[[:space:]]+['\"]?(Step|✅|PASS).*['\"]?" "$SMOKE")
[ "$PLACEHOLDER" -le "12" ] \
  || { echo "FAIL: smoke echo/printf 占位 $PLACEHOLDER > 12"; exit 1; }

for n in 1 2 3 4 5 6; do
  grep -qE "Step\s*$n" "$SMOKE" || { echo "FAIL: 缺 Step $n 标记"; exit 1; }
done
echo "  PASS 形态：lines=$LINES binary=$BINARY_HITS placeholder=$PLACEHOLDER 6 step 齐"

echo "=== ws6 Step 2: evidence 模板 ==="
EVIDENCE=.agent-knowledge/path-4/lead-acceptance-path4-sprint-1.md
test -f "$EVIDENCE" || { echo "FAIL: evidence 缺"; exit 1; }
grep -qE "rog-xian|100\.98\.253\.95|XX-ROG" "$EVIDENCE" \
  || { echo "FAIL: evidence 未锁 rog-xian"; exit 1; }
grep -qE "^## Checklist" "$EVIDENCE" \
  || { echo "FAIL: evidence 缺 Checklist 章节"; exit 1; }
grep -qE "^## Evidence" "$EVIDENCE" \
  || { echo "FAIL: evidence 缺 Evidence 章节"; exit 1; }
grep -qE "LEAD_ACCEPTANCE_VALIDATION" "$EVIDENCE" \
  || { echo "FAIL: evidence 缺 LEAD_ACCEPTANCE_VALIDATION 切换字段"; exit 1; }
echo "  PASS evidence 模板 + Worker Machine + 章节齐 + 模式切换"

echo "=== ws6 Step 3: golden-path-4-smoke.yml workflow ==="
WORKFLOW=.github/workflows/golden-path-4-smoke.yml
test -f "$WORKFLOW" || { echo "FAIL: workflow 缺"; exit 1; }
grep -qE "needs:.*\[(ws1.*ws2.*ws3.*ws4.*ws5|ws1, ws2, ws3, ws4, ws5)\]" "$WORKFLOW" \
  || { echo "FAIL: workflow 未声明 needs:[ws1..ws5]"; exit 1; }
grep -q "golden-path-4-smoke.sh" "$WORKFLOW" \
  || { echo "FAIL: workflow 未跑 golden-path-4-smoke.sh"; exit 1; }
echo "  PASS workflow + needs:[ws1..ws5] enforce"

echo "=== ws6 Step 4: test-registry.yaml ws1..ws6 ==="
for ws in ws1 ws2 ws3 ws4 ws5 ws6; do
  grep -qE "tests/$ws/" test-registry.yaml \
    || { echo "FAIL: $ws 未注册"; exit 1; }
done
echo "  PASS ws1..ws6 全注册"

echo "=== ws6 Step 5: lint-feature-has-smoke.yml Path 4 关键字 ==="
LINT_YML=.github/workflows/lint-feature-has-smoke.yml
test -f "$LINT_YML" || { echo "FAIL: lint-feature-has-smoke.yml 缺"; exit 1; }
grep -qE "golden-path-4|path-4|wechat-rpa" "$LINT_YML" \
  || { echo "FAIL: lint yml 缺 Path 4 关键字"; exit 1; }
echo "  PASS lint-feature-has-smoke.yml 含 Path 4 关键字"

echo "=== ws6 Step 6: 6 个 ws-level smoke 脚本齐 ==="
for ws in ws1 ws2 ws3 ws4 ws5 ws6; do
  test -f ".github/workflows/scripts/smoke/path4-sprint-1-${ws}-smoke.sh" \
    || { echo "FAIL: path4-sprint-1-${ws}-smoke.sh 缺"; exit 1; }
done
echo "  PASS 6 个 ws-level smoke 全在"

echo ""
echo "ws6-smoke: ALL PASS"
