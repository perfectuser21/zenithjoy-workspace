#!/usr/bin/env bash
# ============================================================================
# run-core-regression.sh — 无条件核心回归执行器（zenithjoy 值班表通电）
# ----------------------------------------------------------------------------
# 从 regression-contract.yaml 选出 trigger 含当前 gate 的条目，逐条执行
# test_command。任一失败 → 整体非0。选出0条 → 非0（空契约守卫，防假绿灯）。
#
# 用法：run-core-regression.sh --tier pr|release [--contract <path>]
#   --tier pr       → gate=PR
#   --tier release  → gate=Release
# ============================================================================
set -uo pipefail

TIER=pr
CONTRACT="regression-contract.yaml"
while [ $# -gt 0 ]; do
  case "$1" in
    --tier) TIER="$2"; shift 2;;
    --contract) CONTRACT="$2"; shift 2;;
    *) shift;;
  esac
done

GATE=PR
[ "$TIER" = release ] && GATE=Release

if ! command -v yq >/dev/null 2>&1; then
  echo "ERROR: 需要 yq (mikefarah/yq)"; exit 2
fi
if [ ! -f "$CONTRACT" ]; then
  echo "ERROR: 契约文件不存在: $CONTRACT"; exit 2
fi

IDS=$(yq -r ".golden_paths[] | select(.trigger[] == \"$GATE\") | .id" "$CONTRACT")

if [ -z "$IDS" ]; then
  echo "ERROR: tier=$TIER (gate=$GATE) 选出0条（空契约守卫触发）"; exit 1
fi

rc=0
while IFS= read -r id; do
  [ -z "$id" ] && continue
  cmd=$(yq -r ".golden_paths[] | select(.id==\"$id\") | .test_command" "$CONTRACT")
  echo "=== [$id] $cmd ==="
  bash -c "$cmd" || { echo "FAIL: $id"; rc=1; }
done <<< "$IDS"

if [ $rc -eq 0 ]; then
  echo "=== core-regression PASS (tier=$TIER) ==="
else
  echo "=== core-regression FAIL (tier=$TIER) ==="
fi
exit $rc
