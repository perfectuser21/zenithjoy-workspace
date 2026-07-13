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

# ── 规则 1：新增 smoke 脚本必须进基线（或 DENYLIST 豁免）──────────────
# DENYLIST（真机/RPA smoke，ubuntu glob runner 物理跑不了）从 glob runner 提取。这些脚本
# 由独立 self-hosted workflow（如 e2e-line02-android-collect.yml，xian-rog 真机）守护，
# 进 baseline 反而会在 ubuntu 上必假红。因此新增真机 smoke 进 DENYLIST 即视为"已被守护"，
# 豁免 baseline 要求——否则闸门无法新增任何真机 smoke（此前只有历史遗留脚本苟过）。
GLOB_RUNNER=".github/workflows/ci-smoke-glob-runner.yml"
DENYLIST=$(sed -n '/DENYLIST="/,/^[[:space:]]*"[[:space:]]*$/p' "$GLOB_RUNNER" 2>/dev/null \
  | grep -oE '[a-z0-9._-]+-smoke\.sh' || true)

NEW_SCRIPTS=$(git diff --name-only --diff-filter=A "$BASE_REF"...HEAD -- "$SMOKE_DIR" \
  | grep -E '/[^/]+-smoke\.sh$' || true)
for f in $NEW_SCRIPTS; do
  name=$(basename "$f")
  if printf '%s\n' "$DENYLIST" | grep -qxF "$name"; then
    echo "  ⏭️ $name 在 DENYLIST（真机 smoke，由独立 self-hosted workflow 守护，豁免 baseline）"
    continue
  fi
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
