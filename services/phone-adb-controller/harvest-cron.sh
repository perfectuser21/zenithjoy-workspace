#!/bin/zsh
# harvest-cron.sh PROFILE SERIAL BIZ N PUSH —— 24×7 夜间采收自动扳机(M4/M1 crontab)
# 全自动: Commander上岗 → 设备preflight → 词单←网关关键词表 → batch2 采收 → 落池 → 效果回写
# 0916 改序(主理人拍板): Commander是第一步不是第三步——它必须看着 preflight 与取词单,
#   因为 0915 凌晨三批正是死在这两步、静默 exit、全线 6 小时无人知晓。
# 失败不静默(同上): 任何非正常退出都先 escalate 再退,报警走 us-vps 宿主文件(容器死了照样能写)。
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
P="$1"; SERIAL="$2"; BIZ="${3:-AI人工智能训练师}"; N="${4:-6}"; PUSH="${5:-1}"
TAG="auto$(date +%m%d%H%M)"
LOG=~/harvest-cron.log
log(){ print -- "[$(date +%m%d-%H:%M:%S)] [$TAG] $*" >> $LOG }

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

# ── ① Commander 上岗(第一步,0916 改序) ──
# 辅佐姿态(帮不拦/先动手后汇报/读不到就说读不到),宪法 SSOT=COMMANDER.md,SOP=网关 /root/.openclaw/cmdr-escort.txt
# 0915 真测实证: 网关重启窗口 ECONNREFUSED、拥堵期握手 30s 超时都会让单发拉起静默失败——
# 加 --timeout 90000 + 重试 3 次(间隔 30s)。3 次仍失败=升级分身(网关多半有病),不阻塞采收。
ESCORT_ID=""
for _ea in 1 2 3; do
  ESCORT_ID=$(ssh -o ConnectTimeout=20 us-vps "docker exec openclaw-gateway openclaw cron add --timeout 90000 --name 'escort-$HOSTKEY-$TAG' --agent media --session 'session:escort-$HOSTKEY-$TAG' --every 10m --announce --channel feishu --to 'chat:oc_ef60d6e3f199d90dd695b6ecc213d662' --account main --best-effort-deliver --message '先读 /root/.openclaw/cmdr-escort.txt 作为你的SOP并严格遵守辅佐三原则。本轮上下文: TAG=$TAG 机器=$HOSTKEY serial=$SERIAL profile=$P 起跑=$(date +%H:%M) 日志=/root/.openclaw/m4-logs/${HOSTKEY}-live.log escort名=escort-$HOSTKEY-$TAG。注意:你上岗时本批尚未做设备preflight与取词单,这两步失败会升级给分身,你看到日志里没有词单行属正常早期阶段。'" 2>>$LOG | grep -oE '"id": "[a-f0-9-]+"' | head -1 | cut -d'"' -f4)
  [[ -n "$ESCORT_ID" ]] && break
  log "escort拉起第${_ea}次失败,30s后重试"
  /bin/sleep 30
done
if [[ -n "$ESCORT_ID" ]]; then
  log "escort已拉起: $ESCORT_ID"
  escort_dismiss() { [[ -n "$ESCORT_ID" ]] && ssh -o ConnectTimeout=20 us-vps "docker exec openclaw-gateway openclaw cron rm $ESCORT_ID" >>$LOG 2>&1 && log "escort已注销" }
  trap escort_dismiss EXIT INT TERM
else
  log "escort拉起3次均失败(不阻塞采收)"
  escalate "escort拉起3次均失败,本批全程无陪跑;网关可能不可达或容器异常,请查网关健康"
fi

# ── ② 设备 preflight: 在线 + 屏幕亮 + 解锁(0915 锁屏=整机瘫痪且静默的教训) ──
if ! adb -s $SERIAL get-state >/dev/null 2>&1; then
  log "设备离线,退出"
  escalate "设备 $SERIAL 离线,本批无法起跑(adb get-state 失败);请查 USB/无线调试/机器是否关机"
  exit 0
fi
W=$(adb -s $SERIAL shell dumpsys power | grep -oE "mWakefulness=[A-Za-z]+" | head -1 | tr -d "\r")
if [[ "$W" != *Awake* ]]; then
  log "屏幕非Awake($W),唤醒解锁"
  adb -s $SERIAL shell input keyevent KEYCODE_WAKEUP; /bin/sleep 1
  adb -s $SERIAL shell input swipe 600 2200 600 800 300; /bin/sleep 1
fi
adb -s $SERIAL shell svc power stayon true 2>/dev/null

# 触达时窗守卫: 8-22点是触达的地盘,采收 cron 不该在白天抢(冗余保险,crontab已限时)
# 这是**正常退让**不是故障,不升级(升级=狼来了)。
H=$(date +%H)
if (( H >= 8 && H < 22 )); then log "白天触达时窗,采收退让"; exit 0; fi

# ── ③ 词单←网关(关键词表 SSOT) ──
WF=/tmp/kw-$TAG.txt
ssh -o ConnectTimeout=20 us-vps "docker exec openclaw-gateway node /root/.openclaw/next-keywords.js '$BIZ' $N" > $WF 2>>$LOG
if [[ ! -s $WF ]]; then
  log "词单为空,退出"
  escalate "取词单失败(next-keywords 返回空),本批无词可采直接夭折;0915凌晨三批同型(网关容器死),请先查网关容器状态再查关键词表启用行"
  exit 0
fi
NWORDS=$(wc -l < $WF | tr -d ' ')
log "词单 ${NWORDS}词: $(tr '\n' '/' < $WF)"

# ── ④ 采收主体 ──
/bin/zsh ~/bin-harvest/batch2.sh "$P" "$WF" "$TAG" "$PUSH" "$SERIAL"
log "批完成: $(grep -c '^LEAD' ~/night-$TAG.tsv 2>/dev/null || echo 0) LEAD"

# ── ⑤ 效果回写(词赛马数据闭环) ──
if [[ "$PUSH" == "1" ]]; then
  ssh -o ConnectTimeout=20 us-vps "docker exec openclaw-gateway node /root/.openclaw/update-keyword-stats.js" >> $LOG 2>&1
  log "效果已回写关键词表"
fi
