#!/bin/zsh
# outreach-tick.sh —— 触达心跳(M4/M1 crontab 每30分钟, 全天0-23点)
# 拟人纪律: ①5%概率本tick安静跳过 ②tick内随机延迟0-5分钟 ③发送前5-25秒停留
#          (private-message-send内部已有主页浏览过程) ④两号轮流分摊
# 0920 主理人拍板: 员工反映人工触达28次左右被限,但系统里从未真实测过平台阈值,现用两个号
#   各测一种升量方式找真实上限(见 dm-rate-ramp-lib.js + config/dm-rate-ramp.json):
#   jinoshengyuan-work=逐日阶梯, legacy=单日内快速阶梯,都设理智天花板60/天。
#   连续2次遇到未识别的新失败模式(classify_failure=other)自动熔断该号,防止真把号测坏
#   (熔断标记 ~/bin-harvest/state/dm-paused-<profile>.flag;0928 起自动熔断均为软熔断、到期自动试发恢复,见 auto_pause)。
# 0920 实测发现结构性瓶颈①: 每30分钟一次tick、每次最多发1条、两号轮流,理论上限只有
#   ~48tick/天×70%执行率÷2号≈17条/号/天,天花板配到55/60也够不着——不是账号被限,是
#   节奏设计把自己锁死了。改成一次tick内可连发多条(每条之间随机停顿,而不是死等到下个
#   30分钟tick),直到当日上限/无待发单/tick时间预算耗尽为止,天花板才有意义被真正测到。
# 0920 实测发现结构性瓶颈②: 修完①之后当天实测(12:36-16:09发13条)仍然够不着上限,
#   拉日志发现原30%拟人跳过+0-20分钟tick延迟+60-300秒单间停顿,在同一天内多次连续
#   撞跳过,累计出现40-74分钟的空窗期——熔断安全网(判定真实限流用)跟"拟人不规律"这两
#   件事被绑在一起调,前者要保守、后者当天要冲量。拍板结果: 拟人跳过降到5%、tick延迟
#   降到0-5分钟、单间停顿降到30-90秒,腾出空窗期去真实测上限；熔断阈值(连续2次未识别
#   失败)不变,这才是真正防止把号测坏的那道闸,跟拟人节奏无关,不能因为冲量就放松。
# 0915 三刀(决策 c5e600a4/c5828297): 链接直达出单 + 瞬时失败执行内密集重试(1-2min×10) + mkdir互斥锁
# 0928 生产事故护栏: ①手机界面读取失败(device_ui)不再归笼统 other——回队列不废线索,连续3次软熔断2小时自动恢复
#   ②熔断/风控/回写失败/认领失败一律 Bark 告警(notify_once 去重) ③取单前算出不可用账号经 --exclude 交给选单器,
#   全部不可用即 NO_SENDER 收工——不再"mark requeue 后 continue"每~20秒空转(4天累计~9800次ssh+飞书调用)
#   ④mark 回写失败重试一次,仍失败告警(悬空「触达中」由选单开头40分钟回收兜底)。
# OUTREACH_TICK_TESTING=1(仅测试用,生产不设): 跳过拟人安静跳过与全部随机停顿/延迟。
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
LOG=~/outreach.log
log(){ print -- "[$(date +%m%d-%H:%M:%S)] $*" >> $LOG }
# 拟人停顿统一走 nap: 测试开关下不睡(生产不设该变量)
nap(){ [[ -n "${OUTREACH_TICK_TESTING:-}" ]] && return 0; /bin/sleep "$1" }
# 脚本目录与状态目录(source 时 $0=被 source 的文件,函数里读不到 $0,所以在顶层先固化)
SCRIPT_DIR="${0:a:h}"
STATE_DIR="$SCRIPT_DIR/state"
OUTREACH_PROFILES=(jinoshengyuan-work legacy)
NOTIFY_JS=/Users/administrator/.openclaw/leadgen-scripts/notify-bark.js

# ── 归因分类(决策 c5828297): 按归因行不按整段——warning: foreground 等非致命行禁止污染判定 ──
# 0923补齐account_mismatch: 0921真实事故(langzi463485被平台登出,设备上实际登的是另一个
# 不相关账号)复现的原始信号"current sender account does not match the claimed distribution
# account"/"current Douyin account identity was not visible on the verified Me page"当时被
# 分类进笼统的"other",要等连续2次+人工翻~/anomaly-*.log肉眼诊断才知道是号掉了——这次改成
# 一次命中就直接识别、直接停发,不用等第2次撞上、也不用人工再猜一遍原因。
classify_failure() {
  local out="$1" last_fc tail5
  last_fc=$(print -- "$out" | grep -oE 'failure_class=[A-Z_]+' | tail -1 | cut -d= -f2)
  if [[ "$last_fc" == "TARGET_ABSENT" ]]; then print terminal; return; fi
  if print -- "$out" | grep -qiE 'sender account does not match the claimed distribution account|Douyin account identity was not visible on the verified Me page'; then
    print account_mismatch; return
  fi
  tail5=$(print -- "$out" | tail -5)
  if print -- "$tail5" | grep -qiE 'AdbIME|input method|_ime'; then print transient; return; fi
  # 0928 device_ui: 手机界面读取失败(uiautomator dump 不出/回不到抖音首页/前台不对/无root)——设备环境问题,
  # 不是账号问题:0928 legacy 因此被归 other 连续3次永久熔断+线索被标受阻。account_mismatch 判定在上面,
  # 账号不符比界面问题更严重,不能被本类抢走。"verified private-message input was not found"
  # 可能是账号被限制(私信框都没了),保守仍归 other,不在此列。
  if print -- "$out" | grep -qiE 'ui hierarchy unavailable|uiautomator dump did not produce|could not return to the Douyin feed|failure_class=WRONG_FOREGROUND|failure_class=NO_ROOT'; then
    print device_ui; return
  fi
  print other
}

# ── 0928 告警通道: 经 mmv 上的 notify-bark.js 发 Bark。notify 用 BARK_OK 判成败(ssh 退出码不可信) ──
notify(){
  local title="$1" body="$2" level="${3:-timeSensitive}" tb bb out
  tb=$(print -rn -- "$title" | /usr/bin/base64 | tr -d '\n')
  bb=$(print -rn -- "$body" | /usr/bin/base64 | tr -d '\n')
  out=$(ssh -o ConnectTimeout=15 -o BatchMode=yes mmv "node $NOTIFY_JS $tb $bb $level" 2>/dev/null)
  [[ "$out" == *BARK_OK* ]]
}
# notify_once <key> <title> <body> [ttl_sec=86400]: ttl 内同 key 不重发;发送失败不记 marker(下次再试)
notify_once(){
  local key="$1" title="$2" body="$3" ttl="${4:-86400}" marker last now
  /bin/mkdir -p "$STATE_DIR"
  marker="$STATE_DIR/notify-${key}.marker"
  now=$(date +%s)
  last=$(cat "$marker" 2>/dev/null || echo 0)
  [[ "$last" == <-> ]] || last=0
  (( now - last < ttl )) && return 0
  if notify "$title" "$body"; then
    print -- "$now" > "$marker"
    log "📣 已发告警[${key}]: ${title}"
  else
    log "⚠️ 告警发送失败[${key}]: ${title}(不记marker,下次再试)"
    return 1
  fi
}

# ── 0928 回写: 失败(输出不含 MARKED,含 MARK_FAIL 或 ssh 本身挂了)3 秒后重试一次;仍失败告警。
# 单子会悬空在「触达中」,由选单器开头的 40 分钟悬空回收兜底。签名/日志行为同旧版。
mark(){
  local rid="$1" res="$2" note="$3" nb out attempt
  nb=$(print -n -- "$note" | /usr/bin/base64 | tr -d '\n')
  for attempt in 1 2; do
    out=$(ssh -o ConnectTimeout=15 mmv "node /Users/administrator/.openclaw/leadgen-scripts/next-outreach.js done $rid $res $nb" 2>&1)
    print -r -- "$out" >> $LOG
    [[ "$out" == *MARKED* ]] && return 0
    (( attempt == 1 )) && { log "回写未确认(${res} ${rid}),3秒后重试一次"; nap 3 }
  done
  log "❌ 回写飞书失败: 单 ${rid} ${res}(两次均无MARKED),单子可能悬空在触达中"
  notify_once "markfail" "获客触达回写失败" "单 ${rid} 回写飞书失败，单子可能悬空(40分钟后自动回收)" 3600
  return 1
}

# ── 0928 账号可用性: 取单前算出哪些号不可用,经 --exclude 交给选单器(修 20 秒空转) ──
# 软熔断 flag 第一行 soft_until=<epoch秒>(device_ui 连续3次写入,2小时后自动恢复);其余内容(空文件/普通文本)=永久熔断,须人工删。
soft_pause_until(){ local l; l=$(head -1 "$1" 2>/dev/null); [[ "$l" == soft_until=<-> ]] && print -- "${l#soft_until=}"; return 0 }
# profile_unavailable <profile>: 空=可用;否则输出原因 paused|halted|cap(按此顺序判)
profile_unavailable(){
  local p="$1" flag until_ts now dtag count cap
  flag="$STATE_DIR/dm-paused-$p.flag"
  now=$(date +%s)
  if [[ -f "$flag" ]]; then
    until_ts=$(soft_pause_until "$flag")
    if [[ -z "$until_ts" ]] || (( now <= until_ts )); then print paused; return 0; fi
  fi
  dtag=$(TZ=Asia/Shanghai date +%Y%m%d)
  if [[ -f "$STATE_DIR/dm-halt-$p-$dtag.txt" ]]; then print halted; return 0; fi
  count=$(cat "$STATE_DIR/dm-count-$p-$dtag.txt" 2>/dev/null || echo 0)
  cap=$(node "$SCRIPT_DIR/dm-daily-cap.js" "$p" 2>/dev/null)
  if [[ "$count" == <-> && "$cap" == <-> ]] && (( count >= cap )); then print cap; return 0; fi
  return 0
}
# unavailable_list: 逗号分隔的不可用 profile 名(无则空)
unavailable_list(){
  local p out=""
  for p in "${OUTREACH_PROFILES[@]}"; do
    [[ -n "$(profile_unavailable "$p")" ]] && out+="${out:+,}$p"
  done
  print -- "$out"
}
# unavailable_detail: 日志/告警用 "profile=原因" 逗号列表
unavailable_detail(){
  local p r out=""
  for p in "${OUTREACH_PROFILES[@]}"; do
    r=$(profile_unavailable "$p")
    [[ -n "$r" ]] && out+="${out:+,}${p}=${r}"
  done
  print -- "$out"
}
# auto_pause <profile> <原因首行> [原始输出片段]: 熔断后的恢复由系统自动判定(决策 e08227ee,0928 触达停摆 4 天无人知)——
# 写软熔断 flag(第一行 soft_until=<epoch>),冷却 = min(2h × 2^(n-1), 24h),n = 连续自动熔断次数(dm-pausecount-<p>.txt)。
# 到期由 expire_soft_pauses 自动解除;到期后的第一单即半开试发(调用方把 anomaly 计数留在 1,再失败一次立刻再熔断、冷却翻倍);
# 任一发送成功清零 pausecount/anomaly。人工放入的永久 flag(无 soft_until)仍绝不自动清。
auto_pause(){
  local p="$1" why="$2" raw="${3:-}" cf n cool until_ts hours flag
  cf="$STATE_DIR/dm-pausecount-$p.txt"
  n=$(( $(cat "$cf" 2>/dev/null || echo 0) + 1 ))
  print -- "$n" > "$cf"
  cool=$(( 7200 * (1 << (n > 5 ? 5 : n - 1)) )); (( cool > 86400 )) && cool=86400
  until_ts=$(( $(date +%s) + cool )); hours=$(( cool / 3600 ))
  flag="$STATE_DIR/dm-paused-$p.flag"
  {
    echo "soft_until=$until_ts"
    echo "$(date '+%Y%m%d %H:%M') 自动熔断(第${n}次): ${why}"
    echo "冷却 ${hours} 小时后自动解除并试发一单:成功即恢复,失败则再熔断且冷却翻倍(封顶 24 小时)。无需人工处理。"
    [[ -n "$raw" ]] && print -- "$raw" | tail -5 | head -c 600
  } > "$flag"
  log "⏸️ $p 自动熔断第${n}次,${hours}小时后自动试发: ${why}"
  local extra=""; (( n >= 3 )) && extra="已连续${n}次自动试发失败,建议看一眼手机状态。"
  notify_once "pause-$p-$n" "获客触达熔断" "${p}${why}，已自动暂停${hours}小时，到期自动试发一单，成功即恢复。${extra}" "$cool"
}

# expire_soft_pauses: 过期的软熔断 flag 删除并重置 dm-uifail 计数;永久熔断绝不自动清
expire_soft_pauses(){
  local f p until_ts now
  now=$(date +%s)
  for f in "$STATE_DIR"/dm-paused-*.flag(N); do
    until_ts=$(soft_pause_until "$f")
    [[ -n "$until_ts" ]] || continue
    if (( now > until_ts )); then
      p="${${f:t}#dm-paused-}"; p="${p%.flag}"
      /bin/rm -f "$f" "$STATE_DIR/dm-uifail-$p.txt"
      log "♻️ ${p} 软熔断已到期自动恢复(界面读取失败计数已重置)"
    fi
  done
  # 熔断已被人工清除(flag 不在)→ 重置该账号的熔断告警去重 marker,否则当天再次熔断不会再响
  for p in "${OUTREACH_PROFILES[@]}"; do
    [[ -e "$STATE_DIR/dm-paused-$p.flag" ]] || /bin/rm -f "$STATE_DIR/notify-pause-$p.marker"
  done
  return 0
}

# source 守卫: smoke 层4 以 OUTREACH_TICK_SOURCED=1 source 本文件只取函数,不执行主体
[[ -n "${OUTREACH_TICK_SOURCED:-}" ]] && return 0

# 可视化旁路(0919): 触达每阶段报给控制塔; 上报失败一律吞掉
WR=${WALL_REPORT:-$HOME/bin-harvest/wall-report.sh}
wr(){ [[ -x "$WR" ]] && "$WR" "$@" >/dev/null 2>&1; true }
export WALL_NS=outreach   # 上报器按命名空间分状态文件: 触达链与采收链同机同序列号互不顶状态

# 0920 时窗已放开到全天(阶梯测试拍板),不再卡8-22点

# 拟人①: 30% 概率安静跳过
[[ -z "${OUTREACH_TICK_TESTING:-}" ]] && (( RANDOM % 20 < 1 )) && { log "拟人跳过本tick"; exit 0 }

# ── tick 互斥(mkdir 原子锁,家法同 douyin-phone-adb lock-acquire): 重试拉长运行时长后防重入 ──
# 活性说明: mtime=最后活动时间(重试循环每轮 touch 刷新,防真在跑的tick被误判为尸锁);
#          owner(pid文件)=归属校验,trap 只删自己抢到的锁,防旧tick退出时误删新tick的锁
TICK_LOCK="${OUTREACH_TICK_LOCK:-/tmp/outreach-tick.lock}"   # OUTREACH_TICK_LOCK 仅供测试隔离,生产不设
if ! /bin/mkdir "$TICK_LOCK" 2>/dev/null; then
  # stale 回收: 目录 mtime 超 35 分钟视为上轮尸锁
  if [[ -n "$(find "$TICK_LOCK" -maxdepth 0 -mmin +35 2>/dev/null)" ]]; then
    /bin/rm -rf "$TICK_LOCK" 2>/dev/null
    /bin/mkdir "$TICK_LOCK" 2>/dev/null || { log "锁竞争,跳过"; exit 0 }
    echo $$ > "$TICK_LOCK/pid"
    log "回收尸锁后继续"
  else
    log "上轮tick在跑,跳过"; exit 0
  fi
else
  echo $$ > "$TICK_LOCK/pid"
fi
trap '[[ "$(cat "$TICK_LOCK/pid" 2>/dev/null)" == "$$" ]] && /bin/rm -rf "$TICK_LOCK"' EXIT INT TERM

# 拟人②: 随机延迟 0-1200 秒(0920 拉宽区间,弱化"整点/半点必发"的规律感)
DELAY=$(( RANDOM % 300 ))
log "本tick延迟 ${DELAY}s 后执行"
nap $DELAY

# 0921 网关迁移: us-vps 那份 openclaw-gateway 容器已退役(决策 96054a8b 零执行铁律,
# 迁移见 /root/.openclaw-gateway-retired),取单/去重脚本随迁移落到 MMV 原生跑(不再
# 经 docker exec),下面 ssh 走的是这台机器上早就配好的 SSH 密钥认证(标准 known_hosts
# + 私钥,不在命令行传密码/token)。
C=~/.local/bin/douyin-phone-adb
/bin/mkdir -p "$STATE_DIR"

# 0920 一次tick内可连发多条(见文件头说明): 时间预算25分钟(给下个30分钟tick留5分钟
# 缓冲),每发完一条随机停顿(60-300秒,依然是"突发式"不是"匀速机械"),再取下一单,
# 直到无待发单/当日上限/时间预算耗尽为止。while 条件在每轮取单前重新判断一次经过的
# 秒数,时间预算耗尽时循环体不会再启动新一轮,自然从 while 退出、往下走到收工日志,
# 不存在"预算耗尽后还卡在循环里出不来"的情况。
TICK_BODY_START=$SECONDS
TICK_LOG_OFF=$(wc -l < $LOG 2>/dev/null | tr -d ' ')   # 9032cdad: 步骤 DoD 的 log 类只判本 tick 的日志段
TICK_BUDGET=1500
SENDS_THIS_TICK=0
ORDERS_PICKED=0; BLOCKED_ORDERS=0   # 6b133a81 触达进账本: outreach 工件闭集 orders_picked/messages_sent/requeued/blocked_orders
# CONSEC_CAP_HITS: 连续撞上限计数器,完整生命周期都在本文件里——这里初始化为0，
# 命中当日上限的分支里 +1 并在连续两次时收工(见下方"撞上限"分支)，只要有一次
# 没撞上限(说明选单器换到了另一个号)就立刻重置回0(见本循环体末尾)。
CONSEC_CAP_HITS=0
# 0928 纵深防御计数: 选单已避开不可用账号,正常不会再进入下面的 paused/halt/cap 分支;
# 万一进入(选单器回退/被替换),连续 STALL_LIMIT 次就收工整个tick,不再空转。取到可发单时清零。
STALL=0
STALL_LIMIT=3

while (( SECONDS - TICK_BODY_START < TICK_BUDGET )); do
  expire_soft_pauses   # 每轮取单前先清到期软熔断(tick 开头即第一轮)
  DATE_TAG=$(TZ=Asia/Shanghai date +%Y%m%d)
  # 0928 取单前先算不可用账号(熔断/当日停发/撞上限),经 --exclude 交给选单器——
  # 不再"选到坏号→requeue→continue→又选到同一条线索"每~20秒空转。
  EXCL=$(unavailable_list)
  # 取单(网关选单器: 重复高亮优先→A级→B级, 预写触达中防重)。--exclude 拼在同一个远端命令字符串里(逗号列表无空格,安全)
  ORDER=$(ssh -o ConnectTimeout=15 mmv 'node /Users/administrator/.openclaw/leadgen-scripts/next-outreach.js next'"${EXCL:+ --exclude $EXCL}" 2>>$LOG)
  [[ "$ORDER" == "NO_PENDING" || -z "$ORDER" ]] && { log "无待触达单,本tick结束(已发${SENDS_THIS_TICK}条)"; break }
  [[ "$ORDER" == NO_SCRIPT* ]] && { log "话术缺失: $ORDER,本tick结束(已发${SENDS_THIS_TICK}条)"; break }
  if [[ "$ORDER" == NO_SENDER* ]]; then
    # 所有触达账号都不可用: 立即收工整个tick(不 mark、不空转)。有熔断的账号要告警——熔断是"要人处理"的事。
    UNAVAIL_DETAIL=$(unavailable_detail)
    log "所有触达账号均不可用(${UNAVAIL_DETAIL:-无}),本tick结束(已发${SENDS_THIS_TICK}条)"
    if [[ "$UNAVAIL_DETAIL" == *=paused* ]]; then
      notify_once "paused-all-${DATE_TAG}" "获客触达停摆" "触达账号均不可用: ${UNAVAIL_DETAIL}。paused=熔断(原因见 ${STATE_DIR}/dm-paused-*.flag,自动熔断到期自动试发恢复;仅人工放入的永久熔断需人工解除);halted=今日风控停发(明日自动恢复),cap=今日已达发送上限。" 86400
    fi
    break
  fi
  if [[ "$ORDER" == CLAIM_FAILED* ]]; then
    # 选单器预写「触达中」失败/回读不符: 这一单不能发(单子状态不可信),整个tick收工并告警
    log "选单认领失败: ${ORDER},本tick结束(已发${SENDS_THIS_TICK}条)"
    notify_once "claim-failed" "获客触达选单认领失败" "选单器预写触达中失败或回读不符(${ORDER}),本tick已停发。若持续出现请查飞书线索表写权限/字段。" 3600
    break
  fi
  if [[ "$ORDER" != \{* ]]; then
    log "选单器返回无法识别的内容,本tick结束: ${ORDER:0:150}"
    break
  fi

  RID=$(print -- "$ORDER"     | python3 -c "import json,sys;print(json.load(sys.stdin)['rid'])")
  DYID=$(print -- "$ORDER"    | python3 -c "import json,sys;print(json.load(sys.stdin)['dyid'])")
  MSGB64=$(print -- "$ORDER"  | python3 -c "import json,sys;print(json.load(sys.stdin)['msg_b64'])")
  PROFILE=$(print -- "$ORDER" | python3 -c "import json,sys;print(json.load(sys.stdin)['profile'])")
  SENDER=$(print -- "$ORDER"  | python3 -c "import json,sys;print(json.load(sys.stdin)['sender_id'])")
  SEQ=$(print -- "$ORDER"     | python3 -c "import json,sys;print(json.load(sys.stdin)['seq'])")
  NICK=$(print -- "$ORDER"    | python3 -c "import json,sys;print(json.load(sys.stdin)['nick'])")
  PURL=$(print -- "$ORDER"    | python3 -c "import json,sys;print(json.load(sys.stdin).get('profile_url',''))")
  log "单#$SEQ: $NICK($DYID) via $SENDER [$PROFILE] ${PURL:+link}"
  ORDERS_PICKED=$(( ORDERS_PICKED + 1 ))
  # 可视化: 任务 start 放在拿到锁之后——锁被采收占着时不 start,否则会把同机正在跑的采收任务顶掉(409 superseded)
  WR_STARTED=0

  # ── 0920 阶梯测试: 熔断标记 + 当日发送上限闸(在真发之前拦,别浪费一次真实发送尝试) ──
  # 0928: 选单已经通过 --exclude 避开了这三类不可用账号,下面三个分支正常不会再进入,
  # 只作纵深防御保留;进入时 STALL 计数,连续 STALL_LIMIT 次直接收工整个tick(防空转复发)。
  PAUSE_FLAG="$STATE_DIR/dm-paused-$PROFILE.flag"
  if [[ -f "$PAUSE_FLAG" ]]; then
    log "⛔ $PROFILE 已熔断(见 $PAUSE_FLAG),回队列"
    mark "$RID" requeue "circuit breaker paused, see $PAUSE_FLAG"
    STALL=$(( STALL + 1 ))
    (( STALL >= STALL_LIMIT )) && { log "连续${STALL}次拿到不可用账号的单(空转防护),本tick结束(已发${SENDS_THIS_TICK}条)"; break }
    continue
  fi
  COUNT_FILE="$STATE_DIR/dm-count-$PROFILE-$DATE_TAG.txt"
  # 0923修正: 此前风控命中会把COUNT_FILE直接改写成CAP值("已发数"和"今日是否该停发"
  # 两件事共用同一个字段),导致日志里"今日已达阶梯上限60/60"看起来像真发了60条,
  # 实际当天legacy号只有10条真送达+1条仅互关+1条风控=12次真实尝试。改成独立的
  # HALT_FILE(风控/异常触发的"今日停发"标记),COUNT_FILE只记真实尝试次数,两件事
  # 分开存,谁都不撒谎。
  HALT_FILE="$STATE_DIR/dm-halt-$PROFILE-$DATE_TAG.txt"
  TODAY_SENT=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
  CAP=$(node "$(dirname "$0")/dm-daily-cap.js" "$PROFILE")
  if [[ -f "$HALT_FILE" ]]; then
    log "今日($PROFILE)已因风控停发(见 $HALT_FILE,真实发送${TODAY_SENT}条),回队列"
    mark "$RID" requeue "halted after rate limit hit today (real sent=${TODAY_SENT})"
    CONSEC_CAP_HITS=$(( CONSEC_CAP_HITS + 1 ))
    (( CONSEC_CAP_HITS >= 2 )) && { log "连续${CONSEC_CAP_HITS}次撞上限,本tick结束(已发${SENDS_THIS_TICK}条)"; break }
    STALL=$(( STALL + 1 ))
    (( STALL >= STALL_LIMIT )) && { log "连续${STALL}次拿到不可用账号的单(空转防护),本tick结束(已发${SENDS_THIS_TICK}条)"; break }
    continue
  fi
  if (( TODAY_SENT >= CAP )); then
    log "今日($PROFILE)已达阶梯上限 ${TODAY_SENT}/${CAP},回队列"
    mark "$RID" requeue "daily cap reached (${TODAY_SENT}/${CAP})"
    # 命中一次当日上限: 计数器 +1；连续2次撞上限(两个号大概率都到顶了,选单器轮流
    # 分配,再取单也是空转)才收工,单次撞上限只 continue 换下一单,不会误判整体结束。
    CONSEC_CAP_HITS=$(( CONSEC_CAP_HITS + 1 ))
    (( CONSEC_CAP_HITS >= 2 )) && { log "连续${CONSEC_CAP_HITS}次撞上限,本tick结束(已发${SENDS_THIS_TICK}条)"; break }
    STALL=$(( STALL + 1 ))
    (( STALL >= STALL_LIMIT )) && { log "连续${STALL}次拿到不可用账号的单(空转防护),本tick结束(已发${SENDS_THIS_TICK}条)"; break }
    continue
  fi
  # 这一单没撞上限(选到了还有余量的号): 计数器归零,不让上一次的撞上限计数
  # 跨单误累加(必须是"连续"两次才收工,中间插一次正常单就该重新计)。
  CONSEC_CAP_HITS=0
  STALL=0   # 取到可发单: 空转防护计数清零

  # ── 发送尝试循环(决策 c5828297): 瞬时失败就地重试,间隔60-120s,上限10次,总时长护栏22分钟 ──
  MAX_ATTEMPTS=10
  LOOP_START=$SECONDS
  ATTEMPT=1
  ORDER_RESULT=""
  while [[ -z "$ORDER_RESULT" ]]; do
    /usr/bin/touch "$TICK_LOCK"
    TAG="outreach-$(date +%m%d%H%M)-a${ATTEMPT}"
    if ! $C --profile "$PROFILE" lock-acquire "$TAG" >>$LOG 2>&1; then
      # 0920 锁忙重试: 先在本tick预算内短重试(15-30s间隔,最多180s),扛住"手工临时任务/
      # 短构建"这类几十秒到几分钟就释放的瞬时占用——否则直接收工整个tick要等下一个
      # 30分钟cron点才能再摸这一单,一次瞬时锁碰撞就白扔半小时吞吐量。
      LOCK_WAIT_START=$SECONDS
      LOCK_RETRY_BUDGET=180
      LOCK_ACQUIRED=0
      while (( SECONDS - LOCK_WAIT_START < LOCK_RETRY_BUDGET )); do
        sleep $(( 15 + RANDOM % 16 ))
        if $C --profile "$PROFILE" lock-acquire "$TAG" >>$LOG 2>&1; then
          LOCK_ACQUIRED=1
          log "锁重试后已获取(等待$(( SECONDS - LOCK_WAIT_START ))s)"
          break
        fi
      done
      if (( LOCK_ACQUIRED == 0 )); then
        log "锁被占(采收在用),重试${LOCK_RETRY_BUDGET}s仍未获取,回队列待下轮,本tick结束(已发${SENDS_THIS_TICK}条)"; mark "$RID" requeue "lock busy"
        # 第 2 次及以后尝试才可能已 start(拿过锁), 此时要把已开的任务收成 fail; 第 1 次未 start 不调
        (( WR_STARTED == 1 )) && wr fail --profile "$PROFILE" 0 lock_busy "重试中锁被采收占用"
        break 2   # 长时间占用是环境性问题(通常是采收在跑一整轮),直接收工整个tick
      fi
    fi
    if (( WR_STARTED == 0 )); then wr start --profile "$PROFILE" "触达·单#$SEQ $NICK" "发送,核验"; WR_STARTED=1; fi
    wr step --profile "$PROFILE" 0 doing "第${ATTEMPT}次发送"
    # 拟人③: 发送前 5-25 秒停顿(0920 拉宽区间)
    nap $(( 5 + RANDOM % 21 ))
    OUT=$($C --profile "$PROFILE" private-message-send "$SENDER" "$DYID" "$MSGB64" "$TAG" ${PURL:+"$PURL"} </dev/null 2>&1)
    RC=$?
    print -- "$OUT" | grep -vE "file pulled" | tail -4 >> $LOG

    if print -- "$OUT" | grep -q "send_status=sent"; then
      RAWTAIL=$(print -- "$OUT" | tail -3 | tr '\n' ' ' | cut -c1-180)
      wr step --profile "$PROFILE" 0 done; wr step --profile "$PROFILE" 1 doing "核验仅互关"
      # 0920: 计入今日发送计数(不管后面判成功还是仅互关受限,都是一次真实发送尝试);
      # 且证明账号还能正常发送,清掉连续异常计数(熔断只认"连续"未识别失败)。
      echo $(( $(cat "$COUNT_FILE" 2>/dev/null || echo 0) + 1 )) > "$COUNT_FILE"
      rm -f "$STATE_DIR/dm-anomaly-$PROFILE.txt" "$STATE_DIR/dm-uifail-$PROFILE.txt" "$STATE_DIR/dm-pausecount-$PROFILE.txt"
      # 0919 真机实证(截图+ui-evidence XML实锤): 消息气泡渲染成功≠真送达——对方设置
      # "仅互关可发消息"时,气泡照样能发出来(send_status=sent),但对方收不到,界面会
      # 追加系统提示"...暂无法给对方发送消息"。发送后借同一把锁二次核验,不能只信气泡。
      RESTRICT_TAG="$TAG-restrict"
      $C --profile "$PROFILE" ui-evidence "$RESTRICT_TAG" >>$LOG 2>&1
      RESTRICT_XML="/private/tmp/openclaw-phone/evidence/$PROFILE/$RESTRICT_TAG.xml"
      $C --profile "$PROFILE" lock-release "$TAG" >>$LOG 2>&1 || true
      if [[ -f "$RESTRICT_XML" ]] && grep -qF "暂无法给对方发送消息" "$RESTRICT_XML" 2>/dev/null; then
        mark "$RID" restricted "对方仅互关可发消息,消息气泡已出但对方收不到"
        log "⚠️ 单#$SEQ 气泡已发但仅互关限制,标记受限(不计成功触达)"
        wr step --profile "$PROFILE" 1 done "受限"; wr done --profile "$PROFILE"
        ORDER_RESULT="restricted"
        break
      fi
      # 0923真机实证(0922-11:54单#172原始XML实锤): 气泡渲染成功≠真送达的第二种情形——
      # 短期内私信陌生人过于频繁,平台弹出"给陌生人发送消息过于频繁，请稍后再发送陌生人
      # 消息",气泡照样是send_status=sent,之前这条被直接MARKED sent计成功,主理人肉眼
      # 回看当天记录才发现是假成功。这跟"仅互关"不是同一件事——那是对方的限制(这个人
      # 永远发不通),这是**本账号**当下撞了频率闸(换个人多半照样发不通,今天剩下的单
      # 全部先别发),处理方式也不同:不判"受限"(那是对这条线索的永久性判断),而是让
      # 今日改走独立的HALT_FILE标记停发(0923修正: 此前直接echo "$CAP" > "$COUNT_FILE"
      # 会让"已发送计数"和"是否该停发"两件事共用一个字段,COUNT_FILE从此不再反映真实
      # 发送数——0923实测复现: legacy号当天真实只送达10条+受限1条+本次风控1条=12次
      # 尝试,但日志此后一直显示"今日已达阶梯上限60/60",误导成"发了60条"。COUNT_FILE
      # 不再被本分支改写,继续如实累计真实尝试次数;"今天要不要停"改由HALT_FILE单独
      # 表达,读的时候两件事分开看,谁都不撒谎。
      if [[ -f "$RESTRICT_XML" ]] && grep -qF "发送消息过于频繁" "$RESTRICT_XML" 2>/dev/null; then
        mark "$RID" rate_limited "触发平台风控(短期内发送陌生人消息过于频繁)"
        REAL_SENT_NOW=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
        echo "$(date '+%Y%m%d %H:%M') 触发平台风控(发送消息过于频繁),真实发送${REAL_SENT_NOW}条后停发" > "$HALT_FILE"
        log "🚦 单#$SEQ 触发平台风控(发送消息过于频繁),$PROFILE 今日真实发送${REAL_SENT_NOW}条后停发(见$HALT_FILE)"
        wr step --profile "$PROFILE" 1 done "风控"; wr done --profile "$PROFILE"
        ORDER_RESULT="rate_limited"
        notify_once "halt-${PROFILE}-${DATE_TAG}" "获客触达触发平台风控" "${PROFILE}今日真实发送${REAL_SENT_NOW}条后被平台限频，今日停发(明日自动恢复,见 ${HALT_FILE})" 86400
        break
      fi
      mark "$RID" sent "$RAWTAIL"
      log "✅ 单#$SEQ 送达(第${ATTEMPT}次尝试)"
      wr step --profile "$PROFILE" 1 done; wr done --profile "$PROFILE"
      ORDER_RESULT="sent"
      break
    fi

    $C --profile "$PROFILE" lock-release "$TAG" >>$LOG 2>&1 || true
    CLS=$(classify_failure "$OUT")
    REASON=$(print -- "$OUT" | grep -E "failure_class=|die|not" | tail -1 | head -c 150)
    if [[ "$CLS" == "device_ui" ]]; then
      # 0928 手机界面读取失败(设备环境问题,不是账号问题): 订单回队列,绝不标 failed/受阻(那会永久废掉一条线索);
      # 不做就地重试(对坏界面反复点只会更糟);连续 3 次 → 软熔断 2 小时(flag 第一行 soft_until=<epoch>,
      # 到期由 expire_soft_pauses 自动恢复),同时 Bark 告警。任何一次发送成功会清零计数。
      UIFAIL_FILE="$STATE_DIR/dm-uifail-$PROFILE.txt"
      UIFAIL_COUNT=$(( $(cat "$UIFAIL_FILE" 2>/dev/null || echo 0) + 1 ))
      echo "$UIFAIL_COUNT" > "$UIFAIL_FILE"
      print -- "$OUT" >> ~/anomaly-$PROFILE.log
      log "📵 单#$SEQ 手机界面读取失败(第${UIFAIL_COUNT}次连续,device_ui): ${REASON:-rc=$RC},回队列不废线索"
      if (( UIFAIL_COUNT >= 3 )) && [[ ! -f "$PAUSE_FLAG" ]]; then
        {
          echo "soft_until=$(( $(date +%s) + 7200 ))"
          echo "$(date '+%Y%m%d %H:%M') 自动检测: 手机界面连续${UIFAIL_COUNT}次读取失败(device_ui),环境性软熔断2小时,到期自动恢复"
          echo "最近一次原始输出片段: $(print -- "$OUT" | tail -5 | tr '\n' ' ' | head -c 300)"
        } > "$PAUSE_FLAG"
        log "⏸️ $PROFILE 手机界面连续${UIFAIL_COUNT}次读取失败,软熔断2小时(见 $PAUSE_FLAG,到期自动恢复)"
        notify_once "softpause-$PROFILE" "获客触达软熔断" "${PROFILE}手机界面连续${UIFAIL_COUNT}次读取失败,已软熔断2小时(到期自动恢复)。请检查手机是否卡死/锁屏/前台异常,详情见 ${PAUSE_FLAG}" 7200
      fi
      mark "$RID" requeue "device ui: ${REASON:-rc=$RC}"
      wr fail --profile "$PROFILE" 0 "$CLS" "${REASON:-rc=$RC}"
      ORDER_RESULT="device_ui"
      break
    fi
    if [[ "$CLS" != "transient" ]]; then
      if [[ "$CLS" == "other" ]]; then
        # 0920 自动熔断安全网: "other"=classify_failure认不出的新失败模式,连续2次判定
        # 可能撞上了真实平台限流/封号,自动停发该号,防止在真实账号上继续加压测坏。
        ANOMALY_FILE="$STATE_DIR/dm-anomaly-$PROFILE.txt"
        ANOMALY_COUNT=$(( $(cat "$ANOMALY_FILE" 2>/dev/null || echo 0) + 1 ))
        echo "$ANOMALY_COUNT" > "$ANOMALY_FILE"
        print -- "$OUT" >> ~/anomaly-$PROFILE.log
        log "🚨 单#$SEQ 未识别新失败模式(第${ANOMALY_COUNT}次连续),原始输出已存 ~/anomaly-$PROFILE.log"
        if (( ANOMALY_COUNT >= 2 )); then
          auto_pause "$PROFILE" "连续${ANOMALY_COUNT}次未识别失败(可能是平台限流,原始输出见 ~/anomaly-$PROFILE.log)" "$OUT"
          echo 1 > "$ANOMALY_FILE"   # 半开:到期后的第一单再失败一次即再熔断
        fi
      elif [[ "$CLS" == "account_mismatch" ]]; then
        # 0923真机实证(0921晚langzi463485被登出事故复现): 设备上登的账号跟本单要求分发的账号对不上,一次就能确定
        # 不是偶发抖动——继续用错账号重试只会把消息以错误身份发给真实线索。第一次命中就停发;身份核验在发送前,
        # 到期试发同样先核验,不会用错身份发出去,故恢复也交给 auto_pause 自动判定(重新登录后下次试发即恢复)。
        auto_pause "$PROFILE" "账号身份校验失败(登录账号与分发账号${SENDER}不符,可能被登出)" "$(print -- "$OUT" | grep -E 'sender account does not match|account identity was not visible' | tail -1 | head -c 200)"
      fi
      mark "$RID" failed "${REASON:-rc=$RC}"
      log "❌ 单#$SEQ 失败($CLS): ${REASON:-rc=$RC}"
      wr fail --profile "$PROFILE" 0 "$CLS" "${REASON:-rc=$RC}"
      ORDER_RESULT="failed"
      break
    fi
    if (( ATTEMPT >= MAX_ATTEMPTS )) || (( SECONDS - LOOP_START > 1320 )); then
      mark "$RID" requeue_transient "${REASON:-rc=$RC} (attempts=$ATTEMPT)"
      log "🔁 单#$SEQ 瞬时失败${ATTEMPT}次用尽,回队列: ${REASON:-rc=$RC}"
      wr fail --profile "$PROFILE" 0 transient_exhausted "${REASON:-rc=$RC}"
      ORDER_RESULT="requeue_transient"
      break
    fi
    BACKOFF=$(( 60 + RANDOM % 61 ))
    log "⏳ 单#$SEQ 瞬时失败(第${ATTEMPT}次): ${REASON:-rc=$RC},${BACKOFF}s 后重试"
    wr note --profile "$PROFILE" "第${ATTEMPT}次瞬时失败,${BACKOFF}s后重试"
    nap $BACKOFF
    ATTEMPT=$(( ATTEMPT + 1 ))
  done

  [[ "$ORDER_RESULT" == "sent" || "$ORDER_RESULT" == "restricted" ]] && SENDS_THIS_TICK=$(( SENDS_THIS_TICK + 1 ))
  [[ "$ORDER_RESULT" == "failed" || "$ORDER_RESULT" == "rate_limited" ]] && BLOCKED_ORDERS=$(( BLOCKED_ORDERS + 1 ))

  # 本单已有结果(不是因为设备被占用而收工整个tick),继续取下一单前随机停顿——
  # 一个tick里可能连发好几条,但不是不停顿地机器人式连发。
  BETWEEN_ORDERS_PAUSE=$(( 30 + RANDOM % 61 ))
  log "本单处理完(${ORDER_RESULT:-unknown}),${BETWEEN_ORDERS_PAUSE}s 后看下一单"
  nap $BETWEEN_ORDERS_PAUSE
done
log "本tick收工,累计发送(含受限)${SENDS_THIS_TICK}条"
# ── 6b133a81 触达进账本: 每 tick 收工写一个 outreach 工件(workflow-result.sh outreach-run),读回 out_no_stuck_inflight
#   (本 tick 结束后线索表不得留悬空「触达中」);不过按探针失败语义(retryable→本 tick 判失败,由选单 40 分钟回收兜底)。
#   WFR_DISABLED=1 或账本脚本不在 → no-op(测试把脚本拷到临时目录时即不在)。
outreach_ledger(){
  local wfr_sh="${WFR:-$SCRIPT_DIR/workflow-result.sh}" out req
  [[ "${WFR_DISABLED:-0}" != 1 && -x "$wfr_sh" ]] || return 0
  req=$(( ORDERS_PICKED - SENDS_THIS_TICK - BLOCKED_ORDERS )); (( req < 0 )) && req=0
  out=$(WFR_LOG_FILE=$LOG WFR_LOG_FROM=${TICK_LOG_OFF:-0} bash "$wfr_sh" outreach-run "out$(date +%m%d%H%M)" "${OUTREACH_PROFILES[1]}" "" "$(hostname -s)" "tick picked=$ORDERS_PICKED sent=$SENDS_THIS_TICK" \
    "{\"orders_picked\":$ORDERS_PICKED,\"messages_sent\":$SENDS_THIS_TICK,\"requeued\":$req,\"blocked_orders\":$BLOCKED_ORDERS}" 2>>$LOG)
  log "账本(触达): $(print -r -- "$out" | tr '\n' ' ' | head -c 200)"
  if print -r -- "$out" | grep -q '^WFR_GATE_ALERT=1'; then
    notify_once "outreach-gate" "获客触达后置条件不过" "$(print -r -- "$out" | sed -n "s/^WFR_GATE_ALERT_MSG=//p")" 3600
  fi
  return 0
}
outreach_ledger
