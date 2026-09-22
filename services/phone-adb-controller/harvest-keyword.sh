#!/bin/zsh
# harvest-keyword.sh — 单关键词客资采收驱动(0914 KPI 夜)
# 用法: harvest-keyword.sh PROFILE KEYWORD_URLENC MAX_VIDEOS RUN_TAG
# 输出: LEAD\t昵称\t抖音号\taccount_type\t评论\t日期\t地区\t视频标题\t关键词 到 stdout
# 全部动作走 douyin-phone-adb(锁/守卫/频控内建),本脚本只做序列编排。
set -uo pipefail
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

$C --profile "$P" lock-acquire "$TAG" >/dev/null 2>&1 || { log "锁被占,退出"; rm -f "$SEENVIDS"; exit 3; }
trap '$C --profile "$P" lock-release "$TAG" >/dev/null 2>&1; rm -f "$SEENVIDS"' EXIT

$C --profile "$P" open-app >/dev/null 2>&1; sleep 2
$C --profile "$P" open-search "$KW" >/dev/null 2>&1 || { log "open-search失败"; exit 1; }
sleep 3
$C --profile "$P" search-video-tab "$TAG-vtab" >/dev/null 2>&1 || log "切视频tab失败(可能已在)"
$C --profile "$P" search-time-layer six_months "$TAG-filter" most_liked unlimited unlimited "$LOC" >/dev/null 2>&1 || { log "筛选失败"; exit 1; }
sleep 2
CARDS="$($C --profile "$P" search-video-cards "$TAG-cards" 2>/dev/null | grep -E "^[0-9]+	" | head -"$MAXV")"
[[ -n "$CARDS" ]] || { log "无卡片"; exit 0; }
log "卡片数: $(print -- "$CARDS" | wc -l | tr -d " ")"

i=0
for CARDLINE in "${(f)CARDS}"; do
  i=$((i+1))
  X="$(print -- "$CARDLINE" | cut -f1)"; Y="$(print -- "$CARDLINE" | cut -f2)"
  DUR="$(print -- "$CARDLINE" | cut -f3)"; TITLE="$(print -- "$CARDLINE" | cut -f4)"
  log "视频$i: ${TITLE:0:40}"
  wr note --profile "$P" "视频$i: ${TITLE:0:40}"
  # 0914 融合刀6: 活锁心跳——每视频续一次,长采收绝不再被 TTL 判 stale 抢占
  $C --profile "$P" lock-refresh "$TAG" </dev/null >/dev/null 2>&1 || true
  $C --profile "$P" tap-evidence "$X" "$Y" "$TAG-v$i" >/dev/null 2>&1
  sleep 3
  # 0914 主理人验收字段: 原爆款作品地址。current-video-link 自带 note(图文)检测,
  # 图文帖直接跳过(评论区结构不同,采了也是脏数据)。
  VLINK="$($C --profile "$P" current-video-link "$TAG-v$i-vl" </dev/null 2>/dev/null || true)"
  VURL="$(print -- "$VLINK" | sed -n "s/^short_url=//p")"
  if print -- "$VLINK" | grep -q "^excluded_non_video=true"; then
    log "  图文帖,跳过"
    $C --profile "$P" back-to-results >/dev/null 2>&1 || true
    continue
  fi
  VID="$(print -- "$VLINK" | sed -n "s/^video_id=//p")"
  [[ -n "$VURL" ]] && log "  作品链接: $VURL"
  if [[ -n "$VID" ]] && grep -qxF "$VID" "$SEENVIDS" 2>/dev/null; then
    log "  视频已处理过,跳过: $VID"
    $C --profile "$P" back-to-results >/dev/null 2>&1 || true
    continue
  fi
  OCOUT="$($C --profile "$P" open-comments "$TAG-v$i-oc" </dev/null 2>/dev/null || true)"
  if ! print -- "$OCOUT" | grep -q "^comments_opened=1"; then
    log "  评论区打不开,3秒后重试1次"
    /bin/sleep 3
    OCOUT="$($C --profile "$P" open-comments "$TAG-v$i-oc2" </dev/null 2>/dev/null || true)"
    if ! print -- "$OCOUT" | grep -q "^comments_opened=1"; then
      log "  评论区重试仍打不开,跳过"
      $C --profile "$P" back-to-results >/dev/null 2>&1 || true
      continue
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
  while true; do
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
    # 停止条件(跟comment-tier-lib.js的shouldKeepScrolling同一套判据):
    #   真到底了 / 大户已攒够封顶数 / 连续2屏没有新增(可能卡住了,防死循环) → 停
    if (( EXHAUSTED == 1 )); then break; fi
    if [[ "$TIER" == "large" ]] && (( TOTAL >= LARGE_CAP )); then log "  大户已达封顶${LARGE_CAP}条,停止翻屏"; break; fi
    if (( EMPTY_ROUNDS >= 2 )); then log "  连续2屏无新增,停止翻屏(防卡死)"; break; fi
    $C --profile "$P" swipe 600 2000 600 900 400 </dev/null >/dev/null 2>&1
    sleep 1.5
  done
  unset SEEN_LINES
  CC="$(print -- "$CC" | grep -E "	tap=" || true)"
  if [[ -z "$CC" ]]; then
    log "  零评论"
    # 评论面板开着也不用先 back 一次再归位——back-to-results 自己退到看见结果页为止
    $C --profile "$P" back-to-results >/dev/null 2>&1 || true
    continue
  fi
  log "  评论数: $(print -- "$CC" | wc -l | tr -d " ")"
  j=0
  for CLINE in "${(f)CC}"; do
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
      /bin/sleep 2
      if ! $C --profile "$P" open-comments "$TAG-v$i-u$j-ro$IDTRY" </dev/null >/dev/null 2>&1; then
        $C --profile "$P" back >/dev/null 2>&1; /bin/sleep 2
        $C --profile "$P" open-comments "$TAG-v$i-u$j-ro${IDTRY}b" </dev/null >/dev/null 2>&1 || true
      fi
      /bin/sleep 2
    done
    OID="$(print -- "$IDOUT" | sed -n "s/^douyin_id=//p")"
    ATYPE="$(print -- "$IDOUT" | sed -n "s/^account_type=//p")"
    PIP="$(print -- "$IDOUT" | sed -n "s/^profile_ip=//p")"
    if [[ -z "$ONICK" ]]; then log "  行$j 身份验证3次仍失败,弃: $NICK"; continue; fi
    # 0919 自有账号过滤: 命中自有名单的评论不当线索;若命中的是视频作者本人,整条视频其余评论不再采集
    if node "$(dirname "$0")/check-own-account.js" "$ONICK" "${OID:-}" >/dev/null 2>&1; then
      if [[ "$AUTHOR" == "author" ]]; then
        log "  视频作者是自有账号($ONICK),本视频其余评论不再采集"
        break
      fi
      log "  跳过自有账号: $ONICK"
      continue
    fi
    # 0914 主理人验收:每人顺取名片主页直链(identity已回评论区,重进主页跑card-link,其自带恢复)
    "$C" --profile "$P" tap-evidence "$TXX" "$TXY" "$TAG-v$i-u$j-re" </dev/null >/dev/null 2>&1
    sleep 3
    CARD="$("$C" --profile "$P" commenter-card-link "$TAG-v$i-u$j-cl" </dev/null 2>/dev/null || true)"
    PURL="$(print -- "$CARD" | sed -n "s/^profile_url=//p")"
    print -- "LEAD	$ONICK	${OID:-}	${ATYPE:-personal}	$BODY	$DATE	$REGION	$TITLE	$KWTXT	${PIP:-}	${PURL:-}	${VURL:-}"
    sleep 4
  done
  # 视频落「视频池」行(全链可观察: VIDEO\tid\t短链\t标题\t关键词\t采到评论数)
  print -- "VIDEO	${VID:-}	${VURL:-}	$TITLE	$KWTXT	$(print -- "$CC" | wc -l | tr -d " ")"
  # 收评论面板+回搜索结果
  # 归位不数 back 次数：取过链接的视频栈里多一层，写死的次数必然退多或退少
  # （0922 实证：跳过分支 back 一次落在暂存解析页，后面每个视频都在错页面上瞎点）。
  $C --profile "$P" back-to-results >/dev/null 2>&1 || true
  sleep 3
done
log "关键词完成: $KWTXT"
