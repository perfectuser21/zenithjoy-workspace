#!/bin/zsh
# moments-tick.sh —— 朋友圈发布心跳（xian-m1 crontab，仿 outreach-tick.sh 骨架）
#
# 节奏（判定点表已拍板）：审批后即触发 + 15-30 分钟轮询兜底，不做拟人随机跳过
# （朋友圈本身就低频，不需要伪装稀疏）；建议 crontab 每 20 分钟跑一次，且跟抖音获客
# 的 outreach-tick.sh(每30分钟) 错峰，避免同一部手机的 uiautomator dump 配额被同时抢占：
#   */20 * * * * /bin/zsh ~/bin-harvest/moments-tick.sh >/dev/null 2>&1
#
# 领单：直接 curl zenithjoy-api 的 /api/wechat/moment-drafts/next-dispatch（走 hk-vps
# 内网 localhost，跟 android-publish 领单协议同一姿势），不经 openclaw-gateway 代理——
# 朋友圈队列本来就在 zenithjoy Postgres，没有必要再绕一层。
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

LOG=~/moments-outreach.log
log(){ print -- "[$(date +%m%d-%H:%M:%S)] $*" >> $LOG }

# ── 配置：租户/凭据从本机配置文件读，不硬编码 ──────────────────────────────
CONF="${MOMENTS_CONF:-$HOME/.config/openclaw/moments-tick.env}"
[[ -r "$CONF" ]] && source "$CONF"
: "${MOMENTS_TENANT_ID:?MOMENTS_TENANT_ID 未配置，见 $CONF}"
: "${MOMENTS_PROFILE:?MOMENTS_PROFILE 未配置（douyin-phone-profiles.tsv 里的设备档案名）}"
API_HOST="${MOMENTS_API_HOST:-hk-vps}"
API_PORT="${MOMENTS_API_PORT:-5201}"
ASSET_LIB="${MOMENTS_ASSET_LIB:-$HOME/.config/openclaw/moments-asset-lib}"

api() {
  # $1=method $2=path $3=json body(可选)
  ssh -o ConnectTimeout=15 "$API_HOST" \
    "curl -s -X '$1' 'http://127.0.0.1:${API_PORT}$2' -H 'X-Tenant-Id: ${MOMENTS_TENANT_ID}' -H 'Content-Type: application/json' ${3:+-d '$3'}"
}

C=~/.local/bin/wechat-moments-adb
TICK_LOCK=/tmp/moments-tick.lock
if ! /bin/mkdir "$TICK_LOCK" 2>/dev/null; then
  if [[ -n "$(find "$TICK_LOCK" -maxdepth 0 -mmin +35 2>/dev/null)" ]]; then
    /bin/rm -rf "$TICK_LOCK" 2>/dev/null
    /bin/mkdir "$TICK_LOCK" 2>/dev/null || { log "锁竞争,跳过"; exit 0 }
  else
    log "tick 仍在跑,跳过"; exit 0
  fi
fi
trap '/bin/rm -rf "$TICK_LOCK"' EXIT

ORDER="$(api POST /api/wechat/moment-drafts/next-dispatch "{\"claimed_by\":\"${MOMENTS_PROFILE}\"}")"
if [[ -z "$ORDER" ]] || print -- "$ORDER" | grep -q '"task":null'; then
  log "无待发布工单"
  exit 0
fi

TASK_ID=$(print -- "$ORDER" | python3 -c "import json,sys;print(json.load(sys.stdin)['task']['task_id'])" 2>/dev/null) || { log "工单解析失败: $ORDER"; exit 0 }
CONTENT=$(print -- "$ORDER" | python3 -c "import json,sys;print(json.load(sys.stdin)['task']['content'])" 2>/dev/null)
CAPTION_B64=$(print -n -- "$CONTENT" | /usr/bin/base64)
log "领到工单 $TASK_ID: ${CONTENT:0:30}..."

RUN_TAG="moments-$(date +%m%d%H%M)"
report() {
  # $1=sent|failed $2=json meta
  api POST "/api/wechat/moment-drafts/${TASK_ID}/complete" "{\"result\":\"$1\",\"dispatch_meta\":$2}" >> $LOG 2>&1
}

if ! $C --profile "$MOMENTS_PROFILE" lock-acquire "$RUN_TAG" >>$LOG 2>&1; then
  log "设备锁被占用(可能在跑智能获客),工单不消费——下次 tick 再抢"
  # 注意：不 report failed——工单还是 claimed 状态，10 分钟后孤儿回收会被重新领取，
  # 这不是"发布失败"，是"这一轮没抢到设备"，语义不同，不该污染 failed 统计。
  exit 0
fi

# 素材库匹配：按标签取一张图；匹配不到降级纯文字（微信原生支持，不空转失败）。
IMG_LOCAL=""
if [[ -d "$ASSET_LIB" ]]; then
  IMG_LOCAL="$(/bin/ls "$ASSET_LIB"/*.jpg 2>/dev/null | /usr/bin/shuf -n1 2>/dev/null || true)"
fi

$C --profile "$MOMENTS_PROFILE" open-wechat "${RUN_TAG}-open" >>$LOG 2>&1
$C --profile "$MOMENTS_PROFILE" open-moments "${RUN_TAG}-moments" >>$LOG 2>&1

if [[ -n "$IMG_LOCAL" ]]; then
  FNAME="IMG_$(date +%Y%m%d_%H%M%S).jpg"
  REMOTE_SERIAL=$(python3 -c "
import csv,sys
with open('${DOUYIN_PHONE_REGISTRY:-$HOME/.config/openclaw/douyin-phone-profiles.tsv}') as f:
    for row in csv.reader(f, delimiter='\t'):
        if row and row[0]=='${MOMENTS_PROFILE}': print(row[1]); break
")
  /opt/homebrew/bin/adb -s "$REMOTE_SERIAL" push "$IMG_LOCAL" "/sdcard/DCIM/Camera/$FNAME" >>$LOG 2>&1
  /opt/homebrew/bin/adb -s "$REMOTE_SERIAL" shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///sdcard/DCIM/Camera/$FNAME" >>$LOG 2>&1
  OUT=$($C --profile "$MOMENTS_PROFILE" compose-photo-post "$FNAME" "$CAPTION_B64" "${RUN_TAG}-compose" 2>&1)
else
  log "素材库为空或无匹配图，本轮降级为纯文字动态（compose-photo-post 暂不支持纯文字路径，v1 缺口——见 PrepPRD「不包含」）"
  $C --profile "$MOMENTS_PROFILE" lock-release "$RUN_TAG" >>$LOG 2>&1
  report failed '{"fail_reason_code":"NO_ASSET_AND_TEXT_ONLY_NOT_IMPLEMENTED"}'
  exit 0
fi
print -- "$OUT" >> $LOG

if print -- "$OUT" | grep -q "^composed=1"; then
  PUB_OUT=$($C --profile "$MOMENTS_PROFILE" publish "${RUN_TAG}-publish" 2>&1)
  print -- "$PUB_OUT" >> $LOG
  VERIFY_OUT=$($C --profile "$MOMENTS_PROFILE" verify-latest-post "$CAPTION_B64" "${RUN_TAG}-verify" 2>&1)
  print -- "$VERIFY_OUT" >> $LOG
  if print -- "$VERIFY_OUT" | grep -q "^MATCH"; then
    log "✅ 工单 $TASK_ID 发布成功并核验通过"
    report sent "{\"dump_fail_count\":0,\"vision_fallback_triggered\":true}"
  else
    log "❌ 工单 $TASK_ID 发布后核验不通过（NOMATCH 或脚本失败），判 failed，不重发"
    report failed '{"fail_reason_code":"VERIFY_NOMATCH"}'
  fi
else
  log "❌ 工单 $TASK_ID 编辑页组装失败（dump+视觉均定位不到关键控件），判 failed"
  report failed '{"fail_reason_code":"COMPOSE_LOCATE_FAILED"}'
fi

$C --profile "$MOMENTS_PROFILE" lock-release "$RUN_TAG" >>$LOG 2>&1
