#!/usr/bin/env bash
# lint-feature-has-smoke.sh (ZenithJoy)
# Validate: feat: PR touching apps/*/src/ must add a smoke script
#
# Triggers (any = feature PR):
#   - PR_LABELS contains feature
#   - PR commits have feat: prefix
#
# Usage: bash lint-feature-has-smoke.sh [BASE_REF]
# Exit: 0=pass/skip, 1=fail
set -euo pipefail

BASE_REF="${1:-origin/main}"
PR_LABELS="${PR_LABELS:-}"
echo "lint-feature-has-smoke base: $BASE_REF"

git fetch origin "${BASE_REF#origin/}" --quiet 2>/dev/null || true

HAS_FEAT=0
echo "$PR_LABELS" | grep -qiwE 'feature' && HAS_FEAT=1

COMMIT_MSGS=$(git log --pretty=%s "${BASE_REF}..HEAD" 2>/dev/null || echo "")
echo "$COMMIT_MSGS" | grep -qE '^feat(\([^)]+\))?:' && HAS_FEAT=1

if [ "$HAS_FEAT" -eq 0 ]; then
  echo "skip: non-feature PR"
  exit 0
fi

APPS_SRC_CHANGED=$(git diff --name-only --diff-filter=AM "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -E "^apps/[^/]+/src/" \
  | grep -vE "[.](test|spec)[.]ts$|/__tests__/|/tests/" \
  || true)

if [ -z "$APPS_SRC_CHANGED" ]; then
  echo "skip: feat PR but no apps/*/src changes"
  exit 0
fi

SMOKE_PAT="^[.]github/workflows/scripts/smoke/.+[.]sh$"
NEW_SMOKE=$(git diff --name-only --diff-filter=A "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -E "$SMOKE_PAT" \
  || true)

if [ -z "$NEW_SMOKE" ]; then
  echo "::error::lint-feature-has-smoke FAIL"
  echo "  rule: feat: + apps/*/src requires smoke script"
  exit 1
fi

EMPTY_SMOKE=()
while IFS= read -r smoke; do
  [ -z "$smoke" ] && continue
  REAL_LINES=$(grep -v "^[[:space:]]*#" "$smoke" | grep -v "^[[:space:]]*$" | wc -l | tr -d " ")
  TRUE_CMDS=$(grep -cE "(^|[^a-zA-Z_])(curl|psql|docker|node|npm|npx)[[:space:]]" "$smoke" 2>/dev/null || echo 0)
  if [ "$REAL_LINES" -lt 5 ] || [ "$TRUE_CMDS" -lt 1 ]; then
    EMPTY_SMOKE+=("$smoke (lines=$REAL_LINES cmds=$TRUE_CMDS)")
  fi
done <<< "$NEW_SMOKE"

if [ "${#EMPTY_SMOKE[@]}" -gt 0 ]; then
  echo "::error::lint-feature-has-smoke FAIL -- smoke is empty:"
  printf "  x %s
" "${EMPTY_SMOKE[@]}"
  exit 1
fi

echo "pass lint-feature-has-smoke -- new smoke:"; echo "$NEW_SMOKE" | sed 's/^/  /'