#!/usr/bin/env bash
# lint-feature-has-smoke.test.sh — 4 case
# A: feat: PR 触及 apps/src + 有 smoke.sh → PASS
# B: feat: PR 触及 apps/src + 无 smoke.sh → FAIL
# C: feat: PR 不触及 apps/src → PASS (跳过)
# D: fix: PR 触及 apps/src → PASS (跳过，非 feat)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINT="$SCRIPT_DIR/lint-feature-has-smoke.sh"

PASSED=0; FAILED=0

init_repo() {
  git init -q && git config user.email "t@t" && git config user.name "t" && git config commit.gpgsign false
  mkdir -p apps/api/src .github/workflows/scripts/smoke
  echo "export const x = 1;" > apps/api/src/base.ts
  git add . && git commit -q -m "base"
  git branch -M main && git checkout -q -b "test-case"
}

check_result() {
  local name="$1" expect_fail="$2"
  set +e; bash "$LINT" main > /tmp/lint-fhs-out.txt 2>&1; local rc=$?; set -e
  if [ "$expect_fail" = "1" ] && [ "$rc" -ne 0 ]; then
    echo "  PASS [$name]"; PASSED=$((PASSED+1))
  elif [ "$expect_fail" = "0" ] && [ "$rc" -eq 0 ]; then
    echo "  PASS [$name]"; PASSED=$((PASSED+1))
  else
    echo "  FAIL [$name] expect=$expect_fail got=$rc"; cat /tmp/lint-fhs-out.txt; FAILED=$((FAILED+1))
  fi
}

# A: feat + apps/src + smoke.sh → PASS
TMPDIR=$(mktemp -d); cd "$TMPDIR"; init_repo
echo "export const y = 2;" > apps/api/src/feature.ts
cat > .github/workflows/scripts/smoke/feature-smoke.sh <<'EOF'
#!/usr/bin/env bash
# smoke test for feature
set -euo pipefail
echo "Testing feature..."
curl -sf http://localhost:3000/health || exit 1
node -e "const x = require('./apps/api/src/base'); console.log('ok');"
echo "smoke passed"
exit 0
EOF
chmod +x .github/workflows/scripts/smoke/feature-smoke.sh
git add . && git commit -q -m "feat(api): add feature"
check_result "feat-with-smoke" 0
cd /tmp; rm -rf "$TMPDIR"

# B: feat + apps/src + no smoke → FAIL
TMPDIR=$(mktemp -d); cd "$TMPDIR"; init_repo
echo "export const y = 2;" > apps/api/src/feature.ts
git add . && git commit -q -m "feat(api): add feature"
check_result "feat-no-smoke" 1
cd /tmp; rm -rf "$TMPDIR"

# C: feat + no apps/src change → PASS (skip)
TMPDIR=$(mktemp -d); cd "$TMPDIR"; init_repo
echo "# config" > .github/config.yml
git add . && git commit -q -m "feat(ci): add config"
check_result "feat-no-src" 0
cd /tmp; rm -rf "$TMPDIR"

# D: fix (non-feat) + apps/src → PASS (skip)
TMPDIR=$(mktemp -d); cd "$TMPDIR"; init_repo
echo "export const z = 3;" > apps/api/src/fix.ts
git add . && git commit -q -m "fix(api): fix something"
check_result "fix-skips" 0
cd /tmp; rm -rf "$TMPDIR"

echo ""; echo "lint-feature-has-smoke: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
