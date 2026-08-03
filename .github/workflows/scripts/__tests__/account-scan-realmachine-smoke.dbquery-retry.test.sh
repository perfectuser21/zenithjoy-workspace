#!/usr/bin/env bash
# account-scan-realmachine-smoke.dbquery-retry.test.sh — TDD Red 阶段
#
# 背景（2026-08-03 nightly run 30786965614 实锤）：license_key 查询走 `ssh vps-hk`
# （Tailscale 100.x，无直连全走 DERP 中继），中继闪断时单次查询失败且 stderr 被
# `2>/dev/null` 吞掉，被误报成"查不到 active license_key"（数据实际完好，
# hk-vps 直查有 2 条 active）。与 envbind 修复同款教训：ssh 错误伪装成查无数据。
#
# 结构性静态检查：
#   1. license 查询必须有有界重试（瞬断自愈）：`LICENSE_RETRY` 循环存在
#   2. 查询的 ssh 调用不得吞 stderr：该调用行禁止出现 2>/dev/null，失败时 stderr
#      必须进 envfail 文案（含"ssh"字样区分"真查无数据"与"链路失败"）
set -uo pipefail
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/.github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh"
echo "━━ dbquery-retry 结构性测试 ━━"
[ -f "$SCRIPT" ] || { echo "❌ $SCRIPT 不存在"; exit 1; }
FAIL=0

grep -q 'LICENSE_RETRY' "$SCRIPT" \
  || { echo "❌ FAIL: license 查询无有界重试(LICENSE_RETRY 循环不存在)"; FAIL=1; }

LICENSE_QUERY_LINE=$(grep -n 'SELECT license_key' "$SCRIPT" | head -1 | cut -d: -f1)
if [ -z "$LICENSE_QUERY_LINE" ]; then
  echo "❌ FAIL: 找不到 license_key 查询"; FAIL=1
else
  # 查询行及其后 2 行（同一条命令的续行）内不得出现 2>/dev/null
  if sed -n "${LICENSE_QUERY_LINE},$((LICENSE_QUERY_LINE+2))p" "$SCRIPT" | grep -q '2>/dev/null'; then
    echo "❌ FAIL: license 查询仍在吞 stderr(2>/dev/null)——ssh 失败会伪装成查无数据"; FAIL=1
  else
    echo "✅ license 查询不吞 stderr"
  fi
fi

grep -q 'envfail "查不到.*或 ssh 链路失败' "$SCRIPT" \
  || { echo "❌ FAIL: envfail 文案未区分'查无数据'与'ssh 链路失败'"; FAIL=1; }

[ "$FAIL" -eq 0 ] && { echo "✅ PASS"; exit 0; } || { echo "❌ RED/FAIL"; exit 1; }
