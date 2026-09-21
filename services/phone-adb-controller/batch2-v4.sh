#!/bin/zsh
# batch2-v4.sh PROFILE 词单 TAG PUSH SERIAL —— batch2.sh 的基座1/7副本：每词写 discovery/collection 工件，
# push 后写 delivery，hash 不一致即停(fail-closed)。原 batch2.sh 保持不动，影子跑 2 晚通过后再切 crontab。
# 依赖已 eval 过的 WFR_RUN_ID WFR_HASH WFR_RUN_DIR WFR_ART_DIR WFR_ATTEMPT WFR_SKIP_WORDS（harvest-cron-v4 负责）。
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
P="$1"; WF="$2"; TAG="$3"; PUSH="${4:-0}"; SERIAL="${5:-}"
WR=${WALL_REPORT:-$HOME/bin-harvest/wall-report.sh}
wr(){ [[ -n "$SERIAL" && -x "$WR" ]] && "$WR" "$@" >/dev/null 2>&1; true }
HK=${HARVEST_KEYWORD:-$HOME/bin-harvest/harvest-keyword.sh}
WFR=${WFR:-$HOME/bin-harvest/workflow-result.sh}
SLEEP_BASE=${BATCH_SLEEP:-20}
OUT=~/night-$TAG.tsv; LOG=~/night-$TAG.log
: > $OUT
print "[$(date +%H:%M:%S)] v4批开始 profile=$P $(wc -l < $WF)词 push=$PUSH attempt=${WFR_ATTEMPT:-?}" >> $LOG
# hash 一致性：词单在 init 之后被改 = 请求身份变了，fail-closed（PrepPRD 拍板）
NOWHASH=$(bash "$WFR" hash "$P" "$WF" "$PUSH" 2>/dev/null | sed -n 's/^WFR_HASH=//p'); NOWHASH=${NOWHASH:-}
if [[ -n "${WFR_HASH:-}" && "$NOWHASH" != "$WFR_HASH" ]]; then
  print "[$(date +%H:%M:%S)] hash 不一致 init=$WFR_HASH now=$NOWHASH，停跑" >> $LOG
  bash "$WFR" stage discovery blocked 1 "hash_mismatch init=$WFR_HASH now=$NOWHASH" '[{"type":"log","ref":"'"$LOG"'"}]' '{"candidates":0,"keywords_processed":0,"screens_scanned":0}' "" >/dev/null 2>>$LOG
  print "BATCH2_ESCALATE=hash_mismatch"
  exit 0
fi
count(){ local c; c=$(grep -c "^$1" $OUT 2>/dev/null || true); print -- "${c:-0}"; }
n=0
for W in "${(f)$(cat $WF)}"; do
  [[ -z "$W" ]] && continue
  n=$((n+1))
  # 续跑：skip_words 里的词已在上一 attempt 完成
  if [[ -n "${WFR_SKIP_WORDS:-}" && "|${WFR_SKIP_WORDS}|" == *"|${W}|"* ]]; then
    print "[$(date +%H:%M:%S)] 词$n: $W 已完成(续跑跳过)" >> $LOG; continue
  fi
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
  rc=0; "$HK" "$P" "$ENC" 4 "$TAG-w$n" unlimited >> $OUT 2>> $LOG || rc=$?
  V1=$(count VIDEO); L1=$(count LEAD); DV=$((V1-V0)); DL=$((L1-L0))
  EV='[{"type":"log","ref":"'"$LOG"'","word":"'"$W"'","rc":'"$rc"'}]'
  case "$rc" in
    0) if (( DV > 0 )); then
         bash "$WFR" stage discovery completed "$n" "word=$W videos=$DV" "$EV" '{"candidates":'"$DV"',"keywords_processed":1,"screens_scanned":0}' "$W" >/dev/null 2>>$LOG
         bash "$WFR" stage collection completed "$n" "word=$W leads=$DL" "$EV" '{"comments_collected":'"$DL"',"videos_processed":'"$DV"',"cursor_updates":0}' "$W" >/dev/null 2>>$LOG
       else
         bash "$WFR" stage discovery blocked "$n" "word=$W no_cards" "$EV" '{"candidates":0,"keywords_processed":1,"screens_scanned":0}' "$W" >/dev/null 2>>$LOG
       fi;;
    3) bash "$WFR" stage discovery blocked "$n" "word=$W lock_busy" "$EV" '{"candidates":0,"keywords_processed":1,"screens_scanned":0}' "$W" >/dev/null 2>>$LOG;;
    *) bash "$WFR" stage discovery failed "$n" "word=$W rc=$rc" "$EV" '{"candidates":0,"keywords_processed":1,"screens_scanned":0}' "$W" >/dev/null 2>>$LOG;;
  esac
  print "[$(date +%H:%M:%S)] 词$n 完成 rc=$rc LEAD=$L1" >> $LOG
  wr note "$SERIAL" "词$n 完成 LEAD=$L1"
  (( SLEEP_BASE > 0 )) && /bin/sleep $(( SLEEP_BASE + RANDOM % 40 ))
done
NL=$(count LEAD); NV=$(count VIDEO)
print "[$(date +%H:%M:%S)] v4批完成 LEAD=$NL VIDEO=$NV" >> $LOG
if [[ "$PUSH" == "1" && -s $OUT ]]; then
  scp -o ConnectTimeout=20 $OUT mmv:/tmp/$TAG.tsv >> $LOG 2>&1
  ssh -o ConnectTimeout=20 mmv "node /Users/administrator/.openclaw/leadgen-scripts/push-videos.js /tmp/$TAG.tsv $TAG $P && node /Users/administrator/.openclaw/leadgen-scripts/push-raw-comments.js /tmp/$TAG.tsv $TAG $P" >> $LOG 2>&1
  prc=$?
  if (( prc == 0 )); then
    bash "$WFR" stage delivery completed 1 "pushed $NL leads" '[{"type":"log","ref":"'"$LOG"'"}]' '{"leads_written":'"$NL"',"duplicates_skipped":0,"readback_verified":0,"cursor_updates":0}' >/dev/null 2>>$LOG
  else
    bash "$WFR" stage delivery failed 1 "push rc=$prc" '[{"type":"log","ref":"'"$LOG"'"}]' '{"leads_written":0,"duplicates_skipped":0,"readback_verified":0,"cursor_updates":0}' >/dev/null 2>>$LOG
  fi
  print "[$(date +%H:%M:%S)] 已落池(视频+评论) rc=$prc" >> $LOG
else
  bash "$WFR" stage delivery blocked 1 "push=$PUSH skipped" '[]' '{"leads_written":0,"duplicates_skipped":0,"readback_verified":0,"cursor_updates":0}' >/dev/null 2>>$LOG
fi
