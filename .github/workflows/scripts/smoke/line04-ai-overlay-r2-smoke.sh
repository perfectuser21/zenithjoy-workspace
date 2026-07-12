#!/usr/bin/env bash
# line04-ai-overlay-r2-smoke.sh
# Line04 AI 思考浮窗第二刀 smoke — wechat-draft reasoning API 验收
set -euo pipefail

BASE_URL="${API_BASE_URL:-http://localhost:3000}"

echo "[smoke] line04-ai-overlay-r2: wechat-draft reasoning 字段存在性检查"

# 检查 wechat-draft.ts 含 reasoning 字段扩展
grep -q "reasoning" apps/api/src/services/wechat-draft.ts && \
  echo "[smoke] PASS: wechat-draft.ts 含 reasoning 字段" || \
  { echo "[smoke] FAIL: wechat-draft.ts 缺 reasoning 字段"; exit 1; }

# 检查 overlay_window.py 已交付
[ -f "services/agent/wechat-rpa/overlay/overlay_window.py" ] && \
  echo "[smoke] PASS: overlay_window.py 存在" || \
  { echo "[smoke] FAIL: overlay_window.py 缺失"; exit 1; }

# 检查 node overlay handler 已交付
[ -f "services/agent/modules/line04/handlers/overlay.ts" ] && \
  echo "[smoke] PASS: overlay.ts handler 存在" || \
  { echo "[smoke] FAIL: overlay.ts handler 缺失"; exit 1; }

echo "[smoke] line04-ai-overlay-r2: all checks PASS"
