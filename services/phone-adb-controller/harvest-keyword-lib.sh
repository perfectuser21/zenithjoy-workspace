#!/bin/zsh
# 旧词循环与独立视频入口共享业务函数。
# video_drifted EXPECTED_VID OBSERVED_VID —— 0929修复:抢救(back+重开评论区)后核对屏幕上
# 的视频身份是否仍是本视频。OBSERVED为空(读不到)或与EXPECTED不同即为漂移。EXPECTED本身
# 为空时保守放行(不判定,不是本次修复覆盖的场景)。
video_drifted() {
  local expected="$1" observed="$2"
  [[ -z "$expected" ]] && return 1
  [[ -z "$observed" || "$observed" != "$expected" ]]
}
# nap SECONDS —— 0929修复(DoD审计测试提速): 本文件原来14处裸 sleep/bin/sleep 加起来
# 单条测试要跑几十秒(录制预算类的sleep甚至要等REC_SECONDS+2秒真实时间)，CI里
# leadgen-field-cleanup-smoke.sh 把整个phone-adb-controller测试套件当一步跑,新增
# 的几个真机行为集成测试一叠加直接把这一步的时间预算撑爆(exit 124超时,棘轮闸阻断)。
# 跟 outreach-tick.sh 的 nap() 同一个模式: 测试环境下不真睡,生产不设这个变量不受影响。
nap(){ [[ -n "${HARVEST_KEYWORD_TESTING:-}" ]] && return 0; /bin/sleep "$1" }
# 7d150e33(阶段1): 整批总时限(视频边界判到点平滑收工)+ 发现/采集段按契约预算封顶,函数在 wf-limits.sh;
#   库缺失(旧部署/单独手跑)→ 兜底为"不限时",行为与并入前一致
source "${0:A:h}/wf-limits.sh" 2>/dev/null \
  || { wf_deadline_reached(){ return 1 }; wf_stop_requested(){ return 1 }; wf_budget_of(){ print 0 }; wf_timeout_class(){ print record }; wf_run_bounded(){ shift; "$@" } }
# ── 先判后采(任务 8bb3af55,决策 f18f56b8①「判定合格的视频才采集」) ──
# 此前视频判定(judge-video.js)挂在 batch2.sh 落池之后跑——评论早已采完落池,判了也挡不住。
# 现在每个视频在开评论区之前经 ssh 到 mmv(PG 与模型凭据只在 mmv)调 qualify-video.js:
#   discover(候选落库 pending,回报缓存判定) → 未判过才录音 → judge → 只有 matched 才采 → collected(评论已采)。
# 远端命令形状同 batch2.sh 推 push-videos.js 那条 ssh(先 source zenithjoy-db.env,裸 ssh 没有 DATABASE_URL)。
# 判定出错(库/ssh 不可达、判定接口故障 JudgeApiError 口径)一律按 pending:本视频本轮不采、留待重判,不挡后面的视频。
# 本批批次键(探针 $RUN_TAG):batch2.sh 传的 TAG 是「批次-w词序」,去掉词后缀;调用方可用 HARVEST_BATCH 显式给
HBATCH="${HARVEST_BATCH:-${TAG%-w<->}}"
qsq(){ local q=\' s="$1"; s="${s//$q/$q\\$q$q}"; print -rn -- "'$s'"; }
b64(){ print -rn -- "$1" | base64 | tr -d '\n'; }
# qual_remote 子命令 参数... → stdout: 远端最后一条 QUAL_* 行(ssh 不通/无回话 = 空)
activity_remote_budget(){
  local cap=0
  if [[ -n "${VIDEO_ACTIVITY_MODE:-}" ]] && (( BUDGET > 0 )); then
    cap=$(( BUDGET - ($(date +%s) - ACTIVITY_T0) ))
    (( cap > 0 )) || return 124
  fi
  print -r -- "$cap"
}
qual_remote(){
  local sub="$1" args="" a cap remote prefix host=mmv
  shift
  [[ "$sub" == discover || "$sub" == judge || "$sub" == collected ]] || return 1
  for a in "$@"; do args="$args $(qsq "$a")"; done
  cap="$(activity_remote_budget)" || return 124
  if [[ -n "${VIDEO_ACTIVITY_MODE:-}" && -n "${QUAL_GATEWAY_HOST:-}" ]]; then
    host="$QUAL_GATEWAY_HOST"
    prefix="set -e; "
    if [[ -n "${QUAL_GATEWAY_ENV_FILE:-}" ]]; then prefix+="set -a; . $(qsq "$QUAL_GATEWAY_ENV_FILE"); set +a; "; fi
    remote="${prefix}cd $(qsq "$QUAL_GATEWAY_CWD"); exec $(qsq "${QUAL_GATEWAY_NODE:-node}") $(qsq "$QUAL_GATEWAY_CWD/qualify-video.js") $(qsq "$sub")$args"
  else
    remote="set -a; source ~/.credentials/zenithjoy-db.env 2>/dev/null; set +a; cd ~/.openclaw/leadgen-scripts && node qualify-video.js $sub$args"
  fi
  wf_run_bounded "$cap" ssh -o ConnectTimeout=20 -o BatchMode=yes "$host" "$remote" 2>/dev/null </dev/null | grep '^QUAL_' | tail -1
}
# qual_field JSON行 键 → 值(字符串或 true/false)
qual_field(){ print -r -- "$1" | sed -n "s/.*\"$2\":\"\{0,1\}\([^\",}]*\).*/\1/p" | head -1; }
# 阶段3：旧词循环与独立单视频入口复用的两个业务函数。
# 独立入口覆盖安全边界检测；旧批次保留已有词/视频边界预算行为。
activity_should_stop(){ return 1; }
qualify_current_video() {
  # 先判后采①: 候选落库(pending) + 取缓存判定——以前判过的 rejected 不再录不再判,matched 直接采
  QD="$(qual_remote discover --line "$LINE" --video-id "$VID" --video-url "$VURL" --title-b64 "$(b64 "$TITLE")" --keyword-b64 "$(b64 "$KWTXT")" --batch "$HBATCH")"
  QV="$(qual_field "$QD" status)"; QSRC=cached; QR=""
  case "$QV" in
    matched|rejected) log "  已判定过($QV),沿用库里结论,不重录不重判";;
    pending) QSRC=judged;;
    *) QV=pending; QSRC=discover_failed; QR="候选落库失败(库/ssh不可达): ${QD:-ssh无回话}";;
  esac
  activity_should_stop && { QV=pending; return 124; }
  # 只有待判且库里没有转写(上轮判定接口故障会把转写存下)才录音
  NEED_AUDIO=0
  [[ "$QSRC" == judged && "$(qual_field "$QD" has_transcript)" != true ]] && NEED_AUDIO=1
  # 0923补齐: 录屏+提取音频,给judge-video.js(此前从建成起就没有任何数据源)供料。
  # 时长换算: DUR是视频卡片上的"MM:SS"标签(video_cards_from_xml已经在抓,此前没人用)。
  # 3倍速播放+录制:录制秒数=ceil(min(视频时长,300)/3)+5秒缓冲,跟douyin-phone-adb里
  # record_start自己的注释("正常3倍速调用应传ceil(min(视频时长,300)/3)+5 ≤ 105")对齐。
  # 拿不到时长(DUR为空,标签没抓到)就按60秒视频保守估算,不因为一个字段抓失败就整段跳过。
  AUDIO_PATH=""
  if [[ -n "$DUR" && "$DUR" == <->:<-> ]]; then
    DUR_MIN="${DUR%%:*}"; DUR_SEC="${DUR##*:}"
    VIDEO_SECONDS=$(( 10#$DUR_MIN * 60 + 10#$DUR_SEC ))
  else
    VIDEO_SECONDS=60
  fi
  (( VIDEO_SECONDS > 300 )) && VIDEO_SECONDS=300
  REC_SECONDS=$(( (VIDEO_SECONDS + 2) / 3 + 5 ))
  (( REC_SECONDS < 10 )) && REC_SECONDS=10
  (( REC_SECONDS > 105 )) && REC_SECONDS=105
  if [[ -n "${VIDEO_ACTIVITY_MODE:-}" ]] && (( NEED_AUDIO && BUDGET > 0 && BUDGET - ($(date +%s) - ACTIVITY_T0) < REC_SECONDS + 2 )); then
    ACTIVITY_REASON=budget_exceeded; QV=pending; return 124
  fi
  log "  时长=${DUR:-未知} 录制预算=${REC_SECONDS}s"
  if (( ! NEED_AUDIO )); then
    :
  elif $C --profile "$P" set-playback-speed 3.0 "$TAG-v$i-spd" </dev/null >/dev/null 2>&1; then
    if $C --profile "$P" record-start "$TAG-v$i-rec" "$REC_SECONDS" </dev/null >/dev/null 2>&1; then
      nap "$((REC_SECONDS + 2))"
      RSOUT="$($C --profile "$P" record-stop "$TAG-v$i-rec" </dev/null 2>&1 || true)"
      if print -- "$RSOUT" | grep -q "^record_stopped"; then
        RAOUT="$($C --profile "$P" record-extract-audio "$TAG-v$i-rec" </dev/null 2>&1 || true)"
        AUDIO_PATH="$(print -- "$RAOUT" | sed -n "s/^audio_extracted path=\([^ ]*\).*/\1/p")"
        # 电平打点回显（0924 扩机护栏）：record_stop 已实测 mean_volume 并挂在 record_stopped
        # 行尾。必须写进采收日志——不写就没人看得见，换机型录到 -91dB 死寂时会静默退化成
        # title-only 判定。-91dB 附近即视为死寂，日志里显式标出来。
        MEAN_DB="$(print -- "$RSOUT" | sed -n "s/^record_stopped .*mean_volume_db=\([^ ]*\).*/\1/p" | tail -1)"
        [[ -n "$AUDIO_PATH" ]] && log "  音频已提取: $AUDIO_PATH (电平 ${MEAN_DB:-未知} dB)" || log "  音频提取失败: $(print -- "$RAOUT" | tail -1 | head -c 150)"
        # 0929修复(DoD审计发现): 契约要求"实际录制时长≥预算的80%"，之前完全没有这道比对。
        # 注意基准是 $REC_SECONDS(已经除过3倍速的录制预算,比如原视频60秒→REC_SECONDS≈26秒)，
        # 不是原视频时长——scrcpy 录的是3倍速播放的屏幕，真实录制秒数量级就是预算这个量级，
        # 拿原视频秒数当基准比较会让所有录制永远达不到80%(用户0929现场核对过这个计算链路)。
        REC_DUR="$(print -- "$RSOUT" | sed -n "s/^record_stopped .*duration_seconds=\([^ ]*\).*/\1/p" | tail -1)"
        if [[ "$REC_DUR" == <->(.<->|) ]] \
           && (( $(print -- "$REC_DUR $REC_SECONDS" | awk '{print ($1 < $2*0.8) ? 1 : 0}') )); then
          log "  ⚠️ 录制时长不足(实录${REC_DUR}s / 预算${REC_SECONDS}s,未达80%) — 可能中途被打断,本段音频作废退回title-only判定"
          AUDIO_PATH=""
        fi
        if [[ -n "$MEAN_DB" && "$MEAN_DB" != unknown ]] \
           && (( $(print -- "$MEAN_DB" | awk '{print ($1 <= -80) ? 1 : 0}') )); then
          log "  ⚠️ 录到的几乎是死寂(${MEAN_DB} dB) — 检查该机 speaker 流音量是否为 0,本段音频作废退回title-only判定"
          # 0929修复(DoD审计发现,用户拍板"那肯定不行呀"): 上面这行注释(0924)写的本来就是
          # "不写就没人看得见,换机型录到-91dB死寂时会静默退化成title-only判定"——但代码
          # 从来没真的退化,AUDIO_PATH照样非空,下面140行照样把死寂音频当正常数据吐出去,
          # 白白烧一次转写API调用,还占着pending队列等重试(死寂不是暂时性问题,重试不会变好)。
          # 现在真的清空AUDIO_PATH,让judge-video.js走已有的"无音频退回标题"分支。
          AUDIO_PATH=""
        fi
      else
        log "  录制未产出有效文件: $(print -- "$RSOUT" | tail -1 | head -c 150)"
      fi
    else
      log "  录制启动失败,跳过本视频音频(不影响评论采集)"
    fi
  else
    log "  倍速菜单未找到(可能是视觉定位偶发失败),跳过本视频音频(不影响评论采集)"
  fi
  [[ -n "$AUDIO_PATH" && -n "$VID" ]] && print -- "AUDIO	$VID	$AUDIO_PATH"
  # 先判后采②: 判定在开评论区之前。音频有效才 scp 到 mmv 交给判定(无效/没录 → 判定侧退回标题判定)
  activity_should_stop && { QV=pending; return 124; }
  if [[ "$QSRC" == judged ]]; then
    QAUD=()
    if [[ -n "$AUDIO_PATH" ]]; then
      local audio_ext="${AUDIO_PATH##*.}"
      if [[ -n "${VIDEO_ACTIVITY_MODE:-}" && -n "${QUAL_GATEWAY_HOST:-}" ]]; then
        [[ "$HBATCH" =~ '^[A-Za-z0-9_.-]+$' && "$VID" == <-> && "$audio_ext" =~ '^[A-Za-z0-9]+$' ]] || { QV=pending; return 1; }
      fi
      RAUD="/tmp/qa-${HBATCH}-${VID}.${audio_ext}"
      UPLOAD_CAP="$(activity_remote_budget)" || { QV=pending; return 124; }
      local audio_upload_host=mmv
      [[ -n "${VIDEO_ACTIVITY_MODE:-}" && -n "${QUAL_GATEWAY_HOST:-}" ]] && audio_upload_host="$QUAL_GATEWAY_HOST"
      if wf_run_bounded "$UPLOAD_CAP" scp -o ConnectTimeout=20 -o BatchMode=yes "$AUDIO_PATH" "$audio_upload_host:$RAUD" </dev/null >/dev/null 2>&1; then QAUD=(--audio "$RAUD")
      else log "  音频传 mmv 失败,本视频退回标题判定"; fi
    fi
    activity_should_stop && { QV=pending; return 124; }
    QR="$(qual_remote judge --line "$LINE" --video-id "$VID" "${QAUD[@]}")"
    QV="$(qual_field "$QR" verdict)"
    [[ -n "$QV" ]] || { QV=pending; QR="判定无回话(ssh不通): ${QR:-空}"; }
  fi
  print -- "QUAL	$VID	$QV	$QSRC"
}
# 沿用现有物理命令与超时工具；单episode总上限60秒，同时取活动剩余预算的更小值。
context_command() {
  local cap=$((60 - ($(date +%s) - CONTEXT_T0))) remaining
  activity_should_stop && return 124
  (( cap > 0 )) || { ACTIVITY_REASON=comment_context_unavailable; return 124; }
  remaining="$(activity_remote_budget)" || { ACTIVITY_REASON=budget_exceeded; return 124; }
  if (( remaining > 0 && remaining < cap )); then cap=$remaining; fi
  wf_run_bounded "$cap" "$C" --profile "$P" "$@"
}
# 独立视频活动：每次丢失只尝试一次直接重开，不追退栈；函数调用受活动停止/预算边界约束。
recover_comment_context() {
  local opened orc link lrc observed valid="" panel prc raw rrc
  CONTEXT_EPISODE=$((CONTEXT_EPISODE+1))
  local context_tag="$TAG-v$i-u$j-context$CONTEXT_EPISODE"
  COLLECTION_REASON=comment_context_unavailable
  CONTEXT_T0=$(date +%s)
  activity_should_stop && return 124
  opened="$(context_command open-video "$VID" "$context_tag-open" </dev/null 2>/dev/null)"; orc=$?
  (( orc == 124 )) && { activity_should_stop || ACTIVITY_REASON=comment_context_unavailable; return 124; }
  (( orc == 0 )) && print -r -- "$opened" | grep -q '^video_opened=1$' || return 2
  activity_should_stop && return 124
  link="$(context_command current-video-link "$context_tag-binding" </dev/null 2>/dev/null)"; lrc=$?
  observed="$(print -r -- "$link" | sed -n 's/^video_id=//p')"
  [[ "$observed" == <-> && ${#observed} -ge 16 && ${#observed} -le 24 ]] && valid="$observed"
  print -- "ACTIVITY_BINDING\t$VID\t$valid\t$lrc"
  if (( lrc == 124 )); then activity_should_stop && return 124; fi
  COLLECTION_REASON=video_identity_unavailable
  (( lrc == 0 )) && [[ -n "$valid" && "$VID" == <-> && ${#VID} -ge 16 && ${#VID} -le 24 ]] || return 2
  COLLECTION_REASON=video_mismatch
  [[ "$valid" == "$VID" ]] || return 2
  COLLECTION_REASON=comment_context_unavailable
  activity_should_stop && return 124
  panel="$(context_command open-comments "$context_tag-panel" </dev/null 2>/dev/null)"; prc=$?
  (( prc == 124 )) && { activity_should_stop || ACTIVITY_REASON=comment_context_unavailable; return 124; }
  (( prc == 0 )) && print -r -- "$panel" | grep -q '^comments_opened=1$' || return 2
  activity_should_stop && return 124
  raw="$(context_command collect-comments "$context_tag-fresh" </dev/null 2>/dev/null)"; rrc=$?
  (( rrc == 124 )) && { activity_should_stop || ACTIVITY_REASON=comment_context_unavailable; return 124; }
  (( rrc == 0 )) && print -r -- "$raw" | grep -qE '^exhausted=[01]$' || return 2
  CONTEXT_ROWS="$raw"; CONTEXT_DIRTY=0; CONTEXT_REFRESHED=1
  return 0
}
# 重开后只能用唯一昵称+正文匹配当前屏；重复行、缺行、坏坐标均不能借旧坐标继续。
refresh_comment_row() {
  local row count=0 candidate nick body
  for row in "${(f)CONTEXT_ROWS}"; do
    [[ "$row" == *$'\ttap='* ]] || continue
    nick="$(print -r -- "$row" | cut -f1)"; body="$(print -r -- "$row" | cut -f2)"
    if [[ "$nick" == "$NICK" && "$body" == "$BODY" ]]; then candidate="$row"; count=$((count+1)); fi
  done
  (( count == 1 )) || { COLLECTION_REASON=comment_context_unavailable; return 2; }
  TAPF="$(print -r -- "$candidate" | cut -f6)"; NB="$(print -r -- "$candidate" | cut -f7)"; NB="${NB#b64=}"
  local xy="${TAPF#tap=}"
  TXX="${xy%% *}"; TXY="${xy##* }"
  [[ "$TXX" == <-> && "$TXY" == <-> && -n "$NB" ]] || { COLLECTION_REASON=comment_context_unavailable; return 2; }
}
collect_current_video() {
  ACTIVITY_INTERRUPTED=0
  COLLECTION_REASON=""; CONTEXT_EPISODE=0; CONTEXT_DIRTY=0; CONTEXT_REFRESHED=0; CONTEXT_ROWS=""
  activity_should_stop && return 124
  local open_rc=0 collect_rc=0
  OCOUT="$($C --profile "$P" open-comments "$TAG-v$i-oc" </dev/null 2>/dev/null)"; open_rc=$?
  if [[ -n "${VIDEO_ACTIVITY_MODE:-}" ]] && (( open_rc != 0 )); then COLLECTION_REASON=comment_context_unavailable; return 2; fi
  if ! print -- "$OCOUT" | grep -q "^comments_opened=1$"; then
    log "  评论区打不开,3秒后重试1次"
    nap 3
    OCOUT="$($C --profile "$P" open-comments "$TAG-v$i-oc2" </dev/null 2>/dev/null)"; open_rc=$?
    if [[ -n "${VIDEO_ACTIVITY_MODE:-}" ]] && (( open_rc != 0 )); then COLLECTION_REASON=comment_context_unavailable; return 2; fi
    if ! print -- "$OCOUT" | grep -q "^comments_opened=1$"; then
      log "  评论区重试仍打不开,跳过"
      if [[ -n "${VIDEO_ACTIVITY_MODE:-}" ]]; then COLLECTION_REASON=comment_context_unavailable; return 2; fi
      # 0929修复(DoD审计发现真机复现): back-to-results 不传关键词只核实页面类型，
    # 分不清"真结果页"和 current-video-link 内部的暂存草稿页(两者同 Activity)——
    # 12词×3卡实测100%误判。传 $KW 让它多核一遍搜索框文字是不是这次搜的词。
      return 1
    fi
  fi
  # 0922拍板"大户分级": comment_count 是 open-comments 免费吐出来的字段(如"评论1.2万"),
  # 之前这里直接把 open-comments 的输出丢进 /dev/null,没人读过这个字段。
  # 形态可能是纯数字(158)、带"万"(1.2万)、或没有评论按钮时的 unknown——都要能处理。
  CCOUNT_RAW="$(print -- "$OCOUT" | sed -n "s/^comment_count=//p")"
  if [[ "$CCOUNT_RAW" == *万* ]]; then
    CCOUNT_NUM="$(( int(${CCOUNT_RAW%万} * 10000) ))"
  elif [[ "$CCOUNT_RAW" == <-> ]]; then
    CCOUNT_NUM="$CCOUNT_RAW"
  else
    CCOUNT_NUM=0  # unknown/解析不出来时按"不是大户"处理,走medium档,不因为没读到数字就不采
  fi
  # 大户分级(跟comment-tier-lib.js的commentTier保持同一套阈值,来源同一次0922拍板):
  #   ≤10条 small:一屏基本够,不特殊处理(下面循环第一轮读完exhausted多半就是true了)
  #   10-100条 medium:翻屏抓到exhausted为止,不封顶
  #   >100条 large(大户):标记,翻屏抓到封顶条数或exhausted两者先到为止,不追求抓完
  LARGE_CAP=50
  if (( CCOUNT_NUM > 100 )); then
    TIER="large"; log "  评论数=$CCOUNT_RAW(判定大户,封顶抓${LARGE_CAP}条)"
  elif (( CCOUNT_NUM > 10 )); then
    TIER="medium"
  else
    TIER="small"
  fi

  # 翻屏累积:每屏读到的评论用"昵称|抖音号前缀|正文前20字"这个近似key去重(评论者身份
  # 要等commenter-identity才拿得到,这里只能先用"评论正文行本身"整行去重防止原地重复读
  # 同一屏——真正的昵称+抖音号精确去重key在下面逐条处理commenter-identity之后再算一次,
  # 跟push-raw-comments.js现有rid逻辑对齐,两层去重不冲突)。
  typeset -A SEEN_LINES CONFIRMED_COMMENTS CONFIRMED_IDENTITY_RELATIONS
  CC=""
  local confirmed_count=0 screen_before=0 comment_key="" comment_tuple="" identity_relation="" key_rc=0
  EMPTY_ROUNDS=0
  SCREEN=0
  j=0
  AUTHOR_IS_OWN=0
  VIDEO_DRIFTED=0
  while true; do
    if activity_should_stop; then ACTIVITY_INTERRUPTED=1; break; fi
    SCREEN=$((SCREEN+1))
    CONTEXT_REFRESHED=0
    screen_before=$confirmed_count
    RAW="$($C --profile "$P" collect-comments "$TAG-v$i-cc$SCREEN" 2>/dev/null)"; collect_rc=$?
    if [[ -n "${VIDEO_ACTIVITY_MODE:-}" ]]; then
      if (( collect_rc != 0 )) || ! print -r -- "$RAW" | grep -qE '^exhausted=[01]$'; then
        COLLECTION_REASON=comment_context_unavailable; return 2
      fi
    fi
    EXHAUSTED=0
    print -- "$RAW" | grep -q "^exhausted=1" && EXHAUSTED=1
    NEWLINES=""
    while IFS= read -r LN; do
      [[ "$LN" == *"	tap="* ]] || continue
      if [[ -n "${VIDEO_ACTIVITY_MODE:-}" ]]; then
        # 昵称/正文/坐标都不是身份。每屏逐行读身份后才能去重，同名客户不能在此合并。
        NEWLINES="$NEWLINES$LN"$'\n'
      elif [[ -z "${SEEN_LINES[$LN]:-}" ]]; then
        SEEN_LINES[$LN]=1
        NEWLINES="$NEWLINES$LN"$'\n'
        CC="$CC$LN"$'\n'
      fi
    done <<< "$RAW"
    NEWCOUNT=$(print -- "$NEWLINES" | grep -c "	tap=" || true)
    if [[ -z "${VIDEO_ACTIVITY_MODE:-}" ]]; then
      if (( NEWCOUNT == 0 )); then EMPTY_ROUNDS=$((EMPTY_ROUNDS+1)); else EMPTY_ROUNDS=0; fi
    fi
    TOTAL=$(print -- "$CC" | grep -c "	tap=" || true)
    log "  第${SCREEN}屏: 新增${NEWCOUNT}条 累计${TOTAL}条 exhausted=$EXHAUSTED"

    # 0923修复(生产实证:三台并发批次、两条业务线,身份验证逐行100%炸"nickname mismatch"):
    # 逐条身份验证必须在**本屏还在屏上**时立即做——旧写法是全部翻完屏再回头处理累积列表,
    # 但那时手机已经滚到最后一屏了,早期屏的tap坐标对应的早就是别的内容,一验证必错。
    # 现在每屏collect完立刻处理这一屏的新增行,再决定要不要翻下一屏,坐标永远新鲜。
    if (( NEWCOUNT > 0 )); then
      for CLINE in "${(f)NEWLINES}"; do
        if activity_should_stop; then ACTIVITY_INTERRUPTED=1; break; fi
        [[ -z "$CLINE" ]] && continue
        j=$((j+1))
        # 字段可能为空(连续tab),cut 按位取,绝不合并
        NICK="$(print -- "$CLINE" | cut -f1)"; BODY="$(print -- "$CLINE" | cut -f2)"
        DATE="$(print -- "$CLINE" | cut -f3)"; REGION="$(print -- "$CLINE" | cut -f4)"
        AUTHOR="$(print -- "$CLINE" | cut -f5)"; TAPF="$(print -- "$CLINE" | cut -f6)"; B64F="$(print -- "$CLINE" | cut -f7)"
        [[ "$AUTHOR" == "author" ]] && { log "  跳过作者本人: $NICK"; continue; }
        TX="${TAPF#tap=}"; TXX="${TX%% *}"; TXY="${TX##* }"
        NB="${B64F#b64=}"
        [[ "$TXX" == <-> && "$TXY" == <-> && -n "$NB" ]] || { log "  行$j 坐标缺失($TAPF),跳过"; continue; }
        if [[ -n "${VIDEO_ACTIVITY_MODE:-}" ]]; then
          if (( CONTEXT_DIRTY )); then recover_comment_context || return $?; fi
          if (( CONTEXT_REFRESHED )); then refresh_comment_row || return $?; fi
        fi
        local identity_recovered=$CONTEXT_REFRESHED identity_rc=0
        # 0915: 评论者是真实存在的,一次读不到只说明时序/网络抖——3次重试+死因留档(0912原则)
        IDOUT=""; IDERR=/tmp/iderr-$$.txt
        for IDTRY in 1 2 3; do
          IDOUT="$($C --profile "$P" commenter-identity "$TXX" "$TXY" "$NB" "$TAG-v$i-u$j-t$IDTRY" </dev/null 2>$IDERR)"; identity_rc=$?
          ONICK="$(print -- "$IDOUT" | sed -n "s/^nickname=//p")"
          if [[ -n "$ONICK" && ( -z "${VIDEO_ACTIVITY_MODE:-}" || "$identity_rc" == 0 ) ]]; then break; fi
          if [[ -n "${VIDEO_ACTIVITY_MODE:-}" ]]; then
            if (( identity_recovered )); then COLLECTION_REASON=comment_context_unavailable; return 2; fi
            recover_comment_context || return $?
            refresh_comment_row || return $?
            identity_recovered=1
            continue
          fi
          log "  行$j 身份验证第${IDTRY}次失败: $(tail -1 $IDERR 2>/dev/null | head -c 120)"
          # 0915 真凶: card-link收尾恢复不可靠→评论面板丢失→后续行全灭。恢复=back+重开评论面板
          $C --profile "$P" back >/dev/null 2>&1
          nap 2
          REOPEN_OK=0
          if $C --profile "$P" open-comments "$TAG-v$i-u$j-ro$IDTRY" </dev/null >/dev/null 2>&1; then
            REOPEN_OK=1
          else
            $C --profile "$P" back >/dev/null 2>&1; nap 2
            $C --profile "$P" open-comments "$TAG-v$i-u$j-ro${IDTRY}b" </dev/null >/dev/null 2>&1 && REOPEN_OK=1
          fi
          nap 2
          # 0929修复(生产实证: 悦升3条线索"来源视频"标A、原始评论内容其实是完全不相关的B——
          # 追溯为本处 back 抢救落到了别的视频/推荐页,commenter-identity 却在错误页面上验证
          # 成功): 退栈深度不是固定的(取决于此前逐条评论者主页往返次数,0922已实证退栈次数
          # 写死必错),抢救只解决"面板丢了",不解决"退到了别的视频"。重开成功后必须重新核对
          # 屏幕上的视频身份,跟本视频的$VID对不上就整条视频剩余评论作废,绝不能带着可能来自
          # 别的视频的数据继续贴本视频的$TITLE/$VURL标签。
          if (( REOPEN_OK )); then
            DRIFT_LINK="$($C --profile "$P" current-video-link "$TAG-v$i-u$j-driftchk$IDTRY" </dev/null 2>/dev/null || true)"
            DRIFT_VID="$(print -- "$DRIFT_LINK" | sed -n "s/^video_id=//p")"
            if video_drifted "$VID" "$DRIFT_VID"; then
              log "  行$j 抢救后视频漂移(当前=${DRIFT_VID:-空},预期=${VID:-空}),本视频剩余评论作废"
              VIDEO_DRIFTED=1
              break
            fi
          fi
        done
        if (( VIDEO_DRIFTED == 1 )); then break; fi
        OID="$(print -- "$IDOUT" | sed -n "s/^douyin_id=//p")"
        ATYPE="$(print -- "$IDOUT" | sed -n "s/^account_type=//p")"
        PIP="$(print -- "$IDOUT" | sed -n "s/^profile_ip=//p")"
        if [[ -z "$ONICK" ]]; then log "  行$j 身份验证3次仍失败,弃: $NICK"; continue; fi
        # 0919 自有账号过滤: 命中自有名单的评论不当线索;若命中的是视频作者本人,整条视频其余评论不再采集
        if node "$HARVEST_SCRIPT_DIR/check-own-account.js" "$ONICK" "${OID:-}" >/dev/null 2>&1; then
          if [[ "$AUTHOR" == "author" ]]; then
            log "  视频作者是自有账号($ONICK),本视频其余评论不再采集"
            AUTHOR_IS_OWN=1
            break
          fi
          log "  跳过自有账号: $ONICK"
          continue
        fi
        if [[ -n "${VIDEO_ACTIVITY_MODE:-}" ]]; then
          # 同昵称+全文再次出现时，任一观测缺ID就无法证明是另一客户。
          # 这是身份关系守卫，不改变既有rawid公式或首次合法稀疏身份的采集政策。
          identity_relation="$ONICK"$'\t'"$BODY"
          if [[ -n "${CONFIRMED_IDENTITY_RELATIONS[$identity_relation]:-}" && ( -z "$OID" || "${CONFIRMED_IDENTITY_RELATIONS[$identity_relation]}" == noid ) ]]; then
            COLLECTION_REASON=comment_context_unavailable; return 2
          fi
          # 复用既有rawid政策；只在身份确认后判断重复，保留全文以暴露前20字碰撞。
          comment_key="$(node -e 'const {commentDedupKey}=require(process.argv[1]);process.stdout.write(commentDedupKey(...process.argv.slice(2)))' "$HARVEST_SCRIPT_DIR/comment-tier-lib.js" "$ONICK" "${OID:-}" "$BODY")"; key_rc=$?
          (( key_rc == 0 )) && [[ -n "$comment_key" ]] || { COLLECTION_REASON=comment_context_unavailable; return 2; }
          comment_tuple="$ONICK"$'\t'"${OID:-}"$'\t'"$BODY"
          if [[ -n "${CONFIRMED_COMMENTS[$comment_key]:-}" ]]; then
            if [[ -z "$OID" || "${CONFIRMED_COMMENTS[$comment_key]}" != "$comment_tuple" ]]; then
              COLLECTION_REASON=comment_context_unavailable; return 2
            fi
            continue
          fi
        fi
        # 0914 主理人验收:每人顺取名片主页直链(identity已回评论区,重进主页跑card-link,其自带恢复)
        "$C" --profile "$P" tap-evidence "$TXX" "$TXY" "$TAG-v$i-u$j-re" </dev/null >/dev/null 2>&1
        nap 3
        # 0929修复(DoD审计发现,批次4主理人纠正): 底层 commenter-card-link 失败(面板打不开/
        # 按钮找不到等)有真实 die,批次3先加了"失败即留痕但仍照发LEAD"的降级路径。主理人
        # 纠正:"拿不到主页链接不代表线索没中,拿不到主页链接说明你这个网络有问题啊,就
        # 重试呗"——跟 commenter-identity 同一个病同一个药,先重试3次,3次都拿不到才降级
        # (线索仍保留，douyin_id 仍是有效线索，但触达阶段需退回抖音号搜索)。
        PURL=""
        local card_rc=0 card_stop_rc=0 retry_rc=0
        for CLTRY in 1 2 3; do
          if [[ -n "${VIDEO_ACTIVITY_MODE:-}" ]] && (( CLTRY > 1 )); then
            # 上次失败名片是一个独立丢失episode；安全恢复一次后才按fresh坐标重新进入此人主页。
            # 失败不能直接return：此行已经在原视频上核验，先输出一次再pending。
            recover_comment_context; retry_rc=$?
            if (( retry_rc != 0 )); then card_stop_rc=$retry_rc; break; fi
            refresh_comment_row; retry_rc=$?
            if (( retry_rc != 0 )); then card_stop_rc=$retry_rc; break; fi
            activity_should_stop && { card_stop_rc=124; break; }
            "$C" --profile "$P" tap-evidence "$TXX" "$TXY" "$TAG-v$i-u$j-cl$CLTRY-re" </dev/null >/dev/null 2>&1; retry_rc=$?
            if (( retry_rc != 0 )); then COLLECTION_REASON=comment_context_unavailable; card_stop_rc=2; break; fi
            nap 3
          fi
          CARD="$("$C" --profile "$P" commenter-card-link "$TAG-v$i-u$j-cl$CLTRY" </dev/null 2>/dev/null)"; card_rc=$?
          if [[ -n "${VIDEO_ACTIVITY_MODE:-}" ]]; then
            CONTEXT_REFRESHED=0
            CONTEXT_DIRTY=1
            if (( card_rc == 0 )) && print -r -- "$CARD" | grep -q '^comment_context_restored=1$'; then CONTEXT_DIRTY=0; fi
          fi
          PURL="$(print -- "$CARD" | sed -n "s/^profile_url=//p")"
          if [[ -n "${VIDEO_ACTIVITY_MODE:-}" ]] && (( card_rc != 0 )); then PURL=""; fi
          [[ -n "$PURL" ]] && break
          log "  行$j 主页直链解析第${CLTRY}次失败(可能网络抖动)"
          (( CLTRY < 3 )) && nap 2
        done
        [[ -z "$PURL" ]] && log "  行$j 主页直链解析3次仍失败(douyin_id=${OID:-空})，线索仍保留但触达阶段需退回抖音号搜索"
        print -- "LEAD	$ONICK	${OID:-}	${ATYPE:-personal}	$BODY	$DATE	$REGION	$TITLE	$KWTXT	${PIP:-}	${PURL:-}	${VURL:-}"
        if [[ -n "${VIDEO_ACTIVITY_MODE:-}" ]]; then
          CONFIRMED_COMMENTS[$comment_key]="$comment_tuple"
          if [[ -n "$OID" ]]; then CONFIRMED_IDENTITY_RELATIONS[$identity_relation]=known; else CONFIRMED_IDENTITY_RELATIONS[$identity_relation]=noid; fi
          confirmed_count=$((confirmed_count+1))
          CC="$CC$CLINE"$'\n'
        fi
        (( card_stop_rc != 0 )) && return $card_stop_rc
        nap 4
      done
    fi
    if (( AUTHOR_IS_OWN == 1 || VIDEO_DRIFTED == 1 || ACTIVITY_INTERRUPTED == 1 )); then break; fi

    if [[ -n "${VIDEO_ACTIVITY_MODE:-}" ]] && (( CONTEXT_DIRTY )); then
      recover_comment_context || return $?
      refresh_comment_row || return $?
    fi
    if [[ -n "${VIDEO_ACTIVITY_MODE:-}" ]]; then
      TOTAL=$confirmed_count
      if (( confirmed_count == screen_before )); then EMPTY_ROUNDS=$((EMPTY_ROUNDS+1)); else EMPTY_ROUNDS=0; fi
    fi
    # 停止条件(跟comment-tier-lib.js的shouldKeepScrolling同一套判据):
    #   真到底了 / 大户已攒够封顶数 / 连续2屏没有新增(可能卡住了,防死循环) → 停
    if (( EXHAUSTED == 1 )); then break; fi
    if [[ "$TIER" == "large" ]] && (( TOTAL >= LARGE_CAP )); then log "  大户已达封顶${LARGE_CAP}条,停止翻屏"; break; fi
    if (( EMPTY_ROUNDS >= 2 )); then log "  连续2屏无新增,停止翻屏(防卡死)"; break; fi
    $C --profile "$P" swipe 600 2000 600 900 400 </dev/null >/dev/null 2>&1
    nap 1.5
  done
  unset SEEN_LINES CONFIRMED_COMMENTS CONFIRMED_IDENTITY_RELATIONS
  if (( ACTIVITY_INTERRUPTED )) || activity_should_stop; then return 124; fi
  (( VIDEO_DRIFTED )) && return 2
  CC="$(print -- "$CC" | grep -E "	tap=" || true)"
  if [[ -z "$CC" ]]; then
    log "  零评论"
    COLLECTED_RESULT="$(qual_remote collected --line "$LINE" --video-id "$VID" --count 0)"
    if [[ -n "${VIDEO_ACTIVITY_MODE:-}" && "$(qual_field "$COLLECTED_RESULT" updated)" != 1 ]]; then return 1; fi
    # 评论面板开着也不用先 back 一次再归位——back-to-results 自己退到看见结果页为止
    # 0929修复(DoD审计发现真机复现): back-to-results 不传关键词只核实页面类型，
    # 分不清"真结果页"和 current-video-link 内部的暂存草稿页(两者同 Activity)——
    # 12词×3卡实测100%误判。传 $KW 让它多核一遍搜索框文字是不是这次搜的词。
    return 0
  fi
  log "  评论数: $(print -- "$CC" | wc -l | tr -d " ")"
  # 视频落「视频池」行(全链可观察: VIDEO\tid\t短链\t标题\t关键词\t采到评论数)
  print -- "VIDEO	${VID:-}	${VURL:-}	$TITLE	$KWTXT	$(print -- "$CC" | wc -l | tr -d " ")"
  # 先判后采③: 采完才标「评论已采」(只写给 matched 视频,库侧 WHERE 兜底)
  COLLECTED_RESULT="$(qual_remote collected --line "$LINE" --video-id "$VID" --count "$(print -- "$CC" | wc -l | tr -d " ")")"
  if [[ -n "${VIDEO_ACTIVITY_MODE:-}" && "$(qual_field "$COLLECTED_RESULT" updated)" != 1 ]]; then return 1; fi
  return 0
}
back_to_results_and_maybe_rescan() {
  local evid="$1" btr_out newcards
  if [[ "${WF_SOURCE_KIND:-keyword}" == "benchmark" ]]; then
    $C --profile "$P" back-to-profile 10 </dev/null >/dev/null 2>&1 && return 0
    # 0930 00:59 真机实证(cmd09290953 视频1): 取链接用 deep link 重开过视频,栈里是 feed 不是主页,back 回不去。
    # 对标版兜底(对应关键词版的兜底重搜): 用本对标源链接重开主页重扫卡片;主页网格按发布时间排序、坐标稳定,
    # 保留 i 从下一张继续。重开也扫不到 = 本源剩余候选作废(不拿废坐标瞎点)。
    log "  回对标主页失败(栈里是 feed),用对标链接重开主页重扫卡片"
    newcards="$("${DISCOVER_CMD:-${0:A:h}/discover-benchmark.sh}" "$P" "$KW" "$MAXV" "${evid}-reopen" "$LOC")"
    if [[ -n "$newcards" ]]; then
      CARD_ARR=("${(@f)newcards}")
      log "  重开主页扫到 ${#CARD_ARR[@]} 张卡片，从第 $((i+1)) 张继续"
    else
      log "  重开主页未拿到卡片,本对标源剩余候选到此为止"
      CARD_ARR=()
      i=0
    fi
    return 0
  fi
  btr_out="$($C --profile "$P" back-to-results 4 "$KWTXT" "$evid" </dev/null 2>&1 || true)"
  if print -- "$btr_out" | grep -q "recovered_via=research"; then
    # 0930 事故: 取链接(deep link 重开)后 back 几乎每个视频都回不到结果页,每处理一张就重搜一次。
    # 每词重扫封顶,超限本词剩余候选作废——无论列表/归位怎么异常,本词都必然终止。
    RESCANS=$((RESCANS+1))
    if (( RESCANS > RESCAN_MAX )); then
      log "  重扫次数超限(${RESCAN_MAX}次),本关键词剩余候选作废"
      CARD_ARR=()
      return 0
    fi
    log "  归位触发兜底重搜(原卡片坐标已失效)，重新扫描卡片列表(第${RESCANS}/${RESCAN_MAX}次)"
    # 0929真机复现补丁: douyin-phone-adb里的兜底重搜只重新发起了搜索意图(等同于
    # 脚本最开头的open-search)，落地页默认是"综合"tab，不是"视频"tab——
    # search-video-cards前置要求必须在视频tab(见该子命令自己的注释)，不切tab直接
    # 扫永远是空结果。真机实测复现:12词里第1/2词都是这个路径,连续2次
    # "重新扫描未拿到卡片"。这里补上跟脚本开头对称的 tab 切换+筛选重设，
    # 不能假设"重新搜索=自动回到视频tab+原筛选条件"。
    $C --profile "$P" search-video-tab "${evid}-rescan-vtab" >/dev/null 2>&1 || true
    $C --profile "$P" search-time-layer six_months "${evid}-rescan-filter" most_liked unlimited unlimited "$LOC" >/dev/null 2>&1 || true
    newcards="$($C --profile "$P" search-video-cards "${evid}-rescan" 2>/dev/null | grep -E "^[0-9]+	" | head -"$MAXV")"
    # 0930 事故: 原来这里 i=0 从头处理——同一搜索词+同筛选列表顺序稳定,从头 = 把刚处理过的视频 1
    # 再点一遍,取链接后又回不到结果页又重搜,死循环(真机三台各重扫 116~160 次,卡 6 小时)。
    # 与对标分支(#2024)同一思路: 保留 i 从下一张继续;万一顺序变了,已处理视频另有 seen/判定缓存兜底。
    if [[ -n "$newcards" ]]; then
      CARD_ARR=("${(@f)newcards}")
      log "  重新扫描到 ${#CARD_ARR[@]} 张卡片，从第 $((i+1)) 张继续"
    else
      log "  重新扫描未拿到卡片，本关键词候选到此为止"
      CARD_ARR=()
      i=0
    fi
  fi
}
