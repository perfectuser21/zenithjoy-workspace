#!/usr/bin/env bash
# lint-agent-version-bump.sh (ZenithJoy)
# Rule: any PR that changes services/agent/src/ MUST also bump
#       services/agent/package.json "version" field.
#
# Usage: bash lint-agent-version-bump.sh [BASE_REF]
# Exit:  0 = pass / skip, 1 = fail
set -euo pipefail

BASE_REF="${1:-origin/main}"
echo "lint-agent-version-bump base: $BASE_REF"

git fetch origin "${BASE_REF#origin/}" --quiet 2>/dev/null || true

# Check if any services/agent/src/ file changed (non-test, non-dist)
AGENT_SRC_CHANGED=$(git diff --name-only --diff-filter=AM "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -E "^services/agent/src/" \
  | grep -vE "[.](test|spec)[.](ts|js)$|/__tests__/|/tests/" \
  || true)

if [ -z "$AGENT_SRC_CHANGED" ]; then
  echo "skip: no services/agent/src changes"
  exit 0
fi

echo "Agent src changed:"
echo "$AGENT_SRC_CHANGED" | sed 's/^/  /'

PKG="services/agent/package.json"

# Check package.json was modified at all
PKG_CHANGED=$(git diff --name-only --diff-filter=M "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -F "$PKG" || true)

if [ -z "$PKG_CHANGED" ]; then
  echo "::error::lint-agent-version-bump FAIL"
  echo "  rule: services/agent/src changed → must bump version in $PKG"
  echo "  fix: increment version field in $PKG (e.g. 1.1.2 → 1.1.3)"
  exit 1
fi

# Extract old and new version
OLD_VER=$(git show "${BASE_REF}:${PKG}" 2>/dev/null | grep '"version"' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "")
NEW_VER=$(grep '"version"' "$PKG" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "")

if [ "$OLD_VER" = "$NEW_VER" ]; then
  echo "::error::lint-agent-version-bump FAIL"
  echo "  services/agent/src changed but version stayed at $OLD_VER"
  echo "  fix: bump version in $PKG (current: $OLD_VER)"
  exit 1
fi

echo "pass lint-agent-version-bump — version $OLD_VER → $NEW_VER"
