#!/usr/bin/env bash
# lint-test-pairing.test.sh — 验证 lint-test-pairing.sh 核心规则
# Case A: 有配套 test → PASS
# Case B: 无配套 test → FAIL
# Case C: 顶层 apps/api/tests/ 布局 → PASS
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINT="$SCRIPT_DIR/lint-test-pairing.sh"

PASSED=0; FAILED=0

run_case() {
  local name="$1" expect_fail="$2"
  shift 2
  local setup_fn="$1"

  local TMPDIR; TMPDIR=$(mktemp -d)
  (
    cd "$TMPDIR"
    git init -q
    git config user.email "t@t" && git config user.name "t" && git config commit.gpgsign false
    mkdir -p apps/api/src
    echo "export const x = 1;" > apps/api/src/base.ts
    git add . && git commit -q -m "base"
    git branch -M main
    git checkout -q -b "test-$name"
    eval "$setup_fn"
    git add . && git commit -q -m "test"
    set +e; bash "$LINT" main >/tmp/lint-tp-out.txt 2>&1; LINT_RC=$?; set -e
    echo $LINT_RC
  ) > /tmp/lint-tp-rc.txt
  local rc; rc=$(cat /tmp/lint-tp-rc.txt)

  if [ "$expect_fail" = "1" ] && [ "$rc" -ne 0 ]; then
    echo "  PASS [${name}] 正确拒 exit ${rc}"
    PASSED=$((PASSED+1))
  elif [ "$expect_fail" = "0" ] && [ "$rc" -eq 0 ]; then
    echo "  PASS [${name}] 正确放 exit 0"
    PASSED=$((PASSED+1))
  else
    echo "  FAIL [${name}] expect_fail=${expect_fail} got rc=${rc}"
    cat /tmp/lint-tp-out.txt
    FAILED=$((FAILED+1))
  fi
  rm -rf "$TMPDIR"
}

# Case A: 有配套同目录 test → PASS
run_case "has-test" 0 '
  echo "export const y = 2;" > apps/api/src/foo.ts
  mkdir -p apps/api/src
  cat > apps/api/src/foo.test.ts <<EOF
import { describe, it, expect } from "vitest";
describe("foo", () => { it("works", () => { expect(1).toBe(1); }); });
EOF
'

# Case B: 无配套 test → FAIL
run_case "no-test" 1 '
  echo "export const y = 2;" > apps/api/src/bar.ts
'

# Case C: 顶层 apps/api/tests/ 布局 → PASS
run_case "toplevel-tests-dir" 0 '
  echo "export const y = 2;" > apps/api/src/baz.ts
  mkdir -p apps/api/tests
  cat > apps/api/tests/baz.test.ts <<EOF
import { describe, it, expect } from "vitest";
describe("baz", () => { it("works", () => { expect(2).toBe(2); }); });
EOF
'

echo ""
echo "lint-test-pairing: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
