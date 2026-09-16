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
# ③ 网关容器存活+健康
H=$(docker inspect openclaw-gateway --format "{{.State.Status}}/{{.State.Health.Status}}" 2>/dev/null || echo notfound)
case "$H" in
  running/healthy) : ;;
  notfound) alert gateway "openclaw-gateway容器不存在!" ;;
  *) # starting给15分钟宽限:连续3次(15m)非healthy才报
     C=$(cat "$STATE-gwcnt" 2>/dev/null || echo 0); C=$((C+1)); echo $C > "$STATE-gwcnt"
     [ "$C" -ge 3 ] && alert gateway "openclaw-gateway状态=$H 已${C}次探测非healthy" ;;
esac
[ "$H" = "running/healthy" ] && rm -f "$STATE-gwcnt"
exit 0
