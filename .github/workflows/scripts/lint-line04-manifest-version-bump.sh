#!/usr/bin/env bash
# lint-line04-manifest-version-bump.sh (ZenithJoy)
# Rule: any PR that changes services/agent/wechat-rpa/ (line04 module source)
#       MUST also bump services/agent/build-modules/line04/manifest.json
#       "version" field.
#
# 根因（issue 99741ff9 相关排查，2026-07-08）：lint-agent-version-bump.sh 只护
# services/agent/src/（agent core 启动器版本），完全不覆盖 services/agent/
# wechat-rpa/（line04 模块源码）。#1160/#1163/#1165 三个已合并 P0/P2 修复都
# 改了 wechat-rpa 但漏 bump manifest 版本号，导致客户端 OTA 永远不会拉取新
# 代码——代码合并了但从未实际分发到任何客户机。这个闸门补上这个覆盖缺口。
#
# Usage: bash lint-line04-manifest-version-bump.sh [BASE_REF]
# Exit:  0 = pass / skip, 1 = fail
set -euo pipefail

BASE_REF="${1:-origin/main}"
echo "lint-line04-manifest-version-bump base: $BASE_REF"

git fetch origin "${BASE_REF#origin/}" --quiet 2>/dev/null || true

# Check if any services/agent/wechat-rpa/ file changed (non-test)
RPA_CHANGED=$(git diff --name-only --diff-filter=AM "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -E "^services/agent/wechat-rpa/" \
  | grep -vE "[.](test|spec)[.]py$|/__tests__/|/tests/" \
  || true)

if [ -z "$RPA_CHANGED" ]; then
  echo "skip: no services/agent/wechat-rpa changes"
  exit 0
fi

echo "wechat-rpa (line04 module) changed:"
echo "$RPA_CHANGED" | sed 's/^/  /'

MANIFEST="services/agent/build-modules/line04/manifest.json"

# Check manifest.json was modified at all
MANIFEST_CHANGED=$(git diff --name-only --diff-filter=M "${BASE_REF}...HEAD" 2>/dev/null \
  | grep -F "$MANIFEST" || true)

if [ -z "$MANIFEST_CHANGED" ]; then
  echo "::error::lint-line04-manifest-version-bump FAIL"
  echo "  rule: services/agent/wechat-rpa changed → must bump version in $MANIFEST"
  echo "  fix: increment version field in $MANIFEST (e.g. 1.0.111 -> 1.0.112)"
  exit 1
fi

# Extract old and new version
OLD_VER=$(git show "${BASE_REF}:${MANIFEST}" 2>/dev/null | grep '"version"' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "")
NEW_VER=$(grep '"version"' "$MANIFEST" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "")

if [ "$OLD_VER" = "$NEW_VER" ]; then
  echo "::error::lint-line04-manifest-version-bump FAIL"
  echo "  services/agent/wechat-rpa changed but version stayed at $OLD_VER"
  echo "  fix: bump version in $MANIFEST (current: $OLD_VER)"
  exit 1
fi

echo "pass lint-line04-manifest-version-bump — version $OLD_VER -> $NEW_VER"
