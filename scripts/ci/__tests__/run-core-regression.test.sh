#!/usr/bin/env bash
# ============================================================================
# run-core-regression.test.sh — run-core-regression.sh 的 fixture 驱动单测
# ----------------------------------------------------------------------------
# 四个 case：
#   case1 空契约 golden_paths: []                        → exit 1（空契约守卫）
#   case2 一条 test_command=false                          → exit 1
#   case3 一条 test_command=true                           → exit 0
#   case4 条目 trigger 仅 [Release]，用 --tier pr 跑        → 选出0条 → exit 1
# ============================================================================
set -uo pipefail

RUNNER="$(cd "$(dirname "$0")/.." && pwd)/run-core-regression.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

fail=0
check() {
  # $1=case名 $2=期望退出码 $3=实际退出码
  if [ "$2" = "$3" ]; then
    echo "  ok: $1"
  else
    echo "  FAIL: $1 (want=$2 got=$3)"
    fail=1
  fi
}

# --- case1: 空契约 ---
cat > "$TMP/case1.yaml" <<'YAML'
golden_paths: []
YAML
bash "$RUNNER" --tier pr --contract "$TMP/case1.yaml" >/dev/null 2>&1
check "case1-空契约守卫" 1 "$?"

# --- case2: test_command=false ---
cat > "$TMP/case2.yaml" <<'YAML'
golden_paths:
  - id: FIXTURE-FALSE
    trigger: [PR, Release]
    test_command: "false"
YAML
bash "$RUNNER" --tier pr --contract "$TMP/case2.yaml" >/dev/null 2>&1
check "case2-条目失败" 1 "$?"

# --- case3: test_command=true ---
cat > "$TMP/case3.yaml" <<'YAML'
golden_paths:
  - id: FIXTURE-TRUE
    trigger: [PR, Release]
    test_command: "true"
YAML
bash "$RUNNER" --tier pr --contract "$TMP/case3.yaml" >/dev/null 2>&1
check "case3-条目通过" 0 "$?"

# --- case4: trigger 仅 [Release]，用 --tier pr 跑 ---
cat > "$TMP/case4.yaml" <<'YAML'
golden_paths:
  - id: FIXTURE-RELEASE-ONLY
    trigger: [Release]
    test_command: "true"
YAML
bash "$RUNNER" --tier pr --contract "$TMP/case4.yaml" >/dev/null 2>&1
check "case4-tier不匹配选出0条" 1 "$?"

if [ $fail -eq 0 ]; then
  echo "ALL PASS"
else
  echo "SOME FAILED"
  exit 1
fi
