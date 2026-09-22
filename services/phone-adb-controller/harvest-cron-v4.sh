#!/bin/zsh
# harvest-cron.sh PROFILE SERIAL BIZ N PUSH —— 24×7 夜间采收自动扳机(M4/M1 crontab)
# 全自动: Commander上岗 → 设备preflight → 词单←网关关键词表 → batch2 采收 → 落池 → 效果回写
# 0916 改序(主理人拍板): Commander是第一步不是第三步——它必须看着 preflight 与取词单,
#   因为 0915 凌晨三批正是死在这两步、静默 exit、全线 6 小时无人知晓。
# 失败不静默(同上): 任何非正常退出都先 escalate 再退,报警走 us-vps 宿主文件(容器死了照样能写)。
# v4(基座1/7): +账本/阶段工件/续跑/escort真活复核/孤儿清扫。原 harvest-cron.sh 不动，影子跑 2 晚后切 crontab。
# 库块默认值必须在 wfr_bootstrap 之前定义——source 模式(HARVEST_CRON_V4_LIB=1)下不会走到
# 下面 set -uo pipefail 之后的赋值，wfr_bootstrap 找不到 $WFR/$BATCH2 就会裸调失败。
WFR=${WFR:-$HOME/bin-harvest/workflow-result.sh}
BATCH2=${BATCH2:-$HOME/bin-harvest/batch2-v4.sh}
filter_words(){ # in out "skip|list" —— 续跑：去掉上一 attempt 已完成的词，保序
  local in="$1" out="$2" skip="${3:-}"
  : > "$out"
  while IFS= read -r w; do
    [[ -z "$w" ]] && continue
    [[ -n "$skip" && "|$skip|" == *"|$w|"* ]] && continue
    print -- "$w" >> "$out"
  done < "$in"
}
finalize_needed(){ [[ -n "${WFR_RUN_ID:-}" ]]; }   # 只有 wfr init 跑过(导出了 WFR_RUN_ID)才需要收工记账
# wfr_bootstrap: TAG P WF PUSH SERIAL HOSTKEY —— init 后立刻 export 再 enter，子进程(bash "$WFR" /
#   bash "$BATCH2")才看得到账本位置。终审 C1: 原代码 init→enter 之间不 export，enter 子进程走
#   not_initialized 分支，账本 attempt_id 永远 null、skip_words 恒空——两步接成一个库函数堵死这个洞。
wfr_bootstrap(){
  eval "$(bash "$WFR" init "$1" "$2" "$3" "$4" "$5" "$6" 2>>${LOG:-/dev/null})" 2>/dev/null || true
  export WFR_RUN_ID WFR_HASH WFR_RUN_DIR WFR_ART_DIR
  eval "$(bash "$WFR" enter 2>>${LOG:-/dev/null})" 2>/dev/null || true
  export WFR_ATTEMPT WFR_SKIP_WORDS
}
[[ "${HARVEST_CRON_V4_LIB:-0}" == "1" ]] && return 0
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
P="$1"; SERIAL="$2"; BIZ="${3:-AI人工智能训练师}"; N="${4:-6}"; PUSH="${5:-1}"
TAG="auto$(date +%m%d%H%M)"
LOG=~/harvest-cron.log
log(){ print -- "[$(date +%m%d-%H:%M:%S)] [$TAG] $*" >> $LOG }
# 可视化旁路(0919): 每阶段报给控制塔工作机页; 上报器缺失/失败一律吞掉, 绝不影响采收
WR=${WALL_REPORT:-$HOME/bin-harvest/wall-report.sh}
wr(){ [[ -x "$WR" ]] && "$WR" "$@" >/dev/null 2>&1; true }
export WALL_NS=harvest   # 上报器按命名空间分状态文件: 采收链(含 batch2/harvest-keyword 子进程)与触达链同机同序列号互不顶状态

# 节点名映射(0915 真机核实: hostname 是 mac-mini-m4-xian/mac-mini-m1-us,与日志桥/nodes名不同,禁直推)
case "$(hostname -s)" in
  *m4-xian*) HOSTKEY=xian-m4 ;;
  *m1-us*)   HOSTKEY=xian-m1 ;;
  *)         HOSTKEY=$(hostname -s | tr '[:upper:]' '[:lower:]') ;;
esac

# ── escalate: 升级给 Claude 分身(三级响应第2级) ──
# 直写 us-vps **宿主**文件:0916 实证网关容器死时宿主仍活,docker exec 会失效而 ssh+文件追加照常,
# 且分身 watcher 读的正是这个宿主文件——这条通路是"网关都死了还能叫到人"的唯一保障。
escalate() {
  local msg="$1"
  log "升级分身: $msg"
  ssh -o ConnectTimeout=20 us-vps "echo '[$(date +%m%d-%H:%M)][$HOSTKEY][采收$TAG] $msg' >> /opt/openclaw/state/m4-logs/escalation.log" 2>>$LOG \
    || log "升级通道也不可达(us-vps ssh 失败),仅留本地日志"
}
wr start "$SERIAL" "获客采收·$BIZ" "拉Commander,设备预检,取词单,采收主体,效果回写"
wr step "$SERIAL" 0 doing

# ── ① Commander 上岗(第一步,0916 改序) ──
# 辅佐姿态(帮不拦/先动手后汇报/读不到就说读不到),宪法 SSOT=COMMANDER.md,SOP=网关 /Users/administrator/.openclaw/cmdr-escort.txt
# 0915 真测实证: 网关重启窗口 ECONNREFUSED、拥堵期握手 30s 超时都会让单发拉起静默失败——
# 加 --timeout 90000 + 重试 3 次(间隔 30s)。3 次仍失败=升级分身(网关多半有病),不阻塞采收。
# 0921 网关迁移: us-vps 那份 openclaw-gateway 容器已退役(决策 96054a8b),openclaw CLI
# 原生跑在 MMV,直接 ssh+openclaw 调用,不再经 docker exec。
# 孤儿 escort 清扫：上批 kill -9 时 trap 不触发，会留下 escort cron 烧额度（Agent C 错误路径）
ORPH=$(ssh -o ConnectTimeout=20 mmv "openclaw cron list" 2>>$LOG | grep -F "escort-$HOSTKEY-" | grep -v -F "escort-$HOSTKEY-$TAG" || true)
if [[ -n "$ORPH" ]]; then
  print -r -- "$ORPH" | while read -r oid _; do
    [[ -n "$oid" ]] && ssh -o ConnectTimeout=20 mmv "openclaw cron rm $oid" >>$LOG 2>&1 && log "孤儿escort清理: $oid"
  done
fi

ESCORT_ID=""
for _ea in 1 2 3; do
  ESCORT_ID=$(ssh -o ConnectTimeout=20 mmv "openclaw cron add --timeout 90000 --name 'escort-$HOSTKEY-$TAG' --agent media --session 'session:escort-$HOSTKEY-$TAG' --every 10m --announce --channel feishu --to 'chat:oc_ef60d6e3f199d90dd695b6ecc213d662' --account main --best-effort-deliver --message '先读 /Users/administrator/.openclaw/cmdr-escort.txt 作为你的SOP并严格遵守辅佐三原则。本轮上下文: TAG=$TAG 机器=$HOSTKEY serial=$SERIAL profile=$P 起跑=$(date +%H:%M) 日志=/Users/administrator/.openclaw/m4-logs/${HOSTKEY}-live.log escort名=escort-$HOSTKEY-$TAG。注意:你上岗时本批尚未做设备preflight与取词单,这两步失败会升级给分身,你看到日志里没有词单行属正常早期阶段。'" 2>>$LOG | grep -oE '"id": "[a-f0-9-]+"' | head -1 | cut -d'"' -f4)
  [[ -n "$ESCORT_ID" ]] && break
  log "escort拉起第${_ea}次失败,30s后重试"
  /bin/sleep 30
done
if [[ -n "$ESCORT_ID" ]]; then
  log "escort已拉起: $ESCORT_ID"
  /bin/sleep 30
  ALIVE=$(ssh -o ConnectTimeout=20 mmv "openclaw cron list" 2>>$LOG | grep -F "escort-$HOSTKEY-$TAG" || true)
  if [[ -n "$ALIVE" ]]; then log "escort复核命中"
  else log "escort复核未命中"; escalate "escort 拉起返回 id=$ESCORT_ID 但 30s 后 cron list 未命中 escort-$HOSTKEY-$TAG，本批可能无人陪跑"; fi
  escort_dismiss() { [[ -n "$ESCORT_ID" ]] && ssh -o ConnectTimeout=20 mmv "openclaw cron rm $ESCORT_ID" >>$LOG 2>&1 && log "escort已注销" }
else
  log "escort拉起3次均失败(不阻塞采收)"
  escalate "escort拉起3次均失败,本批全程无陪跑;网关可能不可达或容器异常,请查网关健康"
fi
run_finalize(){
  finalize_needed || { log "账本finalize: skipped(not_initialized, 正常退让)"; return 0; }
  eval "$(bash "$WFR" finalize 2>>$LOG)" 2>/dev/null || true
  log "账本finalize: ok=${WFR_FINALIZE_OK:-?} ${WFR_FINALIZE_MSG:-}"
  [[ "${WFR_FINALIZE_OK:-0}" == "1" ]] || escalate "账本收工自检未通过: ${WFR_FINALIZE_MSG:-unknown}"
}
if [[ -n "$ESCORT_ID" ]]; then trap 'escort_dismiss; run_finalize' EXIT INT TERM; else trap run_finalize EXIT INT TERM; fi
wr step "$SERIAL" 0 done; wr step "$SERIAL" 1 doing

# ── ② 设备 preflight: 在线 + 屏幕亮 + 解锁(0915 锁屏=整机瘫痪且静默的教训) ──
if ! adb -s $SERIAL get-state >/dev/null 2>&1; then
  log "设备离线,退出"
  escalate "设备 $SERIAL 离线,本批无法起跑(adb get-state 失败);请查 USB/无线调试/机器是否关机"
  wr fail "$SERIAL" 1 device_offline "adb get-state 失败"
  exit 0
fi
W=$(adb -s $SERIAL shell dumpsys power | grep -oE "mWakefulness=[A-Za-z]+" | head -1 | tr -d "\r")
if [[ "$W" != *Awake* ]]; then
  log "屏幕非Awake($W),唤醒解锁"
  adb -s $SERIAL shell input keyevent KEYCODE_WAKEUP; /bin/sleep 1
  adb -s $SERIAL shell input swipe 600 2200 600 800 300; /bin/sleep 1
fi
adb -s $SERIAL shell svc power stayon true 2>/dev/null
wr step "$SERIAL" 1 done

# 触达时窗守卫: 8-22点是触达的地盘,采收 cron 不该在白天抢(冗余保险,crontab已限时)
# 这是**正常退让**不是故障,不升级(升级=狼来了)。
H=$(date +%H)
if (( H >= 8 && H < 22 )); then log "白天触达时窗,采收退让"; wr step "$SERIAL" 1 done "白天时窗退让"; wr done "$SERIAL"; exit 0; fi

# ── ③ 词单←网关(关键词表 SSOT) ──
# ── ③ KPI 闸(0916 主理人要求"KPI驱动自动获客,不是一天三次") ──
# 目标表是 SSOT(飞书「获客｜经营目标」tblpwc9GF9mIhdAG): 改目标改表,不改代码不改 crontab。
# 达标即退让(省设备省额度),未达标按缺口放大词数。闸自身故障 fail-open(宪法帮不拦)。
KPI_JSON=$(ssh -o ConnectTimeout=20 mmv "node /Users/administrator/.openclaw/leadgen-scripts/kpi-gate.js '$BIZ' $N" 2>>$LOG)
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
  [[ -n "$KPI_WORDS" && "$KPI_WORDS" -gt 0 ]] && N=$KPI_WORDS
  log "KPI闸: $KPI_REASON"
fi
wr step "$SERIAL" 2 doing

# 0916 分身实弹报告提案: 必须区分"网关容器停摆"与"真的词单为空"——0916凌晨两批真凶是前者,
# 却因两者都表现为空输出而被误报成后者,害得排查方向指向关键词表(白查)。stderr 才是判据。
# 0916 主理人追问"为何100%跑不完"的根因修复: 采收六步中,只有取词单是"网关挂=批次夭折"的死步
# (拉Commander/KPI闸都已 fail-open,采收主体纯本机,落池失败数据留本地可补)。
# 故给词单加本地缓存: 成功即存,失败用上次的词单顶上——网关病了也照跑,不白瞎一个夜间窗口。
WF=/tmp/kw-$TAG.txt
KWERR=/tmp/kwerr-$TAG.txt
KWCACHE=~/.kw-cache-$P.txt
ssh -o ConnectTimeout=20 mmv "node /Users/administrator/.openclaw/leadgen-scripts/next-keywords.js '$BIZ' $N" > $WF 2>$KWERR
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
NWORDS=$(wc -l < $WF | tr -d ' ')
log "词单 ${NWORDS}词: $(tr '\n' '/' < $WF)"
wr step "$SERIAL" 2 done; wr step "$SERIAL" 3 doing "${NWORDS}词"
wfr_bootstrap "$TAG" "$P" "$WF" "$PUSH" "$SERIAL" "$HOSTKEY"
log "账本init: run=${WFR_RUN_ID:-?} hash=${WFR_HASH:-?}"
log "账本enter: attempt=${WFR_ATTEMPT:-?} skip=${WFR_SKIP_WORDS:-}"

# ── ④ 采收主体 ──
# 终审 I3: batch2-v4 本就按 WFR_SKIP_WORDS 逐词跳过；这里若再传过滤后的 $WF2(与 init 时算 hash
# 用的 $WF 不同) 会让 batch2-v4 的 hash 校验判成 hash_mismatch 误报停跑。传原词单 $WF，filter_words
# 只用来打一行续跑跳过数的日志。
WF2=/tmp/kw-$TAG.run.txt
filter_words "$WF" "$WF2" "${WFR_SKIP_WORDS:-}"
log "续跑跳过 $(( $(wc -l < $WF) - $(wc -l < $WF2) )) 词"
B2OUT=$(/bin/zsh "$BATCH2" "$P" "$WF" "$TAG" "$PUSH" "$SERIAL" 2>&1 | tee -a $LOG || true)
if print -r -- "$B2OUT" | grep -q 'BATCH2_ESCALATE=hash_mismatch'; then escalate "词单在 init 后被改动(hash 不一致)，本批已停(fail-closed)"; fi
log "批完成: $(grep -c '^LEAD' ~/night-$TAG.tsv 2>/dev/null || echo 0) LEAD"
wr step "$SERIAL" 3 done

# ── ⑤ 效果回写(词赛马数据闭环) ──
if [[ "$PUSH" == "1" ]]; then
  wr step "$SERIAL" 4 doing
  ssh -o ConnectTimeout=20 mmv "node /Users/administrator/.openclaw/leadgen-scripts/update-keyword-stats.js" >> $LOG 2>&1
  log "效果已回写关键词表"
  wr step "$SERIAL" 4 done
else
  wr step "$SERIAL" 4 done "PUSH=0 跳过回写"
fi
wr done "$SERIAL"
