#!/bin/zsh
# batch2.sh PROFILE 词单 TAG PUSH SERIAL —— PUSH 默认 1(落池);传 0 = 只采不落库。
# 0916: 落池时把 profile 传给 push 脚本 —— 由 line-routes.js 按业务线路由到各自 base,
# 否则悦升的数据会被写进金诺的表(或像此前那样根本不落库)。
# batch-harvest v2 — 清场版+批完自动落池(金诺)
# 0927 棒3b-3(决策 2ca30c4d): 账本钩子内建——每词写 discovery/collection 工件,push 后写 delivery,
#   起跑 hash 不一致即停(fail-closed)。WFR_DISABLED=1、workflow-result.sh 缺失或不可执行 → 钩子全部 no-op,
#   采收行为与并入前逐字一致(__tests__ 用并入前快照 fixtures/batch2-pre-wfr.sh 对拍)。
#   0928 探针可信化: delivery 的 leads_written/duplicates_skipped/videos_pushed 取 push-*.js 打的 PUSH_*_STATS 真实统计;
#   分拣后写真实 scoring 工件(取 sort-comments.js 的 SORT_STATS)。统计解析只读 $LOG,wfr 关闭时同样逐字无差。
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
SLEEP_BASE=${BATCH_SLEEP:-20}   # 词间隔基数(秒),默认与旧行为同(20+随机40);测试传 0
OUT=~/night-$TAG.tsv; LOG=~/night-$TAG.log
# ── 账本钩子(基座 1/7 workflow-result.sh): 一行守卫决定全部 no-op ──
WFR=${WFR:-$HOME/bin-harvest/workflow-result.sh}
wfr_on(){ [[ "${WFR_DISABLED:-0}" != "1" && -x "$WFR" ]] }
wfr(){ wfr_on && bash "$WFR" "$@" >/dev/null 2>>$LOG; true }
# 9032cdad 步骤 DoD 统一裁判的读回上下文: log 类判本词(或本段)日志,tsv 类判本批采收产物;WFR_LOG_FROM 在每段开始前记日志行偏移
export WFR_LOG_FILE=$LOG WFR_TSV=$OUT WFR_LOG_FROM=0
count(){ local c; c=$(grep -c "^$1" $OUT 2>/dev/null || true); print -- "${c:-0}"; }
count_qual(){ local c; c=$(grep -cE "^QUAL	[^	]*	($1)	" $OUT 2>/dev/null || true); print -- "${c:-0}"; }
# 出口码→阶段状态(决策 af061588): 0+有候选 completed / 0 无候选 blocked no_cards / 3 blocked lock_busy / 其它 failed
# harvest-keyword.sh 出口码契约(勿改): 3 锁被占 / 1 open-search 失败 / 0 正常或无卡片
# 6b133a81: 每词写 discovery→qualification→collection 三个工件(契约设计顺序),各自读回判探针并拦截(workflow-result.sh apply_gate)。
#   QUAL 行(8bb3af55 先判后采,harvest-keyword.sh 每个进判定的视频一行 QUAL\t视频\t结论\t来源):
#   discovery.candidates = 进判定的视频数(QUAL 行,缺则回落 VIDEO 行);qualification.candidates_judged = matched+rejected,
#   qualified = matched(pending = 判定接口故障留待重判,qual_none_pending 判 retryable);collection 只在有合格视频时 completed。
wfr_word_stages(){ # n word rc dv dl q qj qm
  wfr_on || return 0
  local n="$1" W="$2" rc="$3" DV="$4" DL="$5" Q="${6:-0}" QJ="${7:-0}" QM="${8:-0}" cand
  local EV='[{"type":"log","ref":"'"$LOG"'","word":"'"$W"'","rc":'"$rc"'}]'
  cand=$(( Q > DV ? Q : DV ))
  case "$rc" in
    0) if (( cand > 0 )); then
         wfr stage discovery completed "$n" "word=$W candidates=$cand" "$EV" '{"candidates":'"$cand"',"keywords_processed":1,"screens_scanned":0}' "$W"
         if (( Q > 0 )); then
           wfr stage qualification completed "$n" "word=$W judged=$QJ qualified=$QM pending=$((Q-QJ))" "$EV" '{"candidates_judged":'"$QJ"',"qualified":'"$QM"'}' "$W"
         else
           wfr stage qualification blocked "$n" "word=$W no_qual_lines" "$EV" '{"candidates_judged":0,"qualified":0}' "$W"
         fi
         if (( QM > 0 || DV > 0 )); then
           wfr stage collection completed "$n" "word=$W leads=$DL" "$EV" '{"comments_collected":'"$DL"',"videos_processed":'"$DV"',"cursor_updates":0}' "$W"
         else
           wfr stage collection blocked "$n" "word=$W no_qualified" "$EV" '{"comments_collected":0,"videos_processed":0,"cursor_updates":0}' "$W"
         fi
       else
         wfr stage discovery blocked "$n" "word=$W no_cards" "$EV" '{"candidates":0,"keywords_processed":1,"screens_scanned":0}' "$W"
       fi;;
    3) wfr stage discovery blocked "$n" "word=$W lock_busy" "$EV" '{"candidates":0,"keywords_processed":1,"screens_scanned":0}' "$W";;
    *) wfr stage discovery failed "$n" "word=$W rc=$rc" "$EV" '{"candidates":0,"keywords_processed":1,"screens_scanned":0}' "$W";;
  esac
}
# gate_stopped: 某活动后置条件 on_fail=stop_run 不过 → workflow-result.sh 写了 $WFR_RUN_DIR/STOP(6b133a81)。停后续活动,收工由 harvest-cron 做
gate_stopped(){ wfr_on && [[ -n "${WFR_RUN_DIR:-}" && -s "$WFR_RUN_DIR/STOP" ]] }
# ── 落池/分拣统计(棒3b 探针可信化): push-*.js / sort-comments.js 各在人读输出之后再打一行 `TAG {json}`(stats-line.js),
# 这里只读 $LOG 里"本次 ssh 之前的行数偏移"之后新增的部分取最后一条合法统计,不写 $LOG、不发任何 ssh。
# 只在 wfr_on 时才会被调用(WFR_DISABLED=1/账本脚本缺失时与并入前逐字一致)。
JQ_BIN=${WFR_JQ:-/usr/bin/jq}
log_off(){ wc -l < "$LOG" 2>/dev/null | tr -d ' '; }
log_stats(){ # offset tag → stdout: 该 tag 最后一条合法 JSON 对象(紧凑单行),没有则空。坏 JSON 行跳过取更早的
  local off="$1" tag="$2" line js
  for line in ${(Oa)${(f)"$(tail -n +$(( ${off:-0} + 1 )) "$LOG" 2>/dev/null | grep "^$tag ")"}}; do
    js=$(print -r -- "${line#$tag }" | "$JQ_BIN" -c 'select(type=="object")' 2>/dev/null)
    if [[ -n "$js" ]]; then print -r -- "$js"; return 0; fi
  done
  return 0
}
stat_num(){ # json key → stdout: 该键的整数值,缺失/非数字则空
  [[ -n "$1" ]] || return 0
  print -r -- "$1" | "$JQ_BIN" -r --arg k "$2" 'if (.[$k]|type)=="number" then (.[$k]|floor|tostring) else empty end' 2>/dev/null
  return 0
}
# delivery 工件: 对账基准取落池脚本的真实统计(created=本批实际落池数,不含被历史全池去重掉的; 缺统计回落 TSV 的 LEAD 行数)
wfr_delivery_stage(){ # prc NL push_log_offset
  wfr_on || return 0
  local prc="$1" NL="$2" off="$3" ev='[{"type":"log","ref":"'"$LOG"'"}]' pv pc lw dup vp note=""
  if (( prc != 0 )); then
    wfr stage delivery failed 1 "push rc=$prc" "$ev" '{"leads_written":0,"videos_pushed":0,"duplicates_skipped":0,"readback_verified":0,"cursor_updates":0}'
    return 0
  fi
  pv=$(log_stats "$off" PUSH_VIDEOS_STATS); pc=$(log_stats "$off" PUSH_COMMENTS_STATS)
  lw=$(stat_num "$pc" created); dup=$(stat_num "$pc" dup); vp=$(stat_num "$pv" created)
  if [[ -z "$lw" ]]; then lw=$NL; note=" (no push stats)"; fi
  [[ -n "$dup" ]] || dup=0
  if [[ -z "$vp" ]]; then vp=0; [[ -n "$note" ]] || note=" (no video stats)"; fi
  wfr stage delivery completed 1 "pushed $lw leads, $vp videos$note" "$ev" '{"leads_written":'"$lw"',"videos_pushed":'"$vp"',"duplicates_skipped":'"$dup"',"readback_verified":0,"cursor_updates":0}'
}
# scoring 工件: 分拣后才有真实工件(此前只有 init 写的 blocked 占位,探针在开跑时就被判)。
# 闭集键 peer/spam 这条链没有对应分类,恒 0; strong_intent=A 级, weak_intent=B+C 级(五档分级落地后重新定义)
wfr_scoring_stage(){ # sort_rc sort_log_offset
  wfr_on || return 0
  local src="$1" off="$2" ev='[{"type":"log","ref":"'"$LOG"'"}]' ss m="" sum="" pend jd
  ss=$(log_stats "$off" SORT_STATS)
  # 有待分拣却一条没判成(judged=0 pending>0: 模型/鉴权整批挂了)不是"分拣完成"——当作没有有效统计,记 failed;
  # pending=0 的空批是正常的,仍 completed
  pend=$(stat_num "$ss" pending); jd=$(stat_num "$ss" judged)
  if [[ -n "$ss" ]] && (( ${pend:-0} > 0 && ${jd:-0} == 0 )); then
    sum=$(print -r -- "$ss" | "$JQ_BIN" -r '"sorted judged=\(.judged//0) pending=\(.pending//0) moved=\(.moved//0)"' 2>/dev/null)
    wfr stage scoring failed 1 "$sum" "$ev" '{"comments_scored":0,"strong_intent":0,"weak_intent":0,"peer":0,"irrelevant":0,"spam":0}'
    return 0
  fi
  if [[ -n "$ss" ]]; then
    m=$(print -r -- "$ss" | "$JQ_BIN" -c '{comments_scored:(.judged//0),strong_intent:(.grades.A//0),weak_intent:((.grades.B//0)+(.grades.C//0)),peer:0,irrelevant:(.grades["不相关"]//0),spam:0}' 2>/dev/null)
    sum=$(print -r -- "$ss" | "$JQ_BIN" -r '"sorted judged=\(.judged//0) pending=\(.pending//0) moved=\(.moved//0)"' 2>/dev/null)
  fi
  if [[ -n "$m" ]]; then
    wfr stage scoring completed 1 "$sum" "$ev" "$m"
  else
    wfr stage scoring failed 1 "no SORT_STATS rc=$src" "$ev" '{"comments_scored":0,"strong_intent":0,"weak_intent":0,"peer":0,"irrelevant":0,"spam":0}'
  fi
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
STOPPED=0
for W in "${(f)$(cat $WF)}"; do
  [[ -z "$W" ]] && continue
  n=$((n+1))
  if gate_stopped; then
    print "[$(date +%H:%M:%S)] 活动后置条件拦截(STOP),停跑后续词: $(cat "$WFR_RUN_DIR/STOP" 2>/dev/null | head -c 200)" >> $LOG
    print "BATCH2_ESCALATE=gate_stop"; STOPPED=1; break
  fi
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
  WFR_LOG_FROM=$(log_off); WFR_LOG_FROM=${WFR_LOG_FROM:-0}
  print "[$(date +%H:%M:%S)] 词$n: $W" >> $LOG
  wr step "$SERIAL" 3 doing "词$n: $W"
  V0=$(count VIDEO); L0=$(count LEAD); Q0=$(count QUAL); QJ0=$(count_qual 'matched|rejected'); QM0=$(count_qual matched)
  rc=0; "${HARVEST_KEYWORD:-$HOME/bin-harvest/harvest-keyword.sh}" "$P" "$ENC" "$MAXV" "$TAG-w$n" unlimited "$LINE" >> $OUT 2>> $LOG || rc=$?
  V1=$(count VIDEO); L1=$(count LEAD); Q1=$(count QUAL); QJ1=$(count_qual 'matched|rejected'); QM1=$(count_qual matched)
  wfr_word_stages "$n" "$W" "$rc" $((V1-V0)) $((L1-L0)) $((Q1-Q0)) $((QJ1-QJ0)) $((QM1-QM0))
  print "[$(date +%H:%M:%S)] 词$n 完成 LEAD=$(grep -c '^LEAD' $OUT 2>/dev/null||echo 0)" >> $LOG
  NLEAD=$(grep -c '^LEAD' $OUT 2>/dev/null); wr note "$SERIAL" "词$n 完成 LEAD=${NLEAD:-0}"
  (( SLEEP_BASE > 0 )) && /bin/sleep $(( SLEEP_BASE + RANDOM % 40 ))
done
print "[$(date +%H:%M:%S)] v2批完成 LEAD=$(grep -c '^LEAD' $OUT) VIDEO=$(grep -c '^VIDEO' $OUT)" >> $LOG
NL=$(count LEAD)
gate_stopped && STOPPED=1
if (( STOPPED )); then
  # 6b133a81: 采集阶段后置条件 stop_run 不过(如未判合格却采了评论)→ 不落池、不分拣,脏数据不进客户可见的池表
  print "[$(date +%H:%M:%S)] 已被活动后置条件拦截,跳过落池/分拣(没跑到的阶段由收工 finalize 补 not_run 读回)" >> $LOG
elif [[ "$PUSH" == "1" && -s $OUT ]]; then
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
  PUSH_OFF=""; wfr_on && PUSH_OFF=$(log_off)   # 本次 ssh 之前的日志行数: 之后新增的输出里才有本批的 PUSH_*_STATS
  WFR_LOG_FROM=${PUSH_OFF:-0}
  ssh -o ConnectTimeout=20 mmv "set -a; source ~/.credentials/zenithjoy-db.env 2>/dev/null; set +a; node /Users/administrator/.openclaw/leadgen-scripts/push-videos.js /tmp/$TAG.tsv $TAG $LINE && node /Users/administrator/.openclaw/leadgen-scripts/push-raw-comments.js /tmp/$TAG.tsv $TAG $LINE" >> $LOG 2>&1
  prc=$?
  # 账本 delivery: 落池 ssh 的出口码决定 completed/failed; readback_verified 由探针读回(checks/ YAML)填,这里不硬编码;
  # leads_written/duplicates_skipped/videos_pushed 取落池脚本的真实统计(缺统计回落 $NL),见 wfr_delivery_stage
  wfr_delivery_stage "$prc" "$NL" "$PUSH_OFF"
  print "[$(date +%H:%M:%S)] 已落池(视频+评论)" >> $LOG
  if gate_stopped; then
    print "[$(date +%H:%M:%S)] 配送读回不过(STOP),跳过分拣: $(cat "$WFR_RUN_DIR/STOP" 2>/dev/null | head -c 200)" >> $LOG
    print "BATCH2_ESCALATE=gate_stop"
  else
  # 0923补齐:落池之后紧接着分拣——此前sort-comments.js压根没有任何自动触发点
  # (既不在cron里,也不在任何批处理链路里,只能靠人/agent手动敲,而agent侧那份
  # "手跑干预"playbook写的是/root/.openclaw/...这个host上根本不存在的路径,
  # 从没真正跑通过)。落池跟分拣本就是同一批活的下一步,原地接上即可,不给它
  # 单独另开一条定时链路(那样反而多一层"两条链步调不一致"的新风险)。
  # 分拣失败不影响本轮采收已经落池的事实,只吞错不重试(留给下一批/下次人工核)。
  SORT_OFF=""; wfr_on && SORT_OFF=$(log_off)
  WFR_LOG_FROM=${SORT_OFF:-0}
  ssh -o ConnectTimeout=20 mmv "node /Users/administrator/.openclaw/leadgen-scripts/sort-comments.js $LINE" >> $LOG 2>&1
  src=$?
  print "[$(date +%H:%M:%S)] 已分拣(判定链)" >> $LOG
  # 账本 scoring: 分拣之后才有真实工件(有 SORT_STATS → completed, 否则 failed); n=1 覆盖 init 写的 blocked 占位项
  wfr_scoring_stage "$src" "$SORT_OFF"
  fi

  # 8bb3af55 先判后采(决策 f18f56b8①): 视频文案判定已前移到 harvest-keyword.sh 逐视频开评论区之前
  # (ssh mmv qualify-video.js discover/judge/collected),判定不合格的视频根本不开评论区。
  # 这里原本在落池之后才跑 judge-video.js——那时评论早已采完落池,判了也挡不住,已删除。
  # 留 pending 的视频(判定接口故障)下次被搜到时重判;批量补判仍可人工跑 judge-video.js。
else
  wfr stage delivery blocked 1 "push=$PUSH skipped" '[]' '{"leads_written":0,"videos_pushed":0,"duplicates_skipped":0,"readback_verified":0,"cursor_updates":0}'
fi
