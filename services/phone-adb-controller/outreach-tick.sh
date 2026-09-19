#!/bin/zsh
# outreach-tick.sh —— 触达心跳(M4 crontab 每30分钟, 08:00-22:00 主理人拍板窗口)
# 拟人纪律: ①30%概率本tick安静跳过(发送时刻不规律) ②tick内随机延迟0-8分钟(不卡半点)
#          ③发送前3-8秒停留(private-message-send内部已有主页浏览过程) ④两号轮流分摊
# 风控账: 28 tick/天 × 70% ≈ 19发/天, 两号各~10, 间隔≥30min —— 远低于0821决策20/时上限
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

# 时窗守卫(冗余保险, crontab 已限时)
H=$(date +%H)
(( H >= 8 && H < 22 )) || { log "时窗外,跳过"; exit 0 }

# 拟人①: 30% 概率安静跳过
(( RANDOM % 10 < 3 )) && { log "拟人跳过本tick"; exit 0 }

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

# 拟人②: 随机延迟 0-480 秒
DELAY=$(( RANDOM % 480 ))
log "本tick延迟 ${DELAY}s 后执行"
/bin/sleep $DELAY

# 取单(网关选单器: 重复高亮优先→A级→B级, 预写触达中防重)
ORDER=$(ssh -o ConnectTimeout=15 us-vps 'docker exec openclaw-gateway node /root/.openclaw/next-outreach.js next' 2>>$LOG)
[[ "$ORDER" == "NO_PENDING" || -z "$ORDER" ]] && { log "无待触达单"; exit 0 }
[[ "$ORDER" == NO_SCRIPT* ]] && { log "话术缺失: $ORDER"; exit 1 }

RID=$(print -- "$ORDER"     | python3 -c "import json,sys;print(json.load(sys.stdin)['rid'])")
DYID=$(print -- "$ORDER"    | python3 -c "import json,sys;print(json.load(sys.stdin)['dyid'])")
MSGB64=$(print -- "$ORDER"  | python3 -c "import json,sys;print(json.load(sys.stdin)['msg_b64'])")
PROFILE=$(print -- "$ORDER" | python3 -c "import json,sys;print(json.load(sys.stdin)['profile'])")
SENDER=$(print -- "$ORDER"  | python3 -c "import json,sys;print(json.load(sys.stdin)['sender_id'])")
SEQ=$(print -- "$ORDER"     | python3 -c "import json,sys;print(json.load(sys.stdin)['seq'])")
NICK=$(print -- "$ORDER"    | python3 -c "import json,sys;print(json.load(sys.stdin)['nick'])")
PURL=$(print -- "$ORDER"    | python3 -c "import json,sys;print(json.load(sys.stdin).get('profile_url',''))")
log "单#$SEQ: $NICK($DYID) via $SENDER [$PROFILE] ${PURL:+link}"

C=~/.local/bin/douyin-phone-adb
mark(){ ssh -o ConnectTimeout=15 us-vps "docker exec openclaw-gateway node /root/.openclaw/next-outreach.js done $1 $2 $(print -n -- "$3" | /usr/bin/base64)" >>$LOG 2>&1 }

# ── 发送尝试循环(决策 c5828297): 瞬时失败就地重试,间隔60-120s,上限10次,总时长护栏22分钟 ──
MAX_ATTEMPTS=10
LOOP_START=$SECONDS
ATTEMPT=1
while true; do
  /usr/bin/touch "$TICK_LOCK"
  TAG="outreach-$(date +%m%d%H%M)-a${ATTEMPT}"
  if ! $C --profile "$PROFILE" lock-acquire "$TAG" >>$LOG 2>&1; then
    log "锁被占(采收在用),回队列待下轮"; mark "$RID" requeue "lock busy"; exit 0
  fi
  # 拟人③: 发送前 3-8 秒停顿
  /bin/sleep $(( 3 + RANDOM % 6 ))
  OUT=$($C --profile "$PROFILE" private-message-send "$SENDER" "$DYID" "$MSGB64" "$TAG" ${PURL:+"$PURL"} </dev/null 2>&1)
  RC=$?
  print -- "$OUT" | grep -vE "file pulled" | tail -4 >> $LOG
  $C --profile "$PROFILE" lock-release "$TAG" >>$LOG 2>&1 || true

  if print -- "$OUT" | grep -q "send_status=sent"; then
    RAWTAIL=$(print -- "$OUT" | tail -3 | tr '\n' ' ' | cut -c1-180)
    mark "$RID" sent "$RAWTAIL"
    log "✅ 单#$SEQ 送达(第${ATTEMPT}次尝试)"
    exit 0
  fi

  CLS=$(classify_failure "$OUT")
  REASON=$(print -- "$OUT" | grep -E "failure_class=|die|not" | tail -1 | head -c 150)
  if [[ "$CLS" != "transient" ]]; then
    mark "$RID" failed "${REASON:-rc=$RC}"
    log "❌ 单#$SEQ 失败($CLS): ${REASON:-rc=$RC}"
    exit 0
  fi
  if (( ATTEMPT >= MAX_ATTEMPTS )) || (( SECONDS - LOOP_START > 1320 )); then
    mark "$RID" requeue_transient "${REASON:-rc=$RC} (attempts=$ATTEMPT)"
    log "🔁 单#$SEQ 瞬时失败${ATTEMPT}次用尽,回队列: ${REASON:-rc=$RC}"
    exit 0
  fi
  BACKOFF=$(( 60 + RANDOM % 61 ))
  log "⏳ 单#$SEQ 瞬时失败(第${ATTEMPT}次): ${REASON:-rc=$RC},${BACKOFF}s 后重试"
  /bin/sleep $BACKOFF
  ATTEMPT=$(( ATTEMPT + 1 ))
done
