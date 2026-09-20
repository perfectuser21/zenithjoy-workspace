#!/usr/bin/env bash
# phone-wall-push.sh — 机房手机 adb 抓屏推帧器：每台在线手机每秒一帧 → 控制塔「工作机」实时画面
# 常驻(launchd com.zenithjoy.phonewallpush)；WALL_ONCE=1 只跑一轮(单测/smoke)。永远退出 0。
# bash 3.2 兼容：不用 declare -A / mapfile / ${var,,}
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=wall-lib.sh
. "$DIR/wall-lib.sh"
WALL_INTERVAL="${WALL_INTERVAL:-1}"
WALL_BACKOFF="${WALL_BACKOFF:-10}"   # frame 429 退避秒数
FRAME_MAX=122880   # 服务端 express.raw limit 120kb

# 缺配置：常驻模式先睡 60s 再退，免得 launchd KeepAlive 每 10s 重启刷日志
wall_load_env || { [ "${WALL_ONCE:-0}" = "1" ] || sleep 60; exit 0; }
command -v "$ADB" >/dev/null 2>&1 || wall_log "adb 不可用: $ADB"
wall_log "推帧器启动 api=$ZJ_API_BASE once=${WALL_ONCE:-0}"

# 单台手机推帧循环（后台子进程）：serial uuid
# 日志限频：中台不可达时每秒一帧都记会一天几万行，用 last 状态机——抓屏失败/非 202 只在状态变化时记一条，
# 恢复 202 时记一条；超限跳帧（capture 返回 2）不是错误，不记也不改状态
push_loop() {
  local serial="$1" uuid="$2" code last=202 rc
  local jpg="$ZJ_WALL_TMP/frame-$serial.jpg"
  while :; do
    if ! wall_adb -s "$serial" get-state >/dev/null; then wall_log "$serial 离线,推帧退出"; return 0; fi
    wall_capture_jpeg "$serial" "$jpg" "$FRAME_MAX"; rc=$?
    if [ "$rc" -eq 0 ]; then
      code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' -X POST "$ZJ_API_BASE/api/workers/$uuid/frame" \
        -H "X-Agent-License: $ZJ_LICENSE" -H 'Content-Type: image/jpeg' --data-binary "@$jpg")
      if [ "$code" != "$last" ]; then
        case "$code" in
          202) wall_log "$serial frame 恢复 202" ;;
          429) wall_log "$serial frame 429,退避${WALL_BACKOFF}s" ;;
          *)   wall_log "$serial frame HTTP $code" ;;
        esac
      fi
      last="$code"
      [ "$code" = "429" ] && sleep "$WALL_BACKOFF"
    elif [ "$rc" -eq 1 ]; then
      [ "$last" = "cap" ] || wall_log "$serial 抓屏失败"
      last=cap
    fi
    [ "${WALL_ONCE:-0}" = "1" ] && return 0
    sleep "$WALL_INTERVAL"
  done
}

PIDS=(); PSER=()
REG_FAILED=" "   # 连续注册失败中的序列号（空格包围），同一台只记第一次失败
alive() { kill -0 "$1" 2>/dev/null; }
# launchd stop / 手工 kill：带走全部推帧子进程，不留孤儿继续推帧
trap 'kill $(jobs -p) 2>/dev/null; exit 0' TERM INT

while :; do
  # 子进程表按存活重建：死掉的项剔除，避免 PID 复用误判"还在跑"和表只增不减
  NP=(); NS=(); i=0
  while [ "$i" -lt "${#PSER[@]}" ]; do
    if alive "${PIDS[$i]}"; then NP[${#NP[@]}]="${PIDS[$i]}"; NS[${#NS[@]}]="${PSER[$i]}"; fi
    i=$((i+1))
  done
  PIDS=(); PSER=(); i=0
  while [ "$i" -lt "${#NS[@]}" ]; do PIDS[i]="${NP[$i]}"; PSER[i]="${NS[$i]}"; i=$((i+1)); done

  serials=$("$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="device"{print $1}')
  for s in $serials; do
    running=0; i=0
    while [ "$i" -lt "${#PSER[@]}" ]; do
      [ "${PSER[$i]}" = "$s" ] && running=1
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
  sleep 60 & wait $!   # 后台 sleep + wait：TERM 到达时立刻进 trap，不等 60s
done
