#!/bin/zsh
# harvest-cron.sh PROFILE SERIAL BIZ N PUSH —— 24×7 夜间采收自动扳机(M4/M1 crontab)
# 全自动: 词单←网关关键词表(效果轮换) → batch2 采收 → 自动落池 → 效果回写
# 前置硬检(0915 锁屏教训): 屏幕必须 Awake,否则唤醒解锁;设备不在=安静退出
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
P="$1"; SERIAL="$2"; BIZ="${3:-AI人工智能训练师}"; N="${4:-6}"; PUSH="${5:-1}"
TAG="auto$(date +%m%d%H%M)"
LOG=~/harvest-cron.log
log(){ print -- "[$(date +%m%d-%H:%M:%S)] [$TAG] $*" >> $LOG }

adb -s $SERIAL get-state >/dev/null 2>&1 || { log "设备离线,退出"; exit 0 }
# preflight: 屏幕亮+解锁(锁屏=整机瘫痪且静默的教训)
W=$(adb -s $SERIAL shell dumpsys power | grep -oE "mWakefulness=[A-Za-z]+" | head -1 | tr -d "\r")
if [[ "$W" != *Awake* ]]; then
  log "屏幕非Awake($W),唤醒解锁"
  adb -s $SERIAL shell input keyevent KEYCODE_WAKEUP; /bin/sleep 1
  adb -s $SERIAL shell input swipe 600 2200 600 800 300; /bin/sleep 1
fi
adb -s $SERIAL shell svc power stayon true 2>/dev/null

# 触达时窗守卫: 8-22点是触达的地盘,采收 cron 不该在白天抢(冗余保险,crontab已限时)
H=$(date +%H)
if (( H >= 8 && H < 22 )); then log "白天触达时窗,采收退让"; exit 0; fi

# 词单←网关(关键词表 SSOT)
WF=/tmp/kw-$TAG.txt
ssh -o ConnectTimeout=20 us-vps "docker exec openclaw-gateway node /root/.openclaw/next-keywords.js '$BIZ' $N" > $WF 2>>$LOG
[[ -s $WF ]] || { log "词单为空,退出"; exit 0 }
log "词单 $(wc -l < $WF | tr -d ' ')词: $(tr '\n' '/' < $WF)"

/bin/zsh ~/bin-harvest/batch2.sh "$P" "$WF" "$TAG" "$PUSH" "$SERIAL"
log "批完成: $(grep -c '^LEAD' ~/night-$TAG.tsv 2>/dev/null || echo 0) LEAD"

# 效果回写(词赛马数据闭环)
if [[ "$PUSH" == "1" ]]; then
  ssh -o ConnectTimeout=20 us-vps "docker exec openclaw-gateway node /root/.openclaw/update-keyword-stats.js" >> $LOG 2>&1
  log "效果已回写关键词表"
fi
