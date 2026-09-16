#!/bin/bash
# disk-gateway-guard.sh — 0916事故防线:根盘/数据盘水位+网关存活探针(每5分钟)
# 事故背景:0916凌晨根盘写满→网关死6小时零告警(opc-watchdog只探Brain)
LOG=/var/log/disk-gateway-guard.log
STATE=/tmp/dgg-alert-state
source /root/.credentials/feishu.env 2>/dev/null || true
source /root/.credentials/bark.env 2>/dev/null || true
alert(){ # $1=key $2=text, 冷却1h
  local key=$1 text=$2 now=$(date +%s) last=0
  [ -f "$STATE-$key" ] && last=$(cat "$STATE-$key")
  [ $((now-last)) -lt 3600 ] && return 0
  echo "$now" > "$STATE-$key"
  echo "$(date -Is) ALERT[$key] $text" >> $LOG
  [ -n "${BARK_TOKEN:-}" ] && curl -s -m 10 -X POST "https://api.day.app/push" -H "Content-Type: application/json" -d "{\"title\":\"us-vps守卫\",\"body\":\"$text\",\"device_key\":\"$BARK_TOKEN\",\"group\":\"disk-gateway\",\"level\":\"timeSensitive\"}" >/dev/null
  [ -n "${FEISHU_WEBHOOK:-}" ] && curl -s -m 10 -X POST "$FEISHU_WEBHOOK" -H "Content-Type: application/json" -d "{\"msg_type\":\"text\",\"content\":{\"text\":\"$text\"}}" >/dev/null
}
# ① 根盘水位
U=$(df / --output=pcent | tail -1 | tr -dc 0-9)
[ "$U" -ge 85 ] && alert rootdisk "根盘${U}%(阈85) df:$(df -h / | tail -1 | awk "{print \$3\"/\"\$2}") 0916事故同型,速清"
# ② 数据盘水位
U2=$(df /mnt/openclaw_data --output=pcent | tail -1 | tr -dc 0-9)
[ "$U2" -ge 85 ] && alert datadisk "openclaw数据盘${U2}%(阈85)"
# ③ 网关容器存活+健康(+救活,0916分身提案代码化)
H=$(docker inspect openclaw-gateway --format "{{.State.Status}}/{{.State.Health.Status}}" 2>/dev/null || echo notfound)
case "$H" in
  running/healthy) : ;;
  notfound) alert gateway "openclaw-gateway容器不存在!" ;;
  exited/*|exited)
     # ── 救活权代码化(COMMANDER.md 宪法第5条例外;0916事故:网关 exited 6小时无人救,
     #    凌晨三批连环夭折。判据机械(状态==exited)故固化成代码,不留给 LLM 临场判断) ──
     # 前提①先取证
     EV=$(docker inspect openclaw-gateway --format "exit={{.State.ExitCode}} oom={{.State.OOMKilled}} finished={{.State.FinishedAt}}" 2>/dev/null)
     TAILLOG=$(docker logs openclaw-gateway --tail 5 2>&1 | tr "\n" "|" | head -c 300)
     echo "$(date -Is) 救活:检出 exited 取证 $EV | 日志尾: $TAILLOG" >> $LOG
     # 磁盘满时重启也起不来(0916实证),先探水位;满则只告警不空转重启
     UROOT=$(df / --output=pcent | tail -1 | tr -dc 0-9)
     if [ "$UROOT" -ge 95 ]; then
       alert gateway "网关 exited 但根盘${UROOT}%已满,重启必失败——需先清盘。取证:$EV"
     else
       # 前提②只对确已停摆的动手(本分支即 exited,健康容器永不进入)
       docker start openclaw-gateway >> $LOG 2>&1
       sleep 20
       # 前提③回读验证
       H2=$(docker inspect openclaw-gateway --format "{{.State.Status}}/{{.State.Health.Status}}" 2>/dev/null || echo notfound)
       echo "$(date -Is) 救活:重启后回读验证 状态=$H2" >> $LOG
       case "$H2" in
         running/*) alert gateway "网关曾 exited 已自动救活,当前=$H2(healthy 需冷启动数分钟)。取证:$EV" ;;
         *) alert gateway "网关 exited 自动救活失败,当前=$H2,需人工介入。取证:$EV 日志尾:$TAILLOG" ;;
       esac
     fi ;;
  *) # starting给15分钟宽限:连续3次(15m)非healthy才报
     C=$(cat "$STATE-gwcnt" 2>/dev/null || echo 0); C=$((C+1)); echo $C > "$STATE-gwcnt"
     [ "$C" -ge 3 ] && alert gateway "openclaw-gateway状态=$H 已${C}次探测非healthy" ;;
esac
[ "$H" = "running/healthy" ] && rm -f "$STATE-gwcnt"
exit 0
