#!/usr/bin/env bash
# two-column-gate.test.sh — W5 D5 合同测试（Contract Tests）
# TASK_ID: 11cc5f4c-9bd0-4612-bf5a-9a6b574756af
#
# 对 scripts/release-gate/two-column-gate.sh 跑 [BEHAVIOR] 断言
# 用法: bash sprints/w5-release-gate-d5/tests/two-column-gate.test.sh
# 前置: bash + jq 已安装，在 repo 根目录执行

SCRIPT="scripts/release-gate/two-column-gate.sh"
FIXTURE_DIR="scripts/release-gate/fixtures"
PROMOTE_SHA_MATCH="aaaaaaaabbbbbbbbccccccccddddddddeeeeeeee"
PROMOTE_SHA_DIFF="bbbbbbbbccccccccddddddddeeeeeeeeffffffff"
PASS=0
FAIL=0

run_case() {
  local label="$1"
  local expected_exit="$2"
  shift 2
  # 剩余参数：环境变量 k=v，再加 --fixture
  local fixture_arg=""
  local env_args=()
  for arg in "$@"; do
    if [[ "$arg" == --fixture=* ]]; then
      fixture_arg="${arg#--fixture=}"
    else
      env_args+=("$arg")
    fi
  done

  local actual_exit=0
  if [ -n "$fixture_arg" ]; then
    env "${env_args[@]}" bash "$SCRIPT" --fixture "$fixture_arg" 2>/dev/null || actual_exit=$?
  else
    env "${env_args[@]}" bash "$SCRIPT" 2>/dev/null || actual_exit=$?
  fi

  if [ "$actual_exit" -eq "$expected_exit" ]; then
    echo "[PASS] $label (exit=$actual_exit)"
    PASS=$((PASS+1))
  else
    echo "[FAIL] $label — expected exit=$expected_exit, got=$actual_exit"
    FAIL=$((FAIL+1))
  fi
}

# [BEHAVIOR] 当 gate 未定案（finalized=false）时，exit 1
run_case "B-1: 未定案 → exit 1" 1 \
  "PROMOTE_SHA=$PROMOTE_SHA_MATCH" "--fixture=$FIXTURE_DIR/case-not-finalized.json"

# [BEHAVIOR] 当 gate_verdict == green 且 backend_sha 精确匹配 PROMOTE_SHA 时，exit 0
run_case "B-2: 定案绿 sha匹配 → exit 0" 0 \
  "PROMOTE_SHA=$PROMOTE_SHA_MATCH" "--fixture=$FIXTURE_DIR/case-green.json"

# [BEHAVIOR] 当 blocked_reason == ai_run_infra_error 且 bypass=true 时，exit 0
run_case "B-3: infra_error+bypass=true → exit 0" 0 \
  "PROMOTE_SHA=$PROMOTE_SHA_MATCH" "BYPASS_TWO_COLUMN_INFRA=true" \
  "--fixture=$FIXTURE_DIR/case-infra-error-bypass.json"

# [BEHAVIOR] 当 blocked_reason == undecided_cells 时，即使 bypass=true 仍 exit 1
run_case "B-4: cells_red+bypass=true → exit 1（bypass无效）" 1 \
  "PROMOTE_SHA=$PROMOTE_SHA_MATCH" "BYPASS_TWO_COLUMN_INFRA=true" \
  "--fixture=$FIXTURE_DIR/case-cells-red-bypass.json"

# [BEHAVIOR] 当 gate 端点不可达（fixture 文件不存在）时，exit 1
run_case "B-5: 取数失败（fixture不存在）→ exit 1" 1 \
  "PROMOTE_SHA=$PROMOTE_SHA_MATCH" "--fixture=$FIXTURE_DIR/nonexistent.json"

# [BEHAVIOR] 当 backend_sha 不匹配 PROMOTE_SHA 时，exit 1（INV-4 字节精确）
run_case "B-INV4: sha不匹配 → exit 1" 1 \
  "PROMOTE_SHA=$PROMOTE_SHA_DIFF" "--fixture=$FIXTURE_DIR/case-green.json"

echo ""
echo "=============================="
echo "合同测试结果: PASS=$PASS FAIL=$FAIL"
echo "=============================="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
