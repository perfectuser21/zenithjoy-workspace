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
# Accept either a brand-new smoke script OR a meaningful extension of an existing
# one — a PR that adds real new Step coverage to an already-registered smoke file
# (e.g. golden-path-2-smoke.sh) satisfies this rule just as well as adding a new
# file. Existing files are held to a diff-based bar (see EMPTY_SMOKE below) so a
# trivial touch to a large file can't rubber-stamp past this gate.
CHANGED_SMOKE=$(git diff --name-only --diff-filter=AM "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -E "$SMOKE_PAT" \
  || true)

if [ -z "$CHANGED_SMOKE" ]; then
  echo "::error::lint-feature-has-smoke FAIL"
  echo "  rule: feat: + apps/*/src requires a new or meaningfully-extended smoke script"
  exit 1
fi

EMPTY_SMOKE=()
while IFS= read -r smoke; do
  [ -z "$smoke" ] && continue
  if git cat-file -e "${BASE_REF}:$smoke" 2>/dev/null; then
    # Pre-existing file: judge the PR's own contribution, not the whole file.
    ADDED_LINES=$(git diff --numstat "${BASE_REF}...HEAD" -- "$smoke" 2>/dev/null | awk '{print $1+0}')
    ADDED_LINES="${ADDED_LINES:-0}"
    ADDED_CMDS=$(git diff "${BASE_REF}...HEAD" -- "$smoke" 2>/dev/null \
      | grep -E '^\+' | grep -vE '^\+\+\+' \
      | grep -cE "(^|[^a-zA-Z_])(curl|psql|docker|node|npm|npx)[[:space:]]" || echo 0)
    # 例外：纯"版本一致性常量同步"编辑（EXPECTED="x.y.z" 一行改成另一个 semver）豁免——
    # 这类 version-gate smoke 的设计就是靠这一行手动同步捕获三方漂移，不是新增覆盖，
    # 用 added_lines/added_cmds 门槛卡它是假阳性（file 本身已注册且已有真实命令）。
    DIFF_BODY=$(git diff "${BASE_REF}...HEAD" -- "$smoke" 2>/dev/null | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)')
    NON_VERSION_LINES=$(echo "$DIFF_BODY" | grep -vE '^[+-][[:space:]]*[A-Z0-9_]*EXPECTED[A-Z0-9_]*="[0-9]+\.[0-9]+\.[0-9]+"[[:space:]]*$' | grep -c '.' || true)
    NON_VERSION_LINES="${NON_VERSION_LINES:-0}"
    WHOLE_FILE_CMDS=$(grep -cE "(^|[^a-zA-Z_])(curl|psql|docker|node|npm|npx)[[:space:]]" "$smoke" 2>/dev/null || true)
    WHOLE_FILE_CMDS="${WHOLE_FILE_CMDS:-0}"
    IS_VERSION_SYNC_ONLY=0
    if [ "$NON_VERSION_LINES" -eq 0 ] && [ "$WHOLE_FILE_CMDS" -ge 1 ]; then
      IS_VERSION_SYNC_ONLY=1
    fi
    if [ "$IS_VERSION_SYNC_ONLY" -eq 1 ]; then
      echo "skip(version-sync-only): $smoke — 纯 EXPECTED 版本常量同步，文件已注册且已有 $WHOLE_FILE_CMDS 条真实命令"
    elif [ "$ADDED_LINES" -lt 5 ] || [ "$ADDED_CMDS" -lt 1 ]; then
      EMPTY_SMOKE+=("$smoke (existing file, added_lines=$ADDED_LINES added_cmds=$ADDED_CMDS)")
    fi
  else
    # Brand-new file: judge the whole file, as before.
    REAL_LINES=$(grep -v "^[[:space:]]*#" "$smoke" | grep -v "^[[:space:]]*$" | wc -l | tr -d " ")
    TRUE_CMDS=$(grep -cE "(^|[^a-zA-Z_])(curl|psql|docker|node|npm|npx)[[:space:]]" "$smoke" 2>/dev/null || echo 0)
    if [ "$REAL_LINES" -lt 5 ] || [ "$TRUE_CMDS" -lt 1 ]; then
      EMPTY_SMOKE+=("$smoke (lines=$REAL_LINES cmds=$TRUE_CMDS)")
    fi
  fi
done <<< "$CHANGED_SMOKE"

if [ "${#EMPTY_SMOKE[@]}" -gt 0 ]; then
  echo "::error::lint-feature-has-smoke FAIL -- smoke is empty or too small an extension:"
  printf "  x %s
" "${EMPTY_SMOKE[@]}"
  exit 1
fi

echo "pass lint-feature-has-smoke -- smoke:"; echo "$CHANGED_SMOKE" | sed 's/^/  /'