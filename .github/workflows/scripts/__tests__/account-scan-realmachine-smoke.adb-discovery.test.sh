#!/usr/bin/env bash
# account-scan-realmachine-smoke.adb-discovery.test.sh — TDD Red 阶段
#
# 背景（2026-08-03 真机对照实锤，decision 2f11ae25 配套）：
#   刀D 在 xian-rog runner 上跑时 PATH 无 adb，脚本默认 ADB=adb，
#   `"$ADB" devices 2>/dev/null` 静默失败被误报"无 Android 设备在线"envfail——
#   同机手动指定 scrcpy adb 全路径后整条链全绿（装 2.1.19→扫描 done→account_ids=2）。
#
# 结构性静态检查（CI 容器无真机；ubuntu runner 自带 adb，行为测试会被干扰，故用静态断言）：
#   1. ADB 未显式传入时必须有探测：glob scrcpy 路径优先（sort -V 取最新版），command -v 兜底
#   2. glob 探测必须先于 command -v（e2e-line02-android-collect.yml 已验证顺序；PATH 杂牌 adb 会互杀 server）
#   3. 探测全失败必须 envfail 独立文案"找不到 adb"（与"无设备在线"区分）
#   4. 设备检查前必须有 `"$ADB" version` 可用性校验（覆盖显式传入坏 ADB），独立文案"adb 不可用"
set -uo pipefail
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/.github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh"
echo "━━ adb-discovery 结构性测试 ━━"
[ -f "$SCRIPT" ] || { echo "❌ $SCRIPT 不存在"; exit 1; }
FAIL=0

GLOB_LINE=$(grep -n 'Genymobile\.scrcpy_' "$SCRIPT" | head -1 | cut -d: -f1)
CMDV_LINE=$(grep -n 'command -v adb' "$SCRIPT" | head -1 | cut -d: -f1)
if [ -z "$GLOB_LINE" ]; then
  echo "❌ FAIL: 无 scrcpy adb glob 探测"; FAIL=1
else
  echo "✅ glob 探测存在 (line $GLOB_LINE)"
  if ! sed -n "${GLOB_LINE}p" "$SCRIPT" | grep -q 'sort -V'; then
    echo "❌ FAIL: glob 探测行缺 sort -V（3.10<3.2 字典序会取到旧版 adb）"; FAIL=1
  fi
  if [ -n "$CMDV_LINE" ] && [ "$CMDV_LINE" -lt "$GLOB_LINE" ]; then
    echo "❌ FAIL: command -v adb (line $CMDV_LINE) 先于 glob (line $GLOB_LINE)，顺序不对"; FAIL=1
  fi
fi
[ -n "$CMDV_LINE" ] || { echo "❌ FAIL: 无 command -v adb 兜底"; FAIL=1; }

grep -q 'envfail "runner 上找不到 adb"' "$SCRIPT" \
  || { echo "❌ FAIL: 缺'找不到 adb'独立 envfail 文案"; FAIL=1; }

VER_LINE=$(grep -n '"\$ADB" version' "$SCRIPT" | head -1 | cut -d: -f1)
DEV_LINE=$(grep -n '"\$ADB" devices' "$SCRIPT" | head -1 | cut -d: -f1)
if [ -z "$VER_LINE" ]; then
  echo "❌ FAIL: 设备检查前无 adb version 可用性校验"; FAIL=1
elif [ -n "$DEV_LINE" ] && [ "$VER_LINE" -gt "$DEV_LINE" ]; then
  echo "❌ FAIL: adb version 校验 (line $VER_LINE) 在 devices 检查 (line $DEV_LINE) 之后"; FAIL=1
else
  echo "✅ adb version 校验先于 devices 检查"
fi
grep -q 'envfail "adb 不可用' "$SCRIPT" \
  || { echo "❌ FAIL: 缺'adb 不可用'独立 envfail 文案（应带 stderr）"; FAIL=1; }
grep -q 'envfail "无 Android 设备在线' "$SCRIPT" \
  || { echo "❌ FAIL: 原'无 Android 设备在线'文案丢失（三种文案必须并存互异）"; FAIL=1; }

[ "$FAIL" -eq 0 ] && { echo "✅ PASS"; exit 0; } || { echo "❌ RED/FAIL"; exit 1; }
