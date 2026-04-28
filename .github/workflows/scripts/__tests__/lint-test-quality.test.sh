#!/usr/bin/env bash
# lint-test-quality.test.sh — 4 case
# A: readFileSync(src/) + 无 await → FAIL (Rule A)
# B: 0 expect → FAIL (Rule B)
# C: 全 skip → FAIL (Rule C)
# D: 真 await + expect → PASS
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINT="$SCRIPT_DIR/lint-test-quality.sh"

PASSED=0; FAILED=0

run_case() {
  local name="$1" expect_fail="$2" content="$3"
  local TMPDIR; TMPDIR=$(mktemp -d)
  (
    cd "$TMPDIR"
    git init -q && git config user.email "t@t" && git config user.name "t" && git config commit.gpgsign false
    mkdir -p apps/api/src
    echo "export const x = 1;" > apps/api/src/base.ts
    git add . && git commit -q -m "base"
    git branch -M main && git checkout -q -b "case-$name"
    printf '%s\n' "$content" > "apps/api/src/${name}.test.ts"
    git add . && git commit -q -m "$name"
    set +e; bash "$LINT" main > /tmp/lint-tq-out.txt 2>&1; local rc=$?; set -e
    echo $rc
  ) > /tmp/lint-tq-rc.txt
  local rc; rc=$(cat /tmp/lint-tq-rc.txt)
  if [ "$expect_fail" = "1" ] && [ "$rc" -ne 0 ]; then
    echo "  PASS [$name]"; PASSED=$((PASSED+1))
  elif [ "$expect_fail" = "0" ] && [ "$rc" -eq 0 ]; then
    echo "  PASS [$name]"; PASSED=$((PASSED+1))
  else
    echo "  FAIL [$name] expect=$expect_fail got=$rc"; cat /tmp/lint-tq-out.txt; FAILED=$((FAILED+1))
  fi
  rm -rf "$TMPDIR"
}

# A: readFileSync(src/) + 无 await → FAIL
run_case "stub" 1 'import { readFileSync } from "fs";
import { describe, it, expect } from "vitest";
const src = readFileSync("apps/api/src/base.ts", "utf8");
describe("stub", () => { it("has export", () => { expect(src).toContain("export"); }); });'

# B: 0 expect → FAIL
run_case "no-expect" 1 'import { describe, it } from "vitest";
describe("empty", () => { it("nothing", () => { const x = 1; }); });'

# C: 全 skip → FAIL
run_case "all-skip" 1 'import { describe, it, expect } from "vitest";
describe("skipped", () => {
  it.skip("a", () => { expect(1).toBe(1); });
  it.skip("b", () => { expect(2).toBe(2); });
});'

# D: 真 await + expect → PASS
run_case "good" 0 'import { describe, it, expect } from "vitest";
async function add(a: number, b: number) { return a + b; }
describe("add", () => { it("sums", async () => {
  const r = await add(1, 2);
  expect(r).toBe(3);
}); });'

echo ""; echo "lint-test-quality: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
