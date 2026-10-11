#!/bin/bash
# brain-lock.sh —— 手机 Brain 设备锁客户端（派发总闸D「止血」，Brain 任务 dd7767b8）
#
# 为什么有它：执行机 crontab 的触达 tick / 采收保底只认本机 mkdir 锁和 pgrep，Brain 派下来的手机活
#   （秋米任务、调度单）看不见它们，它们也看不见 Brain 的设备锁——同一台手机可能两路同时操作。
#   本脚本让这些定时在动手机前先向 Brain 领该手机的锁（Brain 现有 /api/brain/device-locks API），
#   本机锁继续作为第二道。只加锁和留痕，不改发送量与节奏。
#
# 用法：
#   brain-lock.sh acquire <serial> <owner> [ttl_min=15]
#       退出 0=领到（同 owner 重复调用 = 续租）/ 1=被别的 run 持有 / 2=Brain 不可用或设备未注册（调用方降级放行）
#   brain-lock.sh release <serial> <owner>
#       退出 0=已放 / 1=不是本 owner 持有（绝不接管别人的锁）/ 2=Brain 不可用
#   brain-lock.sh heartbeat <serial> <owner> <ttl_min> <interval_sec> <watch_pid>
#       前台循环：每 interval 秒以同 owner 续租；watch_pid 不在了就退出（防孤儿续租把锁永远压住）
#   brain-lock.sh run <serial> <owner> [--ttl N] [--interval S] [--log FILE] [--skip-if-pgrep PATTERN] -- CMD [ARGS...]
#       领锁 → (可选 pgrep 第二道判重) → 心跳续租 → 跑 CMD → 无论正常/失败/被 TERM 都放锁；
#       锁被占或 pgrep 命中 → 不跑 CMD、退出 0（本轮跳过）；Brain 不可用 → 降级照跑。
# stdout（acquire/release）：一行 BRAIN_LOCK=<acquired|busy|unavailable|released|not_held> [BRAIN_LOCK_HOLDER=..] [BRAIN_LOCK_REASON=..]
#
# 凭据：环境里的 BRAIN_URL / BRAIN_INTERNAL_TOKEN 优先；缺了从 ${BRAIN_LOCK_ENV:-~/.credentials/brain.env} 补（同 workflow-result.sh）。
# owner 约定：<定时名>:<机器>:<YYYYmmddTHHMMSS>:<pid>。非 uuid 持有者不参与 Brain 派发对账，只受 TTL 管，所以长跑必须心跳续租。
set -u
SELF="${BASH_SOURCE[0]}"

load_env(){
  local f="${BRAIN_LOCK_ENV:-$HOME/.credentials/brain.env}" u="${BRAIN_URL:-}" t="${BRAIN_INTERNAL_TOKEN:-}"
  if [[ -z "$u" || -z "$t" ]] && [[ -r "$f" ]]; then
    # shellcheck disable=SC1090
    . "$f"
    [[ -n "$u" ]] && BRAIN_URL="$u"
    [[ -n "$t" ]] && BRAIN_INTERNAL_TOKEN="$t"
  fi
  BRAIN_URL="${BRAIN_URL:-}"; BRAIN_URL="${BRAIN_URL%/}"
  BRAIN_INTERNAL_TOKEN="${BRAIN_INTERNAL_TOKEN:-}"
}

# json_body serial owner [ttl] —— 用 python 编码，owner 里有什么字符都安全
json_body(){
  python3 -c 'import json,sys
d={"device_name":sys.argv[1],"locked_by":sys.argv[2]}
if len(sys.argv)>3 and sys.argv[3]: d["ttl_minutes"]=int(sys.argv[3])
print(json.dumps(d))' "$@"
}
# json_get key —— 从 stdin 的 JSON 取一个顶层字段（布尔转 true/false，缺失为空）
json_get(){
  python3 -c 'import json,sys
try: v=json.load(sys.stdin).get(sys.argv[1])
except Exception: v=None
print("" if v is None else (str(v).lower() if isinstance(v,bool) else v))' "$1"
}

# post path body → 设置 HTTP_CODE / HTTP_BODY；curl 自身失败返回非 0
post(){
  local out
  out=$(curl -sS --connect-timeout 5 -m 15 -w $'\n%{http_code}' -X POST "$BRAIN_URL$1" \
    -H "Authorization: Bearer $BRAIN_INTERNAL_TOKEN" -H 'Content-Type: application/json' --data-binary "$2" 2>/dev/null) || return 1
  HTTP_CODE="${out##*$'\n'}"; HTTP_BODY="${out%$'\n'*}"
  return 0
}

cmd_acquire(){
  [[ $# -ge 2 && -n "$1" && -n "$2" ]] || { echo "usage: brain-lock.sh acquire <serial> <owner> [ttl_min]" >&2; return 64; }
  local serial="$1" owner="$2" ttl="${3:-15}" acquired holder
  load_env
  [[ -n "$BRAIN_URL" ]] || { echo "BRAIN_LOCK=unavailable BRAIN_LOCK_REASON=no_brain_url"; return 2; }
  post /api/brain/device-locks/acquire "$(json_body "$serial" "$owner" "$ttl")" \
    || { echo "BRAIN_LOCK=unavailable BRAIN_LOCK_REASON=connect_failed"; return 2; }
  if [[ "$HTTP_CODE" != 200 ]]; then echo "BRAIN_LOCK=unavailable BRAIN_LOCK_REASON=http_$HTTP_CODE"; return 2; fi
  acquired=$(printf '%s' "$HTTP_BODY" | json_get acquired)
  if [[ "$acquired" == true ]]; then echo "BRAIN_LOCK=acquired"; return 0; fi
  if [[ "$acquired" == false ]]; then
    holder=$(printf '%s' "$HTTP_BODY" | json_get locked_by | tr -d ' \n')
    echo "BRAIN_LOCK=busy BRAIN_LOCK_HOLDER=${holder:-unknown}"; return 1
  fi
  echo "BRAIN_LOCK=unavailable BRAIN_LOCK_REASON=bad_response"; return 2
}

cmd_release(){
  [[ $# -ge 2 && -n "$1" && -n "$2" ]] || { echo "usage: brain-lock.sh release <serial> <owner>" >&2; return 64; }
  load_env
  [[ -n "$BRAIN_URL" ]] || { echo "BRAIN_LOCK=unavailable BRAIN_LOCK_REASON=no_brain_url"; return 2; }
  local attempt
  for attempt in 1 2; do
    if post /api/brain/device-locks/release "$(json_body "$1" "$2")"; then
      case "$HTTP_CODE" in
        200) echo "BRAIN_LOCK=released"; return 0;;
        409) echo "BRAIN_LOCK=not_held"; return 1;;
      esac
    fi
    (( attempt == 1 )) && sleep 2
  done
  echo "BRAIN_LOCK=unavailable BRAIN_LOCK_REASON=release_failed"; return 2
}

cmd_heartbeat(){
  local serial="$1" owner="$2" ttl="$3" interval="$4" watch="$5" out
  while :; do
    sleep "$interval"
    kill -0 "$watch" 2>/dev/null || exit 0
    out=$(cmd_acquire "$serial" "$owner" "$ttl"); rc=$?
    # 被别人拿走（只可能发生在我们 TTL 过期之后）：只记日志，由持有方的业务锁兜底；不抢
    (( rc == 1 )) && echo "[$(date +%m%d-%H:%M:%S)] brain-lock: 续租失败,锁已被别人持有($serial ${out#*HOLDER=})" >&2
  done
}

cmd_run(){
  local serial="${1:-}" owner="${2:-}" ttl=15 interval=240 logf="" pg=""
  [[ -n "$serial" && -n "$owner" ]] || { echo "usage: brain-lock.sh run <serial> <owner> [opts] -- cmd..." >&2; return 64; }
  shift 2
  while [[ $# -gt 0 && "$1" != "--" ]]; do
    case "$1" in
      --ttl) ttl="$2"; shift 2;;
      --interval) interval="$2"; shift 2;;
      --log) logf="$2"; shift 2;;
      --skip-if-pgrep) pg="$2"; shift 2;;
      *) echo "brain-lock run: unknown option $1" >&2; return 64;;
    esac
  done
  [[ "${1:-}" == "--" && $# -ge 2 ]] || { echo "brain-lock run: missing -- CMD" >&2; return 64; }
  shift
  # rlog 也会在 EXIT trap 里调用(那时 cmd_run 已返回、局部变量没了),只能读全局 RUN_SERIAL/RUN_LOG
  RUN_SERIAL="$serial"; RUN_LOG="$logf"
  rlog(){ local m="[$(date +%m%d-%H:%M:%S)] brain-lock[${RUN_SERIAL:-?}]: $*"; if [[ -n "${RUN_LOG:-}" ]]; then echo "$m" >> "$RUN_LOG"; fi; echo "$m"; }

  local out rc held=0
  out=$(cmd_acquire "$serial" "$owner" "$ttl"); rc=$?
  case $rc in
    0) held=1; rlog "Brain设备锁已领 owner=$owner ttl=${ttl}min";;
    1) rlog "Brain设备锁被占(${out#*HOLDER=}),本轮跳过,不动手机"; return 0;;
    *) rlog "Brain设备锁服务不可用(${out#*REASON=}),降级放行(本机锁/pgrep 仍生效)";;
  esac

  HB_PID=""; CHILD_PID=""; RUN_HELD=$held; RUN_SERIAL="$serial"; RUN_OWNER="$owner"; RUN_CLEANED=0
  run_cleanup(){
    (( RUN_CLEANED )) && return 0; RUN_CLEANED=1
    [[ -n "$HB_PID" ]] && kill "$HB_PID" 2>/dev/null
    if (( RUN_HELD )); then
      local r; r=$(cmd_release "$RUN_SERIAL" "$RUN_OWNER"); rlog "放锁: $r"
    fi
  }
  on_signal(){
    local code="$1" sig="$2"
    if [[ -n "$CHILD_PID" ]]; then kill -"$sig" "$CHILD_PID" 2>/dev/null; wait "$CHILD_PID" 2>/dev/null; fi
    run_cleanup; exit "$code"
  }
  trap run_cleanup EXIT
  trap 'on_signal 143 TERM' TERM
  trap 'on_signal 130 INT' INT
  trap 'on_signal 129 HUP' HUP

  if [[ -n "$pg" ]] && pgrep -f "$pg" >/dev/null 2>&1; then
    rlog "pgrep 第二道判重命中($pg),已有同机进程在跑,本轮跳过"
    return 0
  fi
  if (( held )); then
    "$SELF" heartbeat "$serial" "$owner" "$ttl" "$interval" "$$" </dev/null >/dev/null 2>>"${logf:-/dev/null}" &
    HB_PID=$!
  fi
  # 后台起 + wait：信号能立刻进 trap（前台子进程时 bash 要等它结束才处理 trap）
  "$@" &
  CHILD_PID=$!
  wait "$CHILD_PID"; rc=$?
  CHILD_PID=""
  return $rc
}

sub="${1:-}"; shift || true
case "$sub" in
  acquire) cmd_acquire "$@";;
  release) cmd_release "$@";;
  heartbeat) cmd_heartbeat "$@";;
  run) cmd_run "$@"; exit $?;;
  *) echo "usage: brain-lock.sh {acquire|release|heartbeat|run} ..." >&2; exit 64;;
esac
