#!/bin/zsh
# harvest-keyword.sh — 单关键词客资采收驱动(0914 KPI 夜)
# 用法: harvest-keyword.sh PROFILE KEYWORD_URLENC MAX_VIDEOS RUN_TAG
# 输出: LEAD\t昵称\t抖音号\taccount_type\t评论\t日期\t地区\t视频标题\t关键词 到 stdout
# 全部动作走 douyin-phone-adb(锁/守卫/频控内建),本脚本只做序列编排。
set -uo pipefail
C=~/.local/bin/douyin-phone-adb
P="$1"; KW="$2"; MAXV="${3:-4}"; TAG="$4"; LOC="${5:-same_city}"; LINE="${6:-}"
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
    $C --profile "$P" back >/dev/null 2>&1; sleep 2
    continue
  fi
  VID="$(print -- "$VLINK" | sed -n "s/^video_id=//p")"
  [[ -n "$VURL" ]] && log "  作品链接: $VURL"
  if [[ -n "$VID" ]] && grep -qxF "$VID" "$SEENVIDS" 2>/dev/null; then
    log "  视频已处理过,跳过: $VID"
    $C --profile "$P" back >/dev/null 2>&1; sleep 2
    continue
  fi
  if ! $C --profile "$P" open-comments "$TAG-v$i-oc" >/dev/null 2>&1; then
    log "  评论区打不开,3秒后重试1次"
    /bin/sleep 3
    if ! $C --profile "$P" open-comments "$TAG-v$i-oc2" >/dev/null 2>&1; then
      log "  评论区重试仍打不开,跳过"
      $C --profile "$P" back >/dev/null 2>&1; sleep 2
      continue
    fi
  fi
  CC="$($C --profile "$P" collect-comments "$TAG-v$i-cc" 2>/dev/null | grep -E "	tap=" || true)"
  if [[ -z "$CC" ]]; then
    log "  零评论"
    $C --profile "$P" back >/dev/null 2>&1; sleep 1
    $C --profile "$P" back >/dev/null 2>&1; sleep 2
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
  $C --profile "$P" back >/dev/null 2>&1; sleep 1
  $C --profile "$P" back >/dev/null 2>&1; sleep 2
  sleep 3
done
log "关键词完成: $KWTXT"
