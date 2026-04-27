#!/usr/bin/env bash
# lint-tdd-commit-order.test.sh — 3 case
# A: test commit 先于 src → PASS
# B: src commit 先于 test → FAIL
# C: 同 commit 含 test + src → PASS
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINT="$SCRIPT_DIR/lint-tdd-commit-order.sh"

PASSED=0; FAILED=0

init_repo() {
  git init -q && git config user.email "t@t" && git config user.name "t" && git config commit.gpgsign false
  mkdir -p apps/api/src
  echo "export const x = 1;" > apps/api/src/base.ts
  git add . && git commit -q -m "base"
  git branch -M main && git checkout -q -b "test-case"
}

check_case() {
  local name="$1" expect_fail="$2"
  set +e; bash "$LINT" main > /tmp/lint-tco-out.txt 2>&1; local rc=$?; set -e
  if [ "$expect_fail" = "1" ] && [ "$rc" -ne 0 ]; then
    echo "  PASS [$name]"; PASSED=$((PASSED+1))
  elif [ "$expect_fail" = "0" ] && [ "$rc" -eq 0 ]; then
    echo "  PASS [$name]"; PASSED=$((PASSED+1))
  else
    echo "  FAIL [$name] expect=$expect_fail got=$rc"; cat /tmp/lint-tco-out.txt; FAILED=$((FAILED+1))
  fi
}

# Case A: test → src → PASS
TMPDIR=$(mktemp -d); cd "$TMPDIR"; init_repo
cat > apps/api/src/foo.test.ts <<'EOF'
import { describe, it, expect } from "vitest";
describe("foo", () => { it("works", () => { expect(1).toBe(1); }); });
EOF
git add . && git commit -q -m "test: foo"
echo "export const foo = 1;" > apps/api/src/foo.ts
git add . && git commit -q -m "feat: foo impl"
check_case "test-first" 0
cd /tmp; rm -rf "$TMPDIR"

# Case B: src → test → FAIL
TMPDIR=$(mktemp -d); cd "$TMPDIR"; init_repo
echo "export const bar = 2;" > apps/api/src/bar.ts
git add . && git commit -q -m "feat: bar impl (no test first)"
cat > apps/api/src/bar.test.ts <<'EOF'
import { describe, it, expect } from "vitest";
describe("bar", () => { it("works", () => { expect(2).toBe(2); }); });
EOF
git add . && git commit -q -m "test: bar"
check_case "src-first" 1
cd /tmp; rm -rf "$TMPDIR"

# Case C: test + src 同 commit → PASS
TMPDIR=$(mktemp -d); cd "$TMPDIR"; init_repo
cat > apps/api/src/baz.test.ts <<'EOF'
import { describe, it, expect } from "vitest";
describe("baz", () => { it("works", () => { expect(3).toBe(3); }); });
EOF
echo "export const baz = 3;" > apps/api/src/baz.ts
git add . && git commit -q -m "feat: baz (test+src together)"
check_case "same-commit" 0
cd /tmp; rm -rf "$TMPDIR"

echo ""; echo "lint-tdd-commit-order: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
