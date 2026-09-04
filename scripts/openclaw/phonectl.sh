#!/usr/bin/env bash
# ============================================================================
# phonectl — OpenClaw 信号桥·件3。HK OpenClaw 网关 exec 白名单薄壳：
# 把 OpenClaw 的一条 exec 指令转发到中台设备指令桥（件2 POST /api/devices/:agentId/actions），
# 由中台经 ws0 下发给手机 agent（件1）执行。这里没有 adb、没有遥控器 Mac——
# OpenClaw 只需要 `openclaw approvals allowlist add ... "phonectl*"` 一条即可接通。
#
# 用法：
#   phonectl <agent_id> screenshot
#   phonectl <agent_id> tap <x> <y>
#   phonectl <agent_id> swipe <x1> <y1> <x2> <y2> [durationMs]
#   phonectl <agent_id> type <text>
#   phonectl <agent_id> key <back|home>
#   phonectl <agent_id> launch <pkg>
#   phonectl <agent_id> device_info
#   phonectl <agent_id> tree_dump
#   [--timeout-ms N] [--idempotency-key <uuid>]  可附加在任意 action 之后
#
# 环境变量：
#   ZENITHJOY_API_BASE       中台 API 基址（默认生产）
#   ZENITHJOY_INTERNAL_TOKEN 内部鉴权 token（必填，Authorization: Bearer）
#
# 输出：把中台回执 JSON 原样打印到 stdout；HTTP 非 2xx 或 data.ok!==true 时
# exit 非零（stderr 也留一份，OpenClaw exec 日志能看到）。504 响应体自带
# outcome:'unknown'——设备无取消机制，指令可能仍在执行，调用方（OpenClaw skill
# 层）看到这个字段就不该盲重试，应改用 --idempotency-key 重取结果（件2 契约）。
# ============================================================================
set -uo pipefail

ZENITHJOY_API_BASE="${ZENITHJOY_API_BASE:-https://autopilot.zenjoymedia.media}"

usage() {
  cat <<'EOF'
用法: phonectl <agent_id> <action> [args...] [--timeout-ms N] [--idempotency-key UUID]
action: screenshot | tap x y | swipe x1 y1 x2 y2 [durationMs] | type text |
        key back|home | launch pkg | device_info | tree_dump
EOF
}

die() {
  echo "phonectl: $1" >&2
  exit "${2:-2}"
}

command -v curl >/dev/null 2>&1 || die "需要 curl"
command -v jq >/dev/null 2>&1 || die "需要 jq"

[ $# -ge 1 ] || { usage >&2; die "缺少 agent_id"; }
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then usage; exit 0; fi
[ $# -ge 2 ] || { usage >&2; die "缺少 action"; }

AGENT_ID="$1"; shift
ACTION="$1"; shift

case "$AGENT_ID" in
  [0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-*-*-*-*)
    ;;
  *) die "agent_id 须为 uuid（zenithjoy.agents.id），收到: $AGENT_ID" ;;
esac

is_int() { [[ "$1" =~ ^-?[0-9]+$ ]]; }

ARGS_JSON="{}"
case "$ACTION" in
  screenshot|device_info|tree_dump)
    ;;
  tap)
    [ $# -ge 2 ] || die "tap 需要 x y"
    is_int "$1" && is_int "$2" || die "x/y 须为整数"
    ARGS_JSON=$(jq -n --argjson x "$1" --argjson y "$2" '{x:$x,y:$y}')
    shift 2
    ;;
  swipe)
    [ $# -ge 4 ] || die "swipe 需要 x1 y1 x2 y2 [durationMs]"
    is_int "$1" && is_int "$2" && is_int "$3" && is_int "$4" || die "swipe 坐标须为整数"
    if [ $# -ge 5 ] && is_int "$5"; then
      ARGS_JSON=$(jq -n --argjson x1 "$1" --argjson y1 "$2" --argjson x2 "$3" --argjson y2 "$4" --argjson d "$5" \
        '{x1:$x1,y1:$y1,x2:$x2,y2:$y2,durationMs:$d}')
      shift 5
    else
      ARGS_JSON=$(jq -n --argjson x1 "$1" --argjson y1 "$2" --argjson x2 "$3" --argjson y2 "$4" \
        '{x1:$x1,y1:$y1,x2:$x2,y2:$y2}')
      shift 4
    fi
    ;;
  type)
    [ $# -ge 1 ] || die "type 需要 text"
    ARGS_JSON=$(jq -n --arg t "$1" '{text:$t}')
    shift 1
    ;;
  key)
    [ $# -ge 1 ] || die "key 需要 back|home"
    case "$1" in back|home) : ;; *) die "key 只认 back|home，收到: $1" ;; esac
    ARGS_JSON=$(jq -n --arg n "$1" '{name:$n}')
    shift 1
    ;;
  launch)
    [ $# -ge 1 ] || die "launch 需要 pkg"
    ARGS_JSON=$(jq -n --arg p "$1" '{pkg:$p}')
    shift 1
    ;;
  *)
    die "未知 action: ${ACTION}（合法值见 --help）"
    ;;
esac

TIMEOUT_MS=""
IDEMPOTENCY_KEY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --timeout-ms)
      [ $# -ge 2 ] || die "--timeout-ms 需要一个值"
      TIMEOUT_MS="$2"; shift 2 ;;
    --idempotency-key)
      [ $# -ge 2 ] || die "--idempotency-key 需要一个值"
      IDEMPOTENCY_KEY="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数: $1" ;;
  esac
done

TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-}"
[ -n "$TOKEN" ] || die "ZENITHJOY_INTERNAL_TOKEN 未设置"

BODY=$(jq -n --argjson args "$ARGS_JSON" --arg action "$ACTION" \
  --arg tms "$TIMEOUT_MS" --arg ik "$IDEMPOTENCY_KEY" \
  '$args + {action:$action}
   + (if $tms != "" then {timeoutMs:($tms|tonumber)} else {} end)
   + (if $ik != "" then {idempotencyKey:$ik} else {} end)')

# curl 超时须盖过服务端最坏等待窗口（clampTimeoutMs 上限 35s）+ 网络余量
CURL_TIMEOUT=45
if is_int "$TIMEOUT_MS" && [ -n "$TIMEOUT_MS" ]; then
  CURL_TIMEOUT=$(( TIMEOUT_MS / 1000 + 10 ))
fi

RESP=$(curl -sS -m "$CURL_TIMEOUT" -w '\n%{http_code}' \
  -X POST "${ZENITHJOY_API_BASE}/api/devices/${AGENT_ID}/actions" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$BODY" 2>&1)
CURL_EXIT=$?

if [ $CURL_EXIT -ne 0 ]; then
  ERR_JSON="{\"success\":false,\"error\":\"CURL_FAILED\",\"message\":$(jq -Rs . <<<"$RESP")}"
  echo "$ERR_JSON"
  echo "$ERR_JSON" >&2
  exit 1
fi

HTTP_CODE=$(echo "$RESP" | tail -1)
JSON_BODY=$(echo "$RESP" | sed '$d')

echo "$JSON_BODY"

if [ "$HTTP_CODE" -lt 200 ] || [ "$HTTP_CODE" -ge 300 ]; then
  echo "$JSON_BODY" >&2
  exit 1
fi

# 注意：不能写成 `.data.ok // empty`——jq 的 // 运算符把 JSON false 当假值，
# `false // empty` 会求值成 empty（等于取不到），"data.ok=false" 这个最需要
# 拦截的失败场景反而会被当成"没有 ok 字段"放过，静默 exit 0。
OK=$(echo "$JSON_BODY" | jq -r 'if (.data.ok == false) then "false" else "true" end' 2>/dev/null)
if [ "$OK" = "false" ]; then
  exit 1
fi

exit 0
