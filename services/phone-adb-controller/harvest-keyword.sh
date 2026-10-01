#!/bin/zsh
# harvest-keyword.sh — 单关键词客资采收驱动(0914 KPI 夜)
# 用法: harvest-keyword.sh PROFILE KEYWORD_URLENC MAX_VIDEOS RUN_TAG
# 输出: LEAD\t昵称\t抖音号\taccount_type\t评论\t日期\t地区\t视频标题\t关键词 到 stdout
# 全部动作走 douyin-phone-adb(锁/守卫/频控内建),本脚本只做序列编排。
set -uo pipefail
HARVEST_SCRIPT_DIR="${0:A:h}"
C=~/.local/bin/douyin-phone-adb
P="$1"; KW="$2"; MAXV="${3:-4}"; TAG="$4"; LOC="${5:-same_city}"
# 这批活回填给谁：优先用调用方传进来的业务线标记（$6），没传就退回 profile 名
# ——两者 line-routes.js 都认。
# 0922 修：原来写的是 LINE="${6:-}"，而 batch2.sh 只传 5 个参数，所以 $LINE 一直是空的；
# 空值被 routeOf 的兜底默默接成金诺，于是**悦升那台跑夜批时，去重查的是金诺的已采视频列表**
# ——去重一直是错的，而且没人看得见。兜底已改成抛错，这里必须给出真值。
LINE="${6:-$P}"
KWTXT="$(python3 -c "import urllib.parse,sys;print(urllib.parse.unquote(sys.argv[1]))" "$KW")"
log(){ print -u2 -- "[$(date +%H:%M:%S)] $*"; }
# 可视化旁路(0919): 每视频续报一次(与下方 lock-refresh 同理); 上报器缺失/失败一律吞掉
WR=${WALL_REPORT:-$HOME/bin-harvest/wall-report.sh}
wr(){ [[ -x "$WR" ]] && "$WR" "$@" >/dev/null 2>&1; true }
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
  local sub="$1" args="" a cap
  shift
  for a in "$@"; do args="$args $(qsq "$a")"; done
  cap="$(activity_remote_budget)" || return 124
  wf_run_bounded "$cap" ssh -o ConnectTimeout=20 -o BatchMode=yes mmv "set -a; source ~/.credentials/zenithjoy-db.env 2>/dev/null; set +a; cd ~/.openclaw/leadgen-scripts && node qualify-video.js $sub$args" 2>/dev/null </dev/null | grep '^QUAL_' | tail -1
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
      RAUD="/tmp/qa-${HBATCH}-${VID}.${AUDIO_PATH##*.}"
      UPLOAD_CAP="$(activity_remote_budget)" || { QV=pending; return 124; }
      if wf_run_bounded "$UPLOAD_CAP" scp -o ConnectTimeout=20 -o BatchMode=yes "$AUDIO_PATH" "mmv:$RAUD" </dev/null >/dev/null 2>&1; then QAUD=(--audio "$RAUD")
      else log "  音频传 mmv 失败,本视频退回标题判定"; fi
    fi
    activity_should_stop && { QV=pending; return 124; }
    QR="$(qual_remote judge --line "$LINE" --video-id "$VID" "${QAUD[@]}")"
    QV="$(qual_field "$QR" verdict)"
    [[ -n "$QV" ]] || { QV=pending; QR="判定无回话(ssh不通): ${QR:-空}"; }
  fi
  print -- "QUAL	$VID	$QV	$QSRC"
}
collect_current_video() {
  ACTIVITY_INTERRUPTED=0
  activity_should_stop && return 124
  OCOUT="$($C --profile "$P" open-comments "$TAG-v$i-oc" </dev/null 2>/dev/null || true)"
  if ! print -- "$OCOUT" | grep -q "^comments_opened=1"; then
    log "  评论区打不开,3秒后重试1次"
    nap 3
    OCOUT="$($C --profile "$P" open-comments "$TAG-v$i-oc2" </dev/null 2>/dev/null || true)"
    if ! print -- "$OCOUT" | grep -q "^comments_opened=1"; then
      log "  评论区重试仍打不开,跳过"
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
  typeset -A SEEN_LINES
  CC=""
  EMPTY_ROUNDS=0
  SCREEN=0
  j=0
  AUTHOR_IS_OWN=0
  VIDEO_DRIFTED=0
  while true; do
    if activity_should_stop; then ACTIVITY_INTERRUPTED=1; break; fi
    SCREEN=$((SCREEN+1))
    RAW="$($C --profile "$P" collect-comments "$TAG-v$i-cc$SCREEN" 2>/dev/null || true)"
    EXHAUSTED=0
    print -- "$RAW" | grep -q "^exhausted=1" && EXHAUSTED=1
    NEWLINES=""
    while IFS= read -r LN; do
      [[ "$LN" == *"	tap="* ]] || continue
      if [[ -z "${SEEN_LINES[$LN]:-}" ]]; then
        SEEN_LINES[$LN]=1
        NEWLINES="$NEWLINES$LN"$'\n'
        CC="$CC$LN"$'\n'
      fi
    done <<< "$RAW"
    NEWCOUNT=$(print -- "$NEWLINES" | grep -c "	tap=" || true)
    if (( NEWCOUNT == 0 )); then EMPTY_ROUNDS=$((EMPTY_ROUNDS+1)); else EMPTY_ROUNDS=0; fi
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
        # 0915: 评论者是真实存在的,一次读不到只说明时序/网络抖——3次重试+死因留档(0912原则)
        IDOUT=""; IDERR=/tmp/iderr-$$.txt
        for IDTRY in 1 2 3; do
          IDOUT="$($C --profile "$P" commenter-identity "$TXX" "$TXY" "$NB" "$TAG-v$i-u$j-t$IDTRY" </dev/null 2>$IDERR || true)"
          ONICK="$(print -- "$IDOUT" | sed -n "s/^nickname=//p")"
          [[ -n "$ONICK" ]] && break
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
        # 0914 主理人验收:每人顺取名片主页直链(identity已回评论区,重进主页跑card-link,其自带恢复)
        "$C" --profile "$P" tap-evidence "$TXX" "$TXY" "$TAG-v$i-u$j-re" </dev/null >/dev/null 2>&1
        nap 3
        # 0929修复(DoD审计发现,批次4主理人纠正): 底层 commenter-card-link 失败(面板打不开/
        # 按钮找不到等)有真实 die,批次3先加了"失败即留痕但仍照发LEAD"的降级路径。主理人
        # 纠正:"拿不到主页链接不代表线索没中,拿不到主页链接说明你这个网络有问题啊,就
        # 重试呗"——跟 commenter-identity 同一个病同一个药,先重试3次,3次都拿不到才降级
        # (线索仍保留，douyin_id 仍是有效线索，但触达阶段需退回抖音号搜索)。
        PURL=""
        for CLTRY in 1 2 3; do
          CARD="$("$C" --profile "$P" commenter-card-link "$TAG-v$i-u$j-cl$CLTRY" </dev/null 2>/dev/null || true)"
          PURL="$(print -- "$CARD" | sed -n "s/^profile_url=//p")"
          [[ -n "$PURL" ]] && break
          log "  行$j 主页直链解析第${CLTRY}次失败(可能网络抖动)"
          (( CLTRY < 3 )) && nap 2
        done
        [[ -z "$PURL" ]] && log "  行$j 主页直链解析3次仍失败(douyin_id=${OID:-空})，线索仍保留但触达阶段需退回抖音号搜索"
        print -- "LEAD	$ONICK	${OID:-}	${ATYPE:-personal}	$BODY	$DATE	$REGION	$TITLE	$KWTXT	${PIP:-}	${PURL:-}	${VURL:-}"
        nap 4
      done
    fi
    if (( AUTHOR_IS_OWN == 1 || VIDEO_DRIFTED == 1 || ACTIVITY_INTERRUPTED == 1 )); then break; fi

    # 停止条件(跟comment-tier-lib.js的shouldKeepScrolling同一套判据):
    #   真到底了 / 大户已攒够封顶数 / 连续2屏没有新增(可能卡住了,防死循环) → 停
    if (( EXHAUSTED == 1 )); then break; fi
    if [[ "$TIER" == "large" ]] && (( TOTAL >= LARGE_CAP )); then log "  大户已达封顶${LARGE_CAP}条,停止翻屏"; break; fi
    if (( EMPTY_ROUNDS >= 2 )); then log "  连续2屏无新增,停止翻屏(防卡死)"; break; fi
    $C --profile "$P" swipe 600 2000 600 900 400 </dev/null >/dev/null 2>&1
    nap 1.5
  done
  unset SEEN_LINES
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
# source 守卫: 单测以 HARVEST_KEYWORD_LIB=1 source 本文件只取函数,不执行主体
[[ -n "${HARVEST_KEYWORD_LIB:-}" ]] && return 0
# RAM盘只有2G,采收截图很快塞爆(0914实证:爆盘让mkdir全军覆没误报锁被占)
find /Volumes/EvidenceRAM/openclaw-phone/evidence -type f \( -name "*.png" -o -name "*.mkv" -o -name "*.wav" \) -mmin +30 -delete 2>/dev/null

# 0919 同视频去重: 采集前拉一次「视频池」已存在的视频ID,采集中命中就跳过该视频
# 真机验证(0919)发现: 本脚本跑在手机机(xian-m4/xian-m1),不持有飞书凭据——
# fetch-seen-videos.js 需要凭据+联网,必须像 next-outreach.js 一样经 SSH 到
# 网关机执行,不能直接在本机跑(会因缺 clawdbot.json 静默拿到空表)。
# 0921 网关迁移: us-vps 那份 openclaw-gateway 容器已退役(决策 96054a8b),脚本随迁移
# 落到 MMV 原生跑(不再经 docker exec)。
SEENVIDS="$(mktemp -t seen-videos)"
ssh -o ConnectTimeout=15 mmv "node /Users/administrator/.openclaw/leadgen-scripts/fetch-seen-videos.js '$LINE'" > "$SEENVIDS" 2>/dev/null

# 0930修复(夜实测auto09292304发现): 原来锁被占一次就直接放弃(exit 3),导致discover-benchmark.sh
# (对标发现,同机同设备)持锁的~5分钟里,12个关键词一次性被跳过6个,一整批只跑完一半——设备并发
# 不该等于丢词。改成限时轮询重试:默认24次×20秒≈8分钟,覆盖实测持锁时长且留余量;仍拿不到才保留
# 原退出码3语义(batch2.sh依赖这个契约区分"锁被占"和其它失败,不能改)。
LOCK_ACQUIRE_MAX_RETRIES="${LOCK_ACQUIRE_MAX_RETRIES:-24}"
LOCK_ACQUIRE_POLL_SECONDS="${LOCK_ACQUIRE_POLL_SECONDS:-20}"
_lock_acquired=0
_lock_try=0
while (( _lock_try < LOCK_ACQUIRE_MAX_RETRIES )); do
  _lock_try=$((_lock_try+1))
  # 7d150e33: 等锁期间总时限到点 → 本词不开跑(不拿锁、不发现),交给 batch2 在词边界收工
  if wf_deadline_reached; then
    log "整批总时限到(${WF_RUN_MAX_SECONDS:-14400}s),本词不开跑"
    rm -f "$SEENVIDS"
    exit 0
  fi
  # 2fc3b6fc: Commander 请求平滑收工(stop 文件)同路径——不拿锁、不发现,交给 batch2 在词边界收工
  if wf_stop_requested; then
    log "Commander 请求收工,本词不开跑"
    rm -f "$SEENVIDS"
    exit 0
  fi
  if $C --profile "$P" lock-acquire "$TAG" >/dev/null 2>&1; then
    _lock_acquired=1
    break
  fi
  if (( _lock_try < LOCK_ACQUIRE_MAX_RETRIES )); then
    log "锁被占,等待重试($_lock_try/$LOCK_ACQUIRE_MAX_RETRIES)"
    nap "$LOCK_ACQUIRE_POLL_SECONDS"
  fi
done
if (( ! _lock_acquired )); then
  log "锁被占,重试${LOCK_ACQUIRE_MAX_RETRIES}次(约$((LOCK_ACQUIRE_MAX_RETRIES*LOCK_ACQUIRE_POLL_SECONDS))s)后仍未拿到,退出"
  rm -f "$SEENVIDS"
  exit 3
fi
# 0929修复(DoD审计发现,批次4主理人纠正): release_lock之前输出全丢进/dev/null,底层
# "只能释放自己持有的锁"的真实校验结果完全看不见——释放失败会漏锁,下一批误判"锁被占"
# 或者更糟地跟正在跑的上一批撞车。批次3先做了留痕,主理人纠正"拿不到确认不代表锁真没
# 释放,大概率是网络抖/时序问题,该重试"——跟 commenter-identity 同一个病同一个药,
# 改成最多重试3次(nap短暂等待,测试模式不真睡),3次都失败才留告警。
trap '
_REL_OK=0
for _RELTRY in 1 2 3; do
  _RELOUT=$($C --profile "$P" lock-release "$TAG" 2>&1)
  if print -- "$_RELOUT" | grep -qE "^lock=(released|free)"; then _REL_OK=1; break; fi
  (( _RELTRY < 3 )) && nap 2
done
(( _REL_OK )) || log "⚠️ 放锁未确认成功(重试3次): $(print -- "$_RELOUT" | tail -1 | head -c 150)"
rm -f "$SEENVIDS"
' EXIT

# 发现(决策 7f842d12 契约组装执行): 抽成可替换实现,接口见 discover-keyword.sh 头注释;
# wf-run.sh 按契约 runtime.entry 经 env DISCOVER_CMD 注入(对标获客 = discover-benchmark.sh),不设 = 关键词发现。
# 7d150e33: 发现段按契约 discovery 预算封顶(发现脚本是子进程,超时收掉它不留手机现场;下一词开头有归位清场);
#   超时按契约分类: retryable 重跑 1 次,仍超 → 记账 exit 4(batch2 记 discovery failed budget_exceeded,进入下一个词)
DISC_BUDGET=$(wf_budget_of discovery)
CARDS="$(wf_run_bounded "$DISC_BUDGET" "${DISCOVER_CMD:-${0:A:h}/discover-keyword.sh}" "$P" "$KW" "$MAXV" "$TAG" "$LOC")"; drc=$?
if (( drc == 124 )) && [[ "$(wf_timeout_class discovery)" == retryable ]]; then
  log "发现超预算(${DISC_BUDGET}s),契约 retryable 重试 1 次"
  CARDS="$(wf_run_bounded "$DISC_BUDGET" "${DISCOVER_CMD:-${0:A:h}/discover-keyword.sh}" "$P" "$KW" "$MAXV" "$TAG" "$LOC")"; drc=$?
fi
if (( drc == 124 )); then log "发现超预算(${DISC_BUDGET}s),本词作废(记账)"; exit 4; fi
(( drc == 0 )) || exit 1
[[ -n "$CARDS" ]] || { log "无卡片"; exit 0; }
# 采集段(判定+采集两个 per_item 活动共用本词的逐视频循环)预算: 自发现结束起累计,在视频边界判
COLLECT_T0=$(date +%s)
COLLECT_BUDGET=$(( $(wf_budget_of qualification) + $(wf_budget_of collection) ))
log "卡片数: $(print -- "$CARDS" | wc -l | tr -d " ")"

# back_to_results_and_maybe_rescan EVIDENCE_ID_PREFIX —— 0929修复(真机验证补丁):
# back-to-results 命中 recovered_via=research 说明它是靠"重新发起本次搜索的意图"
# 才归位成功的(见 douyin-phone-adb back_to_results 函数注释)，这个动作会重置筛选
# 条件，页面上的卡片顺序/内容会变，本批一开始扫描存下的 CARD_ARR 坐标全部作废——
# 继续拿着旧坐标点后面的卡只会点到不相干的内容(真机实证过一次:点开"NOT_ON_
# VIDEO_DETAIL: share button absent")。命中就立刻重新扫描一次，把 CARD_ARR 换成新坐标、
# 保留 i 从下一张继续处理剩余候选(0930 起,见函数内注释)，不是继续拿着废坐标瞎点。
# 对标流(WF_SOURCE_KIND=benchmark,wf-run.sh 下传;决策 7f842d12)卡片在对标账号主页网格上: 归位走 back-to-profile 10
# (0930 真机实测: 主页点卡+取链后要 7 次 back 才回 UserProfileActivity——取链暂存搜索页 4 + UltraDetail 2 + 1;传 5 每源第 1 个视频后必失败)
# (一路 back 到 UserProfileActivity,见 feed/splash 立即返回 1)。不能用 back-to-results——它只认搜索结果页,
# 兜底重搜会拿 KWTXT(此时是主页链接)去搜,人漂走。回主页失败 → 用对标链接重开主页重扫(见下)。
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

typeset -a CARD_ARR
CARD_ARR=("${(@f)CARDS}")
i=0
RESCANS=0
RESCAN_MAX="${HARVEST_RESCAN_MAX:-3}"
while (( i < ${#CARD_ARR[@]} )); do
  # 7d150e33: 视频边界判整批总时限与采集段预算——到点/超预算都不开下一个视频,已采的照常交给 batch2,trap 放锁
  if wf_deadline_reached; then
    log "整批总时限到(${WF_RUN_MAX_SECONDS:-14400}s),本词剩余候选不采"
    break
  fi
  # 2fc3b6fc: Commander 请求平滑收工(stop 文件)——不开下一个视频,已采的照常交给 batch2,trap 放锁
  if wf_stop_requested; then
    log "Commander 请求收工,本词剩余候选不采"
    break
  fi
  if (( COLLECT_BUDGET > 0 && $(date +%s) - COLLECT_T0 >= COLLECT_BUDGET )); then
    log "采集段超预算(${COLLECT_BUDGET}s),本词剩余候选作废(记账)"
    break
  fi
  i=$((i+1))
  CARDLINE="${CARD_ARR[$i]}"
  X="$(print -- "$CARDLINE" | cut -f1)"; Y="$(print -- "$CARDLINE" | cut -f2)"
  DUR="$(print -- "$CARDLINE" | cut -f3)"; TITLE="$(print -- "$CARDLINE" | cut -f4)"
  log "视频$i: ${TITLE:0:40}"
  wr note --profile "$P" "视频$i: ${TITLE:0:40}"
  # 0914 融合刀6: 活锁心跳——每视频续一次,长采收绝不再被 TTL 判 stale 抢占
  # 0929修复(DoD审计发现,批次4主理人纠正): 之前输出+退出码全丢进/dev/null+`|| true`——
  # TTL(1800s)到点没人知道续期一直在失败,直到锁被别的轮次抢走才现形(0928夜实证过一次
  # 真实撞车:两条并发批次同时驱动同一台设备)。批次3先做了留痕,主理人纠正"30分钟buffer
  # 是故意留的容错余地,不是让单次失败躺平不管——拿不到续期确认大概率是网络抖/时序问题,
  # 应该跟commenter-identity一样重试"。改成最多重试3次,3次都失败才留告警(仍不中断整批)。
  _LR_OK=0
  for LRTRY in 1 2 3; do
    _LROUT=$($C --profile "$P" lock-refresh "$TAG" </dev/null 2>&1)
    if print -- "$_LROUT" | grep -q "^lock=refreshed"; then _LR_OK=1; break; fi
    log "  锁心跳续期第${LRTRY}次失败: $(print -- "$_LROUT" | tail -1 | head -c 120)"
    (( LRTRY < 3 )) && nap 2
  done
  (( _LR_OK )) || log "⚠️ 锁心跳续期3次仍未确认成功(可能已被抢占): $(print -- "$_LROUT" | tail -1 | head -c 150)"
  $C --profile "$P" tap-evidence "$X" "$Y" "$TAG-v$i" >/dev/null 2>&1
  nap 3
  # 0914 主理人验收字段: 原爆款作品地址。current-video-link 自带 note(图文)检测,
  # 图文帖直接跳过(评论区结构不同,采了也是脏数据)。
  VLINK="$($C --profile "$P" current-video-link "$TAG-v$i-vl" </dev/null 2>/dev/null || true)"
  VURL="$(print -- "$VLINK" | sed -n "s/^short_url=//p")"
  if print -- "$VLINK" | grep -q "^excluded_non_video=true"; then
    log "  图文帖,跳过"
    # 0929修复(DoD审计发现真机复现): back-to-results 不传关键词只核实页面类型，
    # 分不清"真结果页"和 current-video-link 内部的暂存草稿页(两者同 Activity)——
    # 12词×3卡实测100%误判。传 $KW 让它多核一遍搜索框文字是不是这次搜的词。
    back_to_results_and_maybe_rescan "$TAG-v$i-btr"
    continue
  fi
  VID="$(print -- "$VLINK" | sed -n "s/^video_id=//p")"
  # 0929修复(DoD审计发现): current-video-link 失败(超时/解析不出)时上面 `|| true` 吞掉
  # 错误,VID/VURL 就是空字符串——不检查空值会继续往下录屏、采评论、产出 video_id/video_url
  # 都是空的 LEAD 行(video_drifted 对空 VID 保守放行,拦不住这种情况,是另一道口子)。
  # 拿不到视频身份就不该动这条视频,同"图文帖跳过"处理。
  if [[ -z "$VID" || -z "$VURL" ]]; then
    log "  视频链接解析失败(VID=${VID:-空} VURL=${VURL:-空}),跳过"
    # 0929修复(DoD审计发现真机复现): back-to-results 不传关键词只核实页面类型，
    # 分不清"真结果页"和 current-video-link 内部的暂存草稿页(两者同 Activity)——
    # 12词×3卡实测100%误判。传 $KW 让它多核一遍搜索框文字是不是这次搜的词。
    back_to_results_and_maybe_rescan "$TAG-v$i-btr"
    continue
  fi
  log "  作品链接: $VURL"
  if grep -qxF "$VID" "$SEENVIDS" 2>/dev/null; then
    log "  视频已处理过,跳过: $VID"
    # 0929修复(DoD审计发现真机复现): back-to-results 不传关键词只核实页面类型，
    # 分不清"真结果页"和 current-video-link 内部的暂存草稿页(两者同 Activity)——
    # 12词×3卡实测100%误判。传 $KW 让它多核一遍搜索框文字是不是这次搜的词。
    back_to_results_and_maybe_rescan "$TAG-v$i-btr"
    continue
  fi
  qualify_current_video
  if [[ "$QV" != matched ]]; then
    if [[ "$QV" == rejected ]]; then log "  判定不合格(rejected),不采评论"
    else log "  判定未出结论(pending: $(print -r -- "$QR" | head -c 150)),本视频本轮不采,留待重判"; fi
    # 0929修复(DoD审计发现真机复现): back-to-results 不传关键词只核实页面类型，
    # 分不清"真结果页"和 current-video-link 内部的暂存草稿页(两者同 Activity)——
    # 12词×3卡实测100%误判。走封装函数核实关键词+命中兜底重搜时重扫卡片。
    back_to_results_and_maybe_rescan "$TAG-v$i-btr"
    continue
  fi
  log "  判定合格(matched/$QSRC),开采评论"
  collect_current_video || true
  # 收评论面板+回搜索结果
  # 归位不数 back 次数：取过链接的视频栈里多一层，写死的次数必然退多或退少
  # （0922 实证：跳过分支 back 一次落在暂存解析页，后面每个视频都在错页面上瞎点）。
  # 0929修复(DoD审计发现真机复现): 只核实页面类型分不清"真结果页"和
  # current-video-link 内部的暂存草稿页(两者同 Activity)——12词×3卡实测100%误判。
  # 传 $KWTXT(解码后的可读关键词，搜索框显示的就是这个)多核一遍搜索框文字。
  back_to_results_and_maybe_rescan "$TAG-v$i-btr"
  nap 3
done
log "关键词完成: $KWTXT"
