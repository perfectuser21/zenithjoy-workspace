#!/usr/bin/env bash
# phone-wall-push.sh — 机房手机 adb 抓屏推帧器：每台在线手机每秒一帧 → 控制塔「工作机」实时画面
# 常驻(launchd com.zenithjoy.phonewallpush)；WALL_ONCE=1 只跑一轮(单测/smoke)。永远退出 0。
# bash 3.2 兼容：不用 declare -A / mapfile / ${var,,}
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=wall-lib.sh
. "$DIR/wall-lib.sh"
WALL_INTERVAL="${WALL_INTERVAL:-1}"
FRAME_MAX=122880   # 服务端 express.raw limit 120kb

wall_load_env || exit 0
wall_log "推帧器启动 api=$ZJ_API_BASE once=${WALL_ONCE:-0}"

# 单台手机推帧循环（后台子进程）：serial uuid
# 日志限频：中台不可达时每秒一帧都记会一天几万行，非 202 只在状态码变化时记一条，恢复 202 时记一条
push_loop() {
  local serial="$1" uuid="$2" jpg="$ZJ_WALL_TMP/frame-$1.jpg" code last=202
  while :; do
    if ! "$ADB" -s "$serial" get-state >/dev/null 2>&1; then wall_log "$serial 离线,推帧退出"; return 0; fi
    if wall_capture_jpeg "$serial" "$jpg" "$FRAME_MAX"; then   # 返回 2=超限跳帧，不是错误不记日志
      code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' -X POST "$ZJ_API_BASE/api/workers/$uuid/frame" \
        -H "X-Agent-License: $ZJ_LICENSE" -H 'Content-Type: image/jpeg' --data-binary "@$jpg")
      if [ "$code" != "$last" ]; then
        case "$code" in
          202) wall_log "$serial frame 恢复 202" ;;
          429) wall_log "$serial frame 429,退避10s" ;;
          *)   wall_log "$serial frame HTTP $code" ;;
        esac
      fi
      last="$code"
      [ "$code" = "429" ] && sleep 10
    fi
    [ "${WALL_ONCE:-0}" = "1" ] && return 0
    sleep "$WALL_INTERVAL"
  done
}

PIDS=(); PSER=()
REG_FAILED=" "   # 连续注册失败中的序列号（空格包围），同一台只记第一次失败
alive() { kill -0 "$1" 2>/dev/null; }

while :; do
  serials=$("$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="device"{print $1}')
  for s in $serials; do
    running=0; i=0
    while [ "$i" -lt "${#PSER[@]}" ]; do
      [ "${PSER[$i]}" = "$s" ] && alive "${PIDS[$i]}" && running=1
      i=$((i+1))
    done
    # 每轮注册 = 心跳(刷 last_seen)；失败只跳过本轮不退出。已在失败态的台子静默重试（库内日志也压掉）
    case "$REG_FAILED" in
      *" $s "*)
        if uuid=$(ZJ_WALL_LOG=/dev/null wall_register "$s"); then
          REG_FAILED="${REG_FAILED/ $s / }"; wall_log "$s 注册恢复"
        else continue; fi ;;
      *)
        uuid=$(wall_register "$s") || { REG_FAILED="$REG_FAILED$s "; wall_log "$s 注册失败,本轮跳过"; continue; } ;;
    esac
    if [ "$running" -eq 0 ]; then
      push_loop "$s" "$uuid" &
      PIDS[${#PIDS[@]}]=$!; PSER[${#PSER[@]}]="$s"
      wall_log "$s 推帧子进程 $! uuid=$uuid"
    fi
  done
  [ "${WALL_ONCE:-0}" = "1" ] && { wait; exit 0; }
  sleep 60
done
