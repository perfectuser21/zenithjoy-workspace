#!/bin/zsh
# batch2.sh PROFILE 词单 TAG PUSH SERIAL —— PUSH 默认 1(落池);传 0 = 只采不落库。
# 0916: 落池时把 profile 传给 push 脚本 —— 由 line-routes.js 按业务线路由到各自 base,
# 否则悦升的数据会被写进金诺的表(或像此前那样根本不落库)。
# batch-harvest v2 — 清场版+批完自动落池(金诺)
# 0927 棒3b-3(决策 2ca30c4d): 账本钩子内建——每词写 discovery/collection 工件,push 后写 delivery,
#   起跑 hash 不一致即停(fail-closed)。WFR_DISABLED=1、workflow-result.sh 缺失或不可执行 → 钩子全部 no-op,
#   采收行为与并入前逐字一致(__tests__ 用并入前快照 fixtures/batch2-pre-wfr.sh 对拍)。
#   原 v4 副本 batch2-v4.sh 已废: 与现网分叉四处(LINE 第6参/分拣/音频判定链/MAXV),影子跑又拿不到设备。
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
P="$1"; WF="$2"; TAG="$3"; PUSH="${4:-0}"; SERIAL="${5:-}"
# 这批活的回填去向（业务线名 / key / 研发用 dev）。不传就按 profile 走——
# 隔离点在「活」上不在「机器」上（0922 主理人定），所以它是可以被调用方覆盖的。
LINE="${6:-$P}"
# 0922拍板:每关键词采几个视频不再写死——之前恒为4,不管KPI缺口大小都一个样。
# 传MAXV环境变量可覆盖(比如KPI缺口大时想多采几个),不传保持4不变,老行为不受影响。
MAXV="${MAXV:-4}"
# 可视化旁路(0919): 词级进度报给控制塔; 无序列号/上报器缺失/失败一律吞掉
WR=${WALL_REPORT:-$HOME/bin-harvest/wall-report.sh}
wr(){ [[ -n "$SERIAL" && -x "$WR" ]] && "$WR" "$@" >/dev/null 2>&1; true }
HK=${HARVEST_KEYWORD:-$HOME/bin-harvest/harvest-keyword.sh}
SLEEP_BASE=${BATCH_SLEEP:-20}   # 词间隔基数(秒),默认与旧行为同(20+随机40);测试传 0
OUT=~/night-$TAG.tsv; LOG=~/night-$TAG.log
# ── 账本钩子(基座 1/7 workflow-result.sh): 一行守卫决定全部 no-op ──
WFR=${WFR:-$HOME/bin-harvest/workflow-result.sh}
wfr_on(){ [[ "${WFR_DISABLED:-0}" != "1" && -x "$WFR" ]] }
wfr(){ wfr_on && bash "$WFR" "$@" >/dev/null 2>>$LOG; true }
count(){ local c; c=$(grep -c "^$1" $OUT 2>/dev/null || true); print -- "${c:-0}"; }
# 出口码→阶段状态(决策 af061588): 0+有卡 completed / 0 无卡 blocked no_cards / 3 blocked lock_busy / 其它 failed
# harvest-keyword.sh 出口码契约(勿改): 3 锁被占 / 1 open-search 失败 / 0 正常或无卡片
wfr_word_stages(){ # n word rc dv dl
  wfr_on || return 0
  local n="$1" W="$2" rc="$3" DV="$4" DL="$5"
  local EV='[{"type":"log","ref":"'"$LOG"'","word":"'"$W"'","rc":'"$rc"'}]'
  case "$rc" in
    0) if (( DV > 0 )); then
         wfr stage discovery completed "$n" "word=$W videos=$DV" "$EV" '{"candidates":'"$DV"',"keywords_processed":1,"screens_scanned":0}' "$W"
         wfr stage collection completed "$n" "word=$W leads=$DL" "$EV" '{"comments_collected":'"$DL"',"videos_processed":'"$DV"',"cursor_updates":0}' "$W"
       else
         wfr stage discovery blocked "$n" "word=$W no_cards" "$EV" '{"candidates":0,"keywords_processed":1,"screens_scanned":0}' "$W"
       fi;;
    3) wfr stage discovery blocked "$n" "word=$W lock_busy" "$EV" '{"candidates":0,"keywords_processed":1,"screens_scanned":0}' "$W";;
    *) wfr stage discovery failed "$n" "word=$W rc=$rc" "$EV" '{"candidates":0,"keywords_processed":1,"screens_scanned":0}' "$W";;
  esac
}
: > $OUT
print "[$(date +%H:%M:%S)] v2批开始 profile=$P $(wc -l < $WF)词 push=$PUSH" >> $LOG
# hash 一致性: 词单在 init 之后被改 = 请求身份变了,fail-closed(基座 1/7 PrepPRD 拍板)
if wfr_on && [[ -n "${WFR_HASH:-}" ]]; then
  NOWHASH=$(bash "$WFR" hash "$P" "$WF" "$PUSH" 2>/dev/null | sed -n 's/^WFR_HASH=//p'); NOWHASH=${NOWHASH:-}
  if [[ "$NOWHASH" != "$WFR_HASH" ]]; then
    print "[$(date +%H:%M:%S)] hash 不一致 init=$WFR_HASH now=$NOWHASH，停跑" >> $LOG
    # n=0 哨兵: 词序号从 1 起,用 0 避免覆盖上一 attempt 已完成词的 items 记录(ledger.mjs set --n 按 n 覆盖式写)
    wfr stage discovery blocked 0 "hash_mismatch init=$WFR_HASH now=$NOWHASH" '[{"type":"log","ref":"'"$LOG"'"}]' '{"candidates":0,"keywords_processed":0,"screens_scanned":0}' ""
    print "BATCH2_ESCALATE=hash_mismatch"
    exit 0
  fi
fi
n=0
for W in "${(f)$(cat $WF)}"; do
  [[ -z "$W" ]] && continue
  n=$((n+1))
  # 续跑: skip_words 里的词已在上一 attempt 完成(只有账本在跑时才有这个概念)
  if wfr_on && [[ -n "${WFR_SKIP_WORDS:-}" && "|${WFR_SKIP_WORDS}|" == *"|${W}|"* ]]; then
    print "[$(date +%H:%M:%S)] 词$n: $W 已完成(续跑跳过)" >> $LOG; continue
  fi
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
  V0=$(count VIDEO); L0=$(count LEAD)
  rc=0; "$HK" "$P" "$ENC" "$MAXV" "$TAG-w$n" unlimited "$LINE" >> $OUT 2>> $LOG || rc=$?
  V1=$(count VIDEO); L1=$(count LEAD)
  wfr_word_stages "$n" "$W" "$rc" $((V1-V0)) $((L1-L0))
  print "[$(date +%H:%M:%S)] 词$n 完成 LEAD=$(grep -c '^LEAD' $OUT 2>/dev/null||echo 0)" >> $LOG
  NLEAD=$(grep -c '^LEAD' $OUT 2>/dev/null); wr note "$SERIAL" "词$n 完成 LEAD=${NLEAD:-0}"
  (( SLEEP_BASE > 0 )) && /bin/sleep $(( SLEEP_BASE + RANDOM % 40 ))
done
print "[$(date +%H:%M:%S)] v2批完成 LEAD=$(grep -c '^LEAD' $OUT) VIDEO=$(grep -c '^VIDEO' $OUT)" >> $LOG
NL=$(count LEAD)
if [[ "$PUSH" == "1" && -s $OUT ]]; then
  # 安全前提(回应 0916 AI review 对 ssh/scp 的中间人告警——本段是既有链路,非本次新增):
  #  ① mmv 是 ~/.ssh/config 里的固定别名,走 tailscale 内网(100.x),不经公网
  #  ② 密钥对认证(无密码登录),私钥在本机 600
  #  ③ 未加 StrictHostKeyChecking=no —— host key 校验保持默认开启,首次连接已固化进 known_hosts
  #  故不存在"未验证远程身份"。若将来要改成公网直连,必须先补 host key pin 再动。
  # 0921 网关迁移: us-vps 那份 openclaw-gateway 容器已退役(决策 96054a8b),落池脚本随迁移
  # 落到 MMV 原生跑(不再经 docker cp/docker exec)。
  scp -o ConnectTimeout=20 $OUT mmv:/tmp/$TAG.tsv >> $LOG 2>&1
  # 0923修正:push-videos.js今天新接的Postgres双写(leadgen-db-connect.js读DATABASE_URL)
  # 裸ssh过去的shell不会自动source ~/.credentials/,不带这行DATABASE_URL就是空,
  # 双写会连到pg默认本地库(压根没有zenithjoy.leadgen_videos表)而不是生产库,
  # 全部静默失败——真机验证时才发现(见0923 handoff)。push-raw-comments.js不碰Postgres,
  # 不受影响,但为了让两条命令共享同一次ssh session的env,统一放在同一行source。
  ssh -o ConnectTimeout=20 mmv "set -a; source ~/.credentials/zenithjoy-db.env 2>/dev/null; set +a; node /Users/administrator/.openclaw/leadgen-scripts/push-videos.js /tmp/$TAG.tsv $TAG $LINE && node /Users/administrator/.openclaw/leadgen-scripts/push-raw-comments.js /tmp/$TAG.tsv $TAG $LINE" >> $LOG 2>&1
  prc=$?
  # 账本 delivery: 落池 ssh 的出口码决定 completed/failed; readback_verified 由探针读回(checks/ YAML)填,这里不硬编码
  if (( prc == 0 )); then
    wfr stage delivery completed 1 "pushed $NL leads" '[{"type":"log","ref":"'"$LOG"'"}]' '{"leads_written":'"$NL"',"duplicates_skipped":0,"readback_verified":0,"cursor_updates":0}'
  else
    wfr stage delivery failed 1 "push rc=$prc" '[{"type":"log","ref":"'"$LOG"'"}]' '{"leads_written":0,"duplicates_skipped":0,"readback_verified":0,"cursor_updates":0}'
  fi
  print "[$(date +%H:%M:%S)] 已落池(视频+评论)" >> $LOG
  # 0923补齐:落池之后紧接着分拣——此前sort-comments.js压根没有任何自动触发点
  # (既不在cron里,也不在任何批处理链路里,只能靠人/agent手动敲,而agent侧那份
  # "手跑干预"playbook写的是/root/.openclaw/...这个host上根本不存在的路径,
  # 从没真正跑通过)。落池跟分拣本就是同一批活的下一步,原地接上即可,不给它
  # 单独另开一条定时链路(那样反而多一层"两条链步调不一致"的新风险)。
  # 分拣失败不影响本轮采收已经落池的事实,只吞错不重试(留给下一批/下次人工核)。
  ssh -o ConnectTimeout=20 mmv "node /Users/administrator/.openclaw/leadgen-scripts/sort-comments.js $LINE" >> $LOG 2>&1
  print "[$(date +%H:%M:%S)] 已分拣(判定链)" >> $LOG

  # 0923补齐: 视频文案判定(judge-video.js)——此前从建成起两头都没接:①没人往
  # Postgres leadgen_videos表里写数据(push-videos.js只写飞书,已在本次一并修)
  # ②没有任何触发点。这里补触发端:把harvest-keyword.sh录的音频传到mmv,拼成
  # judge-video.js要的manifest,落池之后紧接着调用(判定失败/无音频不影响本轮
  # 已经落池的事实,只吞错留给下一轮重试——跟分拣那步同一个容错原则)。
  AUDIO_LINES="$(grep '^AUDIO	' $OUT 2>/dev/null || true)"
  if [[ -n "$AUDIO_LINES" ]]; then
    REMOTE_AUDIO_DIR="/tmp/$TAG-audio"
    ssh -o ConnectTimeout=20 mmv "mkdir -p $REMOTE_AUDIO_DIR" >> $LOG 2>&1
    MANIFEST_LOCAL=$(mktemp -t "$TAG-manifest")
    python3 -c "
import json, sys
entries = []
for line in sys.stdin.read().strip().split(chr(10)):
    if not line: continue
    parts = line.split(chr(9))
    if len(parts) < 3: continue
    entries.append({'videoId': parts[1], 'audioPath': parts[2]})
print(json.dumps(entries))
" <<< "$AUDIO_LINES" > "$MANIFEST_LOCAL"
    XFER_OK=1
    while IFS=$'\t' read -r _tag VID LOCAL_AUDIO; do
      [[ -z "$LOCAL_AUDIO" || ! -f "$LOCAL_AUDIO" ]] && continue
      scp -o ConnectTimeout=20 "$LOCAL_AUDIO" "mmv:$REMOTE_AUDIO_DIR/" >> $LOG 2>&1 || XFER_OK=0
    done <<< "$AUDIO_LINES"
    # manifest里的本机路径改写成mmv上的远端路径(文件名不变,目录换成刚建的REMOTE_AUDIO_DIR)
    REMOTE_MANIFEST="/tmp/$TAG-manifest.json"
    python3 -c "
import json
with open('$MANIFEST_LOCAL') as f:
    entries = json.load(f)
for e in entries:
    e['audioPath'] = '$REMOTE_AUDIO_DIR/' + e['audioPath'].rsplit('/', 1)[-1]
print(json.dumps(entries))
" > "${MANIFEST_LOCAL}.remote"
    scp -o ConnectTimeout=20 "${MANIFEST_LOCAL}.remote" "mmv:$REMOTE_MANIFEST" >> $LOG 2>&1
    if [[ "$XFER_OK" == "1" ]]; then
      ssh -o ConnectTimeout=20 mmv "set -a; source ~/.credentials/zenithjoy-db.env 2>/dev/null; set +a; node /Users/administrator/.openclaw/leadgen-scripts/judge-video.js $LINE $REMOTE_MANIFEST" >> $LOG 2>&1
      AUDIO_COUNT=$(print -- "$AUDIO_LINES" | wc -l | tr -d ' ')
      print "[$(date +%H:%M:%S)] 已判定(视频文案链,音频${AUDIO_COUNT}条)" >> $LOG
    else
      print "[$(date +%H:%M:%S)] 音频传输部分失败,跳过本轮视频判定(留给下一轮)" >> $LOG
    fi
    rm -f "$MANIFEST_LOCAL" "${MANIFEST_LOCAL}.remote"
  else
    # 没有录到任何音频(可能整批视频都很短命中零评论便宜闸/录制失败)时,manifest传空数组,
    # 让judge-video.js照样跑一遍——它对没有音频来源的视频会退回title_only兜底判定,
    # 总比这一轮完全不调用、Postgres里的pending视频永远堆积要好。
    ssh -o ConnectTimeout=20 mmv "set -a; source ~/.credentials/zenithjoy-db.env 2>/dev/null; set +a; echo '[]' > /tmp/$TAG-manifest.json && node /Users/administrator/.openclaw/leadgen-scripts/judge-video.js $LINE /tmp/$TAG-manifest.json" >> $LOG 2>&1
    print "[$(date +%H:%M:%S)] 已判定(视频文案链,本轮无新音频,走title兜底)" >> $LOG
  fi
else
  wfr stage delivery blocked 1 "push=$PUSH skipped" '[]' '{"leads_written":0,"duplicates_skipped":0,"readback_verified":0,"cursor_updates":0}'
fi
