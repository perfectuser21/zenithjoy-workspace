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
NWORDS=$(wc -l < $WF | tr -d ' ')
log "词单 ${NWORDS}词: $(tr '\n' '/' < $WF)"

# ── 0915 伴随Commander(决策dcdaa83e): run第一步拉起专属escort每10分钟看护,收工注销 ──
# 辅佐姿态(帮不拦/先动手后汇报/读不到就说读不到),SOP=网关 /root/.openclaw/cmdr-escort.txt
# 节点名映射(0915真机核实: hostname是mac-mini-m4-xian/mac-mini-m1-us,与日志桥/nodes名不同,禁直推)
case "$(hostname -s)" in
  *m4-xian*) HOSTKEY=xian-m4 ;;
  *m1-us*)   HOSTKEY=xian-m1 ;;
  *)         HOSTKEY=$(hostname -s | tr '[:upper:]' '[:lower:]') ;;
esac
# 0915 真测实证: 网关重启窗口 ECONNREFUSED、拥堵期握手30s超时都会让单发拉起静默失败——
# 加 --timeout 90000 + 重试3次(间隔30s)。仍失败=不阻塞采收,Commander缺岗由值守cron兜底。
ESCORT_ID=""
for _ea in 1 2 3; do
  ESCORT_ID=$(ssh -o ConnectTimeout=20 us-vps "docker exec openclaw-gateway openclaw cron add --timeout 90000 --name 'escort-$HOSTKEY-$TAG' --agent media --session 'session:escort-$HOSTKEY-$TAG' --every 10m --announce --channel feishu --to 'chat:oc_ef60d6e3f199d90dd695b6ecc213d662' --account main --best-effort-deliver --message '先读 /root/.openclaw/cmdr-escort.txt 作为你的SOP并严格遵守辅佐三原则。本轮上下文: TAG=$TAG 机器=$HOSTKEY serial=$SERIAL profile=$P 词数=$NWORDS 起跑=$(date +%H:%M) 日志=/root/.openclaw/m4-logs/${HOSTKEY}-harvest.log escort名=escort-$HOSTKEY-$TAG'" 2>>$LOG | grep -oE '"id": "[a-f0-9-]+"' | head -1 | cut -d'"' -f4)
  [[ -n "$ESCORT_ID" ]] && break
  log "escort拉起第${_ea}次失败,30s后重试"
  /bin/sleep 30
done
[[ -n "$ESCORT_ID" ]] && log "escort已拉起: $ESCORT_ID" || log "escort拉起3次均失败(不阻塞采收,值守cron兜底)"
escort_dismiss() { [[ -n "$ESCORT_ID" ]] && ssh -o ConnectTimeout=20 us-vps "docker exec openclaw-gateway openclaw cron rm $ESCORT_ID" >>$LOG 2>&1 && log "escort已注销" }
trap escort_dismiss EXIT INT TERM

/bin/zsh ~/bin-harvest/batch2.sh "$P" "$WF" "$TAG" "$PUSH" "$SERIAL"
log "批完成: $(grep -c '^LEAD' ~/night-$TAG.tsv 2>/dev/null || echo 0) LEAD"

# 效果回写(词赛马数据闭环)
if [[ "$PUSH" == "1" ]]; then
  ssh -o ConnectTimeout=20 us-vps "docker exec openclaw-gateway node /root/.openclaw/update-keyword-stats.js" >> $LOG 2>&1
  log "效果已回写关键词表"
fi
