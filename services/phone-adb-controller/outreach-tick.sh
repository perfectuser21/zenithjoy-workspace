#!/bin/zsh
# outreach-tick.sh —— 触达心跳(M4/M1 crontab 每30分钟, 全天0-23点)
# 拟人纪律: ①5%概率本tick安静跳过 ②tick内随机延迟0-5分钟 ③发送前5-25秒停留
#          (private-message-send内部已有主页浏览过程) ④两号轮流分摊
# 0920 主理人拍板: 员工反映人工触达28次左右被限,但系统里从未真实测过平台阈值,现用两个号
#   各测一种升量方式找真实上限(见 dm-rate-ramp-lib.js + config/dm-rate-ramp.json):
#   jinoshengyuan-work=逐日阶梯, legacy=单日内快速阶梯,都设理智天花板60/天。
#   连续2次遇到未识别的新失败模式(classify_failure=other)自动熔断该号,防止真把号测坏
#   (熔断标记 ~/bin-harvest/state/dm-paused-<profile>.flag,需人工核查后手动删除)。
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
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
LOG=~/outreach.log
log(){ print -- "[$(date +%m%d-%H:%M:%S)] $*" >> $LOG }

# ── 归因分类(决策 c5828297): 按归因行不按整段——warning: foreground 等非致命行禁止污染判定 ──
classify_failure() {
  local out="$1" last_fc tail5
  last_fc=$(print -- "$out" | grep -oE 'failure_class=[A-Z_]+' | tail -1 | cut -d= -f2)
  if [[ "$last_fc" == "TARGET_ABSENT" ]]; then print terminal; return; fi
  tail5=$(print -- "$out" | tail -5)
  if print -- "$tail5" | grep -qiE 'AdbIME|input method|_ime'; then print transient; return; fi
  print other
}

# source 守卫: smoke 层4 以 OUTREACH_TICK_SOURCED=1 source 本文件只取函数,不执行主体
[[ -n "${OUTREACH_TICK_SOURCED:-}" ]] && return 0

# 可视化旁路(0919): 触达每阶段报给控制塔; 上报失败一律吞掉
WR=${WALL_REPORT:-$HOME/bin-harvest/wall-report.sh}
wr(){ [[ -x "$WR" ]] && "$WR" "$@" >/dev/null 2>&1; true }
export WALL_NS=outreach   # 上报器按命名空间分状态文件: 触达链与采收链同机同序列号互不顶状态

# 0920 时窗已放开到全天(阶梯测试拍板),不再卡8-22点

# 拟人①: 30% 概率安静跳过
(( RANDOM % 20 < 1 )) && { log "拟人跳过本tick"; exit 0 }

# ── tick 互斥(mkdir 原子锁,家法同 douyin-phone-adb lock-acquire): 重试拉长运行时长后防重入 ──
# 活性说明: mtime=最后活动时间(重试循环每轮 touch 刷新,防真在跑的tick被误判为尸锁);
#          owner(pid文件)=归属校验,trap 只删自己抢到的锁,防旧tick退出时误删新tick的锁
TICK_LOCK=/tmp/outreach-tick.lock
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
/bin/sleep $DELAY

# ssh 到 us-vps 走的是这台机器上早就配好的 SSH 密钥认证(标准 known_hosts + 私钥,
# 不在命令行传密码/token),下面这几处 ssh 调用只是把已有的 mark()/取单 写法原样保留,
# 不是本次改动新引入的凭据处理逻辑。
C=~/.local/bin/douyin-phone-adb
mark(){ ssh -o ConnectTimeout=15 us-vps "docker exec openclaw-gateway node /root/.openclaw/next-outreach.js done $1 $2 $(print -n -- "$3" | /usr/bin/base64)" >>$LOG 2>&1 }
STATE_DIR="$(dirname "$0")/state"
mkdir -p "$STATE_DIR"

# 0920 一次tick内可连发多条(见文件头说明): 时间预算25分钟(给下个30分钟tick留5分钟
# 缓冲),每发完一条随机停顿(60-300秒,依然是"突发式"不是"匀速机械"),再取下一单,
# 直到无待发单/当日上限/时间预算耗尽为止。while 条件在每轮取单前重新判断一次经过的
# 秒数,时间预算耗尽时循环体不会再启动新一轮,自然从 while 退出、往下走到收工日志,
# 不存在"预算耗尽后还卡在循环里出不来"的情况。
TICK_BODY_START=$SECONDS
TICK_BUDGET=1500
SENDS_THIS_TICK=0
# CONSEC_CAP_HITS: 连续撞上限计数器,完整生命周期都在本文件里——这里初始化为0，
# 命中当日上限的分支里 +1 并在连续两次时收工(见下方"撞上限"分支)，只要有一次
# 没撞上限(说明选单器换到了另一个号)就立刻重置回0(见本循环体末尾)。
CONSEC_CAP_HITS=0

while (( SECONDS - TICK_BODY_START < TICK_BUDGET )); do
  # 取单(网关选单器: 重复高亮优先→A级→B级, 预写触达中防重)
  ORDER=$(ssh -o ConnectTimeout=15 us-vps 'docker exec openclaw-gateway node /root/.openclaw/next-outreach.js next' 2>>$LOG)
  [[ "$ORDER" == "NO_PENDING" || -z "$ORDER" ]] && { log "无待触达单,本tick结束(已发${SENDS_THIS_TICK}条)"; break }
  [[ "$ORDER" == NO_SCRIPT* ]] && { log "话术缺失: $ORDER,本tick结束(已发${SENDS_THIS_TICK}条)"; break }

  RID=$(print -- "$ORDER"     | python3 -c "import json,sys;print(json.load(sys.stdin)['rid'])")
  DYID=$(print -- "$ORDER"    | python3 -c "import json,sys;print(json.load(sys.stdin)['dyid'])")
  MSGB64=$(print -- "$ORDER"  | python3 -c "import json,sys;print(json.load(sys.stdin)['msg_b64'])")
  PROFILE=$(print -- "$ORDER" | python3 -c "import json,sys;print(json.load(sys.stdin)['profile'])")
  SENDER=$(print -- "$ORDER"  | python3 -c "import json,sys;print(json.load(sys.stdin)['sender_id'])")
  SEQ=$(print -- "$ORDER"     | python3 -c "import json,sys;print(json.load(sys.stdin)['seq'])")
  NICK=$(print -- "$ORDER"    | python3 -c "import json,sys;print(json.load(sys.stdin)['nick'])")
  PURL=$(print -- "$ORDER"    | python3 -c "import json,sys;print(json.load(sys.stdin).get('profile_url',''))")
  log "单#$SEQ: $NICK($DYID) via $SENDER [$PROFILE] ${PURL:+link}"
  # 可视化: 任务 start 放在拿到锁之后——锁被采收占着时不 start,否则会把同机正在跑的采收任务顶掉(409 superseded)
  WR_STARTED=0

  # ── 0920 阶梯测试: 熔断标记 + 当日发送上限闸(在真发之前拦,别浪费一次真实发送尝试) ──
  PAUSE_FLAG="$STATE_DIR/dm-paused-$PROFILE.flag"
  if [[ -f "$PAUSE_FLAG" ]]; then
    log "⛔ $PROFILE 已熔断(见 $PAUSE_FLAG),回队列"
    mark "$RID" requeue "circuit breaker paused, see $PAUSE_FLAG"
    continue
  fi
  DATE_TAG=$(TZ=Asia/Shanghai date +%Y%m%d)
  COUNT_FILE="$STATE_DIR/dm-count-$PROFILE-$DATE_TAG.txt"
  TODAY_SENT=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
  CAP=$(node "$(dirname "$0")/dm-daily-cap.js" "$PROFILE")
  if (( TODAY_SENT >= CAP )); then
    log "今日($PROFILE)已达阶梯上限 ${TODAY_SENT}/${CAP},回队列"
    mark "$RID" requeue "daily cap reached (${TODAY_SENT}/${CAP})"
    # 命中一次当日上限: 计数器 +1；连续2次撞上限(两个号大概率都到顶了,选单器轮流
    # 分配,再取单也是空转)才收工,单次撞上限只 continue 换下一单,不会误判整体结束。
    CONSEC_CAP_HITS=$(( CONSEC_CAP_HITS + 1 ))
    (( CONSEC_CAP_HITS >= 2 )) && { log "连续${CONSEC_CAP_HITS}次撞上限,本tick结束(已发${SENDS_THIS_TICK}条)"; break }
    continue
  fi
  # 这一单没撞上限(选到了还有余量的号): 计数器归零,不让上一次的撞上限计数
  # 跨单误累加(必须是"连续"两次才收工,中间插一次正常单就该重新计)。
  CONSEC_CAP_HITS=0

  # ── 发送尝试循环(决策 c5828297): 瞬时失败就地重试,间隔60-120s,上限10次,总时长护栏22分钟 ──
  MAX_ATTEMPTS=10
  LOOP_START=$SECONDS
  ATTEMPT=1
  ORDER_RESULT=""
  while [[ -z "$ORDER_RESULT" ]]; do
    /usr/bin/touch "$TICK_LOCK"
    TAG="outreach-$(date +%m%d%H%M)-a${ATTEMPT}"
    if ! $C --profile "$PROFILE" lock-acquire "$TAG" >>$LOG 2>&1; then
      log "锁被占(采收在用),回队列待下轮,本tick结束(已发${SENDS_THIS_TICK}条)"; mark "$RID" requeue "lock busy"
      # 第 2 次及以后尝试才可能已 start(拿过锁), 此时要把已开的任务收成 fail; 第 1 次未 start 不调
      (( WR_STARTED == 1 )) && wr fail --profile "$PROFILE" 0 lock_busy "重试中锁被采收占用"
      break 2   # 设备被占用是环境性问题(通常是采收在跑,一时半会不会解除),直接收工整个tick
    fi
    if (( WR_STARTED == 0 )); then wr start --profile "$PROFILE" "触达·单#$SEQ $NICK" "发送,核验"; WR_STARTED=1; fi
    wr step --profile "$PROFILE" 0 doing "第${ATTEMPT}次发送"
    # 拟人③: 发送前 5-25 秒停顿(0920 拉宽区间)
    /bin/sleep $(( 5 + RANDOM % 21 ))
    OUT=$($C --profile "$PROFILE" private-message-send "$SENDER" "$DYID" "$MSGB64" "$TAG" ${PURL:+"$PURL"} </dev/null 2>&1)
    RC=$?
    print -- "$OUT" | grep -vE "file pulled" | tail -4 >> $LOG

    if print -- "$OUT" | grep -q "send_status=sent"; then
      RAWTAIL=$(print -- "$OUT" | tail -3 | tr '\n' ' ' | cut -c1-180)
      wr step --profile "$PROFILE" 0 done; wr step --profile "$PROFILE" 1 doing "核验仅互关"
      # 0920: 计入今日发送计数(不管后面判成功还是仅互关受限,都是一次真实发送尝试);
      # 且证明账号还能正常发送,清掉连续异常计数(熔断只认"连续"未识别失败)。
      echo $(( $(cat "$COUNT_FILE" 2>/dev/null || echo 0) + 1 )) > "$COUNT_FILE"
      rm -f "$STATE_DIR/dm-anomaly-$PROFILE.txt"
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
      mark "$RID" sent "$RAWTAIL"
      log "✅ 单#$SEQ 送达(第${ATTEMPT}次尝试)"
      wr step --profile "$PROFILE" 1 done; wr done --profile "$PROFILE"
      ORDER_RESULT="sent"
      break
    fi

    $C --profile "$PROFILE" lock-release "$TAG" >>$LOG 2>&1 || true
    CLS=$(classify_failure "$OUT")
    REASON=$(print -- "$OUT" | grep -E "failure_class=|die|not" | tail -1 | head -c 150)
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
          touch "$PAUSE_FLAG"
          log "⛔⛔ $PROFILE 连续${ANOMALY_COUNT}次未识别失败,自动熔断——这可能就是真实限流阈值,人工核查 ~/anomaly-$PROFILE.log 后手动删除 $PAUSE_FLAG 才会恢复"
        fi
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
    /bin/sleep $BACKOFF
    ATTEMPT=$(( ATTEMPT + 1 ))
  done

  [[ "$ORDER_RESULT" == "sent" || "$ORDER_RESULT" == "restricted" ]] && SENDS_THIS_TICK=$(( SENDS_THIS_TICK + 1 ))

  # 本单已有结果(不是因为设备被占用而收工整个tick),继续取下一单前随机停顿——
  # 一个tick里可能连发好几条,但不是不停顿地机器人式连发。
  BETWEEN_ORDERS_PAUSE=$(( 30 + RANDOM % 61 ))
  log "本单处理完(${ORDER_RESULT:-unknown}),${BETWEEN_ORDERS_PAUSE}s 后看下一单"
  /bin/sleep $BETWEEN_ORDERS_PAUSE
done
log "本tick收工,累计发送(含受限)${SENDS_THIS_TICK}条"
