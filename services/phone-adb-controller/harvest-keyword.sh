#!/bin/zsh
# harvest-keyword.sh — 单关键词客资采收驱动(0914 KPI 夜)
# 用法: harvest-keyword.sh PROFILE KEYWORD_URLENC MAX_VIDEOS RUN_TAG
# 输出: LEAD\t昵称\t抖音号\taccount_type\t评论\t日期\t地区\t视频标题\t关键词 到 stdout
# 全部动作走 douyin-phone-adb(锁/守卫/频控内建),本脚本只做序列编排。
set -uo pipefail
HARVEST_SCRIPT_DIR="${0:A:h}"
C="${DOUYIN_PHONE_ADB:-${DOUYIN_PHONE_CONTROLLER:-$HOME/.local/bin/douyin-phone-adb}}"
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
source "${0:A:h}/harvest-keyword-lib.sh" || exit 1
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
