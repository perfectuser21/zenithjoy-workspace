#!/usr/bin/env bash
# device-job-claimer.sh —— 工作机领单器（task 3abb7f8c）
#
# 主理人在工作机页点「派一件活」→ 这个脚本把它领下来，在真机上跑掉，再把结果报回去。
# 没有它，页面上派的单会永远躺在"待跑"——页面第一次亮相就用事实教育主理人
# 「这里排的东西不算数」，那比不上线更糟。
#
# 边界（本刀只做这一半，另一半留给第二刀）：
#   · 只领 **一次性单**（source=oneoff）。每晚采收、每半小时触达那些周期活仍归
#     crontab，本脚本一条都不碰 —— 两套调度同时盯同一批活，一件活会跑两遍。
#   · 只认本机 `adb devices` 里真实在线的手机，不按配置文件猜。
#
# 三道自保：
#   1. **宿主级互斥**：一台 Mac 驱动两台手机，同一时刻只许跑一单。22:00/22:30 的错峰
#      本来就是为了避开 adb 争用，放开了会让两台手机互相打架（0821 搜索框错位同款根因）。
#   2. **认领是中台做的原子 UPDATE**，本脚本拿到就是独占，不需要自己判重。
#   3. **失败必回执**：不回执的活会一直挂在"执行中"，页面上看着像卡死。
#
# 环境（~/.config/zenithjoy/wall.env，与推帧器共用）：
#   ZJ_API_BASE          中台基址
#   ZJ_INTERNAL_TOKEN    内部 token（认领/回执用）
#
# 用法：device-job-claimer.sh   （launchd 每分钟一次）
#
# 用 bash 而不是 zsh：与 phone-wall-push.sh / wall-report.sh 一致，这三个都有 CI 测试，
# 要在 ubuntu runner 上跑得起来；同时避开 bash 4 专有语法（macOS 自带的是 3.2）。
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

CONF="${ZJ_CONF:-$HOME/.config/zenithjoy/wall.env}"
[[ -f "$CONF" ]] && source "$CONF"
API_BASE="${ZJ_API_BASE:-}"
TOKEN="${ZJ_INTERNAL_TOKEN:-}"
ADB="${ZJ_ADB:-adb}"
PHONE_CTL="${ZJ_PHONE_CTL:-$HOME/bin-harvest/douyin-phone-adb}"
WR="${WALL_REPORT:-$HOME/bin-harvest/wall-report.sh}"
LOG="${ZJ_CLAIMER_LOG:-$HOME/device-job-claimer.log}"
LOCK_DIR="${ZJ_CLAIMER_LOCK:-/tmp/zj-device-job-claimer.lock}"
# 跨境写请求 3 秒不够（PR#1892 的丢单教训）：领单/回执一律 8 秒
API_TIMEOUT="${ZJ_API_TIMEOUT:-8}"

log() { printf '[%s] %s\n' "$(date +%m%d-%H:%M:%S)" "$*" >> "${LOG}"; }
wr() { [[ -x "${WR}" ]] && "${WR}" "$@" >/dev/null 2>&1; true; }

if [[ -z "${API_BASE}" || -z "${TOKEN}" ]]; then log "缺 ZJ_API_BASE 或 ZJ_INTERNAL_TOKEN，跳过"; exit 0; fi

# ── 自保 1：宿主级互斥（mkdir 是原子的） ──────────────────────────
if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  # 锁超过 30 分钟视为上一轮崩了没清，夺锁继续；否则安静退出（每分钟一轮，不刷屏）
  if [[ -d "${LOCK_DIR}" ]]; then
    # 取锁目录 mtime。不能用 `stat -f %m || stat -c %Y`：GNU 的 -f 是 --file-system，
    # 在 Linux 上**不会失败**，会返回文件系统信息，算术表达式当场炸（CI 实证）。
    # python3 本脚本已经依赖，用它一次跨平台。
    lock_mtime=$(python3 -c 'import os,sys; print(int(os.path.getmtime(sys.argv[1])))' "${LOCK_DIR}" 2>/dev/null || echo 0)
    local_age=$(( $(date +%s) - lock_mtime ))
    if (( local_age > 1800 )); then
      log "锁已存在 ${local_age}s，判定为上一轮残留，夺锁"
      rm -rf "${LOCK_DIR}" && mkdir "${LOCK_DIR}" 2>/dev/null || exit 0
    else
      exit 0
    fi
  else
    exit 0
  fi
fi
trap 'rm -rf "${LOCK_DIR}"' EXIT INT TERM

# ── 本机真实在线的手机 ────────────────────────────────────────────
SERIALS=()
while IFS= read -r line; do
  [[ -n "${line}" ]] && SERIALS+=("${line}")
done < <("${ADB}" devices 2>/dev/null | awk '/\tdevice$/ {print $1}')
if (( ${#SERIALS[@]} == 0 )); then
  log "本机没有在线手机，跳过"
  exit 0
fi

SERIAL_JSON=$(printf '%s\n' "${SERIALS[@]}" | python3 -c 'import sys,json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')
CLAIMER="$(hostname -s)-claimer"

# ── 认领一条 ──────────────────────────────────────────────────────
RESP=$(curl -s -m "${API_TIMEOUT}" -X POST "${API_BASE}/api/schedule/claim" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{\"serials\": ${SERIAL_JSON}, \"claimer\": \"${CLAIMER}\"}" 2>>"${LOG}")

JOB_ID=$(printf '%s' "${RESP}" | python3 -c 'import sys,json;d=json.load(sys.stdin);j=(d.get("data") or {}).get("job");print(j["id"] if j else "")' 2>/dev/null)
if [[ -z "${JOB_ID}" ]]; then
  # 没活是常态（每分钟一轮），不记日志免刷屏；认领报错才记
  printf '%s' "${RESP}" | grep -q '"success":false' && log "认领异常: ${RESP}"
  exit 0
fi

JOB_SERIAL=$(printf '%s' "${RESP}" | python3 -c 'import sys,json;d=json.load(sys.stdin);print((d["data"]["job"].get("serial") or ""))' 2>/dev/null)
JOB_TITLE=$(printf '%s' "${RESP}" | python3 -c 'import sys,json;d=json.load(sys.stdin);print((d["data"]["job"].get("title") or ""))' 2>/dev/null)
JOB_ACTION=$(printf '%s' "${RESP}" | python3 -c 'import sys,json;d=json.load(sys.stdin);print((d["data"]["job"].get("params") or {}).get("action",""))' 2>/dev/null)
JOB_PROFILE=$(printf '%s' "${RESP}" | python3 -c 'import sys,json;d=json.load(sys.stdin);print((d["data"]["job"].get("params") or {}).get("profile",""))' 2>/dev/null)
JOB_ARG=$(printf '%s' "${RESP}" | python3 -c 'import sys,json;d=json.load(sys.stdin);print((d["data"]["job"].get("params") or {}).get("arg",""))' 2>/dev/null)

log "领到单 ${JOB_ID}｜${JOB_TITLE}｜设备 ${JOB_SERIAL}｜动作 ${JOB_ACTION:-未指定}"
export WALL_NS=devicejob
wr start "${JOB_SERIAL}" "${JOB_TITLE}" "执行工作机页派下来的活"
wr step "${JOB_SERIAL}" 0 doing

# ── 执行 ─────────────────────────────────────────────────────────
OK=false
ERR_CODE=""
OUT=""
if [[ -z "${JOB_ACTION}" ]]; then
  ERR_CODE="NO_ACTION"
  log "单 ${JOB_ID} 没带动作，直接判失败（派单方必须给 params.action）"
elif [[ ! -x "${PHONE_CTL}" ]]; then
  ERR_CODE="NO_PHONE_CTL"
  log "找不到 ${PHONE_CTL}"
else
  # douyin-phone-adb 按 profile 选设备；派单没给 profile 时用序列号兜底
  P="${JOB_PROFILE:-${JOB_SERIAL}}"
  if [[ -n "${JOB_ARG}" ]]; then
    OUT=$("${PHONE_CTL}" --profile "${P}" "${JOB_ACTION}" "${JOB_ARG}" </dev/null 2>&1)
  else
    OUT=$("${PHONE_CTL}" --profile "${P}" "${JOB_ACTION}" </dev/null 2>&1)
  fi
  RC=$?
  if (( RC == 0 )); then
    OK=true
  else
    ERR_CODE="EXEC_RC_${RC}"
    log "执行失败 rc=${RC}: $(printf '%s' "${OUT}" | tail -3)"
  fi
fi

# ── 回执（失败也必须回，否则这条活会一直挂在"执行中"像卡死） ──────
EVID=$(python3 -c '
import json,sys
out=sys.stdin.read()
print(json.dumps({"tail": out[-800:]}))' <<< "${OUT}")
FINISH=$(curl -s -m "${API_TIMEOUT}" -X POST "${API_BASE}/api/schedule/jobs/${JOB_ID}/finish" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{\"ok\": ${OK}, \"error_code\": \"${ERR_CODE}\", \"evidence\": ${EVID}}" 2>>"${LOG}")

if printf '%s' "${FINISH}" | grep -q '"success":true'; then
  log "单 ${JOB_ID} 回执已送达（ok=${OK}）"
else
  # 回执送不到是最危险的一种失败：活跑过了但账上还是"执行中"。重试一次。
  log "回执失败，重试一次: ${FINISH}"
  sleep 3
  curl -s -m "${API_TIMEOUT}" -X POST "${API_BASE}/api/schedule/jobs/${JOB_ID}/finish" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d "{\"ok\": ${OK}, \"error_code\": \"${ERR_CODE}\", \"evidence\": ${EVID}}" >>"${LOG}" 2>&1
fi

if [[ "${OK}" == "true" ]]; then
  wr step "${JOB_SERIAL}" 0 done
  wr done "${JOB_SERIAL}"
else
  wr fail "${JOB_SERIAL}" "${ERR_CODE}"
fi
exit 0
