#!/usr/bin/env bash
# lint-no-fake-test.test.sh — 5 case
# A: 全 toBeDefined → FAIL (Rule 1)
# B: 全 not.toThrow → FAIL (Rule 1)
# C: 6 mock + 2 expect → FAIL (Rule 2)
# D: 真行为断言 toBe → PASS
# E: 弱+强混合 → PASS
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINT="$SCRIPT_DIR/lint-no-fake-test.sh"

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
    set +e; bash "$LINT" main > /tmp/lint-nft-out.txt 2>&1; local rc=$?; set -e
    echo $rc
  ) > /tmp/lint-nft-rc.txt
  local rc; rc=$(cat /tmp/lint-nft-rc.txt)
  if [ "$expect_fail" = "1" ] && [ "$rc" -ne 0 ]; then
    echo "  PASS [$name]"; PASSED=$((PASSED+1))
  elif [ "$expect_fail" = "0" ] && [ "$rc" -eq 0 ]; then
    echo "  PASS [$name]"; PASSED=$((PASSED+1))
  else
    echo "  FAIL [$name] expect=$expect_fail got=$rc"; cat /tmp/lint-nft-out.txt; FAILED=$((FAILED+1))
  fi
  rm -rf "$TMPDIR"
}

# A: 全 toBeDefined → FAIL
run_case "all-defined" 1 'import { describe, it, expect } from "vitest";
import { x } from "./base";
describe("weak", () => { it("exists", () => { expect(x).toBeDefined(); expect(x).toBeDefined(); }); });'

# B: 全 not.toThrow → FAIL
run_case "all-no-throw" 1 'import { describe, it, expect } from "vitest";
import { x } from "./base";
describe("weak", () => { it("safe", () => {
  expect(() => x).not.toThrow();
  expect(() => x + 1).not.toThrow();
}); });'

# C: 6 mock + 2 expect → FAIL
run_case "mock-heavy" 1 'import { describe, it, expect, vi } from "vitest";
vi.mock("./mod1", () => ({})); vi.mock("./mod2", () => ({})); vi.mock("./mod3", () => ({}));
vi.mock("./mod4", () => ({})); vi.mock("./mod5", () => ({})); vi.mock("./mod6", () => ({}));
describe("mocks", () => { it("test", () => { expect(1).toBe(1); expect(2).toBe(2); }); });'

# D: 真 toBe → PASS
run_case "good-behavior" 0 'import { describe, it, expect } from "vitest";
import { x } from "./base";
describe("real", () => { it("value is 1", () => { expect(x).toBe(1); }); });'

# E: 弱+强混合 → PASS
run_case "mixed" 0 'import { describe, it, expect } from "vitest";
import { x } from "./base";
describe("mixed", () => { it("exists and value", () => {
  expect(x).toBeDefined();
  expect(x).toBe(1);
}); });'

echo ""; echo "lint-no-fake-test: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
