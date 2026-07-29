#!/usr/bin/env bash
# account-scan-realmachine-smoke.test.sh — TDD Red 阶段
#
# 验证 account-scan-realmachine-smoke.sh 在无 Android 设备的环境（本 CI 容器/ubuntu-latest）
# 下正确走 envfail() 分支：exit 3，区分"环境未就绪"与"真机验证真的失败"(exit 1)。
# 这条区分是 line02-android-collect-realmachine-smoke.sh 已验证过的既有约定，本脚本跟进。
#
# 迁移自 sprints/07292330-realmachine-verify-lane/tests/account-scan-realmachine-smoke.envfail.test.sh
# （同 lint-*.test.sh 家族的 __tests__ 目录约定）。
#
# 用法: bash account-scan-realmachine-smoke.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/.github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  account-scan-realmachine-smoke.sh envfail 分支测试"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f "$SCRIPT" ]; then
  echo "❌ RED（预期）: $SCRIPT 不存在 —— Generator 尚未实现，TDD Red 阶段正常现象"
  exit 1
fi

# 用一个必然找不到设备的假 ADB 路径，强制走 envfail 分支（无需真机也能测这条降级路径）
ADB="/nonexistent/adb-binary-for-test" bash "$SCRIPT"
CODE=$?

if [ "$CODE" -eq 3 ]; then
  echo "✅ PASS: 无设备环境正确 exit 3（envfail，非 fail）"
  exit 0
else
  echo "❌ FAIL: 期望 exit 3（环境未就绪），实得 exit=$CODE"
  exit 1
fi
