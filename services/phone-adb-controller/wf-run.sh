#!/bin/zsh
# wf-run.sh <能力> <profile> <serial> <biz> [n] [push] [--sources <文件>] [--commander <escort cron id>] [--tag <TAG>] [--allow-missing]
# 契约组装执行的通用驱动(决策 7f842d12: Commander 当入口 + 契约组装执行)。由 harvest-cron.sh 泛化而来——
#   harvest-cron.sh 现在是薄壳 `exec wf-run.sh keyword_acquisition "$@"`(现网 crontab 一字不改)。
# 执行计划: ~/bin-harvest/plans/<能力>.plan(scripts/product-map/wf-plan.mjs 从契约生成、deploy.sh 同步),
#   给出 WF_STAGES(控制塔阶段串)/WF_SOURCE_KIND(keyword|benchmark)/WF_DISCOVER_CMD(发现实现)/WF_MISSING(未实现步骤)。
#   计划缺失 / 有未实现步骤(除非 --allow-missing) → 拒跑(无实现不得跑),拒跑发生在拉 escort 之前。
# 取源: keyword → KPI 闸 + next-keywords 词单(原样);benchmark → 读 --sources 文件(每行一个对标主页链接或 sec_uid),
#   KPI 达标仍退让但不按缺口放大。发现实现经 env DISCOVER_CMD 传给 batch2 → harvest-keyword。
# --commander <escort cron id> = 由 Commander 启动器(wf-launch.sh)发起、escort 已登记:跳过自拉,但把它当 ESCORT_ID
#   (按 id 复核、退出 trap 注销);没给 = 旧行为自拉 escort。--tag 覆盖默认 TAG(autoMMDDHHMM)。
# 起跑(计划通过后)向 stdout 打一行 `WF_RUN_STARTED tag=<TAG> cap=<能力> serial=<serial>` 供启动器确认。
# 全自动: Commander上岗 → 设备preflight → 取源 → batch2 采收 → 落池 → 效果回写
# 0916 改序(主理人拍板): Commander是第一步不是第三步——它必须看着 preflight 与取词单,
#   因为 0915 凌晨三批正是死在这两步、静默 exit、全线 6 小时无人知晓。
# 失败不静默(同上): 任何非正常退出都先 escalate 再退,报警走 MMV 本机文件(网关死了照样能写)。
# 0927 棒3b-3(决策 2ca30c4d): 账本钩子内建(原 harvest-cron-v4.sh 副本已废——与现网分叉、影子跑拿不到设备、
#   孤儿清理误杀在跑生产批 escort)。WFR_DISABLED=1 / workflow-result.sh 缺失或不可执行 → 钩子全部 no-op。
#   孤儿 escort 清理**不并入**: openclaw cron list 只有名字,分不清"上批 kill -9 遗留"与"同机另一批仍在跑"
#   (三批衔接无空窗),kill -9 遗留由 escort 自身 --timeout 与分身值守兜底。
# ── 库块(WF_RUN_LIB=1 / HARVEST_CRON_LIB=1 source 只装函数不跑主体,供单测)——默认值必须在 set -u 之前定义 ──
WFR=${WFR:-$HOME/bin-harvest/workflow-result.sh}
BATCH2=${BATCH2:-$HOME/bin-harvest/batch2.sh}
WF_HOME=${${(%):-%x}:A:h}                # 本文件所在目录(执行与 source 都对),执行机上 = ~/bin-harvest
WF_PLAN_DIR=${WF_PLAN_DIR:-$WF_HOME/plans}
# 7d150e33(阶段1): 整批总时限 + 每活动按契约预算封顶,函数在 wf-limits.sh(deploy.sh 同步);库缺失 → 兜底为"不限时",行为与并入前一致
source "$WF_HOME/wf-limits.sh" 2>/dev/null \
  || { wf_deadline_reached(){ return 1 }; wf_budget_of(){ print 0 }; wf_timeout_class(){ print record }; wf_run_bounded(){ shift; "$@" } }
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
  eval "$(bash "$WFR" enter 2>>${LOG:-/dev/null})" 2>/dev/null || true
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
  ssh -o ConnectTimeout=20 mmv "openclaw cron add --timeout 90000 --name 'escort-$HOSTKEY-$TAG' --agent media --session 'session:escort-$HOSTKEY-$TAG' --every 10m --announce --channel feishu --to 'chat:oc_ef60d6e3f199d90dd695b6ecc213d662' --account main --best-effort-deliver --message '先执行 ssh -o BatchMode=yes -o ConnectTimeout=10 administrator@100.71.151.105 cat /Users/administrator/.openclaw/cmdr-escort.txt 读取网关 SOP 并严格遵守辅佐三原则。你可能落在任意跑场机；SOP、日志、findings、openclaw CLI 均在网关，相关读写经 ssh -o BatchMode=yes -o ConnectTimeout=10 administrator@100.71.151.105 执行，不能把本机文件不存在当成网关文件不存在。本轮上下文: TAG=$TAG 机器=$HOSTKEY serial=$SERIAL profile=$P 起跑=${ESCORT_START_HM:-$(date +%H:%M)} 日志=/Users/administrator/.openclaw/m4-logs/${HOSTKEY}-live.log escort名=escort-$HOSTKEY-$TAG。注意:你上岗时本批尚未做设备preflight与取词单,这两步失败会升级给分身,你看到日志里没有词单行属正常早期阶段。'" 2>>${LOG:-/dev/null} | grep -oE '"id": "[a-f0-9-]+"' | head -1 | cut -d'"' -f4
}
# escort_current_id —— 当前 escort id: 看门狗重拉后写在 ESCORT_ID_FILE 的新 id 优先,否则 ESCORT_ID
escort_current_id(){
  if [[ -n "${ESCORT_ID_FILE:-}" && -s "$ESCORT_ID_FILE" ]]; then head -1 "$ESCORT_ID_FILE" | tr -d '[:space:]'
  else print -rn -- "${ESCORT_ID:-}"; fi
}
# 6751323e: Brain 接班只回写账本，执行机可能仍持旧 id。仅收养完整 JSON 中唯一同名的陪跑；
# 表格名字会截断，不能据此换 id。absent 才允许新建，unknown/ambiguous 均保留现场。
escort_by_name(){
  local want="$1" out found
  out=$(ssh -o ConnectTimeout=20 mmv "openclaw cron list --json" 2>>${LOG:-/dev/null}) \
    || { print unknown; return 0; }
  found=$(jq -er --arg want "$want" '
    if (.jobs | type) != "array" then error("invalid jobs") else
      [.jobs[] | select(.name == $want)] as $matches |
      if ($matches | length) == 0 then "absent"
      elif ($matches | length) > 1 then "ambiguous"
      elif ($matches[0].id | type) != "string" then error("invalid id")
      elif ($matches[0].id | test("^[A-Za-z0-9._-]{4,64}$")) then $matches[0].id
      else error("invalid id") end
    end' <<< "$out" 2>/dev/null) || found=unknown
  print -r -- "$found"
}
escort_adopt_id(){
  [[ -n "${ESCORT_ID_FILE:-}" ]] || return 1
  print -r -- "$1" > "$ESCORT_ID_FILE.tmp.$$" && mv -f "$ESCORT_ID_FILE.tmp.$$" "$ESCORT_ID_FILE"
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
  local id want="escort-$HOSTKEY-$TAG" verdict replacement
  id=$(escort_current_id)
  [[ -n "$id" ]] || return 0
  verdict=$(escort_owned "$id" "$want")
  if [[ "$verdict" == absent ]]; then
    replacement=$(escort_by_name "$want")
    case "$replacement" in
      absent) ;;
      ambiguous) log "escort注销跳过: 同名陪跑不唯一($want),保留 id 供对账"; return 0;;
      unknown) log "escort注销跳过: 同名陪跑不可确认($want),保留 id 供对账"; return 0;;
      *) id="$replacement"; escort_adopt_id "$id" || return 0
         verdict=$(escort_owned "$id" "$want");;
    esac
  fi
  case "$verdict" in
    match)   ssh -o ConnectTimeout=20 mmv "openclaw cron rm $id" >>${LOG:-/dev/null} 2>&1 || return 0
             log "escort已注销";;
    absent)  log "escort注销跳过: id=$id 已不在 cron 表(在途被移除/已被别处注销)";;
    unknown) log "escort注销跳过: id=$id cron list 不可达,不盲删"; return 0;;
    *)       log "escort注销拒绝: id=$id name=${verdict#mismatch:} 非本run(期望 $want),不删"; return 0;;
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
  new=$(escort_by_name "$want")
  case "$new" in
    unknown) return 0;;
    ambiguous) log "escort接班暂停: 同名陪跑不唯一($want),不再创建"; return 0;;
    absent) ;;
    *) escort_adopt_id "$new" || return 0
       log "escort已接班(id=$cur),收养同名新id=$new"; return 0;;
  esac
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
    # 先暂停循环；先杀 sleep 会唤醒父循环，让它在 TERM 到达前抢跑一轮重拉。
    kill -STOP "$ESCORT_WATCH_PID" 2>/dev/null
    pkill -P "$ESCORT_WATCH_PID" 2>/dev/null
    kill "$ESCORT_WATCH_PID" 2>/dev/null
    kill -CONT "$ESCORT_WATCH_PID" 2>/dev/null
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
    # 冻结循环后再收子进程，避免 stop 途中提前唤醒并发出下一次续租。
    kill -STOP "$LEASE_HB_PID" 2>/dev/null
    pkill -P "$LEASE_HB_PID" 2>/dev/null   # 先收掉在睡的 sleep 子进程,免得留 5 分钟孤儿
    kill "$LEASE_HB_PID" 2>/dev/null
    kill -CONT "$LEASE_HB_PID" 2>/dev/null
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
[[ "${WF_RUN_LIB:-0}" == "1" || "${HARVEST_CRON_LIB:-0}" == "1" ]] && return 0
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
wf_parse_args "$@"
TAG="${WF_TAG:-auto$(date +%m%d%H%M)}"   # --tag 覆盖(启动器传 cmdMMDDHHMM,escort 会话名/日志/账本 run 对得上)
C=${C:-$HOME/.local/bin/douyin-phone-adb}
DOUYIN_ACCOUNT_REGISTRY="${DOUYIN_ACCOUNT_REGISTRY:-$HOME/.config/openclaw/douyin-account-routes.tsv}"
LOG=~/harvest-cron.log
log(){ print -- "[$(date +%m%d-%H:%M:%S)] [$TAG] $*" >> $LOG }
# nap SECONDS —— 假机整链测试(wf-run-deadline-e2e)里预检清场等待不真睡(同 harvest-keyword.sh nap 模式);生产不设 WF_TESTING 不受影响
nap(){ [[ -n "${WF_TESTING:-}" ]] && return 0; /bin/sleep "$1" }
# 可视化旁路(0919): 每阶段报给控制塔工作机页; 上报器缺失/失败一律吞掉, 绝不影响采收
WR=${WALL_REPORT:-$HOME/bin-harvest/wall-report.sh}
wr(){ [[ -x "$WR" ]] && "$WR" "$@" >/dev/null 2>&1; true }
# wr_get: 同 wr 但保留 stdout,只用于读值子命令(brain-task)。wr() 本身按基线守卫必须吞 stdout,
# 所以 start 打出的 WFR_BRAIN_TASK_ID 行拿不到,改由 wall-report 落状态文件第 3 行、这里用 brain-task 读回
wr_get(){ [[ -x "$WR" ]] && "$WR" "$@" 2>/dev/null; true }
export WALL_NS=harvest   # 上报器按命名空间分状态文件: 采收链(含 batch2/harvest-keyword 子进程)与触达链同机同序列号互不顶状态

# 节点名映射(0915 真机核实: hostname 是 mac-mini-m4-xian/mac-mini-m1-us,与日志桥/nodes名不同,禁直推)
case "$(hostname -s)" in
  *m4-xian*) HOSTKEY=xian-m4 ;;
  *m1-us*)   HOSTKEY=xian-m1 ;;
  *)         HOSTKEY=$(hostname -s | tr '[:upper:]' '[:lower:]') ;;
esac

# ── escalate: 升级给 Claude 分身(三级响应第2级) ──
# 直写 MMV 本机文件(ssh+文件追加,不经网关进程):0916 实证网关死时宿主仍活,这条通路是"网关都死了还能叫到人"的唯一保障。
# 0930(任务 975aa6ec): 目标由 us-vps 宿主文件改为 MMV ~/.openclaw/m4-logs/escalation.log——0921 网关迁 MMV 后
# escort/stream 哨兵与分身 watcher 都在 MMV,us-vps 那份已无人读。
escalate() {
  local msg="$1"
  log "升级分身: $msg"
  ssh -o ConnectTimeout=20 mmv "echo '[$(date +%m%d-%H:%M)][$HOSTKEY][采收$TAG] $msg' >> /Users/administrator/.openclaw/m4-logs/escalation.log" 2>>$LOG \
    || log "升级通道也不可达(mmv ssh 失败),仅留本地日志"
}
# ── ⓪ 执行计划(契约组装): 无计划/无实现不得跑——在拉 escort 之前拦,拒跑要升级(多半是部署漏了 plans/ 或契约缺口) ──
if ! wf_load_plan "$WF_ARG_CAP"; then
  log "$WF_LOAD_ERR"
  print -u2 -- "$WF_LOAD_ERR"
  escalate "${WF_ARG_CAP:-未指定能力} 未起跑: $WF_LOAD_ERR"
  exit 1
fi
DISCOVER_CMD="$(wf_discover_cmd)"
if [[ ! -x "$DISCOVER_CMD" ]]; then
  log "拒跑: 发现实现 $DISCOVER_CMD 不存在或不可执行"
  print -u2 -- "拒跑: 发现实现 $DISCOVER_CMD 不存在或不可执行"
  escalate "$WF_CAP 未起跑: 发现实现 $DISCOVER_CMD 不存在或不可执行(deploy.sh 未同步?)"
  exit 1
fi
export DISCOVER_CMD
# 起跑回执(启动器/Commander 看 nohup 日志确认已起跑);计划拒跑时不打
print -r -- "WF_RUN_STARTED tag=$TAG cap=$WF_CAP serial=$SERIAL"
# 7d150e33: 整批总时限——起跑记时刻,默认 4h(WF_RUN_MAX_SECONDS 可覆盖);batch2 在词边界、harvest-keyword 在视频边界各自判到点平滑收工
export WF_RUN_START_TS=$(date +%s) WF_RUN_MAX_SECONDS="${WF_RUN_MAX_SECONDS:-14400}"
# 2fc3b6fc: Commander 平滑收工的正规入口(三档「自动做」,决策 018e4e84)——起跑登记 ~/wf-runs/<TAG>.stop 约定;
#   escort/分身在执行机 touch 该文件,batch2 词边界 / harvest-keyword 视频边界检测到即按 deadline 同路径收工。
#   起跑先清残留(同 TAG 上一次遗留的 stop 会让新批第 1 个词都不开);收工 finalize 后再清。
export WF_STOP_FILE="$HOME/wf-runs/$TAG.stop"
mkdir -p "$HOME/wf-runs"; rm -f "$WF_STOP_FILE"
log "执行计划: $WF_CAP 源=$WF_SOURCE_KIND 发现=$DISCOVER_CMD 总时限=${WF_RUN_MAX_SECONDS}s 收工入口=touch $WF_STOP_FILE${WF_MISSING:+ 未实现(--allow-missing 放行)=$WF_MISSING}"
WF_TITLE=获客采收; [[ "$WF_SOURCE_KIND" == "benchmark" ]] && WF_TITLE=对标采收
wr start "$SERIAL" "$WF_TITLE·$BIZ" "$WF_STAGES"
# 服务端镜像给本批的 Brain 单号(棒1 回执线,决策 702949b6): 紧跟 start 读,export 给 workflow-result.sh 做 stage/finalize 回执;
# 拿不到=空串=回执跳过,不影响采收
WFR_BRAIN_TASK_ID=$(wr_get brain-task "$SERIAL" | head -1)
export WFR_BRAIN_TASK_ID
wfr_on && log "Brain单: ${WFR_BRAIN_TASK_ID:-无(回执跳过)}"
wr step "$SERIAL" 0 doing

# ── ① Commander 上岗(第一步,0916 改序) ──
# 辅佐姿态(帮不拦/先动手后汇报/读不到就说读不到),宪法 SSOT=COMMANDER.md,SOP=网关 /Users/administrator/.openclaw/cmdr-escort.txt
# 0915 真测实证: 网关重启窗口 ECONNREFUSED、拥堵期握手 30s 超时都会让单发拉起静默失败——
# 加 --timeout 90000 + 重试 3 次(间隔 30s)。3 次仍失败=升级分身(网关多半有病),不阻塞采收。
# 0921 网关迁移: us-vps 那份 openclaw-gateway 容器已退役(决策 96054a8b),openclaw CLI
# 原生跑在 MMV,直接 ssh+openclaw 调用,不再经 docker exec。
# 7f842d12: --commander 给了 = 由 Commander 发起、escort 已由它登记,这里不再自拉(否则一批两个陪跑员)。
ESCORT_ID=""
ESCORT_ID_FILE="$HOME/wf-escort-$TAG.id"   # 看门狗重拉后的新 id 落这里,注销读它(escort_current_id)
ESCORT_START_HM=$(date +%H:%M)
escort_launch(){
for _ea in 1 2 3; do
  ESCORT_ID=$(escort_add)
  [[ -n "$ESCORT_ID" ]] && break
  log "escort拉起第${_ea}次失败,30s后重试"
  /bin/sleep 30
done
if [[ -n "$ESCORT_ID" ]]; then
  log "escort已拉起: $ESCORT_ID"
  # escort 真活复核: 拉起返回了 id 不等于它真在 cron 表里(网关重启窗口会吞掉),30s 后按 id 复核(escort_alive,禁按名字)
  /bin/sleep 30
  if escort_alive "$ESCORT_ID"; then log "escort复核命中(id=$ESCORT_ID)"
  else log "escort复核未命中(id=$ESCORT_ID)"; escalate "escort 拉起返回 id=$ESCORT_ID 但 30s 后 cron list(按 id)未命中，本批可能无人陪跑"; fi
else
  log "escort拉起3次均失败(不阻塞采收)"
  escalate "escort拉起3次均失败,本批全程无陪跑;网关可能不可达或容器异常,请查网关健康"
fi
}
if [[ -n "$WF_COMMANDER" ]]; then
  # --commander 的值 = 启动器(wf-launch.sh)已登记的 escort cron id: 当本批 ESCORT_ID 用——按 id 复核一次(登记在先,不再等 30s),
  #   退出 trap 照旧 escort_dismiss 注销,生命周期与自拉的 escort 一致
  ESCORT_ID="$WF_COMMANDER"
  log "由 Commander 发起,escort=$ESCORT_ID(启动器已登记,跳过自拉)"
  if escort_alive "$ESCORT_ID"; then log "escort复核命中(id=$ESCORT_ID)"
  else log "escort复核未命中(id=$ESCORT_ID)"; escalate "Commander 传入的 escort id=$ESCORT_ID 在 cron list(按 id)未命中，本批可能无人陪跑"; fi
else escort_launch; fi
# escort 看门狗: 从这里到收尾,在途被移除(不管谁删的)立即同名重拉;trap 里先停看门狗再注销(1ebaeb00)
escort_watch_start
# 账本收工(trap 里跑,正常退让路径也会经过): 未 init 只记 skipped;自检不过 escalate
# 40f02c5e: 收尾顺序 = 锁内清场(close-app/回桌面) → 放锁 → 账本 finalize。此前 trap 先 release_run_lock 再清场,
#   下一批一拿到锁就被我们 close-app;现在清场前先以本批 TAG lock-acquire 确认锁仍是本 run 的(幂等),
#   锁已易主(限时重试仍拿不到)→ 跳过清场记日志,指标 close_app_attempts=0/safe_desktop_visible=0 如实进账本。
device_cleanup_in_lock(){
  local i tries="${CLEANUP_LOCK_TRIES:-3}"
  WFR_CLOSE_APP_ATTEMPTS=0; WFR_SAFE_DESKTOP_VISIBLE=0
  export WFR_CLOSE_APP_ATTEMPTS WFR_SAFE_DESKTOP_VISIBLE
  finalize_needed || return 0
  for (( i = 1; i <= tries; i++ )); do
    "$C" --profile "$P" lock-acquire "$TAG" </dev/null >/dev/null 2>>$LOG && break
    (( i < tries )) && nap "${CLEANUP_LOCK_WAIT:-10}"
  done
  if (( i > tries )); then
    log "cleanup: 锁被占,跳过收尾清场(锁已是别的 run 的,不动它的现场)"
    return 0
  fi
  WFR_CLOSE_APP_ATTEMPTS=1
  if $C --profile "$P" close-app </dev/null >/dev/null 2>>$LOG; then
    log "cleanup: close-app 成功"
  else
    log "cleanup: close-app 失败(设备可能已离线/前台未能关闭,见日志)"
  fi
  if $C --profile "$P" return-safe-desktop </dev/null >/dev/null 2>>$LOG; then
    WFR_SAFE_DESKTOP_VISIBLE=1
    log "cleanup: 已回到安全桌面"
  else
    log "cleanup: 回安全桌面失败,设备可能停在异常界面上"
    escalate "本批收工后未能确认回到安全桌面,设备可能停在异常界面上,请人工查看"
  fi
  export WFR_CLOSE_APP_ATTEMPTS WFR_SAFE_DESKTOP_VISIBLE
}
run_finalize(){
  device_cleanup_in_lock
  release_run_lock
  # 2fc3b6fc: 收工后清 stop 文件(账本已带 reason=commander_stop,文件本身不是证据;留着会让同 TAG 重跑第 1 个词都不开)
  [[ -n "${WF_STOP_FILE:-}" ]] && rm -f "$WF_STOP_FILE"
  wfr_on || return 0
  finalize_needed || { log "账本finalize: skipped(not_initialized, 正常退让)"; return 0; }
  # 0929批次4(6b133a81): cleanup 活动"关App"/"回安全桌面"真跑真记——现在在 device_cleanup_in_lock 里(锁内)做,
  # 指标 WFR_CLOSE_APP_ATTEMPTS/WFR_SAFE_DESKTOP_VISIBLE 已 export,这里只写账本
  # 9032cdad: 收工时步骤 DoD 判整批(如锁心跳续期失败次数)——日志与产物取本批 night 文件全段
  export WFR_LOG_FILE=~/night-$TAG.log WFR_TSV=~/night-$TAG.tsv WFR_LOG_FROM=0
  eval "$(bash "$WFR" finalize 2>>$LOG)" 2>/dev/null || true
  log "账本finalize: ok=${WFR_FINALIZE_OK:-?} final=${WFR_FINALIZE_FINAL:-?} lock_released=${WFR_LOCK_RELEASED:-?} ${WFR_FINALIZE_MSG:-}"
  [[ "${WFR_FINALIZE_OK:-0}" == "1" ]] || escalate "账本收工自检未通过: ${WFR_FINALIZE_MSG:-unknown}"
  gate_check "收工" >/dev/null || true
  # finalize 未确认成功时保留陪跑，不让后续闸检查的退出码抹掉账本失败。
  [[ "${WFR_FINALIZE_OK:-0}" == "1" ]]
}
# 40f02c5e: 放锁并入 run_finalize(锁内清场 → 放锁 → 账本),trap 里不再单列 release_run_lock
if [[ -n "$ESCORT_ID" ]]; then trap 'lease_heartbeat_stop; escort_watch_stop; run_finalize && escort_dismiss' EXIT INT TERM; else trap 'lease_heartbeat_stop; run_finalize' EXIT INT TERM; fi
wr step "$SERIAL" 0 done; wr step "$SERIAL" 1 doing

# ── ② 设备 preflight: 在线 + 屏幕亮 + 解锁(0915 锁屏=整机瘫痪且静默的教训) ──
if ! adb -s $SERIAL get-state >/dev/null 2>&1; then
  log "设备离线,退出"
  escalate "设备 $SERIAL 离线,本批无法起跑(adb get-state 失败);请查 USB/无线调试/机器是否关机"
  wr fail "$SERIAL" 1 device_offline "adb get-state 失败"
  exit 0
fi
DEVICE_VERIFIED=1   # 6b133a81: 预检指标取真实结果,不再在 workflow-result.sh 写死
# 40f02c5e: 拿设备锁提前到第一个碰手机的动作(唤醒)之前——此前拿锁排在取词单之后,唤醒/清场/读号全在锁外,
#   同机另一批(对标发现/触达)持锁时会被我们清场。拿不到锁 = 本批不碰手机(只做只读检测),预检工件 lock_acquired=0 由
#   pf_lock_acquired 探针拦停;账本关着时下面也显式拦(不开采)。
preflight_lock_acquire
log "预检拿锁: lock_acquired=$LOCK_ACQUIRED"
(( LOCK_ACQUIRED )) || log "预检拿锁失败(锁被占),本批不碰手机: 跳过唤醒/清场/读号"
W=$(adb -s $SERIAL shell dumpsys power | grep -oE "mWakefulness=[A-Za-z]+" | head -1 | tr -d "\r")
if (( LOCK_ACQUIRED )) && [[ "$W" != *Awake* ]]; then
  log "屏幕非Awake($W),唤醒解锁"
  adb -s $SERIAL shell input keyevent KEYCODE_WAKEUP; /bin/sleep 1
  adb -s $SERIAL shell input swipe 600 2200 600 800 300; /bin/sleep 1
fi
(( LOCK_ACQUIRED )) && adb -s $SERIAL shell svc power stayon true 2>/dev/null
CALLSTATE=$(adb -s $SERIAL shell dumpsys telephony.registry 2>/dev/null | awk -F= '/mCallState=/{gsub(/\r/,"",$2); print $2; exit}')
if device_call_busy "$CALLSTATE"; then
  log "设备通话中(mCallState=$CALLSTATE),退出"
  escalate "设备 $SERIAL 通话中(mCallState=$CALLSTATE),本批无法起跑;请查是否有未挂断的电话"
  wr fail "$SERIAL" 1 call_busy "设备通话中(mCallState=$CALLSTATE)"
  exit 0
fi
CALL_STATE_IDLE=1
# 读账号标记(我页)/验账号身份 —— 0929批次4修复(DoD审计发现的死代码,详见 account_registered
# 定义处注释): 读不到抖音号/登的号不在本profile注册表里,都判定为"账号有问题",升级分身+
# 记账为需人工处理,不静默继续采(继续采只会产出归属存疑的线索)。
ACCOUNT_VERIFIED=0
# 读号前归位清场(0914铁律: 不假设重开=干净态;写法同 batch2.sh 每词开头)。0930 事故: 抖音重开恢复到
# 触达刚私信过的他人主页,读号子命令读成别人的号→误判账号不符拦整批;22:30 批停在搜索结果页,
# 3 步 verified back 退不出。冷启动落在首页,读号子命令再自证是自己主页(第一道闸在它里面)。
# 40f02c5e: 清场+读号都是碰手机的动作,只在持锁时做;没锁 → DOUYIN_ID 留空、ACCOUNT_VERIFIED=0,由下面的拿锁拦截统一收工
DOUYIN_ID=""; ACCTOUT=""
if (( LOCK_ACQUIRED )); then
adb -s $SERIAL shell am force-stop com.ss.android.ugc.aweme 2>/dev/null
nap 2
adb -s $SERIAL shell am start -n com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.main.MainActivity >/dev/null 2>&1
nap 4
ACCTOUT="$($C --profile "$P" account-current "$TAG-preflight-acct" </dev/null 2>&1)"
DOUYIN_ID="$(print -- "$ACCTOUT" | sed -n "s/^douyin_id=//p")"
fi
if (( ! LOCK_ACQUIRED )); then
  :
elif [[ -z "$DOUYIN_ID" ]]; then
  log "读账号标记失败(我页读不到抖音号): $(print -- "$ACCTOUT" | tail -1 | head -c 150)"
  escalate "读账号标记失败,读不到我页抖音号,本批无法确认登录账号: $(print -- "$ACCTOUT" | tail -1 | head -c 150)"
  wr fail "$SERIAL" 1 account_read_failed "读账号标记失败"
  exit 0
elif ! account_registered "$P" "$DOUYIN_ID" "$DOUYIN_ACCOUNT_REGISTRY"; then
  log "账号不符: 我页抖音号=$DOUYIN_ID 未登记在 profile=$P 下"
  escalate "手机登录号不符(account_mismatch): 我页抖音号=$DOUYIN_ID 不在 $P 的注册账号列表里,本批可能登错号/串号,线索归属存疑"
  wr fail "$SERIAL" 1 account_mismatch "我页抖音号=$DOUYIN_ID 不属于profile=$P"
  exit 0
else
  ACCOUNT_VERIFIED=1
  log "账号验证通过: 我页抖音号=$DOUYIN_ID (profile=$P)"
fi
export ACCOUNT_VERIFIED DOUYIN_ID DEVICE_VERIFIED CALL_STATE_IDLE
wr step "$SERIAL" 1 done

# 触达时窗守卫: 8-22点是触达的地盘,采收 cron 不该在白天抢(冗余保险,crontab已限时)
# 这是**正常退让**不是故障,不升级(升级=狼来了)。
H=$(date +%H)
if (( H >= 8 && H < 22 )); then log "白天触达时窗,采收退让"; wr step "$SERIAL" 1 done "白天时窗退让"; wr done "$SERIAL"; exit 0; fi

# ── ③ 取源: keyword=词单←网关(关键词表 SSOT) / benchmark=--sources 对标清单 ──
# ── ③ KPI 闸(0916 主理人要求"KPI驱动自动获客,不是一天三次") ──
# 目标表是 SSOT(飞书「获客｜经营目标」tblpwc9GF9mIhdAG): 改目标改表,不改代码不改 crontab。
# 达标即退让(省设备省额度),未达标按缺口放大词数。闸自身故障 fail-open(宪法帮不拦)。
# 7d150e33: 取源段(KPI 闸 + 词单)借发现活动预算封顶——词单是发现的输入,远程调用超时收掉子进程即走既有 fail-open/兜底词单路径
SRC_BUDGET=$(wf_budget_of discovery)
KPI_JSON=$(wf_run_bounded "$SRC_BUDGET" ssh -o ConnectTimeout=20 mmv "node /Users/administrator/.openclaw/leadgen-scripts/kpi-gate.js '$BIZ' $N" 2>>$LOG)
KPI_VERDICT=$(print -r -- "$KPI_JSON" | sed -n 's/.*"verdict":"\([a-z]*\)".*/\1/p')
KPI_REASON=$(print -r -- "$KPI_JSON" | sed -n 's/.*"reason":"\([^"]*\)".*/\1/p')
KPI_WORDS=$(print -r -- "$KPI_JSON" | sed -n 's/.*"words":\([0-9]*\).*/\1/p')
if [[ "$KPI_VERDICT" == "done" ]]; then
  log "KPI已达标,本批退让: $KPI_REASON"
  wr step "$SERIAL" 1 done "KPI已达标:$KPI_REASON"; wr done "$SERIAL"
  exit 0
fi
if [[ -z "$KPI_VERDICT" ]]; then
  # 闸不可达(ssh/网关故障)——不停产,按默认词数继续,但留痕
  log "KPI闸不可达,按默认${N}词继续(fail-open)"
else
  # 对标源清单由发起方给定,不按 KPI 缺口放大(达标退让照旧)
  [[ "$WF_SOURCE_KIND" == "keyword" && -n "$KPI_WORDS" && "$KPI_WORDS" -gt 0 ]] && N=$KPI_WORDS
  log "KPI闸: $KPI_REASON"
fi
wr step "$SERIAL" 2 doing

# 0916 分身实弹报告提案: 必须区分"网关容器停摆"与"真的词单为空"——0916凌晨两批真凶是前者,
# 却因两者都表现为空输出而被误报成后者,害得排查方向指向关键词表(白查)。stderr 才是判据。
# 0916 主理人追问"为何100%跑不完"的根因修复: 采收六步中,只有取词单是"网关挂=批次夭折"的死步
# (拉Commander/KPI闸都已 fail-open,采收主体纯本机,落池失败数据留本地可补)。
# 故给词单加本地缓存: 成功即存,失败用上次的词单顶上——网关病了也照跑,不白瞎一个夜间窗口。
WF=/tmp/kw-$TAG.txt
if [[ "$WF_SOURCE_KIND" == "benchmark" ]]; then
  # 对标源(7f842d12): 由发起方(Commander/调试)给 --sources 文件,每行一个对标主页链接或 sec_uid;缺/空 = 本批夭折要升级
  if ! wf_read_sources "$WF_SOURCES" "$WF"; then
    WHY="对标源文件缺失或为空(--sources ${WF_SOURCES:-未给})"
    log "取对标源失败,退出: $WHY"
    escalate "取对标源失败,本批夭折。根因: $WHY"
    wr fail "$SERIAL" 2 sources_unavailable "$WHY"
    exit 0
  fi
else
  KWERR=/tmp/kwerr-$TAG.txt
  KWCACHE=~/.kw-cache-$P.txt
  wf_run_bounded "$SRC_BUDGET" ssh -o ConnectTimeout=20 mmv "node /Users/administrator/.openclaw/leadgen-scripts/next-keywords.js '$BIZ' $N" > $WF 2>$KWERR
  (( $? == 124 )) && print "取词单超发现预算(${SRC_BUDGET}s),远程调用已收掉" >> $KWERR
  [[ -s $KWERR ]] && cat $KWERR >> $LOG
  if [[ -s $WF ]]; then
    cp $WF $KWCACHE 2>/dev/null && log "词单已存本地缓存"
  else
    # 取词单失败 → 先判根因(供分身排查),再尝试兜底词单续跑
    # 0921 网关迁移(决策 96054a8b): 判据从"容器停摆"改成"网关机(MMV)不可达/脚本报错"
    if grep -qE 'Connection refused|Connection timed out|Could not resolve hostname|No such file or directory|Permission denied' $KWERR 2>/dev/null; then
      WHY="网关机(MMV)不可达或脚本路径异常($(head -c 100 $KWERR | tr -d '\n'))"
    else
      WHY="网关机正常但 next-keywords 返回空(查关键词表启用行/业务线是否匹配 $BIZ)"
    fi
    if [[ -s $KWCACHE ]]; then
      cp $KWCACHE $WF
      log "取词单失败,改用兜底词单(本地缓存 $(wc -l < $WF | tr -d ' ')词)续跑"
      escalate "取词单失败已走**兜底词单**续跑(本批不夭折,但用的是上次缓存的词、效果轮换暂停)。根因: $WHY。请尽快恢复网关,否则后续批次会一直吃旧词单"
    else
      log "取词单失败且无本地缓存,退出"
      escalate "取词单失败**且无兜底词单**(首次跑或缓存丢失),本批夭折。根因: $WHY"
      wr fail "$SERIAL" 2 keywords_unavailable "$WHY"
      exit 0
    fi
  fi
fi
NWORDS=$(wc -l < $WF | tr -d ' ')
log "词单 ${NWORDS}词: $(tr '\n' '/' < $WF)"
wr step "$SERIAL" 2 done; wr step "$SERIAL" 3 doing "${NWORDS}词"
# 预检拿锁(契约 preflight.acquire_device_lock):拿到才算设备就绪,结果随 init 写进 preflight 工件读回
wfr_bootstrap "$TAG" "$P" "$WF" "$PUSH" "$SERIAL" "$HOSTKEY"
wfr_on && log "账本init: run=${WFR_RUN_ID:-?} hash=${WFR_HASH:-?} attempt=${WFR_ATTEMPT:-?} skip=${WFR_SKIP_WORDS:-}"
# 6b133a81: 预检后置条件(设备/账号/通话/锁)读回不过 → stop_run,本批不开采(收工 trap 照做)
if gate_check "预检"; then
  log "预检后置条件不过,本批不开采: ${WFR_GATE_STAGE:-}:${WFR_GATE_KEYS:-}"
  wr fail "$SERIAL" 3 preflight_postcondition "${WFR_GATE_KEYS:-}"
  exit 0
fi
# 40f02c5e: 账本/探针关着(测试、WFR_DISABLED)也不许无锁开采——没锁就没碰过手机、也没验过账号
if (( ! LOCK_ACQUIRED )); then
  log "预检拿锁失败(锁被占),本批不开采(lock_busy 契约 retryable,下一批再来)"
  wr fail "$SERIAL" 3 lock_busy "预检拿锁失败"
  exit 0
fi

# ── ④ 采收主体 ──
# 传原词单 $WF(init 时算 hash 用的就是它,传过滤后的副本会被 batch2 判 hash_mismatch 误报停跑);续跑跳词由 batch2 按 WFR_SKIP_WORDS 逐词做
# 采收主体期间后台心跳续租(0929: 不续租 = 10 分钟后被 sweep 误判 executor_lost)
lease_heartbeat_start "$SERIAL"
B2OUT=$(/bin/zsh "$BATCH2" "$P" "$WF" "$TAG" "$PUSH" "$SERIAL" 2>&1 | tee -a $LOG || true)
lease_heartbeat_stop
if print -r -- "$B2OUT" | grep -q 'BATCH2_ESCALATE=hash_mismatch'; then escalate "词单在 init 后被改动(hash 不一致)，本批已停(fail-closed)"; fi
# 7d150e33 / 2fc3b6fc: batch2 报收工原因(deadline 到点 / commander_stop Commander touch 了 stop 文件)→ 账本终态记 partial 并带原因,
#   收工动作(放锁/回桌面/escort 注销/效果回写)照常
B2_STOP_REASON=$(print -r -- "$B2OUT" | sed -n 's/^BATCH2_STOP_REASON=//p' | tail -1)
if [[ "$B2_STOP_REASON" == deadline ]]; then
  export WFR_FINAL_REASON="$B2_STOP_REASON"
  log "总时限到,平滑收工(${WF_RUN_MAX_SECONDS}s): 已采线索已落池,账本终态记 partial"
  wr note "$SERIAL" "总时限到,平滑收工"
elif [[ "$B2_STOP_REASON" == commander_stop ]]; then
  export WFR_FINAL_REASON="$B2_STOP_REASON"
  log "Commander 请求收工,平滑收工($WF_STOP_FILE): 已采线索已落池,账本终态记 partial"
  wr note "$SERIAL" "Commander 请求收工,平滑收工"
fi
GATE_STOPPED=0
if gate_check "采收"; then GATE_STOPPED=1; log "活动后置条件拦截停跑: ${WFR_GATE_STAGE:-}:${WFR_GATE_KEYS:-}"; fi
# 本批线索数随 done 上报(0929): 0 条线索的批次与出线索的批次不能都只是一个 completed。
# 不用 `|| echo 0`: grep -c 零命中时已打印 0 且退出 1,再 echo 会变成 "0\n0"。文件缺失时 grep 无输出 → 兜 0
NLEAD=$(grep -c '^LEAD' ~/night-$TAG.tsv 2>/dev/null); NLEAD=${NLEAD:-0}
log "批完成: $NLEAD LEAD"
wr step "$SERIAL" 3 done

# ── ⑤ 效果回写(词赛马数据闭环) ──
if [[ "$WF_SOURCE_KIND" != "keyword" ]]; then
  # 词赛马回写只对关键词源有意义;对标源的 keyword 列是 bench:<源>,回写进关键词表是污染
  wr step "$SERIAL" 4 done "对标源无关键词效果回写"
elif [[ "$PUSH" == "1" ]] && (( ! GATE_STOPPED )); then
  wr step "$SERIAL" 4 doing
  # 0923: 必须传 "${BIZ}" —— 此前不传,脚本内部写死金诺的 base,于是 m1 跑悦升的批次
  # 也在往**金诺**表回写,悦升关键词表四列长期全 0。PR#1962 改成按 line-routes 路由之后,
  # 不传参数会直接抛「未配路由」——夜批当晚就会在这一步红,不会再静默写错家。
  ssh -o ConnectTimeout=20 mmv "node /Users/administrator/.openclaw/leadgen-scripts/update-keyword-stats.js '${BIZ}'" >> $LOG 2>&1
  log "效果已回写关键词表(${BIZ})"
  wr step "$SERIAL" 4 done
else
  wr step "$SERIAL" 4 done "PUSH=$PUSH 拦截=$GATE_STOPPED 跳过回写"
fi
(( GATE_STOPPED )) && { wr fail "$SERIAL" 3 postcondition_stop "${WFR_GATE_STAGE:-}:${WFR_GATE_KEYS:-}"; exit 0 }
wr done "$SERIAL" "$NLEAD"
