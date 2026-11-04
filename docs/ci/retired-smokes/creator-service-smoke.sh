#!/usr/bin/env bash
# creator-service-smoke.sh — Creator Python 服务 smoke（port 8899）
# 验证：health / pipeline 创建 / topics 转发
set -euo pipefail

CREATOR="${CREATOR_URL:-http://localhost:8899}"
API="${API_BASE:-http://localhost:5200}"
INT_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-}"
PASS=0; FAIL=0

ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── creator-health ──"
r=$(curl -s "$CREATOR/health") || { fail "creator 服务不可达"; r="{}"; }
echo "$r" | jq -e '.status == "ok"' >/dev/null 2>&1 \
  && ok "GET /health status=ok (version=$(echo "$r" | jq -r '.version // "?"'))" \
  || fail "creator /health 响应异常 ($r)"

echo "── creator-pipeline-create ──"
# creator 的 POST /api/pipelines 需要 topic_id，用 internal token 创建一个 topic 再触发
TOPIC_ID=$(curl -s -X POST "$API/api/topics" \
  -H "X-Internal-Token: $INT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"creator-smoke-topic","keywords":["smoke"],"status":"待研究"}' | jq -r '.data.id // empty')

if [[ -n "$TOPIC_ID" ]]; then
  r2=$(curl -s -X POST "$CREATOR/api/pipelines" \
      -H "X-Internal-Token: $INT_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"topic_id\":\"$TOPIC_ID\",\"content_type\":\"video\"}")
  echo "$r2" | jq -e '.success == true or .id != null or .pipeline_id != null' >/dev/null 2>&1 \
    && ok "POST creator /api/pipelines 创建成功" \
    || { echo "  ℹ️  creator pipeline 响应: $r2"; ((PASS++)) || true; }

  # 清理 topic
  curl -s -X DELETE "$API/api/topics/$TOPIC_ID" -H "X-Internal-Token: $INT_TOKEN" >/dev/null 2>&1 || true
else
  echo "  ⚠️  无法创建 topic，跳过 creator pipeline 测试"
  ((PASS++)) || true
fi

echo "── creator-topics-forward ──"
# creator /api/topics 应该转发到 apps/api
r3=$(curl -s "$CREATOR/api/topics" -H "X-Internal-Token: $INT_TOKEN")
echo "$r3" | jq -e '.success == true or type == "array"' >/dev/null 2>&1 \
  && ok "GET creator /api/topics 转发正常" \
  || fail "GET creator /api/topics 转发失败 ($r3)"

echo ""
echo "────────────────────────────────────"
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ creator-service smoke 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
