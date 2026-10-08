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
WF_HOME=${${(%):-%x}:A:h}
WFR=${WFR:-$WF_HOME/workflow-result.sh}
BATCH2=${BATCH2:-$WF_HOME/batch2.sh}
WF_PLAN_DIR=${WF_PLAN_DIR:-$WF_HOME/plans}
# 7d150e33(阶段1): 整批总时限 + 每活动按契约预算封顶,函数在 wf-limits.sh(deploy.sh 同步);库缺失 → 兜底为"不限时",行为与并入前一致
source "$WF_HOME/wf-limits.sh" 2>/dev/null \
  || { wf_deadline_reached(){ return 1 }; wf_budget_of(){ print 0 }; wf_timeout_class(){ print record }; wf_run_bounded(){ shift; "$@" } }
source "$WF_HOME/wf-run-lib.sh" || exit 1
[[ "${WF_RUN_LIB:-0}" == "1" || "${HARVEST_CRON_LIB:-0}" == "1" ]] && return 0
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
wf_parse_args "$@"
TAG="${WF_TAG:-auto$(date +%m%d%H%M)}"   # --tag 覆盖(启动器传 cmdMMDDHHMM,escort 会话名/日志/账本 run 对得上)
C=${C:-$HOME/.local/bin/douyin-phone-adb}
DOUYIN_ACCOUNT_REGISTRY="${DOUYIN_ACCOUNT_REGISTRY:-$HOME/.config/openclaw/douyin-account-routes.tsv}"
LOG=~/harvest-cron.log
# cap+tag索引仅定位，身份与完整性仍由run-definition验证；在latest计划门禁之前续跑。
if [[ -z "${WF_FROZEN_ROOT:-}" ]]; then
  frozen_run=$(bash "$WFR" locate-run "$WF_ARG_CAP" "$TAG" "$P" "$SERIAL") || exit 1
  if [[ -n "$frozen_run" ]]; then
    export WFR_RUN_DIR="$frozen_run"
    wf_exec_frozen "$@"
  fi
fi
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
if [[ -n "${WF_FROZEN_ROOT:-}" && "$WF_HOME" == "${WF_FROZEN_ROOT:A}" ]]; then
  source "$WFR_RUN_DIR/workflow.plan"
  for k in ${(k)parameters}; do [[ "$k" == WF_BUDGET_* || "$k" == WF_TIMEOUT_CLASS_* ]] && export "$k"; done
else
if ! wf_load_plan "$WF_ARG_CAP"; then
  log "$WF_LOAD_ERR"
  print -u2 -- "$WF_LOAD_ERR"
  escalate "${WF_ARG_CAP:-未指定能力} 未起跑: $WF_LOAD_ERR"
  exit 1
fi
fi
if [[ "${WF_RETIRED:-0}" == 1 ]]; then
  print -u2 -- '旧获客流程已退役；请使用 leadgen-run.sh 的四个独立流程。'
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
# 固定版本失败时只留本地错误；在控制塔、escort、设备动作之前拒跑。
export WF_ARG_CAP P SERIAL WFR_TAG="$TAG"
export WF_HOME WF_DEPLOYMENT_ROOT="${WF_DEPLOYMENT_ROOT:-$WF_HOME}"
export WF_PLAN_PATH="$WF_PLAN_DIR/$WF_ARG_CAP.plan" WF_BRAIN_WORKFLOW WF_CONTRACT_RAW_SHA256 WF_ACTIVITY_REFS WF_STEP_SPEC
export WFR_RUN_ID="${WF_WORKFLOW}-crontab-$TAG"
export WFR_RUN_DIR="${WFR_HOME:-$HOME/.config/zenithjoy}/ledger/$WFR_RUN_ID"
# 运行时子命令的 stderr 先落临时文件再脱敏进日志：crontab 把 stderr 丢 /dev/null，且原始报错可能带 Bearer token。
# 固定版本/绑定失败只留本地错误（不 ssh、不 escalate）：拒跑必须先于任何外部动作；告警由 MMV 侧读日志桥完成。
wf_runtime_why() {  # $1=stderr 文件 → 打印脱敏后的末尾两行（≤400 字）
  sed -E 's/(Bearer )[^ "]+/\1***/g; s/(BRAIN_INTERNAL_TOKEN=)[^ ]+/\1***/g' "$1" 2>/dev/null | grep -v '^[[:space:]]*$' | tail -2 | tr '\n' ' ' | cut -c1-400
}
WF_RT_ERR=$(mktemp -t wfrt.XXXXXX)
if ! bash "$WFR" prepare 2>"$WF_RT_ERR"; then
  WHY=$(wf_runtime_why "$WF_RT_ERR"); rm -f "$WF_RT_ERR"
  log "拒跑: 工作流定义版本冻结失败: $WHY"
  print -u2 -- "拒跑: 工作流定义版本冻结失败: $WHY"
  exit 1
fi
rm -f "$WF_RT_ERR"
# 转到冻结shell本身：zsh后续读取与相对source也不能再命中全局部署目录。
if [[ "$WF_HOME" != "${WFR_RUN_DIR:A}/runtime" ]]; then
  wf_exec_frozen "$@"
fi
source "$WFR_RUN_DIR/workflow.plan"
export DISCOVER_CMD="$(wf_discover_cmd)"
export WFR_STEP_SPEC="$WFR_RUN_DIR/step-dod.json"
# 发布绑定ACK必须先于控制塔、escort与设备动作；失败保留本地固定请求。
export WFR_HOSTKEY="$HOSTKEY"
WF_RT_ERR=$(mktemp -t wfrt.XXXXXX)
if ! WF_BIND_EXPORTS=$(wf_bind_run "$WF_RT_ERR"); then
  WHY=$(wf_runtime_why "$WF_RT_ERR"); rm -f "$WF_RT_ERR"
  log "拒跑: 运行发布绑定未确认: $WHY"; print -u2 -- "拒跑: 运行发布绑定未确认: $WHY"
  exit 1
fi
rm -f "$WF_RT_ERR"
eval "$WF_BIND_EXPORTS"
export WFR_ATTEMPT WFR_SKIP_WORDS
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
  [[ "${WF_YIELDED:-0}" == 1 ]] && { log "账本finalize: skipped(时窗退让,未建账本)"; return 0; }
  finalize_needed || { log "账本finalize: skipped(not_initialized, 正常退让)"; return 0; }
  # 0929批次4(6b133a81): cleanup 活动"关App"/"回安全桌面"真跑真记——现在在 device_cleanup_in_lock 里(锁内)做,
  # 指标 WFR_CLOSE_APP_ATTEMPTS/WFR_SAFE_DESKTOP_VISIBLE 已 export,这里只写账本
  # 9032cdad: 收工时步骤 DoD 判整批(如锁心跳续期失败次数)——日志与产物取本批 night 文件全段
  export WFR_LOG_FILE=~/night-$TAG.log WFR_TSV=~/night-$TAG.tsv WFR_LOG_FROM=0
  eval "$(bash "$WFR" finalize 2>>$LOG)" 2>/dev/null || true
  log "账本finalize: ok=${WFR_FINALIZE_OK:-?} final=${WFR_FINALIZE_FINAL:-?} lock_released=${WFR_LOCK_RELEASED:-?} ${WFR_FINALIZE_MSG:-}"
  [[ "${WFR_FINALIZE_OK:-0}" == "1" ]] || escalate "账本收工自检未通过: ${WFR_FINALIZE_MSG:-unknown}"
  gate_check "收工" >/dev/null || true
}
# 40f02c5e: 放锁并入 run_finalize(锁内清场 → 放锁 → 账本),trap 里不再单列 release_run_lock
if [[ -n "$ESCORT_ID" ]]; then trap 'lease_heartbeat_stop; escort_watch_stop; escort_dismiss; run_finalize' EXIT INT TERM; else trap 'lease_heartbeat_stop; run_finalize' EXIT INT TERM; fi
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
# 退让发生在账本 init 之前: 打 WF_YIELDED 标记,收尾走 skipped,不跑账本自检、不升级(10-08 误报 not_initialized 升级分身)
if wf_window_yield; then WF_YIELDED=1; log "白天触达时窗,采收退让"; wr step "$SERIAL" 1 done "白天时窗退让"; wr done "$SERIAL"; exit 0; fi

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
