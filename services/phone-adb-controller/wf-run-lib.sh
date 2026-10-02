#!/bin/zsh
# wf-run 原函数块，保持库模式与执行模式使用相同实现。
# wf_parse_args ARGS... —— 位置参数 <能力> <profile> <serial> <biz> [n] [push],选项可出现在任意位置
wf_parse_args(){
  local -a pos
  WF_SOURCES=""; WF_COMMANDER=""; WF_TAG=""; WF_ALLOW_MISSING=${WF_ALLOW_MISSING:-0}
  while (( $# )); do
    case "$1" in
      --sources) WF_SOURCES="${2:-}"; shift; (( $# )) && shift;;
      --tag) WF_TAG="${2:-}"; shift; (( $# )) && shift;;
      --commander) WF_COMMANDER="${2:-}"; shift; (( $# )) && shift;;
      --allow-missing) WF_ALLOW_MISSING=1; shift;;
      *) pos+=("$1"); shift;;
    esac
  done
  WF_ARG_CAP="${pos[1]:-}"; P="${pos[2]:-}"; SERIAL="${pos[3]:-}"
  BIZ="${pos[4]:-AI人工智能训练师}"; N="${pos[5]:-6}"; PUSH="${pos[6]:-1}"
}
# wf_load_plan CAP —— source 执行计划;rc=1 计划缺失/残缺,rc=2 有未实现步骤且未 --allow-missing。原因放 WF_LOAD_ERR
wf_load_plan(){
  local f="$WF_PLAN_DIR/$1.plan"
  WF_LOAD_ERR=""; WF_STAGES=""; WF_SOURCE_KIND=""; WF_DISCOVER_CMD=""; WF_MISSING=""
  [[ -n "$1" && -r "$f" ]] || { WF_LOAD_ERR="无执行计划 $f(契约未生成计划或 plans/ 未部署)"; return 1; }
  source "$f" || { WF_LOAD_ERR="执行计划 $f 读取失败"; return 1; }
  [[ -n "$WF_STAGES" && -n "$WF_SOURCE_KIND" && -n "$WF_DISCOVER_CMD" ]] || { WF_LOAD_ERR="执行计划 $f 缺 WF_STAGES/WF_SOURCE_KIND/WF_DISCOVER_CMD"; return 1; }
  export WF_SOURCE_KIND   # harvest-keyword.sh 按它选逐视频归位方式(benchmark = back-to-profile)
  # 7d150e33: 计划里的每活动预算 WF_BUDGET_<key> / 超时分类 WF_TIMEOUT_CLASS_<key> 要给 batch2/harvest-keyword 子进程看到
  local k
  for k in ${(k)parameters}; do [[ "$k" == WF_BUDGET_* || "$k" == WF_TIMEOUT_CLASS_* ]] && export "$k"; done
  if [[ -n "$WF_MISSING" && "${WF_ALLOW_MISSING:-0}" != "1" ]]; then
    WF_LOAD_ERR="拒跑: $1 有步骤未实现(无实现不得跑,真机调试加 --allow-missing): $WF_MISSING"; return 2
  fi
}
# wf_discover_cmd —— 计划里的发现入口(脚本名)解析为本目录下的绝对路径
wf_discover_cmd(){ print -r -- "$WF_HOME/$WF_DISCOVER_CMD"; }
# wf_read_sources SRC OUT —— 对标源清单: 去空行/注释/首尾空白,每行一个对标主页链接或 sec_uid;缺文件或读完为空 rc=1
wf_read_sources(){
  [[ -n "$1" && -r "$1" ]] || return 1
  grep -vE '^[[:space:]]*(#|$)' "$1" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' > "$2"
  [[ -s "$2" ]]
}
wfr_on(){ [[ "${WFR_DISABLED:-0}" != "1" && -x "$WFR" ]] }
finalize_needed(){ wfr_on && [[ -n "${WFR_RUN_ID:-}" ]] }   # 只有 wfr init 跑过(导出了 WFR_RUN_ID)才需要收工记账
# wfr_bootstrap: TAG P WF PUSH SERIAL HOSTKEY —— init 后立刻 export 再 enter,子进程(bash "$WFR" / zsh "$BATCH2")
#   才看得到账本位置。终审 C1: init→enter 之间不 export,enter 子进程走 not_initialized 分支,账本 attempt_id 永远 null。
wfr_bootstrap(){
  wfr_on || return 0
  eval "$(bash "$WFR" init "$1" "$2" "$3" "$4" "$5" "$6" 2>>${LOG:-/dev/null})" 2>/dev/null || true
  export WFR_RUN_ID WFR_HASH WFR_RUN_DIR WFR_ART_DIR WFR_TAG WFR_PROFILE   # WFR_TAG/WFR_PROFILE: 棒3b 探针读回的 --run-tag/--line-key
  if [[ -z "${WFR_ATTEMPT:-}" ]]; then
    eval "$(bash "$WFR" enter 2>>${LOG:-/dev/null})" 2>/dev/null || true
  fi
  export WFR_ATTEMPT WFR_SKIP_WORDS
}
# escort_alive ESCORT_ID —— 30s 复核只按 id 精确判(决策 711ca6cf,判定点 4f85a74d)。
#   0927 两批假阳性根因: `openclaw cron list` 表格 Name 列定宽截断, escort-xian-m4-auto09270600 显示为
#   escort-xian-m4-auto09..., 按名字 grep -F 全名永不命中 → 每批误升级分身而 escort 明明活着。
#   优先 `cron list --json` 取 .jobs[].id(jq 缺则 grep 精确键值); --json 不可用或回非 JSON → 退回表格首列 awk 精确匹配。
#   永远不碰 name 列。
escort_alive(){
  local id="$1" out rc
  [[ -n "$id" ]] || return 1
  if out=$(ssh -o ConnectTimeout=20 mmv "openclaw cron list --json" 2>>${LOG:-/dev/null}) && [[ -n "$out" ]]; then
    if command -v jq >/dev/null 2>&1; then
      jq -e --arg id "$id" '[.jobs[]? | select(.id==$id)] | length > 0' <<< "$out" >/dev/null 2>&1; rc=$?
      (( rc == 0 )) && return 0
      (( rc == 1 )) && return 1          # 合法 JSON 但没这个 id = 真未命中
    elif grep -qE "\"id\":[[:space:]]*\"$id\"" <<< "$out"; then
      return 0
    fi
    # jq 解析失败(网关回了非 JSON)或无 jq 且 grep 未命中 → 不信这份输出,退回表格
  fi
  out=$(ssh -o ConnectTimeout=20 mmv "openclaw cron list" 2>>${LOG:-/dev/null}) || true
  [[ -n "$(awk -v id="$id" '$1==id' <<< "$out")" ]]
}
# ── escort 在途保护(任务 1ebaeb00,决策 3c98fb36 阶段1·稳 / fd2a22f4) ──
# 0930 02:54 实证: escort d417a34c 是被 escort 自己在 run 在途时 `openclaw cron rm` 删掉的(它读到 MMV 上 0918 起就死掉的
#   日志桥文件,判"日志停滞"后把自己当"已收工"注销),run 随后死循环 5 小时无人陪跑;audit_events 0916 起 58 次同形。
#   这里三件事: ①注销只删"id 在表且 name 全等 escort-$HOSTKEY-$TAG"的 cron ②看门狗每 ESCORT_WATCH_INTERVAL 秒复核,
#   在途被移除立即同名同会话重拉(跨轮记忆不断) ③重拉后的新 id 落 ESCORT_ID_FILE,注销跟着用新 id。
# escort_add —— 单次 cron add(拉起与看门狗重拉共用),stdout 新 id;失败回空。起跑时间用 ESCORT_START_HM(重拉不改起跑)。
escort_add(){
  ssh -o ConnectTimeout=20 mmv "openclaw cron add --timeout 90000 --name 'escort-$HOSTKEY-$TAG' --agent media --session 'session:escort-$HOSTKEY-$TAG' --every 10m --announce --channel feishu --to 'chat:oc_ef60d6e3f199d90dd695b6ecc213d662' --account main --best-effort-deliver --message '先读 /Users/administrator/.openclaw/cmdr-escort.txt 作为你的SOP并严格遵守辅佐三原则。本轮上下文: TAG=$TAG 机器=$HOSTKEY serial=$SERIAL profile=$P 起跑=${ESCORT_START_HM:-$(date +%H:%M)} 日志=/Users/administrator/.openclaw/m4-logs/${HOSTKEY}-live.log escort名=escort-$HOSTKEY-$TAG。注意:你上岗时本批尚未做设备preflight与取词单,这两步失败会升级给分身,你看到日志里没有词单行属正常早期阶段。'" 2>>${LOG:-/dev/null} | grep -oE '"id": "[a-f0-9-]+"' | head -1 | cut -d'"' -f4
}
# escort_current_id —— 当前 escort id: 看门狗重拉后写在 ESCORT_ID_FILE 的新 id 优先,否则 ESCORT_ID
escort_current_id(){
  if [[ -n "${ESCORT_ID_FILE:-}" && -s "$ESCORT_ID_FILE" ]]; then head -1 "$ESCORT_ID_FILE" | tr -d '[:space:]'
  else print -rn -- "${ESCORT_ID:-}"; fi
}
# escort_owned ID WANT_NAME —— 这个 id 是不是本 run 的 escort。stdout: match / absent / mismatch:<name> / unknown(网关读不到)。
#   优先 cron list --json 按 id 取 name 全等比;--json 不可用退回表格: 首列 id 命中 + Name 列去掉截断的 ... 后是期望名前缀。
escort_owned(){
  local id="$1" want="$2" out name rc
  [[ -n "$id" ]] || { print absent; return 0; }
  if out=$(ssh -o ConnectTimeout=20 mmv "openclaw cron list --json" 2>>${LOG:-/dev/null}) && [[ -n "$out" ]] && command -v jq >/dev/null 2>&1; then
    name=$(jq -r --arg id "$id" '[.jobs[]? | select(.id==$id)][0].name // "__absent__"' <<< "$out" 2>/dev/null); rc=$?
    if (( rc == 0 )) && [[ -n "$name" ]]; then
      case "$name" in
        __absent__) print absent;;
        "$want") print match;;
        *) print "mismatch:$name";;
      esac
      return 0
    fi
  fi
  out=$(ssh -o ConnectTimeout=20 mmv "openclaw cron list" 2>>${LOG:-/dev/null}) || { print unknown; return 0; }
  [[ -n "$out" ]] || { print unknown; return 0; }
  name=$(awk -v id="$id" '$1==id {print $3; exit}' <<< "$out"); name="${name%...}"
  if [[ -z "$name" ]]; then print absent
  elif [[ "$want" == "$name"* ]]; then print match
  else print "mismatch:$name"; fi
}
# escort_dismiss —— 只注销本 run 登记的 escort: escort_owned 判 match 才 cron rm;不在表/别人的/读不到 → 只记日志不删。
escort_dismiss(){
  local id want="escort-$HOSTKEY-$TAG" verdict
  id=$(escort_current_id)
  [[ -n "$id" ]] || return 0
  verdict=$(escort_owned "$id" "$want")
  case "$verdict" in
    match)   ssh -o ConnectTimeout=20 mmv "openclaw cron rm $id" >>${LOG:-/dev/null} 2>&1 && log "escort已注销";;
    absent)  log "escort注销跳过: id=$id 已不在 cron 表(在途被移除/已被别处注销)";;
    unknown) log "escort注销跳过: id=$id cron list 不可达,不盲删";;
    *)       log "escort注销拒绝: id=$id name=${verdict#mismatch:} 非本run(期望 $want),不删";;
  esac
  [[ -n "${ESCORT_ID_FILE:-}" ]] && rm -f "$ESCORT_ID_FILE"
  true
}
# escort_watch_tick —— 看门狗一轮: 当前 id 判 absent(网关可读且真不在表)才重拉;unknown 不动(防 list 抖动拉出两个陪跑)。
escort_watch_tick(){
  local cur new verdict want="escort-$HOSTKEY-$TAG"
  cur=$(escort_current_id)
  [[ -n "$cur" ]] || return 0
  verdict=$(escort_owned "$cur" "$want")
  [[ "$verdict" == absent ]] || return 0
  new=$(escort_add)
  if [[ -n "$new" ]]; then
    print -r -- "$new" > "$ESCORT_ID_FILE"
    log "escort在途被移除(id=$cur),已重拉: 新id=$new"
    escalate "escort(id=$cur)在 run 在途被移除,已同名重拉 新id=$new;移除者查 mmv gateway.log 的 cron.remove"
  else
    log "escort在途被移除(id=$cur),重拉失败,下一轮再试"
  fi
}
ESCORT_WATCH_PID=""
escort_watch_start(){
  local iv="${ESCORT_WATCH_INTERVAL:-300}" parent=$$
  [[ -n "${ESCORT_ID:-}" && -n "${ESCORT_ID_FILE:-}" ]] || return 0
  escort_watch_stop
  print -r -- "$ESCORT_ID" > "$ESCORT_ID_FILE"
  ( while kill -0 $parent 2>/dev/null; do
      /bin/sleep $iv
      kill -0 $parent 2>/dev/null || break
      escort_watch_tick
    done ) </dev/null >/dev/null 2>&1 &
  ESCORT_WATCH_PID=$!
}
escort_watch_stop(){
  if [[ -n "$ESCORT_WATCH_PID" ]]; then
    pkill -P "$ESCORT_WATCH_PID" 2>/dev/null
    kill "$ESCORT_WATCH_PID" 2>/dev/null
    wait "$ESCORT_WATCH_PID" 2>/dev/null
  fi
  ESCORT_WATCH_PID=""
  true
}
# device_call_busy MCALLSTATE —— 0929修复(DoD审计发现): 契约"验通话空闲"是死代码,
# douyin-phone-adb的preflight子命令里有真实call_state检测(telephony.registry的
# mCallState),但从建成起就没有调用链路碰过它,harvest-cron.sh自己的preflight只查
# 在线+唤醒,从不查通话状态。mCallState: 0=idle 1=ringing 2=offhook,1/2都算占线。
device_call_busy(){ [[ "$1" == 1 || "$1" == 2 ]]; }
# account_registered PROFILE DOUYIN_ID REGISTRY_FILE —— 0929批次4修复(DoD审计发现的死代码):
# 契约"读账号标记(我页)"同样从建成起没有调用链路——douyin-phone-adb的account-current子命令
# (真读"我"页"抖音号："文本,多版本兼容,底部导航没长齐会自动重试)存在,但没人调它,登错号/
# 串号全程无人发现,线索会被静默贴上错误账号的标签。REGISTRY_FILE不可读时fail-open(这是
# "确认账号对不对"的辅助闸,不是账号系统本身,登记表本身挂了不该拦住整批采收)。
account_registered(){
  local profile="$1" id="$2" registry="$3"
  [[ -r "$registry" ]] || return 0
  awk -F'\t' -v p="$profile" -v id="$id" '$1==p && $2==id {found=1} END{exit !found}' "$registry"
}
# lease_heartbeat_start SERIAL / lease_heartbeat_stop —— 0929 修复: 采收主体(batch2)一跑 1~7 小时,
#   服务端租约 10 分钟只靠逐词/逐视频的零星上报续命,间隔一超 10 分钟就被 sweep 判 failed/executor_lost,
#   事后 done 也翻不回来(页面/Brain 上一片"失败",实际批完成 7~42 LEAD)。这里起后台循环每 LEASE_HB_INTERVAL 秒
#   (默认 300,租约的一半)调 wall-report heartbeat 纯续租。父进程没了(kill -9 没走 trap)循环自停——
#   绝不替已死的采收永久续租,那样 sweep 永远判不出真失联。
LEASE_HB_PID=""
lease_heartbeat_start(){
  local serial="$1" iv="${LEASE_HB_INTERVAL:-300}" parent=$$ hbwr="${WR:-${WALL_REPORT:-$HOME/bin-harvest/wall-report.sh}}"
  [[ -n "$serial" && -x "$hbwr" ]] || return 0
  lease_heartbeat_stop
  ( while kill -0 $parent 2>/dev/null; do
      /bin/sleep $iv
      kill -0 $parent 2>/dev/null || break
      "$hbwr" heartbeat "$serial" >/dev/null 2>&1
    done ) </dev/null >/dev/null 2>&1 &
  LEASE_HB_PID=$!
}
lease_heartbeat_stop(){
  if [[ -n "$LEASE_HB_PID" ]]; then
    pkill -P "$LEASE_HB_PID" 2>/dev/null   # 先收掉在睡的 sleep 子进程,免得留 5 分钟孤儿
    kill "$LEASE_HB_PID" 2>/dev/null
    wait "$LEASE_HB_PID" 2>/dev/null
  fi
  LEASE_HB_PID=""
  true
}
# ── 6b133a81 预检/归位真读 + 活动后置条件运行时拦截 ──
# preflight_lock_acquire: 以本批 TAG 拿设备锁(契约 preflight.acquire_device_lock),拿到 LOCK_ACQUIRED=1;
#   被占(触达 tick 在发,单 tick 预算 25 分钟)重试 PF_LOCK_TRIES=10 次(间隔 PF_LOCK_WAIT=60 秒)仍拿不到 → 0(pf_lock_acquired 不过 → stop_run 不开采)。
#   逐词 harvest-keyword.sh 以 TAG-wN 申请同一把锁,douyin-phone-adb same_run_lock 前缀判同 run → 幂等续用。
#   7d150e33: 预检段按契约 preflight 预算(WF_BUDGET_preflight,现值 300s)封顶——再等一轮会超预算就不等了(lock_busy 在契约里本就是 retryable,预算只给重试上限)
preflight_lock_acquire(){
  local i tries="${PF_LOCK_TRIES:-10}" wait="${PF_LOCK_WAIT:-60}" t0=$(date +%s) budget
  budget=$(wf_budget_of preflight)
  LOCK_ACQUIRED=0
  for (( i = 1; i <= tries; i++ )); do
    if "$C" --profile "$P" lock-acquire "$TAG" </dev/null >/dev/null 2>>${LOG:-/dev/null}; then LOCK_ACQUIRED=1; break; fi
    (( i < tries )) || break
    if (( budget > 0 && $(date +%s) - t0 + wait > budget )); then
      (( $+functions[log] )) && log "预检拿锁: 再等 ${wait}s 会超预检预算(${budget}s),不再重试(第${i}次)"
      break
    fi
    /bin/sleep "$wait"
  done
  export LOCK_ACQUIRED
}
# release_run_lock: 收工放本批锁,再用 lock-status 真读(契约 cleanup.release_lock):free 或已被别的 run 持有 → WFR_LOCK_RELEASED=1;
#   仍是本 run(TAG / TAG-wN)或读不到 → 0(cl_lock_released 不过 → 告警)。不依赖账本开关,早退路径也放锁。
release_run_lock(){
  local st owner
  WFR_LOCK_RELEASED=0
  if [[ -n "${C:-}" && -n "${TAG:-}" ]]; then
    "$C" --profile "$P" lock-release "$TAG" </dev/null >/dev/null 2>&1
    st=$("$C" --profile "$P" lock-status </dev/null 2>/dev/null)
    if [[ "$st" == *lock=free* ]]; then WFR_LOCK_RELEASED=1
    elif [[ "$st" == *owner=* ]]; then
      owner="${${st#*owner=}%% *}"
      [[ -n "$owner" && "$owner" != "$TAG" && "$owner" != "$TAG"-* ]] && WFR_LOCK_RELEASED=1
    fi
  fi
  export WFR_LOCK_RELEASED
}
# gate_bark 标题 正文: 经 mmv 上的 notify-bark.js 发 Bark(同 outreach-tick.sh notify),失败吞掉
gate_bark(){
  local tb bb
  tb=$(print -rn -- "$1" | base64 | tr -d '\n'); bb=$(print -rn -- "$2" | base64 | tr -d '\n')
  ssh -o ConnectTimeout=15 -o BatchMode=yes mmv "node /Users/administrator/.openclaw/leadgen-scripts/notify-bark.js $tb $bb timeSensitive" </dev/null >/dev/null 2>&1
  true
}
# gate_check 阶段名: 读账本拦截状态(workflow-result.sh gate)。needs_human/fatal 探针不过的新告警 → 升级分身 + Bark(每条只报一次);
#   返回 0 = 已被 stop_run 拦截(调用方停后续活动,收工照做),1 = 没停
gate_check(){
  wfr_on && [[ -n "${WFR_RUN_ID:-}" ]] || return 1
  eval "$(bash "$WFR" gate 2>>${LOG:-/dev/null})" 2>/dev/null || return 1
  if [[ "${WFR_GATE_ALERT:-0}" == 1 ]]; then
    (( $+functions[escalate] )) && escalate "活动后置条件不过($1): ${WFR_GATE_ALERT_MSG:-}"
    gate_bark "获客采收被拦截" "${HOSTKEY:-} ${TAG:-} $1: ${WFR_GATE_ALERT_MSG:-}"
  fi
  [[ "${WFR_GATE_STOP:-0}" == 1 ]]
}

# 固定原始TAG与本机执行根，普通续跑和首次prepare共用。
wf_exec_frozen(){
  export WF_FROZEN_ROOT="$WFR_RUN_DIR/runtime" WF_PLAN_DIR="$WFR_RUN_DIR"
  export WFR="$WF_FROZEN_ROOT/workflow-result.sh" BATCH2="$WF_FROZEN_ROOT/batch2.sh"
  export HARVEST_KEYWORD="$WF_FROZEN_ROOT/harvest-keyword.sh" C="$WF_FROZEN_ROOT/douyin-phone-adb"
  export DOUYIN_LOCATE_SCRIPT="$WF_FROZEN_ROOT/locate-element.py"
  export DOUYIN_PHONE_ADB="$C" WALL_REPORT="$WF_FROZEN_ROOT/wall-report.sh"
  export WFR_LEDGER_MJS="$WF_FROZEN_ROOT/ledger.mjs" WFR_STEP_JUDGE="$WF_FROZEN_ROOT/step-judge.mjs"
  export WFR_RUNTIME_MJS="$WF_FROZEN_ROOT/runtime-receipts.mjs"
  exec zsh "$WF_FROZEN_ROOT/wf-run.sh" "$@" --tag "$TAG"
}
