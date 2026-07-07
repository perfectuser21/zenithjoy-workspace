#!/usr/bin/env bash
# lint-smoke-baseline —— smoke 棘轮闸的两条 PR 规则（机器卡，不靠自觉）
#   规则 1（新债不欠）：PR 新增的 *-smoke.sh 必须同时加进 smoke-baseline.txt
#   规则 2（删行留痕）：smoke-baseline.txt 有删除行时，PR body 必须含 "BASELINE-REMOVE:" 理由
# 用法: lint-smoke-baseline.sh [origin/main]
# 环境: PR_BODY 由 workflow 注入（${{ github.event.pull_request.body }}）
set -euo pipefail

BASE_REF="${1:-origin/main}"
git fetch origin "${BASE_REF#origin/}" --quiet 2>/dev/null || true

BASELINE=".github/workflows/scripts/smoke-baseline.txt"
SMOKE_DIR=".github/workflows/scripts/smoke"
FAIL=0

# ── 规则 1：新增 smoke 脚本必须进基线 ──────────────────────────────
NEW_SCRIPTS=$(git diff --name-only --diff-filter=A "$BASE_REF"...HEAD -- "$SMOKE_DIR" \
  | grep -E '/[^/]+-smoke\.sh$' || true)
for f in $NEW_SCRIPTS; do
  name=$(basename "$f")
  if ! grep -qxF "$name" "$BASELINE"; then
    echo "::error::新增 smoke 脚本 $name 未加入 smoke-baseline.txt（新债不欠：新脚本必须从第一天起被棘轮闸守护）"
    FAIL=1
  fi
done

# ── 规则 2：基线删行必须声明理由 ──────────────────────────────────
REMOVED=$(git diff "$BASE_REF"...HEAD -- "$BASELINE" \
  | grep '^-' | grep -v '^---' | sed 's/^-//' | grep -v '^[[:space:]]*$' || true)
if [ -n "$REMOVED" ]; then
  if ! printf '%s' "${PR_BODY:-}" | grep -q 'BASELINE-REMOVE:'; then
    echo "::error::smoke-baseline.txt 有删除行但 PR body 缺 'BASELINE-REMOVE:' 理由声明。删除的行: $(echo "$REMOVED" | tr '\n' ' ')"
    FAIL=1
  fi
fi

[ "$FAIL" -eq 0 ] && echo "✅ lint-smoke-baseline 通过"
exit "$FAIL"
