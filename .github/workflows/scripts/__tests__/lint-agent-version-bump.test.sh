#!/usr/bin/env bash
# lint-agent-version-bump.test.sh — 4 cases
# A: services/agent/src 有变动 + package.json version 有 bump → PASS
# B: services/agent/src 有变动 + package.json version 无 bump → FAIL
# C: services/agent/src 无变动 → PASS (skip)
# D: services/agent/src 有变动 + package.json 本身没变 → FAIL
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINT="$SCRIPT_DIR/lint-agent-version-bump.sh"

PASSED=0; FAILED=0

init_repo() {
  git init -q
  git config user.email "t@t"
  git config user.name "t"
  git config commit.gpgsign false
  mkdir -p services/agent/src
  cat > services/agent/package.json <<'EOF'
{
  "name": "zenithjoy-agent",
  "version": "1.1.2",
  "main": "dist/index.js"
}
EOF
  echo "export const x = 1;" > services/agent/src/index.ts
  git add . && git commit -q -m "base"
  git branch -M main && git checkout -q -b "test-case"
}

check_result() {
  local name="$1" expect_fail="$2"
  set +e; bash "$LINT" main > /tmp/lint-avb-out.txt 2>&1; local rc=$?; set -e
  if [ "$expect_fail" = "1" ] && [ "$rc" -ne 0 ]; then
    echo "  PASS [$name]"; PASSED=$((PASSED+1))
  elif [ "$expect_fail" = "0" ] && [ "$rc" -eq 0 ]; then
    echo "  PASS [$name]"; PASSED=$((PASSED+1))
  else
    echo "  FAIL [$name] expect=$expect_fail got=$rc"; cat /tmp/lint-avb-out.txt; FAILED=$((FAILED+1))
  fi
}

# A: agent/src 变动 + version bump → PASS
TMPDIR=$(mktemp -d); cd "$TMPDIR"; init_repo
echo "export const y = 2;" > services/agent/src/video-pipeline.ts
cat > services/agent/package.json <<'EOF'
{
  "name": "zenithjoy-agent",
  "version": "1.1.3",
  "main": "dist/index.js"
}
EOF
git add . && git commit -q -m "fix(agent): audio merge"
check_result "src-changed-version-bumped" 0
cd /tmp; rm -rf "$TMPDIR"

# B: agent/src 变动 + 无 version bump → FAIL
TMPDIR=$(mktemp -d); cd "$TMPDIR"; init_repo
echo "export const y = 2;" > services/agent/src/video-pipeline.ts
git add . && git commit -q -m "fix(agent): audio merge"
check_result "src-changed-no-bump" 1
cd /tmp; rm -rf "$TMPDIR"

# C: agent/src 无变动 → PASS (skip)
TMPDIR=$(mktemp -d); cd "$TMPDIR"; init_repo
echo "some docs" > README.md
git add . && git commit -q -m "docs: update readme"
check_result "no-src-change" 0
cd /tmp; rm -rf "$TMPDIR"

# D: agent/src 变动 + package.json 变动但 version 不变 → FAIL
TMPDIR=$(mktemp -d); cd "$TMPDIR"; init_repo
echo "export const y = 2;" > services/agent/src/video-pipeline.ts
cat > services/agent/package.json <<'EOF'
{
  "name": "zenithjoy-agent",
  "version": "1.1.2",
  "main": "dist/index.js",
  "description": "new field added"
}
EOF
git add . && git commit -q -m "fix(agent): audio merge"
check_result "src-changed-version-same" 1
cd /tmp; rm -rf "$TMPDIR"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Results: $PASSED passed, $FAILED failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
[ "$FAILED" -eq 0 ] || exit 1
