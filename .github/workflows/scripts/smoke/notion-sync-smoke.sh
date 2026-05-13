#!/usr/bin/env bash
# Smoke for .github/scripts/notion-sync-on-merge.js
# 3 case:
#   1. PR body 含 Notion-Sprint trailer + 真 sprint 名 → dry-run 输出 "found sprint" + "would PATCH"
#   2. 无 trailer → "no Notion-Sprint trailer" + exit 0
#   3. 不存在的 sprint 名 → "sprint not found" warning + exit 0

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SCRIPT="$REPO_ROOT/.github/scripts/notion-sync-on-merge.js"

[ -f "$SCRIPT" ] || { echo "FAIL: $SCRIPT 不存在"; exit 1; }

if [ -z "${NOTION_API_KEY:-}" ] && [ -f "$HOME/.credentials/notion.env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.credentials/notion.env"
fi

if [ -z "${NOTION_API_KEY:-}" ]; then
  echo "SKIP: NOTION_API_KEY 未配置"
  exit 0
fi

PASS=0
FAIL=0
assert_contains() {
  if echo "$1" | grep -qF "$2"; then
    echo "  PASS: $3"; PASS=$((PASS + 1))
  else
    echo "  FAIL: $3"; echo "    expected: $2"; echo "    got: $1"; FAIL=$((FAIL + 1))
  fi
}

echo "=== Case 1: 含 trailer + 真 sprint → dry-run PATCH 计划 ==="
OUT1=$(NOTION_API_KEY="$NOTION_API_KEY" PR_NUMBER=99999 \
  PR_TITLE="chore: smoke fake" PR_URL="https://github.com/test/repo/pull/99999" \
  PR_BODY=$'## Summary\n\nfake.\n\nNotion-Sprint: Sprint 2.1f 产品级容错' \
  node "$SCRIPT" --dry-run 2>&1)
echo "$OUT1" | sed 's/^/    /'
assert_contains "$OUT1" "found sprint" "Case 1: 找到 sprint"
assert_contains "$OUT1" "DRY-RUN" "Case 1: dry-run 标记"
assert_contains "$OUT1" "would PATCH" "Case 1: PATCH 计划"

echo ""
echo "=== Case 2: 无 trailer → 静默退出 ==="
OUT2=$(NOTION_API_KEY="$NOTION_API_KEY" PR_NUMBER=99998 \
  PR_TITLE="chore: no trailer" PR_URL="https://github.com/test/repo/pull/99998" \
  PR_BODY=$'## Summary\n\n没 trailer' \
  node "$SCRIPT" --dry-run 2>&1)
echo "$OUT2" | sed 's/^/    /'
assert_contains "$OUT2" "no Notion-Sprint trailer" "Case 2: 识别无 trailer"

echo ""
echo "=== Case 3: 不存在 sprint 名 → warning + exit 0 ==="
OUT3=$(NOTION_API_KEY="$NOTION_API_KEY" PR_NUMBER=99997 \
  PR_TITLE="chore: fake sprint" PR_URL="https://github.com/test/repo/pull/99997" \
  PR_BODY=$'## Summary\n\nNotion-Sprint: 不存在的 Sprint XYZ-99999' \
  node "$SCRIPT" --dry-run 2>&1) && EC=$? || EC=$?
echo "$OUT3" | sed 's/^/    /'
assert_contains "$OUT3" "sprint not found" "Case 3: 报告找不到"
if [ "${EC:-0}" -eq 0 ]; then
  echo "  PASS: Case 3 exit 0 (不阻塞)"; PASS=$((PASS + 1))
else
  echo "  FAIL: Case 3 exit $EC (应该 0)"; FAIL=$((FAIL + 1))
fi

echo ""
echo "Smoke: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
