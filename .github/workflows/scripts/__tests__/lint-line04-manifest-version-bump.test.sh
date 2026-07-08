#!/usr/bin/env bash
# lint-line04-manifest-version-bump.test.sh — 4 cases
# 根因（issue 99741ff9 相关排查，2026-07-08）：#1160/#1163/#1165 三个 PR 改了
# services/agent/wechat-rpa/**（line04 模块源码），但都没 bump
# services/agent/build-modules/line04/manifest.json 的 version，导致修复从未
# 被客户端 OTA 拉取——lint-agent-version-bump.sh 只护 services/agent/src/
# （agent core），完全不覆盖 wechat-rpa（line04 模块），三个 PR 全部漏检。
#
# A: wechat-rpa 有变动 + manifest version 有 bump → PASS
# B: wechat-rpa 有变动 + manifest version 无 bump → FAIL
# C: wechat-rpa 无变动 → PASS (skip)
# D: wechat-rpa 有变动 + manifest 本身没变 → FAIL
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINT="$SCRIPT_DIR/lint-line04-manifest-version-bump.sh"

PASSED=0; FAILED=0

init_repo() {
  git init -q
  git config user.email "t@t"
  git config user.name "t"
  git config commit.gpgsign false
  mkdir -p services/agent/wechat-rpa services/agent/build-modules/line04
  cat > services/agent/build-modules/line04/manifest.json <<'EOF'
{
  "lineId": "line04-wechat-cs",
  "version": "1.0.111",
  "displayName": "微信AI客服"
}
EOF
  echo "x = 1" > services/agent/wechat-rpa/listen_chat.py
  git add . && git commit -q -m "base"
  git branch -M main && git checkout -q -b "test-case"
}

check_result() {
  local name="$1" expect_fail="$2"
  set +e; bash "$LINT" main > /tmp/lint-l4mvb-out.txt 2>&1; local rc=$?; set -e
  if [ "$expect_fail" = "1" ] && [ "$rc" -ne 0 ]; then
    echo "  PASS [$name]"; PASSED=$((PASSED+1))
  elif [ "$expect_fail" = "0" ] && [ "$rc" -eq 0 ]; then
    echo "  PASS [$name]"; PASSED=$((PASSED+1))
  else
    echo "  FAIL [$name] expect=$expect_fail got=$rc"; cat /tmp/lint-l4mvb-out.txt; FAILED=$((FAILED+1))
  fi
}

# A: wechat-rpa 变动 + manifest version bump → PASS
TMPDIR=$(mktemp -d); cd "$TMPDIR"; init_repo
echo "y = 2" > services/agent/wechat-rpa/scan.py
cat > services/agent/build-modules/line04/manifest.json <<'EOF'
{
  "lineId": "line04-wechat-cs",
  "version": "1.0.112",
  "displayName": "微信AI客服"
}
EOF
git add . && git commit -q -m "fix(wechat-rpa): anchor fix"
check_result "rpa-changed-version-bumped" 0
cd /tmp; rm -rf "$TMPDIR"

# B: wechat-rpa 变动 + manifest 无 bump（manifest 文件根本没改）→ FAIL
TMPDIR=$(mktemp -d); cd "$TMPDIR"; init_repo
echo "y = 2" > services/agent/wechat-rpa/scan.py
git add . && git commit -q -m "fix(wechat-rpa): anchor fix"
check_result "rpa-changed-no-manifest-touch" 1
cd /tmp; rm -rf "$TMPDIR"

# C: wechat-rpa 无变动 → PASS (skip)
TMPDIR=$(mktemp -d); cd "$TMPDIR"; init_repo
echo "# doc" > README.md
git add . && git commit -q -m "docs: update readme"
check_result "no-rpa-change" 0
cd /tmp; rm -rf "$TMPDIR"

# D: wechat-rpa 变动 + manifest 文件被碰了但 version 数值没变 → FAIL
TMPDIR=$(mktemp -d); cd "$TMPDIR"; init_repo
echo "y = 2" > services/agent/wechat-rpa/scan.py
cat > services/agent/build-modules/line04/manifest.json <<'EOF'
{
  "lineId": "line04-wechat-cs",
  "version": "1.0.111",
  "displayName": "微信AI客服（改了描述但没bump版本号）"
}
EOF
git add . && git commit -q -m "fix(wechat-rpa): anchor fix"
check_result "rpa-changed-manifest-touched-but-version-same" 1
cd /tmp; rm -rf "$TMPDIR"

echo ""; echo "lint-line04-manifest-version-bump: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
