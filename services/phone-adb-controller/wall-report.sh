#!/usr/bin/env bash
# wall-report.sh — 获客链步骤上报薄壳（控制塔 worker 活动协议执行器面）。永远退出 0、绝不阻塞主流程。
# 用法（目标 = <serial> 或 --profile <P>，后者查 douyin-phone-profiles.tsv）:
#   wall-report start <目标> "<title>" "步骤1,步骤2,..."
#   wall-report step  <目标> <idx> doing|done|failed ["note"] ["diag"]
#   wall-report note  <目标> "<note>"            # 当前步再报 doing（服务端续租 10 分钟）
#   wall-report done  <目标>
#   wall-report fail  <目标> <idx> <error_code> ["diag_line"]   # 步骤 note=error_code、diag 缺省=error_code
# 注意：note 只在 `step N doing` 之后用，不要在 `step N done` 之后调——它会把已完成的第 N 步改回 doing。
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=wall-lib.sh
. "$DIR/wall-lib.sh"
EXECUTOR="adb-wall"
SHOT_MAX=204000   # 服务端 base64 上限对应的原图上限（204800 差一会被拒）
# 最小合法 JPEG(1×1)，真机截图失败时的占位（服务端 failed 步必须带截图）
PLACEHOLDER_JPEG_B64='/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDA0MDAsLDBEODw0RFRUWFhURFBQXGh0dHRoaGRkcHSAgICAeIiIiIiIiIiIiIiIiIiL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAB//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z'

cmd="${1:-}"; [ $# -gt 0 ] && shift
wall_load_env || exit 0
[ -n "${ZJ_INTERNAL_TOKEN:-}" ] || { wall_log "缺 ZJ_INTERNAL_TOKEN,上报关闭"; exit 0; }
if [ "${1:-}" = "--profile" ]; then SERIAL=$(wall_profile_serial "${2:-}"); [ $# -ge 2 ] && shift 2
else SERIAL="${1:-}"; [ $# -gt 0 ] && shift; fi
[ -n "$SERIAL" ] || { wall_log "report $cmd: 无法解析序列号"; exit 0; }
STATE="$ZJ_WALL_TMP/task-$SERIAL"    # 两行: task_id / 当前 step_index

# 执行器面只用内部 token；绝不带 X-Agent-License（带了会被分流到 license 路径而 401）
api() { # POST path body [总超时秒,默认 3] → 输出 "<code> <body>"
  local out code
  out=$(curl -s --connect-timeout 2 -m "${3:-3}" -w '\n%{http_code}' -X POST "$ZJ_API_BASE$1" \
        -H "Authorization: Bearer $ZJ_INTERNAL_TOKEN" -H 'Content-Type: application/json' -d "$2") || { printf '000 \n'; return 0; }
  code=${out##*$'\n'}; out=${out%$'\n'*}
  printf '%s %s\n' "$code" "$out"
}
state_task() { sed -n 1p "$STATE" 2>/dev/null; }
state_step() { sed -n 2p "$STATE" 2>/dev/null; }
state_put()  { printf '%s\n%s\n' "$1" "$2" > "$STATE"; }
is_idx()     { case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }

do_complete() { # task_id completed | task_id failed error_code failed_step
  local b
  if [ "$2" = "failed" ]; then
    b=$(python3 -c 'import json,sys;print(json.dumps({"outcome":"failed","executor_id":sys.argv[1],"error_code":sys.argv[2],"failed_step":int(sys.argv[3] or 0)}))' "$EXECUTOR" "$3" "${4:-0}" 2>/dev/null)
  else
    b=$(python3 -c 'import json,sys;print(json.dumps({"outcome":sys.argv[2],"executor_id":sys.argv[1]}))' "$EXECUTOR" "$2" 2>/dev/null)
  fi
  api "/api/workers/tasks/$1/complete" "$b" >/dev/null
}

do_start() { # title steps_csv
  local uuid body r code tid old
  uuid=$(wall_uuid_for "$SERIAL") || { wall_log "start $SERIAL: 无 uuid"; return 0; }
  body=$(python3 -c 'import json,sys;print(json.dumps({"title":sys.argv[1][:80],"steps":[s for s in sys.argv[2].split(",") if s],"executor_id":sys.argv[3]}))' "$1" "$2" "$EXECUTOR" 2>/dev/null)
  r=$(api "/api/workers/$uuid/tasks" "$body"); code=${r%% *}
  if [ "$code" = "409" ]; then
    old=$(state_task)
    if [ -n "$old" ]; then
      do_complete "$old" failed superseded "$(state_step)"
      r=$(api "/api/workers/$uuid/tasks" "$body"); code=${r%% *}
    fi
  fi
  if [ "$code" = "201" ]; then
    tid=$(printf '%s' "${r#* }" | wall_json_get data.task_id)
    state_put "$tid" 0; wall_log "start $SERIAL task=$tid"
  else
    rm -f "$STATE"; wall_log "start $SERIAL HTTP $code,静默降级"
  fi
}

do_step() { # idx status [note] [diag]
  local tid idx="$1" st="$2" note="${3:-}" diag="${4:-}" body fg shot b64 placeholder=0 tmo=3 r code
  tid=$(state_task); [ -n "$tid" ] || { wall_log "$cmd $SERIAL 无进行中任务,忽略"; return 0; }
  is_idx "$idx" || { wall_log "$cmd $SERIAL idx 非数字: $idx"; return 0; }
  if [ "$st" = "failed" ]; then
    fg=$(wall_foreground_pkg "$SERIAL"); [ -n "$fg" ] || fg=unknown
    [ -n "$diag" ] || diag="${note:-n/a}"
    shot="$ZJ_WALL_TMP/fail-$SERIAL.jpg"
    if wall_capture_jpeg "$SERIAL" "$shot" "$SHOT_MAX"; then b64=$(base64 < "$shot" | tr -d '\n')
    else b64="$PLACEHOLDER_JPEG_B64"; placeholder=1; fi
    # 占位时 note 先截到 170 再拼标注，保证标注不被 200 上限切掉
    body=$(python3 -c 'import json,sys
n=sys.argv[3][:170]+" [截图失败,占位图]" if sys.argv[7]=="1" else sys.argv[3][:200]
print(json.dumps({"step_index":int(sys.argv[1]),"status":"failed","executor_id":sys.argv[2],"note":n,"foreground_pkg":sys.argv[4],"diag_line":sys.argv[5][:500],"screenshot_jpeg_b64":sys.argv[6]}))' "$idx" "$EXECUTOR" "$note" "$fg" "$diag" "$b64" "$placeholder" 2>/dev/null)
    tmo=10   # 带截图 body 可到 270KB，给足传输时间
  else
    body=$(python3 -c 'import json,sys;print(json.dumps({"step_index":int(sys.argv[1]),"status":sys.argv[2],"executor_id":sys.argv[3],"note":sys.argv[4][:200]}))' "$idx" "$st" "$EXECUTOR" "$note" 2>/dev/null)
  fi
  r=$(api "/api/workers/tasks/$tid/steps" "$body" "$tmo"); code=${r%% *}
  [ "$code" = "200" ] || wall_log "step $SERIAL #$idx $st HTTP $code"
  state_put "$tid" "$idx"
}

case "$cmd" in
  start) do_start "${1:-任务}" "${2:-步骤1}" ;;
  step)  do_step "${1:-0}" "${2:-doing}" "${3:-}" "${4:-}" ;;
  note)  do_step "$(state_step)" doing "${1:-}" ;;
  done)  tid=$(state_task); [ -n "$tid" ] && { do_complete "$tid" completed; rm -f "$STATE"; } ;;
  fail)  idx="${1:-0}"; ec="${2:-failed}"
         do_step "$idx" failed "$ec" "${3:-$ec}"
         tid=$(state_task)
         if [ -n "$tid" ] && is_idx "$idx"; then do_complete "$tid" failed "$ec" "$idx"; rm -f "$STATE"; fi ;;
  *)     wall_log "未知子命令: $cmd" ;;
esac
exit 0
