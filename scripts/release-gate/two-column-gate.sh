#!/usr/bin/env bash
# two-column-gate.sh — W5 D5 双列验收放行闸
#
# 功能：
#   1. 从 Brain Gate 端点取定案 run（或 --fixture 模式读本地 JSON）
#   2. 断言 run.backend_sha == PROMOTE_SHA（字节精确匹配）
#   3. 断言 run.gate_verdict == "green"
#   4. blocked_reason 三态：ai_run_infra_error/undecided_cells/null（格红）
#   5. bypass_two_column_infra 仅在 ai_run_infra_error 时生效
#   6. 棘轮计数（近30天任一项 > 3 时 exit 1 + summary 大字）
#
# 用法：
#   two-column-gate.sh [--fixture <file>]
#
# 环境变量：
#   PROMOTE_SHA              — 要 promote 的 commit sha（40 位）
#   BYPASS_TWO_COLUMN_INFRA  — "true" 时允许绕过 ai_run_infra_error（仅此情形有效）
#   GATE_TOKEN               — Brain Gate API Token
#   GATE_URL                 — Brain Gate 基础 URL（默认 https://brain-acceptance.zenjoymedia.media）
#   JOURNEY_ID               — Journey ID
#
# TASK_ID: 11cc5f4c-9bd0-4612-bf5a-9a6b574756af

set -euo pipefail

# ─── 解析参数 ────────────────────────────────────────────────────────────────
FIXTURE_FILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --fixture)
      FIXTURE_FILE="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

# ─── 环境变量 ────────────────────────────────────────────────────────────────
PROMOTE_SHA="${PROMOTE_SHA:-}"
BYPASS="${BYPASS_TWO_COLUMN_INFRA:-false}"
GATE_TOKEN="${GATE_TOKEN:-}"
GATE_URL="${GATE_URL:-https://brain-acceptance.zenjoymedia.media}"
JOURNEY_ID="${JOURNEY_ID:-}"

# ─── 辅助：写 GITHUB_STEP_SUMMARY ────────────────────────────────────────────
write_summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    echo "$1" >> "$GITHUB_STEP_SUMMARY"
  fi
}

# ─── 辅助：棘轮检查 ──────────────────────────────────────────────────────────
ratchet_check() {
  local name="$1"
  local count="$2"
  if [ "$count" -gt 3 ]; then
    echo "::error::棘轮超限：近30天 $name=$count（>3），拒绝放行"
    write_summary "## 🚨 棘轮超限：$name=$count（近30天 >3）"
    write_summary ""
    write_summary "四项异常计数之一超出棘轮上限，本次 promote 被自动阻止。请先排查根因，再重置计数。"
    exit 1
  fi
}

# ─── 取 Gate 数据 ─────────────────────────────────────────────────────────────
if [ -n "$FIXTURE_FILE" ]; then
  # --fixture 模式：读本地 JSON，跳过 HTTP
  if [ ! -f "$FIXTURE_FILE" ]; then
    echo "::error::--fixture 文件不存在: $FIXTURE_FILE"
    exit 1
  fi
  GATE_JSON="$(cat "$FIXTURE_FILE")"
  echo "[fixture] 已读取: $FIXTURE_FILE"
else
  # 真实 HTTP 模式
  if [ -z "$GATE_TOKEN" ]; then
    echo "::error::GATE_TOKEN 未设置，无法调用 Gate 端点"
    exit 1
  fi
  if [ -z "$JOURNEY_ID" ]; then
    echo "::error::JOURNEY_ID 未设置，无法调用 Gate 端点"
    exit 1
  fi
  ENDPOINT="${GATE_URL}/acceptance/gate/latest-finalized?journey_id=${JOURNEY_ID}"
  echo "[gate] 查询: $ENDPOINT"
  GATE_JSON=$(curl -fsSL \
    -H "Authorization: Bearer $GATE_TOKEN" \
    -H "Accept: application/json" \
    "$ENDPOINT") || {
    echo "::error::Gate 端点调用失败（网络错误或 HTTP 非 2xx）"
    exit 1
  }
fi

# ─── 检查 jq ─────────────────────────────────────────────────────────────────
if ! command -v jq &>/dev/null; then
  echo "::error::需要 jq 但未安装"
  exit 1
fi

echo "[gate] 响应: $GATE_JSON"

# ─── 解析字段 ─────────────────────────────────────────────────────────────────
FINALIZED=$(echo "$GATE_JSON" | jq -r '.finalized // false')
GATE_VERDICT=$(echo "$GATE_JSON" | jq -r '.gate_verdict // ""')
BACKEND_SHA=$(echo "$GATE_JSON" | jq -r '.backend_sha // ""')
BLOCKED_REASON=$(echo "$GATE_JSON" | jq -r '.blocked_reason // "null"')

# 棘轮计数（fixture 中可携带 ratchet 字段）
RATCHET_FORCE=$(echo "$GATE_JSON" | jq -r '.ratchet.force_reason_count // 0')
RATCHET_UNVERIFIABLE=$(echo "$GATE_JSON" | jq -r '.ratchet.unverifiable_count // 0')
RATCHET_WAIVE=$(echo "$GATE_JSON" | jq -r '.ratchet.waive_count // 0')
RATCHET_BYPASS=$(echo "$GATE_JSON" | jq -r '.ratchet.bypass_count // 0')

echo "[gate] finalized=$FINALIZED gate_verdict=$GATE_VERDICT blocked_reason=$BLOCKED_REASON"
echo "[gate] backend_sha=$BACKEND_SHA"
echo "[gate] ratchet: force_reason=$RATCHET_FORCE unverifiable=$RATCHET_UNVERIFIABLE waive=$RATCHET_WAIVE bypass=$RATCHET_BYPASS"

# ─── Step 1: 定案检查 ─────────────────────────────────────────────────────────
if [ "$FINALIZED" != "true" ]; then
  echo "::error::Gate run 尚未定案（finalized=false），不能 promote"
  exit 1
fi
echo "[check] ✅ 已定案（finalized=true）"

# ─── Step 2: 棘轮超限检查 ──────────────────────────────────────────────────────
ratchet_check "force_reason" "$RATCHET_FORCE"
ratchet_check "unverifiable" "$RATCHET_UNVERIFIABLE"
ratchet_check "waive"        "$RATCHET_WAIVE"
ratchet_check "bypass_count" "$RATCHET_BYPASS"
echo "[check] ✅ 棘轮计数全部 ≤ 3，通过"

# ─── Step 3: gate_verdict 检查 ────────────────────────────────────────────────
if [ "$GATE_VERDICT" != "green" ]; then
  echo "[gate] gate_verdict=$GATE_VERDICT（非 green），检查 blocked_reason..."

  # blocked_reason 三态
  if [ "$BLOCKED_REASON" = "ai_run_infra_error" ]; then
    if [ "$BYPASS" = "true" ]; then
      echo "⚠️ [bypass] Gate 判红原因为 ai_run_infra_error，bypass_two_column_infra=true，允许绕过"
      write_summary "## ⚠️ two-column-gate bypass 生效（ai_run_infra_error）"
      write_summary ""
      write_summary "Gate 因 AI Run 基础设施错误判红，人工确认已填 bypass=true，本次放行。"
      write_summary "**绕过人=${GITHUB_ACTOR:-manual}，谁绕过谁负责。**"
      echo "[check] ✅ infra_error + bypass=true → 放行"
      exit 0
    else
      echo "::error::Gate 判红（blocked_reason=ai_run_infra_error），且 bypass_two_column_infra 未启用，拒绝放行"
      exit 1
    fi
  else
    # cells_red 或其他格红：bypass 无效
    echo "::error::Gate 判红（gate_verdict=$GATE_VERDICT，blocked_reason=$BLOCKED_REASON），bypass 对此情形无效，拒绝放行"
    exit 1
  fi
fi
echo "[check] ✅ gate_verdict=green"

# ─── Step 4: SHA 精确匹配检查 ─────────────────────────────────────────────────
if [ -z "$PROMOTE_SHA" ]; then
  echo "::error::PROMOTE_SHA 未设置，无法断言 sha 匹配"
  exit 1
fi

if [ "$BACKEND_SHA" != "$PROMOTE_SHA" ]; then
  echo "::error::SHA 不匹配（字节精确对比失败）"
  echo "  expected=$PROMOTE_SHA"
  echo "  got=$BACKEND_SHA"
  exit 1
fi
echo "[check] ✅ backend_sha 字节精确匹配 PROMOTE_SHA"

# ─── 全部通过 ─────────────────────────────────────────────────────────────────
echo ""
echo "✅ two-column-gate 全部通过：定案绿 + sha 匹配 + 棘轮正常。promote 可继续。"
exit 0
