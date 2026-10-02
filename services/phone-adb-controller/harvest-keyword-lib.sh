#!/bin/zsh
# 原函数与预算库装配机械提取；执行逻辑保持不变。
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
qual_remote(){
  local sub="$1" args="" a
  shift
  for a in "$@"; do args="$args $(qsq "$a")"; done
  ssh -o ConnectTimeout=20 -o BatchMode=yes mmv "set -a; source ~/.credentials/zenithjoy-db.env 2>/dev/null; set +a; cd ~/.openclaw/leadgen-scripts && node qualify-video.js $sub$args" 2>/dev/null </dev/null | grep '^QUAL_' | tail -1
}
# qual_field JSON行 键 → 值(字符串或 true/false)
qual_field(){ print -r -- "$1" | sed -n "s/.*\"$2\":\"\{0,1\}\([^\",}]*\).*/\1/p" | head -1; }
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
