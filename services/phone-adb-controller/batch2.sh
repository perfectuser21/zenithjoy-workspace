#!/bin/zsh
# 0916: 落池时把 profile 传给 push 脚本 —— 由 line-routes.js 按业务线路由到各自 base,
# 否则悦升的数据会被写进金诺的表(或像此前那样根本不落库)。
# batch-harvest v2 — 清场版+批完自动落池(金诺)
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
P="$1"; WF="$2"; TAG="$3"; PUSH="${4:-0}"; SERIAL="${5:-}"
OUT=~/night-$TAG.tsv; LOG=~/night-$TAG.log
: > $OUT
print "[$(date +%H:%M:%S)] v2批开始 profile=$P $(wc -l < $WF)词 push=$PUSH" >> $LOG
n=0
for W in "${(f)$(cat $WF)}"; do
  [[ -z "$W" ]] && continue
  n=$((n+1))
  # 归位清场: 显式回feed(0914铁律: 不假设重开=干净态)
  if [[ -n "$SERIAL" ]]; then
    adb -s $SERIAL shell am force-stop com.ss.android.ugc.aweme 2>/dev/null
    /bin/sleep 2
    adb -s $SERIAL shell am start -n com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.main.MainActivity >/dev/null 2>&1
    /bin/sleep 4
  fi
  ENC=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$W")
  print "[$(date +%H:%M:%S)] 词$n: $W" >> $LOG
  ~/bin-harvest/harvest-keyword.sh "$P" "$ENC" 4 "$TAG-w$n" unlimited >> $OUT 2>> $LOG
  print "[$(date +%H:%M:%S)] 词$n 完成 LEAD=$(grep -c '^LEAD' $OUT 2>/dev/null||echo 0)" >> $LOG
  /bin/sleep $(( 20 + RANDOM % 40 ))
done
print "[$(date +%H:%M:%S)] v2批完成 LEAD=$(grep -c '^LEAD' $OUT) VIDEO=$(grep -c '^VIDEO' $OUT)" >> $LOG
if [[ "$PUSH" == "1" && -s $OUT ]]; then
  scp -o ConnectTimeout=20 $OUT us-vps:/tmp/$TAG.tsv >> $LOG 2>&1
  ssh -o ConnectTimeout=20 us-vps "docker cp /tmp/$TAG.tsv openclaw-gateway:/root/.openclaw/ && docker exec openclaw-gateway node /root/.openclaw/push-videos.js /root/.openclaw/$TAG.tsv $TAG $P && docker exec openclaw-gateway node /root/.openclaw/push-raw-comments.js /root/.openclaw/$TAG.tsv $TAG $P" >> $LOG 2>&1
  print "[$(date +%H:%M:%S)] 已落池(视频+评论)" >> $LOG
fi
