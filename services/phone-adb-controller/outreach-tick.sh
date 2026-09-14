#!/bin/zsh
# outreach-tick.sh —— 触达心跳(M4 crontab 每30分钟, 08:00-22:00 主理人拍板窗口)
# 拟人纪律: ①30%概率本tick安静跳过(发送时刻不规律) ②tick内随机延迟0-8分钟(不卡半点)
#          ③发送前3-8秒停留(private-message-send内部已有主页浏览过程) ④两号轮流分摊
# 风控账: 28 tick/天 × 70% ≈ 19发/天, 两号各~10, 间隔≥30min —— 远低于0821决策20/时上限
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
LOG=~/outreach.log
log(){ print -- "[$(date +%m%d-%H:%M:%S)] $*" >> $LOG }

# 时窗守卫(冗余保险, crontab 已限时)
H=$(date +%H)
(( H >= 8 && H < 22 )) || { log "时窗外,跳过"; exit 0 }

# 拟人①: 30% 概率安静跳过
(( RANDOM % 10 < 3 )) && { log "拟人跳过本tick"; exit 0 }
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
log "单#$SEQ: $NICK($DYID) via $SENDER [$PROFILE]"

C=~/.local/bin/douyin-phone-adb
TAG="outreach-$(date +%m%d%H%M)"
mark(){ ssh -o ConnectTimeout=15 us-vps "docker exec openclaw-gateway node /root/.openclaw/next-outreach.js done $1 $2 $(print -n -- "$3" | /usr/bin/base64)" >>$LOG 2>&1 }

if ! $C --profile "$PROFILE" lock-acquire "$TAG" >>$LOG 2>&1; then
  log "锁被占,回退待触达"; mark "$RID" failed "device lock busy"; exit 0
fi
# 拟人③: 发送前 3-8 秒停顿
/bin/sleep $(( 3 + RANDOM % 6 ))
OUT=$($C --profile "$PROFILE" private-message-send "$SENDER" "$DYID" "$MSGB64" "$TAG" </dev/null 2>&1)
RC=$?
print -- "$OUT" | grep -vE "file pulled" | tail -4 >> $LOG
$C --profile "$PROFILE" lock-release "$TAG" >>$LOG 2>&1 || true

if print -- "$OUT" | grep -q "send_status=sent"; then
  mark "$RID" sent "ok"
  log "✅ 单#$SEQ 送达"
else
  REASON=$(print -- "$OUT" | grep -E "failure_class=|die|not" | tail -1 | head -c 150)
  mark "$RID" failed "${REASON:-rc=$RC}"
  log "❌ 单#$SEQ 失败: ${REASON:-rc=$RC}"
fi
