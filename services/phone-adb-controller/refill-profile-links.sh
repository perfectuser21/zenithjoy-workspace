#!/bin/zsh
# refill-profile-links.sh PROFILE IDLIST_FILE OUT_TSV — 按抖音号回填主页直链
# 每号: open-search → locate-tap点"用户"标签 → locate-tap按抖音号定位目标卡片 → 主页校验抖音号 → card-link → 记录
# (0920: 全程视觉定位,不依赖 uiautomator dump/固定坐标,见下方两条真机实证注释)
set -uo pipefail
C=~/.local/bin/douyin-phone-adb
P="$1"; LIST="$2"; OUT="$3"
TAG="refill-$(date +%H%M%S)"
EVROOT="/private/tmp/openclaw-phone/evidence/$P"
log(){ print -u2 -- "[$(date +%H:%M:%S)] $*"; }
find /Volumes/EvidenceRAM/openclaw-phone/evidence -type f \( -name "*.png" -o -name "*.xml" \) -mmin +30 -delete 2>/dev/null
$C --profile "$P" lock-acquire "$TAG" >/dev/null 2>&1 || { log "锁被占"; exit 3; }
trap '$C --profile "$P" lock-release "$TAG" >/dev/null 2>&1' EXIT
$C --profile "$P" open-app >/dev/null 2>&1; sleep 2
n=0; ok=0
for DYID in "${(f)$(cat $LIST)}"; do
  [[ -z "$DYID" ]] && continue
  n=$((n+1)); log "[$n] $DYID"
  ENC=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$DYID")
  $C --profile "$P" open-search "$ENC" </dev/null >/dev/null 2>&1; sleep 4
  # 0920 真机实证两个根因:
  # ① 搜索落地页默认停在"综合"tab,内嵌自动播放feed,uiautomator dump 必挂
  #    ("did not produce a fresh complete hierarchy",跟 harvest-keyword.sh 已知的
  #    "综合tab采不到"是同一个坑)。
  # ② "用户"tab在标签栏里的位置不固定(观察到"综合/视频/用户/图文/商品"和
  #    "综合/用户/视频/商品/直播"两种真实顺序,取决于搜索词是昵称还是纯数字ID),
  #    列表里目标账号是不是"第一张卡"也不固定,写死坐标(300,570)会点错人。
  # 两个问题的共同解法: 改用 locate-tap(视觉定位,截图喂给识图模型找坐标,完全不
  # 依赖 uiautomator dump,也不依赖固定位置假设),先点"用户"标签,再直接按抖音号
  # 文本定位目标卡片。
  # 0921 真机实锤(28条批量补链0成功后逐张截图排查): 两处此前只试一次就放弃,
  # 但失败原因都是"再来一次/往下滑一屏就能找到",不是真的定位不出来——
  # ①用户tab识图偶发漏判(截图给识图模型认,单次调用本就有误判率,retry一次即可);
  # ②抖音搜索是模糊匹配,目标账号常年不在第一屏(如搜"youyawuxiang"整屏全是
  #   "youya"开头的相似账号),原脚本从不滚动,永远够不着第一屏以下的正确结果。
  UTAB_TAPPED=0
  for _ut in 1 2; do
    UTAB_DESC=$(print -n -- "搜索结果页顶部横向标签栏里文字为用户二字的那个标签" | /usr/bin/base64)
    UTAB_OUT=$($C --profile "$P" locate-tap "$UTAB_DESC" "$TAG-$n-utab$_ut" </dev/null 2>&1)
    if print -- "$UTAB_OUT" | grep -q "^tapped"; then UTAB_TAPPED=1; break; fi
    log "  用户tab定位第${_ut}次失败,重试一次"
    sleep 2
  done
  if (( UTAB_TAPPED == 0 )); then log "  用户tab定位失败(已重试),跳过"; continue; fi
  sleep 3
  CARD_TAPPED=0
  for _ct in 1 2 3; do
    CARD_DESC=$(print -n -- "用户列表里抖音号显示为${DYID}的那一条用户卡片" | /usr/bin/base64)
    CARD_OUT=$($C --profile "$P" locate-tap "$CARD_DESC" "$TAG-$n-card$_ct" </dev/null 2>&1)
    if print -- "$CARD_OUT" | grep -q "^tapped"; then CARD_TAPPED=1; break; fi
    (( _ct == 3 )) && break
    log "  第${_ct}屏未找到抖音号=${DYID}的卡片,下滑一屏再找"
    $C --profile "$P" swipe 600 2000 600 900 400 </dev/null >/dev/null 2>&1
    sleep 2
  done
  if (( CARD_TAPPED == 0 )); then log "  未找到抖音号=${DYID}的卡片(已滑3屏),跳过"; continue; fi
  sleep 3
  $C --profile "$P" ui-evidence "$TAG-$n-prof" </dev/null >/dev/null 2>&1
  PX="$EVROOT/$TAG-$n-prof.xml"
  if [[ ! -s "$PX" ]] || ! grep -qF "抖音号：$DYID" "$PX" 2>/dev/null; then
    log "  主页校验失败(定位到的卡片非本人或未进入),跳过"
    $C --profile "$P" back </dev/null >/dev/null 2>&1; sleep 1
    continue
  fi
  CARD=$($C --profile "$P" commenter-card-link "$TAG-$n" </dev/null 2>/dev/null || true)
  PURL=$(print -- "$CARD" | sed -n "s/^profile_url=//p")
  SHORT=$(print -- "$CARD" | sed -n "s/^card_short_url=//p")
  if [[ -n "$PURL" ]]; then
    ok=$((ok+1)); print -- "REFILL	$DYID	$PURL	$SHORT" >> "$OUT"
    log "  ✅ $PURL"
  else
    log "  card-link失败"
  fi
  # card-link 恢复后大约在主页/搜索层级;统一回搜索起点:back×2
  $C --profile "$P" back </dev/null >/dev/null 2>&1; sleep 1
  $C --profile "$P" back </dev/null >/dev/null 2>&1; sleep 2
  sleep 2
done
log "回填完成: $ok/$n"
