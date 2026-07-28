#!/usr/bin/env bash
# lint-feature-has-smoke.test.sh — 6 case
# A: feat: PR 触及 apps/src + 有 smoke.sh → PASS
# B: feat: PR 触及 apps/src + 无 smoke.sh → FAIL
# C: feat: PR 不触及 apps/src → PASS (跳过)
# D: fix: PR 触及 apps/src → PASS (跳过，非 feat)
# E: feat: PR 触及 apps/src + 对既有大 smoke.sh 做有实质内容的扩展（新增 Step）→ PASS
# F: feat: PR 触及 apps/src + 只象征性碰一下既有大 smoke.sh（无实质新增）→ FAIL
# G: feat: PR 触及 apps/src + 只改既有version-gate smoke.sh的EXPECTED="x.y.z"一行同步版本号 → PASS(版本同步豁免)
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

# Like init_repo, but commits an existing smoke script to `main` itself
# (before branching) — needed for E/F cases where the smoke file must
# genuinely predate the feature branch, not just predate a later commit
# on the same branch (git diff main...HEAD would otherwise see it as new).
init_repo_with_existing_smoke() {
  git init -q && git config user.email "t@t" && git config user.name "t" && git config commit.gpgsign false
  mkdir -p apps/api/src .github/workflows/scripts/smoke
  echo "export const x = 1;" > apps/api/src/base.ts
  cat > .github/workflows/scripts/smoke/existing-smoke.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "Step 1"
curl -sf http://localhost:3000/health || exit 1
echo "Step 2"
node -e "console.log('ok')"
EOF
  chmod +x .github/workflows/scripts/smoke/existing-smoke.sh
  git add . && git commit -q -m "base incl. existing smoke"
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

# E: feat + apps/src + 对既有大 smoke.sh 做有实质内容的扩展 → PASS
TMPDIR=$(mktemp -d); cd "$TMPDIR"; init_repo_with_existing_smoke
echo "export const y = 2;" > apps/api/src/feature.ts
cat >> .github/workflows/scripts/smoke/existing-smoke.sh <<'EOF'

echo "Step 3: 新功能回归"
curl -sf -X POST http://localhost:3000/api/new-feature -d '{}' || exit 1
psql "$DB_URL" -c "SELECT 1" || exit 1
echo "Step 3 passed"
EOF
git add . && git commit -q -m "feat(api): add feature, extend existing smoke with Step 3"
check_result "feat-extends-existing-smoke" 0
cd /tmp; rm -rf "$TMPDIR"

# F: feat + apps/src + 只象征性碰一下既有大 smoke.sh（无实质新增）→ FAIL
TMPDIR=$(mktemp -d); cd "$TMPDIR"; init_repo_with_existing_smoke
echo "export const y = 2;" > apps/api/src/feature.ts
sed -i.bak 's/Step 1/Step 1 (touched)/' .github/workflows/scripts/smoke/existing-smoke.sh
rm -f .github/workflows/scripts/smoke/existing-smoke.sh.bak
git add . && git commit -q -m "feat(api): add feature, trivially touch existing smoke"
check_result "feat-trivial-touch-fails" 1
cd /tmp; rm -rf "$TMPDIR"

# G: feat + apps/src + 只改既有 version-gate smoke 的 EXPECTED="x.y.z" 一行 → PASS（版本同步豁免）
TMPDIR=$(mktemp -d); cd "$TMPDIR"
git init -q && git config user.email "t@t" && git config user.name "t" && git config commit.gpgsign false
mkdir -p apps/api/src .github/workflows/scripts/smoke
echo "export const x = 1;" > apps/api/src/base.ts
cat > .github/workflows/scripts/smoke/version-gate-smoke.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
EXPECTED_LINE04_VERSION="1.0.1"
node -e "process.stdout.write(require('./manifest.json').version)"
curl -sf http://localhost:3000/health || exit 1
echo "version-gate OK"
EOF
chmod +x .github/workflows/scripts/smoke/version-gate-smoke.sh
git add . && git commit -q -m "base incl. version-gate smoke"
git branch -M main && git checkout -q -b "test-case"
echo "export const y = 2;" > apps/api/src/feature.ts
sed -i.bak 's/EXPECTED_LINE04_VERSION="1.0.1"/EXPECTED_LINE04_VERSION="1.0.2"/' .github/workflows/scripts/smoke/version-gate-smoke.sh
rm -f .github/workflows/scripts/smoke/version-gate-smoke.sh.bak
git add . && git commit -q -m "feat(api): add feature, bump line04 version-gate smoke EXPECTED"
check_result "feat-version-sync-only-passes" 0
cd /tmp; rm -rf "$TMPDIR"

echo ""; echo "lint-feature-has-smoke: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
