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
# 更新的 GitHub Secrets：
#   DOUYIN_COOKIES         — 抖音主号
#   DOUYIN_COOKIES_BURNER  — 抖音小号（burner 目录最新文件）
# ================================================================

set -euo pipefail

MACHINE="${1:-xian-rog}"
REPO="perfectuser21/zenithjoy-workspace"
BARK_URL="https://api.day.app/QU7ktbzPJxZbNx9pEHcstW"
WIN_SESSIONS='C:\Users\asus\.zenithjoy-agent\sessions'

synced=(); failed=()

echo "=== Session Sync from ${MACHINE} @ $(date '+%Y-%m-%d %H:%M') ==="

bark() {
  curl -s --max-time 5 "${BARK_URL}/${1}/${2}?group=ZenithJoy" >/dev/null 2>&1 || true
}

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
  if ! echo "$json" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    echo "  ❌ JSON 无效"; failed+=("${label}"); return
  fi
  local n; n=$(echo "$json" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
  echo "  ${n} 个 cookies"
  if echo "$json" | gh secret set "$secret" --repo "$REPO" 2>&1; then
    echo "  ✅ 已更新"; synced+=("${label}(${n})")
  else
    echo "  ❌ gh secret set 失败"; failed+=("${label}")
  fi
}

# ── 抖音主号 ──────────────────────────────────────────────────────
sync_one "抖音主号" "${WIN_SESSIONS}\\douyin\\default.json" "DOUYIN_COOKIES"

# ── 抖音小号 ──────────────────────────────────────────────────────
BURNER=$(ssh "$MACHINE" \
  "for /f \"delims=\" %f in ('dir /b /o-d \"${WIN_SESSIONS}\\douyin\\burner\" 2^>nul') do (echo %f & goto :eof)" \
  2>/dev/null | head -1 | tr -d '\r\n')
if [ -n "$BURNER" ]; then
  sync_one "抖音小号" "${WIN_SESSIONS}\\douyin\\burner\\${BURNER}" "DOUYIN_COOKIES_BURNER"
else
  echo ""; echo "── 抖音小号: burner 目录无文件，跳过"
fi

# ── 汇总 ─────────────────────────────────────────────────────────
echo ""
echo "================================================================"
printf "完成: %d 成功  %d 失败\n" "${#synced[@]}" "${#failed[@]}"
[ ${#synced[@]} -gt 0 ] && echo "✅ $(IFS=,; echo "${synced[*]}")"
[ ${#failed[@]} -gt 0 ] && echo "❌ $(IFS=,; echo "${failed[*]}")"

if [ ${#failed[@]} -eq 0 ] && [ ${#synced[@]} -gt 0 ]; then
  bark "Session已同步✅" "$(IFS=,; echo "${synced[*]}")"
elif [ ${#synced[@]} -gt 0 ]; then
  bark "Session部分同步⚠️" "失败:$(IFS=,; echo "${failed[*]}")"
else
  bark "Session同步失败❌" "$(IFS=,; echo "${failed[*]}")"
fi
echo "Bark 通知已发"
