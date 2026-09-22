#!/bin/zsh
# batch2.sh PROFILE 词单 TAG PUSH SERIAL —— PUSH 默认 1(落池);传 0 = 只采不落库。
# 0916: 落池时把 profile 传给 push 脚本 —— 由 line-routes.js 按业务线路由到各自 base,
# 否则悦升的数据会被写进金诺的表(或像此前那样根本不落库)。
# batch-harvest v2 — 清场版+批完自动落池(金诺)
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
P="$1"; WF="$2"; TAG="$3"; PUSH="${4:-0}"; SERIAL="${5:-}"
# 这批活的回填去向（业务线名 / key / 研发用 dev）。不传就按 profile 走——
# 隔离点在「活」上不在「机器」上（0922 主理人定），所以它是可以被调用方覆盖的。
LINE="${6:-$P}"
# 可视化旁路(0919): 词级进度报给控制塔; 无序列号/上报器缺失/失败一律吞掉
WR=${WALL_REPORT:-$HOME/bin-harvest/wall-report.sh}
wr(){ [[ -n "$SERIAL" && -x "$WR" ]] && "$WR" "$@" >/dev/null 2>&1; true }
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
  wr step "$SERIAL" 3 doing "词$n: $W"
  ~/bin-harvest/harvest-keyword.sh "$P" "$ENC" 4 "$TAG-w$n" unlimited "$LINE" >> $OUT 2>> $LOG
  print "[$(date +%H:%M:%S)] 词$n 完成 LEAD=$(grep -c '^LEAD' $OUT 2>/dev/null||echo 0)" >> $LOG
  NLEAD=$(grep -c '^LEAD' $OUT 2>/dev/null); wr note "$SERIAL" "词$n 完成 LEAD=${NLEAD:-0}"
  /bin/sleep $(( 20 + RANDOM % 40 ))
done
print "[$(date +%H:%M:%S)] v2批完成 LEAD=$(grep -c '^LEAD' $OUT) VIDEO=$(grep -c '^VIDEO' $OUT)" >> $LOG
if [[ "$PUSH" == "1" && -s $OUT ]]; then
  # 安全前提(回应 0916 AI review 对 ssh/scp 的中间人告警——本段是既有链路,非本次新增):
  #  ① mmv 是 ~/.ssh/config 里的固定别名,走 tailscale 内网(100.x),不经公网
  #  ② 密钥对认证(无密码登录),私钥在本机 600
  #  ③ 未加 StrictHostKeyChecking=no —— host key 校验保持默认开启,首次连接已固化进 known_hosts
  #  故不存在"未验证远程身份"。若将来要改成公网直连,必须先补 host key pin 再动。
  # 0921 网关迁移: us-vps 那份 openclaw-gateway 容器已退役(决策 96054a8b),落池脚本随迁移
  # 落到 MMV 原生跑(不再经 docker cp/docker exec)。
  scp -o ConnectTimeout=20 $OUT mmv:/tmp/$TAG.tsv >> $LOG 2>&1
  ssh -o ConnectTimeout=20 mmv "node /Users/administrator/.openclaw/leadgen-scripts/push-videos.js /tmp/$TAG.tsv $TAG $LINE && node /Users/administrator/.openclaw/leadgen-scripts/push-raw-comments.js /tmp/$TAG.tsv $TAG $LINE" >> $LOG 2>&1
  print "[$(date +%H:%M:%S)] 已落池(视频+评论)" >> $LOG
fi
