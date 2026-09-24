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
# profile 是**工作机本地**的概念（douyin-phone-adb 的 registry：<profile名>\t<serial>\t…），
# 中台不知道也不该知道。派单只给机身序列号，profile 在这里按 serial 现查。
PHONE_REGISTRY="${DOUYIN_PHONE_REGISTRY:-$HOME/.config/openclaw/douyin-phone-profiles.tsv}"
# 发送方账号也是本机概念：<profile>\t<抖音号>\t<昵称>\t<角色标签>，私信用带 distribution 的那个
ACCOUNT_REGISTRY="${DOUYIN_ACCOUNT_REGISTRY:-$HOME/.config/openclaw/douyin-account-routes.tsv}"
# 业务脚本落点（都在本机 ~/bin-harvest 下；测试用 env 覆盖）
HARVEST_KEYWORD="${ZJ_HARVEST_KEYWORD:-$HOME/bin-harvest/harvest-keyword.sh}"
OUTREACH_TICK="${ZJ_OUTREACH_TICK:-$HOME/bin-harvest/outreach-tick.sh}"
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
# 业务工作（主理人在页面上派的"活"）。没有 job_type 的是老的 adb 原语单，走下面的兼容分支。
jp() { printf '%s' "${RESP}" | python3 -c "import sys,json;d=json.load(sys.stdin);print((d['data']['job'].get('params') or {}).get('$1',''))" 2>/dev/null; }
JOB_TYPE=$(jp job_type)

log "领到单 ${JOB_ID}｜${JOB_TITLE}｜设备 ${JOB_SERIAL}｜动作 ${JOB_ACTION:-未指定}"
export WALL_NS=devicejob
wr start "${JOB_SERIAL}" "${JOB_TITLE}" "执行工作机页派下来的活" "${JOB_ID}"
wr step "${JOB_SERIAL}" 0 doing

# ── 执行 ─────────────────────────────────────────────────────────
OK=false
ERR_CODE=""
OUT=""

# 先把 profile 解出来：业务工作和 adb 原语都要用
resolve_profile() {
  local p=""
  if [[ -r "${PHONE_REGISTRY}" && -n "${JOB_SERIAL}" ]]; then
    p=$(awk -F'\t' -v s="${JOB_SERIAL}" '$2 == s { print $1; exit }' "${PHONE_REGISTRY}")
  fi
  if [[ -z "${p}" ]]; then
    p="${JOB_PROFILE:-${JOB_SERIAL}}"
    log "registry 里按序列号 ${JOB_SERIAL} 查不到 profile，退回用 ${p}"
  fi
  printf '%s' "${p}"
}

if [[ -n "${JOB_TYPE}" ]]; then
  # ── 业务工作：主理人在页面上派的"活" ──────────────────────────
  P=$(resolve_profile)
  case "${JOB_TYPE}" in
    harvest_keyword)
      KW=$(jp keyword); MAXV=$(jp max_videos)
      if [[ ! -x "${HARVEST_KEYWORD}" ]]; then
        ERR_CODE="NO_SCRIPT"; log "找不到采收脚本 ${HARVEST_KEYWORD}"
      elif [[ -z "${KW}" ]]; then
        ERR_CODE="NO_KEYWORD"; log "采收单没带关键词"
      else
        # 脚本要的是 URL 编码后的词（它自己不编码）
        KW_ENC=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "${KW}" 2>/dev/null)
        OUT=$("${HARVEST_KEYWORD}" "${P}" "${KW_ENC}" "${MAXV:-6}" "dj$(date +%m%d%H%M%S)" </dev/null 2>&1)
        RC=$?; (( RC == 0 )) && OK=true || { ERR_CODE="EXEC_RC_${RC}"; log "采收失败 rc=${RC}: $(printf '%s' "${OUT}" | tail -3)"; }
      fi
      ;;
    outreach_round)
      if [[ ! -x "${OUTREACH_TICK}" ]]; then
        ERR_CODE="NO_SCRIPT"; log "找不到触达脚本 ${OUTREACH_TICK}"
      else
        OUT=$("${OUTREACH_TICK}" </dev/null 2>&1)
        RC=$?; (( RC == 0 )) && OK=true || { ERR_CODE="EXEC_RC_${RC}"; log "触达失败 rc=${RC}: $(printf '%s' "${OUT}" | tail -3)"; }
      fi
      ;;
    dm_one)
      TARGET=$(jp target); MSG=$(jp message)
      # 发送方账号由本机路由表定：取该 profile 下带 distribution 角色的第一个号。
      # 中台不知道这台机绑了哪些号，也不该知道（同 profile，上一轮的教训）。
      SENDER=""
      if [[ -r "${ACCOUNT_REGISTRY}" ]]; then
        SENDER=$(awk -F'\t' -v p="${P}" '$1 == p && $4 ~ /distribution/ { print $2; exit }' "${ACCOUNT_REGISTRY}")
        [[ -z "${SENDER}" ]] && SENDER=$(awk -F'\t' -v p="${P}" '$1 == p { print $2; exit }' "${ACCOUNT_REGISTRY}")
      fi
      if [[ ! -x "${PHONE_CTL}" ]]; then
        ERR_CODE="NO_PHONE_CTL"; log "找不到 ${PHONE_CTL}"
      elif [[ -z "${SENDER}" ]]; then
        # 宁可判失败说清楚，也不拿个不确定的号去发——发错号比不发更糟
        ERR_CODE="NO_SENDER"; log "本机账号路由表里查不到 ${P} 的发送号，不发"
      elif [[ -z "${TARGET}" || -z "${MSG}" ]]; then
        ERR_CODE="NO_TARGET_OR_MSG"; log "私信单缺发给谁或发什么"
      else
        # 话术走 base64：引号、$、换行都不会在传参路上被吃掉
        MSG_B64=$(printf '%s' "${MSG}" | /usr/bin/base64 | tr -d '\n')
        OUT=$("${PHONE_CTL}" --profile "${P}" private-message-send "${SENDER}" "${TARGET}" "${MSG_B64}" "dj$(date +%m%d%H%M%S)" </dev/null 2>&1)
        RC=$?; (( RC == 0 )) && OK=true || { ERR_CODE="EXEC_RC_${RC}"; log "私信失败 rc=${RC}: $(printf '%s' "${OUT}" | tail -3)"; }
      fi
      ;;
    *)
      ERR_CODE="UNKNOWN_JOB_TYPE"
      log "不认识的活：${JOB_TYPE}（页面上的工作目录与本机分派对不上，八成是有一边没更新）"
      ;;
  esac
elif [[ -z "${JOB_ACTION}" ]]; then
  ERR_CODE="NO_ACTION"
  log "单 ${JOB_ID} 既没带 job_type 也没带动作，直接判失败"
elif [[ ! -x "${PHONE_CTL}" ]]; then
  ERR_CODE="NO_PHONE_CTL"
  log "找不到 ${PHONE_CTL}"
else
  P=$(resolve_profile)
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
  # 签名是 fail <目标> <idx> <error_code>：少传 idx 会让 error_code 被当成 idx，
  # 非数字则不执行收尾，控制塔那条永远挂在 running，10 分钟后被判「机器失联」——
  # 把"参数错、2 秒就失败"伪装成"跨境网络抖动"，把人往完全错误的方向带（生产实证 03aa758d）。
  wr fail "${JOB_SERIAL}" 0 "${ERR_CODE}"
fi
exit 0
