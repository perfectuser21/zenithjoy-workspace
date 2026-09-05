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

# phonectl 调用失败时的错误提取逻辑，cmd_open_app / cmd_snapshot_capture 共用：
# 优先从 PHONECTL_OUT 里取 data.errorCode，取不到落回调用方给的默认 errorCode；
# detail 优先用 PHONECTL_STDERR（真实失败原因），空了落回默认文案。
extract_phonectl_error() {
  local default_code="$1" default_detail="$2"
  local err_code detail
  err_code=$(echo "$PHONECTL_OUT" | jq -r '.data.errorCode // empty' 2>/dev/null)
  [ -n "$err_code" ] || err_code="$default_code"
  detail="$PHONECTL_STDERR"
  [ -n "$detail" ] || detail="$default_detail"
  jq -n --arg code "$err_code" --arg d "$detail" '{ok:false,errorCode:$code,detail:$d}'
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

now_epoch() { date -u +%s; }

# 锁文件是否是合法 JSON。空文件/半截写入/其他损坏内容都判为不合法，
# 与 cmd_preflight 里 sessions_body 的 `jq empty` 校验模式保持一致。
lock_file_valid() {
  [ -f "$LOCK_FILE" ] && jq empty "$LOCK_FILE" >/dev/null 2>&1
}

# 原子写锁文件：先写同目录下的临时文件，再 mv 到位。
# mv 在同一文件系统内是原子操作，避免进程被杀在写一半时留下半截 JSON。
write_lock_file() {
  local owner="$1" iso="$2" epoch="$3" tmp
  tmp="${LOCK_FILE}.tmp.$$"
  jq -n --arg owner "$owner" --arg iso "$iso" --argjson epoch "$epoch" \
    '{owner:$owner, acquired_at:$iso, acquired_at_epoch:$epoch}' > "$tmp"
  mv -f "$tmp" "$LOCK_FILE"
}

cmd_lock_acquire() {
  local run_id="${1:-}"
  [ -n "$run_id" ] || die "lock-acquire 需要 run_id"
  if lock_file_valid; then
    local owner acquired_at age
    owner=$(jq -r '.owner' "$LOCK_FILE")
    acquired_at=$(jq -r '.acquired_at_epoch' "$LOCK_FILE")
    age=$(( $(now_epoch) - acquired_at ))
    if [ "$owner" = "$run_id" ]; then
      # 重入续期：刷新 acquired_at/acquired_at_epoch，避免长流程多个 stage
      # 依次调用 lock-acquire 时，锁的年龄仍从第一次获取算起被误判成孤儿锁。
      write_lock_file "$run_id" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(now_epoch)"
      emit_ok "$(jq -n '{ok:true, acquired:true, already_owned:true}')"
    fi
    if [ "$age" -lt "$LOCK_TTL_SECONDS" ]; then
      emit_fail "$(jq -n --arg owner "$owner" '{ok:false,errorCode:"LOCKED",owner:$owner}')" 1
    fi
    # 孤儿锁超时，允许抢占，落到下面正常写入
  fi
  # 走到这里：锁不存在 / 锁文件损坏（按"没有锁"处理，允许覆盖）/ 孤儿锁超时
  write_lock_file "$run_id" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(now_epoch)"
  emit_ok "$(jq -n '{ok:true, acquired:true}')"
}

cmd_lock_release() {
  local run_id="${1:-}"
  [ -n "$run_id" ] || die "lock-release 需要 run_id"
  if ! lock_file_valid; then
    emit_fail "$(jq -n '{ok:false,errorCode:"NOT_OWNER",detail:"锁不存在"}')" 1
  fi
  local owner
  owner=$(jq -r '.owner' "$LOCK_FILE")
  if [ "$owner" != "$run_id" ]; then
    emit_fail "$(jq -n --arg owner "$owner" '{ok:false,errorCode:"NOT_OWNER",owner:$owner}')" 1
  fi
  rm -f "$LOCK_FILE"
  emit_ok "$(jq -n '{ok:true, released:true}')"
}

cmd_lock_status() {
  if [ -f "$LOCK_FILE" ] && ! lock_file_valid; then
    emit_ok "$(jq -n '{ok:true, locked:false, warning:"检测到损坏的锁文件，已忽略"}')"
  fi
  if [ ! -f "$LOCK_FILE" ]; then
    emit_ok "$(jq -n '{ok:true, locked:false}')"
  fi
  local owner acquired_at age
  owner=$(jq -r '.owner' "$LOCK_FILE")
  acquired_at=$(jq -r '.acquired_at' "$LOCK_FILE")
  age=$(( $(now_epoch) - $(jq -r '.acquired_at_epoch' "$LOCK_FILE") ))
  emit_ok "$(jq -n --arg owner "$owner" --arg at "$acquired_at" --argjson age "$age" \
    '{ok:true, locked:true, owner:$owner, acquired_at:$at, age_seconds:$age}')"
}

cmd_open_app() {
  call_phonectl launch com.ss.android.ugc.aweme
  if [ "$PHONECTL_EXIT" -ne 0 ]; then
    emit_fail "$(extract_phonectl_error "LAUNCH_FAILED" "launch 失败")" 1
  fi
  local fg
  fg=$(echo "$PHONECTL_OUT" | jq -r '.data.foregroundPkg // "unknown"')
  emit_ok "$(jq -n --arg fg "$fg" '{ok:true, foregroundPkg:$fg}')"
}

# EVIDENCE_ID 只允许用作文件名安全字符，防止路径穿越/注入（同 profile 名称校验的风格）。
validate_evidence_id() {
  [[ "$1" =~ ^[A-Za-z0-9._-]+$ ]] || die "非法 EVIDENCE_ID: $1"
}

# 文件末尾是否是合法的 PNG IEND chunk：4字节长度0x00000000 + "IEND" + 4字节CRC 0xae426082，
# 十六进制 0000000049454e44ae426082。
# 这是内容层面的完整性校验，不能只信 base64 -d 的退出码——macOS/BSD 的 base64 在
# 某些"合法字符但内容被截断/替换"的输入下会 exit=0 且不报任何错误，只是静默写出
# 一个更短/被破坏的文件；只有校验通过落盘的图片确实是一个完整的 PNG 时才算成功。
png_has_valid_iend() {
  local f="$1" sz tail_hex
  sz=$(wc -c < "$f" 2>/dev/null | tr -d ' ')
  [ -n "$sz" ] && [ "$sz" -ge 12 ] || return 1
  tail_hex=$(tail -c 12 "$f" | od -An -tx1 | tr -d ' \n')
  [ "$tail_hex" = "0000000049454e44ae426082" ]
}

# 截图核心逻辑：不 exit，把结果 JSON 通过 echo 传给调用方，用返回码区分成功(0)/失败(非0)。
# 供 cmd_snapshot 直接用，也供未来 tap/swipe/back-evidence 等命令内部复用截图能力，
# 而不会因为 emit_ok/emit_fail 的 exit 而提前终止整个脚本。
# evidence_id 的格式校验（validate_evidence_id）由外层调用方负责，这里不重复。
cmd_snapshot_capture() {
  local evidence_id="${1:-}"
  local filename
  if [ -n "$evidence_id" ]; then
    filename="snapshot-${evidence_id}.png"
  else
    filename="snapshot-$(date +%s%N).png"
  fi
  call_phonectl screenshot
  if [ "$PHONECTL_EXIT" -ne 0 ]; then
    extract_phonectl_error "CAPTURE_FAILED" "screenshot 失败"
    return 1
  fi
  # 深层取值前先用 `// empty`/`// 0` 兜底：字段不存在时 jq -r 会打印字面量 "null"，
  # 若不做这层防御，"null" 三个字符会被当 base64 解码，写出一个损坏的 PNG 却仍报 ok:true。
  local b64 cw ch sw sh out_path tmp_path decode_rc
  b64=$(echo "$PHONECTL_OUT" | jq -r '.data.data.imageBase64 // empty')
  if [ -z "$b64" ]; then
    jq -n '{ok:false,errorCode:"CAPTURE_FAILED",detail:"imageBase64 缺失或为空"}'
    return 1
  fi
  cw=$(echo "$PHONECTL_OUT" | jq -r '.data.data.captureWidth // 0')
  ch=$(echo "$PHONECTL_OUT" | jq -r '.data.data.captureHeight // 0')
  sw=$(echo "$PHONECTL_OUT" | jq -r '.data.data.screenWidth // 0')
  sh=$(echo "$PHONECTL_OUT" | jq -r '.data.data.screenHeight // 0')
  out_path="$PROFILE_DIR/$filename"
  # 原子写：先写临时文件，通过完整性检查后再 mv 到位。任何一环失败都只删临时文件，
  # 绝不碰 out_path——避免同一 evidence_id 重试时，一次损坏的写入销毁掉之前已经
  # 成功落盘的好文件。
  tmp_path="${out_path}.tmp.$$"
  echo "$b64" | base64 -d > "$tmp_path" 2>/dev/null
  decode_rc=$?
  if [ "$decode_rc" -ne 0 ] || ! png_has_valid_iend "$tmp_path"; then
    rm -f "$tmp_path"
    jq -n '{ok:false,errorCode:"CAPTURE_FAILED",detail:"截图数据损坏：base64 解码失败或 PNG 完整性校验未通过"}'
    return 1
  fi
  mv -f "$tmp_path" "$out_path"
  jq -n --arg path "$out_path" --argjson cw "$cw" --argjson ch "$ch" --argjson sw "$sw" --argjson sh "$sh" \
    '{ok:true, path:$path, captureWidth:$cw, captureHeight:$ch, screenWidth:$sw, screenHeight:$sh}'
  return 0
}

cmd_snapshot() {
  local evidence_id="${1:-}"
  [ -n "$evidence_id" ] && validate_evidence_id "$evidence_id"
  local out rc
  out=$(cmd_snapshot_capture "$evidence_id")
  rc=$?
  if [ "$rc" -ne 0 ]; then emit_fail "$out" 1; fi
  emit_ok "$out"
}

# tap/swipe/back-evidence 共用的收尾逻辑：动作已成功执行，等待 wait_ms 后
# 调用 cmd_snapshot_capture 截图存证。截图失败就把截图的错误 JSON 透传出去
# （此时动作本身已经做了，但没有证据，调用方需要知道截图这一步失败了）；
# 截图成功则在结果里加 action_ok:true，表明"动作+截图"整体成功。
finish_action_evidence() {
  local evidence_id="$1" wait_ms="$2"
  sleep "$(awk "BEGIN{print $wait_ms/1000}")"
  local snap_json rc
  snap_json=$(cmd_snapshot_capture "$evidence_id")
  rc=$?
  if [ "$rc" -ne 0 ]; then
    emit_fail "$snap_json" 1
  fi
  emit_ok "$(echo "$snap_json" | jq -c '. + {action_ok:true}')"
}

cmd_tap_evidence() {
  local x="${1:-}" y="${2:-}" evidence_id="${3:-}" wait_ms="${4:-800}"
  [ -n "$x" ] && [ -n "$y" ] && [ -n "$evidence_id" ] || die "tap-evidence 需要 x y evidence_id [wait_ms]"
  validate_evidence_id "$evidence_id"
  call_phonectl tap "$x" "$y"
  if [ "$PHONECTL_EXIT" -ne 0 ]; then
    emit_fail "$(extract_phonectl_error "TAP_FAILED" "tap 失败")" 1
  fi
  finish_action_evidence "$evidence_id" "$wait_ms"
}

cmd_swipe_evidence() {
  local x1="${1:-}" y1="${2:-}" x2="${3:-}" y2="${4:-}" duration_ms="${5:-}" evidence_id="${6:-}" wait_ms="${7:-800}"
  [ -n "$x1" ] && [ -n "$y1" ] && [ -n "$x2" ] && [ -n "$y2" ] && [ -n "$duration_ms" ] && [ -n "$evidence_id" ] \
    || die "swipe-evidence 需要 x1 y1 x2 y2 duration_ms evidence_id [wait_ms]"
  validate_evidence_id "$evidence_id"
  call_phonectl swipe "$x1" "$y1" "$x2" "$y2" "$duration_ms"
  if [ "$PHONECTL_EXIT" -ne 0 ]; then
    emit_fail "$(extract_phonectl_error "SWIPE_FAILED" "swipe 失败")" 1
  fi
  finish_action_evidence "$evidence_id" "$wait_ms"
}

cmd_back_evidence() {
  local evidence_id="${1:-}" wait_ms="${2:-800}"
  [ -n "$evidence_id" ] || die "back-evidence 需要 evidence_id [wait_ms]"
  validate_evidence_id "$evidence_id"
  call_phonectl key back
  if [ "$PHONECTL_EXIT" -ne 0 ]; then
    emit_fail "$(extract_phonectl_error "KEY_FAILED" "key back 失败")" 1
  fi
  finish_action_evidence "$evidence_id" "$wait_ms"
}

cmd_unsupported() {
  emit_fail "$(jq -n --arg c "$COMMAND" '{ok:false,errorCode:"UNSUPPORTED",detail:("本次范围（keyword_acquisition Step②③）不支持: "+$c)}')" 3
}

case "$COMMAND" in
  preflight) cmd_preflight ;;
  lock-acquire) cmd_lock_acquire "$@" ;;
  lock-release) cmd_lock_release "$@" ;;
  lock-status) cmd_lock_status ;;
  open-app) cmd_open_app ;;
  snapshot) cmd_snapshot "" ;;
  snapshot-evidence) cmd_snapshot "${1:-}" ;;
  tap-evidence) cmd_tap_evidence "$@" ;;
  swipe-evidence) cmd_swipe_evidence "$@" ;;
  back-evidence) cmd_back_evidence "$@" ;;
  current-video-link|record-start|record-stop|record-status|record-extract-audio|ui-evidence) cmd_unsupported ;;
  *) die "命令尚未实现: $COMMAND" ;;
esac
