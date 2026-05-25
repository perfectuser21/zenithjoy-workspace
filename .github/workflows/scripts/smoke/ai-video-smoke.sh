#!/usr/bin/env bash
# ai-video-smoke.sh — AI 视频功能 smoke（ai_video_history / ai_video_task_monitor / ai_video_generate）
set -euo pipefail

API="${API_BASE:-http://localhost:5200}"
FEISHU_USER="ou_smoke_aiv_001"
PASS=0; FAIL=0

ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── ai-video-history ──"
r=$(curl -s "$API/api/ai-video/history" -H "X-Feishu-User-Id: $FEISHU_USER")
echo "$r" | jq -e '.data != null and (.total >= 0)' >/dev/null 2>&1 \
  && ok "GET /ai-video/history 返回 {data, total}" \
  || fail "GET /ai-video/history 响应异常 ($r)"

echo "── ai-video-task-monitor ──"
r=$(curl -s "$API/api/ai-video/active" -H "X-Feishu-User-Id: $FEISHU_USER")
echo "$r" | jq -e 'type == "array"' >/dev/null 2>&1 \
  && ok "GET /ai-video/active 返回数组" \
  || fail "GET /ai-video/active 响应异常 ($r)"

echo "── ai-video-generate (路由可达性) ──"
# generate 依赖 ToAPI 外部服务，smoke 验端点可达 + 校验链路（非 404）
http_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/ai-video/generate" \
    -H "X-Feishu-User-Id: $FEISHU_USER" \
    -H "Content-Type: application/json" \
    -d '{"prompt":"smoke test","model":"kling-v2-master","duration":5,"aspect_ratio":"16:9"}')
[[ "$http_code" != "404" && "$http_code" != "000" ]] \
  && ok "POST /ai-video/generate 路由可达 (HTTP $http_code)" \
  || fail "POST /ai-video/generate 404 或不可达"

echo "── ai-video-upload (路由可达性 + 400 无文件) ──"
# POST /api/ai-video/upload 不带 video 文件必须返回 400（不是 404/500）
http_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/ai-video/upload" \
    -H "X-Feishu-User-Id: $FEISHU_USER")
[[ "$http_code" == "400" ]] \
  && ok "POST /api/ai-video/upload 无文件 → 400" \
  || fail "POST /api/ai-video/upload 无文件 → 期望 400，得 $http_code"

echo ""
echo "────────────────────────────────────"
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ ai-video smoke 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
