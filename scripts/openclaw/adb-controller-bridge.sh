#!/usr/bin/env bash
# adb-controller-bridge.sh — OpenClaw douyin-phone-runtime skill 的 adb_controller 实现。
# 把 douyin-phone-runtime 要求的命令集转译到中台设备指令桥（phonectl.sh），
# 替代原来 SSH 到 xian-m1 本地跑 adb 的老路径。
#
# 用法: adb-controller-bridge.sh --profile <phone_profile> <command> [args...]
#
# 环境变量：
#   PROFILES_FILE             profile 映射文件（默认脚本同目录 profiles.json）
#   PHONECTL                  phonectl.sh 路径（默认脚本同目录）
#   ZENITHJOY_API_BASE        中台 API 基址
#   ZENITHJOY_INTERNAL_TOKEN  内部鉴权 token（必填，转发给 phonectl.sh）
#   OPENCLAW_EVIDENCE_DIR     evidence 落盘根目录（默认 /tmp/openclaw-evidence）
#   OPENCLAW_LOCK_TTL_SECONDS 设备锁孤儿超时（默认 1800）
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILES_FILE="${PROFILES_FILE:-$SCRIPT_DIR/profiles.json}"
PHONECTL="${PHONECTL:-$SCRIPT_DIR/phonectl.sh}"
ZENITHJOY_API_BASE="${ZENITHJOY_API_BASE:-https://autopilot.zenjoymedia.media}"
EVIDENCE_ROOT="${OPENCLAW_EVIDENCE_DIR:-/tmp/openclaw-evidence}"
LOCK_TTL_SECONDS="${OPENCLAW_LOCK_TTL_SECONDS:-1800}"

die() { echo "adb-controller-bridge: $1" >&2; exit "${2:-2}"; }
emit_ok() { echo "$1"; exit 0; }
emit_fail() { echo "$1"; exit "${2:-1}"; }

command -v jq >/dev/null 2>&1 || die "需要 jq"
command -v curl >/dev/null 2>&1 || die "需要 curl"
[ -n "${ZENITHJOY_INTERNAL_TOKEN:-}" ] || die "缺少 ZENITHJOY_INTERNAL_TOKEN"

[ $# -ge 2 ] || die "用法: --profile <phone_profile> <command> [args...]"
[ "$1" = "--profile" ] || die "第一个参数必须是 --profile"
PROFILE="$2"; shift 2
[ $# -ge 1 ] || die "缺少 command"
COMMAND="$1"; shift

[ -f "$PROFILES_FILE" ] || die "profiles 文件不存在: $PROFILES_FILE"
AGENT_ID=$(jq -r --arg p "$PROFILE" '.[$p].agent_id // empty' "$PROFILES_FILE")
TENANT_ID=$(jq -r --arg p "$PROFILE" '.[$p].tenant_id // empty' "$PROFILES_FILE")
[ -n "$AGENT_ID" ] || die "unknown profile: $PROFILE"
[[ "$PROFILE" =~ ^[A-Za-z0-9_-]+$ ]] || die "profile 名称非法: $PROFILE"

PROFILE_DIR="$EVIDENCE_ROOT/$PROFILE"
mkdir -p "$PROFILE_DIR"
LOCK_FILE="$PROFILE_DIR/.lock.json"

call_phonectl() {
  # 透传 phonectl.sh 的 stdout（JSON），把 exit code 存到 PHONECTL_EXIT，
  # stderr 单独存到 PHONECTL_STDERR（不能吞掉，失败时是唯一能看到具体原因的地方）
  local out err_file
  err_file=$(mktemp)
  out=$(bash "$PHONECTL" "$AGENT_ID" "$@" 2>"$err_file")
  PHONECTL_EXIT=$?
  PHONECTL_OUT="$out"
  PHONECTL_STDERR=$(cat "$err_file")
  rm -f "$err_file"
}

cmd_preflight() {
  call_phonectl device_info
  if [ "$PHONECTL_EXIT" -ne 0 ]; then
    local detail="device_info 失败"
    [ -n "$PHONECTL_STDERR" ] && detail="$PHONECTL_STDERR"
    emit_fail "$(jq -n --arg d "$detail" '{ok:false,errorCode:"DEVICE_UNREACHABLE",detail:$d}')" 1
  fi
  local dinfo
  dinfo=$(echo "$PHONECTL_OUT" | jq -c '.data')
  local model foreground
  model=$(echo "$dinfo" | jq -r '.data.model // "unknown"')
  foreground=$(echo "$dinfo" | jq -r '.foregroundPkg // "unknown"')

  local sessions_http sessions_body
  sessions_body=$(mktemp)
  sessions_http=$(curl -sS -m 15 -o "$sessions_body" -w '%{http_code}' \
    "${ZENITHJOY_API_BASE}/api/agent/burner/sessions" \
    -H "X-Tenant-Id: ${TENANT_ID}" \
    -H "Authorization: Bearer ${ZENITHJOY_INTERNAL_TOKEN}")

  # sessions_check_ok 只有在 http=200 且 body 是合法 JSON、且真的能算出布尔值时才为 true；
  # 任何一环失败都必须把 account_verified 明确钉死成 "false"（不能是空字符串），
  # 否则下游 --argjson 会因为拿到非法 JSON 字面量而炸掉，导致整个命令 stdout 几乎为空却 exit 0。
  local account_verified="false"
  local sessions_check_ok="false"
  local sessions_warning=""
  if [ "$sessions_http" = "200" ] && jq empty "$sessions_body" >/dev/null 2>&1; then
    local verified_calc
    verified_calc=$(jq --arg aid "$AGENT_ID" \
      '[.data.sessions[]? | select(.agent_id==$aid and .platform=="douyin" and .role=="burner" and .status=="active")] | length > 0' \
      "$sessions_body" 2>/dev/null)
    if [ "$verified_calc" = "true" ] || [ "$verified_calc" = "false" ]; then
      sessions_check_ok="true"
      account_verified="$verified_calc"
    fi
  fi
  if [ "$sessions_check_ok" != "true" ]; then
    account_verified="false"
    # 注意：$var 后面紧跟多字节字符（无 ASCII 分隔）在部分 bash 上会解析错乱，
    # 必须用 ${var} 显式界定变量名边界
    sessions_warning="burner sessions 查询失败（http=${sessions_http}），account_verified 无法确认，按 false 保守处理"
  fi
  rm -f "$sessions_body"

  emit_ok "$(jq -n \
    --arg profile "$PROFILE" --arg serial "$AGENT_ID" --arg model "$model" \
    --arg fg "$foreground" --argjson verified "$account_verified" \
    --argjson sessions_check_ok "$sessions_check_ok" --arg sessions_warning "$sessions_warning" \
    '{ok:true, profile:$profile, serial:$serial, model:$model, adb_state:"device",
       call_state:"unknown", foreground_pkg:$fg, account_verified:$verified,
       sessions_check_ok:$sessions_check_ok,
       warnings: (["call_state 检测能力缺失，douyin-phone-runtime skill 要求 call_state!=idle 时安全停止，这里无法提供该判据，调用方需自行决定是否继续"]
         + (if $sessions_warning != "" then [$sessions_warning] else [] end))}')"
}

case "$COMMAND" in
  preflight) cmd_preflight ;;
  *) die "命令尚未实现: $COMMAND" ;;
esac
