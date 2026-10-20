#!/usr/bin/env bash
# 定案业务绿 + 完整候选 SHA 一致才允许晋级。
# 用法：PROMOTE_SHA=<40位SHA> GATE_TOKEN=... JOURNEY_ID=... bash two-column-gate.sh
# --fixture <file> 只供回归测试。生产调用从 Gate API 读取定案回执。
# BYPASS_TWO_COLUMN_INFRA 保留为旧调用兼容参数，不能改变准入结果。
set -euo pipefail

fail() { echo "::error::$*" >&2; exit 1; }
FIXTURE_FILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --fixture)
      [[ $# -ge 2 && -n "$2" ]] || fail "--fixture 缺少文件路径"
      FIXTURE_FILE="$2"
      shift 2
      ;;
    *) fail "未知参数: $1" ;;
  esac
done

PROMOTE_SHA="${PROMOTE_SHA:-}"
GATE_URL="${GATE_URL:-https://brain-acceptance.zenjoymedia.media}"
[[ "$PROMOTE_SHA" =~ ^[0-9a-fA-F]{40}$ ]] || fail "PROMOTE_SHA 必须是完整40位十六进制提交 SHA"
command -v jq >/dev/null || fail "需要 jq 但未安装"

if [[ -n "$FIXTURE_FILE" ]]; then
  [[ -f "$FIXTURE_FILE" ]] || fail "fixture 文件不存在: $FIXTURE_FILE"
  GATE_JSON="$(cat "$FIXTURE_FILE")"
else
  [[ -n "${GATE_TOKEN:-}" ]] || fail "GATE_TOKEN 未设置"
  [[ -n "${JOURNEY_ID:-}" ]] || fail "JOURNEY_ID 未设置"
  GATE_JSON="$(curl --fail --silent --show-error --connect-timeout 15 --max-time 60 \
    --get --data-urlencode "journey_id=${JOURNEY_ID}" \
    -H "Authorization: Bearer ${GATE_TOKEN}" -H 'Accept: application/json' \
    "${GATE_URL%/}/acceptance/gate/latest-finalized")" || fail "Gate 取数失败，禁止晋级"
fi

# 单份 JSON 对象、严格字段类型：字符串 true 不等于已定案。
jq -e -s 'length == 1 and (.[0] | type == "object")' <<< "$GATE_JSON" >/dev/null \
  || fail "Gate 响应不是单份 JSON 对象"
jq -e '.finalized == true' <<< "$GATE_JSON" >/dev/null || fail "Gate 尚未定案"
jq -e '.gate_verdict == "green" and .blocked_reason == null' <<< "$GATE_JSON" >/dev/null \
  || fail "业务验收未通过；基础设施错误、未验证和格红均不能晋级，bypass 无效"
jq -e '.backend_sha | type == "string" and test("^[0-9a-fA-F]{40}$")' <<< "$GATE_JSON" >/dev/null \
  || fail "Gate 回执未绑定完整40位提交 SHA"
BACKEND_SHA="$(jq -r '.backend_sha' <<< "$GATE_JSON")"
[[ "$BACKEND_SHA" == "$PROMOTE_SHA" ]] || fail "Gate 回执 SHA 与候选 SHA 不一致"

# API 的 ratchet 是可选统计；一旦提供，缺列/非整数/负数不能默认为 0。
if jq -e 'has("ratchet")' <<< "$GATE_JSON" >/dev/null; then
  jq -e '
    .ratchet | if type != "object" then false else
      [.force_reason_count, .unverifiable_count, .waive_count, .bypass_count]
      | all(.[]; if type == "number" then . >= 0 and . <= 3 and floor == . else false end)
    end
  ' <<< "$GATE_JSON" >/dev/null || fail "棘轮统计无效或超过上限3，禁止晋级"
fi

echo "two-column-gate 通过：已定案业务绿，候选 SHA=${BACKEND_SHA}，棘轮正常"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf '%s\n' "双列验收通过：候选 SHA=${BACKEND_SHA}，已定案业务绿。" >> "$GITHUB_STEP_SUMMARY"
fi
