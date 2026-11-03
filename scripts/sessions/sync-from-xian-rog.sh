#!/bin/bash
# ================================================================
# Session Sync — 从 xian-rog/xian-pc 同步平台 session 到 GitHub Secrets
#
# 用法（Mac 上跑）：
#   bash scripts/sessions/sync-from-xian-rog.sh [xian-rog|xian-pc]
#
# 前提：
#   1. 已在 xian-rog 上登录平台（浏览器扫码完成）
#   2. Mac 上 gh CLI 已认证
#   3. SSH 别名 xian-rog 可连通
#
# 覆盖的 GitHub Secrets（8 平台 × 4 账号 = 32 个）：
#   {PLATFORM}_COOKIES（主号）/ {PLATFORM}_SUB_1 / _SUB_2 / _SUB_3
#   PLATFORM: DOUYIN / KUAISHOU / XIAOHONGSHU / WEIBO / GONGZHONGHAO / TOUTIAO / ZHIHU / SHIPINHAO
#   ACCOUNT_TYPE: MAIN（Secret 映射为 COOKIES）/ SUB_1 / SUB_2 / SUB_3
#
#   例：KUAISHOU_COOKIES  XIAOHONGSHU_SUB_1  DOUYIN_SUB_3
#
# Secrets: KUAISHOU_COOKIES KUAISHOU_SUB_1 KUAISHOU_SUB_2 KUAISHOU_SUB_3
#          XIAOHONGSHU_COOKIES XIAOHONGSHU_SUB_1 XIAOHONGSHU_SUB_2 XIAOHONGSHU_SUB_3
#          SHIPINHAO_COOKIES SHIPINHAO_SUB_1 SHIPINHAO_SUB_2 SHIPINHAO_SUB_3
#          TOUTIAO_COOKIES TOUTIAO_SUB_1 TOUTIAO_SUB_2 TOUTIAO_SUB_3
#          WEIBO_COOKIES WEIBO_SUB_1 WEIBO_SUB_2 WEIBO_SUB_3
#          ZHIHU_COOKIES ZHIHU_SUB_1 ZHIHU_SUB_2 ZHIHU_SUB_3
#          GONGZHONGHAO_COOKIES GONGZHONGHAO_SUB_1 GONGZHONGHAO_SUB_2 GONGZHONGHAO_SUB_3
#          DOUYIN_COOKIES DOUYIN_SUB_1 DOUYIN_SUB_2 DOUYIN_SUB_3
#
# Windows session 文件路径约定：
#   %WIN_SESSIONS%\{platform}\main.json
#   %WIN_SESSIONS%\{platform}\sub_1.json
#   %WIN_SESSIONS%\{platform}\sub_2.json
#   %WIN_SESSIONS%\{platform}\sub_3.json
# ================================================================

set -uo pipefail

MACHINE="${1:-xian-rog}"
REPO="perfectuser21/zenithjoy-workspace"
BARK_URL="https://api.day.app/QU7ktbzPJxZbNx9pEHcstW"
WIN_SESSIONS='C:\Users\asus\.zenithjoy-agent\sessions'

synced=(); failed=()

echo "=== Session Sync from ${MACHINE} @ $(date '+%Y-%m-%d %H:%M') ==="

bark() {
  local encoded_path
  encoded_path=$(python3 -c 'import sys; from urllib.parse import quote; print(quote(sys.argv[1], safe="") + "/" + quote(sys.argv[2], safe=""))' "$1" "$2") || return 1
  curl -fsS --max-time 5 "${BARK_URL}/${encoded_path}?group=ZenithJoy" >/dev/null 2>&1
}

# SSH 连通性检测 — 失败则 early return，不覆盖旧 Secret
if ! ssh -o ConnectTimeout=10 -o BatchMode=yes "$MACHINE" "exit 0" 2>/dev/null; then
  echo "❌ SSH 连接 ${MACHINE} 失败 — early return，旧 Secret 保持不变"
  bark "Session同步失败❌" "SSH无法连接${MACHINE}"
  exit 1
fi
echo "✅ SSH 连通"

# 读 Windows 文件，剥离 BOM
read_win() {
  ssh "$MACHINE" "type \"${1}\"" 2>/dev/null \
    | python3 -c "import sys; d=sys.stdin.buffer.read(); print(d.decode('utf-8-sig','replace'))"
}

sync_one() {
  local label="$1" win_path="$2" secret="$3"
  echo ""
  echo "── ${label} → ${secret}"
  local json; json=$(read_win "$win_path" 2>/dev/null || echo "")
  if [ -z "$json" ]; then
    echo "  ⚠️  文件不存在，跳过"; failed+=("${label}"); return
  fi
  # Accept cookie arrays and the storageState emitted by the QR publishers.
  # Validate every cookie before invoking gh, retaining the full original JSON
  # (including origins/localStorage) for browser consumers.
  local n
  if ! n=$(printf '%s\n' "$json" | python3 -c '
import json, sys
try:
    state = json.load(sys.stdin)
    cookies = state if isinstance(state, list) else state.get("cookies") if isinstance(state, dict) else None
    valid = isinstance(cookies, list) and bool(cookies) and all(
        isinstance(cookie, dict)
        and isinstance(cookie.get("name"), str) and bool(cookie["name"].strip())
        and isinstance(cookie.get("value"), str)
        for cookie in cookies
    )
    if not valid:
        sys.exit(1)
    print(len(cookies))
except (ValueError, TypeError):
    sys.exit(1)
' 2>/dev/null); then
    echo "  ❌ Cookie JSON 无效（须含非空 cookies 数组，每项含非空 name 和字符串 value）"; failed+=("${label}"); return
  fi
  echo "  ${n} 个 cookies"
  if echo "$json" | gh secret set "$secret" --repo "$REPO" 2>&1; then
    echo "  ✅ 已更新"; synced+=("${label}(${n})")
  else
    echo "  ❌ gh secret set 失败"; failed+=("${label}")
  fi
}

# sync_matrix — 按 (平台, 账号类型) 同步一条 Secret
sync_matrix() {
  local platform_lower="$1"
  local platform_upper="$2"
  local account_type="$3"  # MAIN / SUB_1 / SUB_2 / SUB_3

  local account_lower; account_lower=$(echo "$account_type" | tr '[:upper:]' '[:lower:]')
  local win_path="${WIN_SESSIONS}\\${platform_lower}\\${account_lower}.json"
  local secret="${platform_upper}_${account_type}"
  if [ "$account_type" = "MAIN" ]; then secret="${platform_upper}_COOKIES"; fi
  local label="${platform_upper} ${account_type}"

  sync_one "$label" "$win_path" "$secret"
}

# ── 8 平台 × 4 账号矩阵 ────────────────────────────────────────────
PLATFORMS=(
  "douyin:DOUYIN"
  "kuaishou:KUAISHOU"
  "xiaohongshu:XIAOHONGSHU"
  "weibo:WEIBO"
  "gongzhonghao:GONGZHONGHAO"
  "toutiao:TOUTIAO"
  "zhihu:ZHIHU"
  "shipinhao:SHIPINHAO"
)

ACCOUNT_TYPES=(MAIN SUB_1 SUB_2 SUB_3)

for platform_entry in "${PLATFORMS[@]}"; do
  platform_lower="${platform_entry%%:*}"
  platform_upper="${platform_entry##*:}"
  for account_type in "${ACCOUNT_TYPES[@]}"; do
    sync_matrix "$platform_lower" "$platform_upper" "$account_type"
  done
done

# ── 汇总 ─────────────────────────────────────────────────────────
echo ""
echo "================================================================"
printf "完成: %d 成功  %d 失败\n" "${#synced[@]}" "${#failed[@]}"
[ ${#synced[@]} -gt 0 ] && echo "✅ $(IFS=,; echo "${synced[*]}")"
[ ${#failed[@]} -gt 0 ] && echo "❌ $(IFS=,; echo "${failed[*]}")"

NOTIFY_STATUS=0
if [ ${#failed[@]} -eq 0 ] && [ ${#synced[@]} -gt 0 ]; then
  bark "Session已同步✅" "$(IFS=,; echo "${synced[*]}")" || NOTIFY_STATUS=1
elif [ ${#synced[@]} -gt 0 ]; then
  bark "Session部分同步⚠️" "失败:$(IFS=,; echo "${failed[*]}")" || NOTIFY_STATUS=1
else
  bark "Session同步失败❌" "$(IFS=,; echo "${failed[*]}")" || NOTIFY_STATUS=1
fi
if [ "$NOTIFY_STATUS" -eq 0 ]; then
  echo "Bark 通知已发"
else
  echo "❌ Bark 通知发送失败" >&2
fi
if [ ${#failed[@]} -gt 0 ] || [ ${#synced[@]} -eq 0 ] || [ "$NOTIFY_STATUS" -ne 0 ]; then
  exit 1
fi
