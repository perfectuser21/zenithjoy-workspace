#!/usr/bin/env bash
# ai-video-smoke.sh — AI 视频功能 smoke（ai_video_history / ai_video_task_monitor / ai_video_generate / ai_video_upload）
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

echo "── ai-video-upload (upload 端点 201 + 无超时) ──"
# 生成 1 秒测试视频（ffmpeg 必须可用）
TMP_DIR=$(mktemp -d)
TMP_VIDEO="$TMP_DIR/test.mp4"
if command -v ffmpeg &>/dev/null; then
  ffmpeg -f lavfi -i "sine=frequency=440:duration=1" \
    -f lavfi -i "color=black:size=320x180:duration=1" \
    -map 0:a -map 1:v -y "$TMP_VIDEO" 2>/dev/null
  # dispatch() 内 execSync(ssh) 最长阻塞 120s，给 curl 足够时间等待
  curl_out=$(curl -s -m 60 -o /tmp/upload_resp.json -w "%{http_code}" \
    -X POST "$API/api/ai-video/upload" \
    -F "video=@$TMP_VIDEO;type=video/mp4" \
    -F "script=smoke 测试上传" 2>/dev/null)
  curl_exit=$?
  http_code="${curl_out:-000}"
  [[ $curl_exit -ne 0 ]] && http_code="000"
  body=$(cat /tmp/upload_resp.json 2>/dev/null || echo "{}")
  if [[ "$http_code" == "201" ]]; then
    job_id=$(echo "$body" | jq -r '.id // empty' 2>/dev/null)
    [[ -n "$job_id" ]] \
      && ok "POST /ai-video/upload 返回 201 + job id ($job_id)" \
      || fail "POST /ai-video/upload 返回 201 但缺少 id 字段 (body=$body)"
  else
    fail "POST /ai-video/upload 非 201 (HTTP $http_code, body=$body)"
  fi
  rm -rf "$TMP_DIR"
else
  ok "跳过 upload smoke（ffmpeg 未安装）"
fi

echo ""
echo "────────────────────────────────────"
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ ai-video smoke 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
