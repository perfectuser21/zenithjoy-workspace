#!/usr/bin/env bash
# wf-agent-run.sh —— codex_agent 形态 workflow 的一次 run（任务 c0fe7e30；决策 2186700a / 26df670a）
#
# 形状：共享外壳-准备(preflight：查手机 → 领手机控制器锁 → 查账号) → 业务块(OpenClaw skill-factory agent，Codex 运行时跑业务 skill)
#       → 共享外壳-收尾(cleanup：关抖音 → 放本 run 的锁 → 回读 free)。收尾挂 trap EXIT：业务块成功/失败/超时/被 TERM 都执行。
# 由 wf-launch.sh 在网关机 MMV 独立会话拉起（openclaw CLI 在本机）；手机经 ssh <host> 调登记控制器 douyin-phone-adb。
# Brain 设备锁由 Brain 派发器代领（owner=Brain 任务），这里管的是手机控制器锁（owner=run_id），两层互不替代。
# 成败不在这里判：本脚本只如实汇总外壳事实 + 业务块交付 + 系统读回到 ~/wf-agent-runs/<run_id>/delivery.json，由 Brain 收割与裁判。
#
# 用法: wf-agent-run.sh <cap> <host> <profile> <serial> <biz> --tag TAG --run-id RUN --task-id TASK
# 日志行（wf-status.sh 读）: WF_RUN_STARTED / preflight ok|fail / agent running / cleanup lock_status=… / WF_RUN_RESULT {json} / WF_RUN_FINISHED
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
LIB="${WF_AGENT_LIB:-$HERE/wf-agent-lib.py}"
HANDOFF="$HERE/wf-agent-handoff.py"
PARENT_SESSION="${WF_PARENT_SESSION_KEY:-}"
CONTRACTS="${WF_CONTRACTS_JSON:-$HERE/workflow-contracts.json}"
OPENCLAW="${OPENCLAW:-openclaw}"
PY="${WF_PYTHON:-python3}"
BRAIN_URL="${WF_BRAIN_URL:-http://localhost:5221}"
AGENT="${WF_AGENT:-skill-factory}"
AGENT_TIMEOUT_S="${WF_AGENT_TIMEOUT_S:-2700}"
POLL_S="${WF_AGENT_POLL_S:-15}"
REFRESH_S="${WF_LOCK_REFRESH_S:-600}"
SSH_OPTS=(-o ConnectTimeout=20 -o BatchMode=yes)

die(){ echo "wf-agent-run: $2" >&2; exit "$1"; }
[[ $# -ge 5 ]] || die 2 "用法: wf-agent-run.sh <cap> <host> <profile> <serial> <biz> --tag TAG --run-id RUN --task-id TASK"
CAP="$1"; HOST="$2"; PROFILE="$3"; SERIAL="$4"; BIZ="$5"; shift 5
TAG=""; RUN_ID=""; TASK_ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG="${2:-}"; shift 2 ;;
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --task-id) TASK_ID="${2:-}"; shift 2 ;;
    --parent-session) PARENT_SESSION="${2:-}"; shift 2 ;;
    *) die 2 "未知参数: $1" ;;
  esac
done
[[ "$CAP" =~ ^[a-z0-9_]+$ && "$HOST" =~ ^xian-m[14]$ && "$PROFILE" =~ ^[A-Za-z0-9_.-]+$ && "$SERIAL" =~ ^[A-Za-z0-9]+$ ]] || die 2 "参数非法"
[[ "$TAG" =~ ^[a-z]+[0-9]+$ && "$RUN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$ && "$TASK_ID" =~ ^[0-9a-f-]{36}$ ]] || die 2 "--tag/--run-id/--task-id 缺或非法"

RUN_DIR="$HOME/wf-agent-runs/$RUN_ID"
HOST_EVIDENCE_ROOT="/private/tmp/openclaw-phone/evidence/$PROFILE"
[[ "$PARENT_SESSION" == agent:work-commander:* ]] || die 2 "须带 Commander 父会话 --parent-session"
[[ ! -e "$RUN_DIR/state.env" ]] || die 3 "run 已存在，不得重启"
mkdir -p "$RUN_DIR/evidence" || die 5 "建不了 $RUN_DIR"
STATE="$RUN_DIR/state.env"
: > "$STATE"
ts(){ TZ=Asia/Shanghai date '+%H:%M:%S'; }
log(){ echo "[$(ts)] [$TAG] $*"; }
# state.env 一行一个 KEY=VALUE（值压成单行），assemble 读；后写覆盖前写
st(){ printf '%s=%s\n' "$1" "$(printf '%s' "$2" | tr '\n\r' '  ' | head -c 400)" >> "$STATE"; }
last(){ sed -n "s/^$1=//p" "$STATE" | tail -n 1; }
ctl(){ ssh "${SSH_OPTS[@]}" "$HOST" "export PATH=\$HOME/.local/bin:\$PATH; douyin-phone-adb --profile $PROFILE $*"; }

for kv in "RUN_ID=$RUN_ID" "TAG=$TAG" "TASK_ID=$TASK_ID" "SERIAL=$SERIAL" "AGENT=$AGENT" "PARENT_SESSION_KEY=$PARENT_SESSION" "HOST_EVIDENCE_ROOT=$HOST_EVIDENCE_ROOT"; do
  st "${kv%%=*}" "${kv#*=}"
done
"$PY" "$LIB" contract "$CONTRACTS" "$CAP" "$RUN_DIR/contract.json" || die 4 "Commander 合同清单里没有 $CAP"
echo "WF_RUN_STARTED tag=$TAG run_id=$RUN_ID cap=$CAP host=$HOST serial=$SERIAL"

LOCK_MINE=0; FINISHED=0
lock_owner_now(){
  local s; s="$(ctl lock-status 2>&1)"
  case "$s" in lock=free*) echo free ;; *owner=*) s="${s#*owner=}"; echo "held:${s%% *}" ;; *) echo unknown ;; esac
}

# 所有控制器动作仍持精确 owner；复制原件不经压缩或重绘，回执保留 stdout/stderr。
cleanup_desktop_evidence(){
  local eid="$RUN_ID-cleanup-desktop-original" ext
  ctl --lock-owner "$RUN_ID" return-safe-desktop > "$RUN_DIR/cleanup-desktop.log" 2>&1 || return 1
  ctl --lock-owner "$RUN_ID" snapshot-evidence "$eid" > "$RUN_DIR/cleanup-screenshot.log" 2>&1 || return 1
  ctl --lock-owner "$RUN_ID" ui-evidence "$eid" > "$RUN_DIR/cleanup-ui.log" 2>&1 || return 1
  for ext in png xml; do
    ssh "${SSH_OPTS[@]}" "$HOST" "cat $HOST_EVIDENCE_ROOT/$eid.$ext" > "$RUN_DIR/evidence/$eid.$ext" 2>> "$RUN_DIR/cleanup-copy.log" || return 1
  done
  st DESKTOP_CAPTURED 1
}

cleanup(){
  (( FINISHED )) && return 0
  FINISHED=1
  trap '' TERM INT HUP
  local child_stopped=1
  if [[ -f "$RUN_DIR/agent-request.json" ]]; then
    "$PY" "$HANDOFF" stop "$RUN_DIR" >> "$RUN_DIR/child-stop.log" 2>&1 || child_stopped=0
  fi
  if (( ! child_stopped )); then
    st CHILD_STOP_FAILED 1; log "cleanup: 子run终止未确认，保留本run锁，不关App不释放"
  fi
  local now summary
  now="$(lock_owner_now)"
  if [[ "$now" == "held:$RUN_ID" ]] && (( child_stopped )); then
    if ctl --lock-owner "$RUN_ID" close-app > "$RUN_DIR/cleanup-close-app.log" 2>&1; then
      st APP_CLOSED 1
      cleanup_desktop_evidence || log "cleanup: 桌面原证据采集失败，交付不得宣称收尾完整"
    else st APP_CLOSED 0; log "cleanup: close-app 失败"; fi
    ctl lock-release "$RUN_ID" >/dev/null 2>&1 || log "cleanup: lock-release 返回非 0"
  elif (( LOCK_MINE )); then
    st APP_CLOSED 0; log "cleanup: 锁已不在本 run 名下（${now}），不关 App 不放锁"
  fi
  now="$(lock_owner_now)"; st LOCK_STATUS "${now%%:*}"
  [[ "$now" == free ]] || st LOCK_HOLDER "$now"
  log "cleanup lock_status=$now"
  ctl outward-ledger "$RUN_ID" > "$RUN_DIR/outward.json" 2>/dev/null || true
  ssh "${SSH_OPTS[@]}" "$HOST" "ls -1 $HOST_EVIDENCE_ROOT/ 2>/dev/null | grep -F -- '$RUN_ID' || true" > "$RUN_DIR/host-files.txt" 2>/dev/null || true
  summary="$("$PY" "$LIB" assemble "$RUN_DIR" 2>&1 | tail -n 1)"
  echo "WF_RUN_RESULT $summary"
  echo "WF_RUN_FINISHED tag=$TAG run_id=$RUN_ID delivery=$RUN_DIR/delivery.json"
}
trap cleanup EXIT
trap 'st INTERRUPTED signal; exit 143' TERM INT HUP

# ── 共享外壳-准备 ─────────────────────────────────────────────────────────────
preflight(){
  local out now acq acc nick
  out="$(ctl preflight 2>&1)"
  if [[ "$out" != *"serial=$SERIAL"* || "$out" != *"state=device"* ]]; then
    st PRE_REASON "phone_unavailable: $(echo "$out" | tail -n 2)"; return 1
  fi
  st PHONE_STATE device
  now="$(lock_owner_now)"; st LOCK_PRE "$now"
  case "$now" in
    free)
      acq="$(ctl lock-acquire "$RUN_ID" 2>&1)"
      [[ "$acq" == *"lock=acquired owner=$RUN_ID"* ]] || { st PRE_REASON "lock_acquire_failed: $(echo "$acq" | tail -n 1)"; return 1; }
      [[ "$(lock_owner_now)" == "held:$RUN_ID" ]] || { st PRE_REASON "lock_readback_mismatch"; return 1; } ;;
    "held:$RUN_ID") ;;
    *) st PRE_REASON "lock_busy: ${now}（不抢别的 run 的锁）"; return 1 ;;
  esac
  LOCK_MINE=1; st LOCK_MINE 1
  ctl --lock-owner "$RUN_ID" open-app >/dev/null 2>&1 || true
  acc="$(ctl --lock-owner "$RUN_ID" account-current "$RUN_ID-preflight-account" 2>&1)"
  nick="$(echo "$acc" | sed -n 's/^nickname=//p' | head -n 1)"
  if [[ -n "$nick" && "$nick" == "$BIZ" ]]; then
    st ACCOUNT_VERIFIED true; st ACCOUNT_NICK "$nick"
  elif [[ -n "$nick" ]]; then
    st ACCOUNT_NICK "$nick"; st PRE_REASON "account_mismatch: nickname=$nick expected=${BIZ}（不切号）"; return 1
  else
    # 读不到（如启动弹层挡住「我」页）不等于不对：控制器在 --lock-owner 下拒绝盲导航，交业务块按 skill 核号并如实标注
    st ACCOUNT_VERIFIED false; st ACCOUNT_NOTE "unreadable: $(echo "$acc" | tail -n 1)"
  fi
  return 0
}
if preflight; then
  st PRE_OK 1; log "preflight ok lock=$RUN_ID account_verified=$(last ACCOUNT_VERIFIED)"
else
  st PRE_OK 0; log "preflight fail: $(last PRE_REASON)"
  exit 0
fi

# ── 业务块 ───────────────────────────────────────────────────────────────────
curl -s -m 20 "$BRAIN_URL/api/brain/tasks/$TASK_ID" > "$RUN_DIR/task.json" 2>/dev/null
if ! BRIEF="$("$PY" "$LIB" brief "$RUN_DIR/task.json")"; then
  st AGENT_EXIT brief_unavailable; log "读不到 Brain 任务正文，业务块不起跑"; exit 0
fi
ACC_LINE="外壳已读到账号昵称「${BIZ}」并核对一致"
[[ "$(last ACCOUNT_VERIFIED)" == true ]] || ACC_LINE="外壳未能读到账号（$(last ACCOUNT_NOTE)），你必须按 skill 自行核对本人账号，不符即 blocked"
AGENT_ACTS="$("$PY" -c 'import json,sys; print(" → ".join(a["key"] for a in json.load(open(sys.argv[1]))["activities"] if a["by"]=="agent"))' "$RUN_DIR/contract.json")"
WF_KEY="$("$PY" -c 'import json,sys; print(json.load(open(sys.argv[1])).get("brain_workflow_key",""))' "$RUN_DIR/contract.json")"
{
  echo "【Commander 派发 · codex_agent 业务块】Brain 任务 ${TASK_ID}（workflow_dispatch 单，状态由 Brain 收割；不要 PATCH 这张任务）"
  echo "run_id：${RUN_ID}（全程 --lock-owner ${RUN_ID}）"
  echo "workflow：${WF_KEY}｜能力：${CAP}｜你负责的活动：${AGENT_ACTS}（准备 preflight 与收尾 cleanup 由外壳负责）"
  echo "设备：host=$HOST profile=$PROFILE serial=$SERIAL"
  echo ""
  echo "外壳准备结果：手机在线；手机控制器锁已由外壳领到 owner=${RUN_ID}——不要 lock-acquire / lock-release，收尾由外壳关抖音、放锁、回读 free；${ACC_LINE}。"
  echo "活动读回：每个活动做成后立刻留一份读回证据 \`douyin-phone-adb --profile $PROFILE --lock-owner $RUN_ID ui-evidence $RUN_ID-<活动>-original\`（活动=$AGENT_ACTS 之一）；没做成的活动不要留这个名字。"
  echo "交付：结束时最后一行只输出一行（单行 JSON，别加代码块）："
  echo 'WF_DELIVERY {"claimed_result":"success|failed|blocked","fail_reason":null,"side_effects":[],"readback":{"private_before":0,"private_after":0,"visibility":"","first_title":"","first_date":""},"acceptance":"","final_evidence":["证据ID"],"evidence_locations":{},"activities":{"prepare":{"evidence_ids":[]},"publish":{"evidence_ids":[]},"verify":{"evidence_ids":[]}}}'
  echo "对外动作次数、锁状态由外壳从系统账读回，不要编；读不到就写读不到。"
  echo ""
  echo "--- 以下为 Brain 任务正文（照【执行参数】执行；与上面锁/交付规矩冲突处以上面为准）---"
  echo "$BRIEF"
} > "$RUN_DIR/msg.txt"

# 正式子会话由 Commander 的 sessions_spawn 启动；外壳不能以 CLI 消息丢失父归属。
WAIT_S=$(( AGENT_TIMEOUT_S + ${WF_AGENT_GRACE_S:-120} ))
"$PY" "$HANDOFF" init "$RUN_DIR" "$PARENT_SESSION" "$WAIT_S" >/dev/null || { st AGENT_EXIT handoff_init_failed; exit 1; }
echo "WF_AGENT_READY run_id=$RUN_ID request=$RUN_DIR/agent-request.json message=$RUN_DIR/msg.txt"
START=$(date +%s); LAST_REFRESH=$START
while true; do
  EXIT_CODE="$("$PY" "$HANDOFF" status "$RUN_DIR")"; HANDOFF_STATUS=$?
  if (( HANDOFF_STATUS == 0 )); then st AGENT_EXIT "$EXIT_CODE"; break; fi
  if (( HANDOFF_STATUS == 4 )); then st AGENT_EXIT timeout; log "业务交接超时，取消精确子run后收尾"; break; fi
  if (( HANDOFF_STATUS != 3 )); then st AGENT_EXIT handoff_invalid; break; fi
  sleep "$POLL_S"
  NOW=$(date +%s)
  if (( NOW - LAST_REFRESH >= REFRESH_S )); then
    if ctl lock-refresh "$RUN_ID" >/dev/null 2>&1; then log "lock-refresh ok"; else log "lock-refresh 失败"; fi
    LAST_REFRESH=$NOW
  fi
  log "awaiting attributed child $(( NOW - START ))s"
done
log "agent handoff done exit=$(last AGENT_EXIT)"
exit 0
