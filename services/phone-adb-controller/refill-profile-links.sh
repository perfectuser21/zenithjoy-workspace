#!/bin/zsh
# refill-profile-links.sh PROFILE IDLIST_FILE OUT_TSV — 按抖音号回填主页直链
# 每号: open-search → 用户tab(树) → 点首卡(固定位) → 主页校验抖音号 → card-link → 记录
set -uo pipefail
C=~/.local/bin/douyin-phone-adb
P="$1"; LIST="$2"; OUT="$3"
TAG="refill-$(date +%H%M%S)"
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
  # 切用户tab(树锚点)
  UX=$($C --profile "$P" ui-evidence "$TAG-$n-tabs" </dev/null 2>/dev/null | tail -1)
  UT=$(grep -oE "<node[^>]*text=\"用户\"[^>]*>" "$UX" 2>/dev/null | head -1 | sed -E "s/.*bounds=\"\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]\".*/\1 \2 \3 \4/")
  if [[ -z "$UT" ]]; then log "  用户tab未见,跳过"; continue; fi
  read x1 y1 x2 y2 <<< "$UT"
  $C --profile "$P" tap $(( (x1+x2)/2 )) $(( (y1+y2)/2 )) </dev/null >/dev/null 2>&1; sleep 4
  # 首卡固定位(1200宽机型: 300,570) — 进主页后强校验抖音号,认错人即弃
  $C --profile "$P" tap 300 570 </dev/null >/dev/null 2>&1; sleep 3
  PX=$($C --profile "$P" ui-evidence "$TAG-$n-prof" </dev/null 2>/dev/null | tail -1)
  if ! grep -qF "抖音号：$DYID" "$PX" 2>/dev/null; then
    log "  主页校验失败(首卡非本人或未进入),跳过"
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
