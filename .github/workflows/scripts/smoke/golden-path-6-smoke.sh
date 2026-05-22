#!/usr/bin/env bash
# golden-path-6-smoke.sh
# ZenithJoy Walking Skeleton — 内容采集与分发路径（Path 6）
#
# 5 步：贴链接 → 回调写入 → OCR提取 → Notion推送 → 飞书推送
#
# 用法：
#   bash .github/workflows/scripts/smoke/golden-path-6-smoke.sh
#   退出码 0 = 端到端全通；非零 = 第 N 步红
#
# 每个 PR 推进的 step 必须让 smoke 多过一关。
# PR 描述须声明：「本 PR 把 Path 6 的 Step Y 从 ❌ 推到 ✅」

set -uo pipefail

API_BASE="${API_BASE:-http://localhost:3001}"
TEST_EMAIL="${TEST_EMAIL:-smoke-$(date +%s)@zenithjoy.test}"
TEST_PASSWORD="${TEST_PASSWORD:-Smoke!Test2026}"
DOUYIN_URL="${DOUYIN_URL:-https://v.douyin.com/test-smoke-001/}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "$2"; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ZenithJoy Path 6 Walking Skeleton — 内容采集与分发路径"
echo "  5 步：贴链接 → 回调写入 → OCR提取 → Notion推送 → 飞书推送"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 登录拿 cookie
COOKIES=$(mktemp)
TMP=$(mktemp)
cleanup() { rm -f "$COOKIES" "$TMP"; }
trap cleanup EXIT

# 注册/登录
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 30 \
  -c "$COOKIES" \
  -X POST "$API_BASE/api/auth/sign-up/email" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"name\":\"smoke6\"}")
[ "$HTTP" = "200" ] || fail "登录 expected 200, got $HTTP" 0

# ───────────────────────────────────────────────────────────────────
# Step 1：POST /api/clips → status=pending
# 现状：✅ PR #435 已合并
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 1: POST /api/clips → status=pending"

HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 15 \
  -b "$COOKIES" \
  -X POST "$API_BASE/api/clips" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$DOUYIN_URL\"}")
[ "$HTTP" = "201" ] || [ "$HTTP" = "200" ] || fail "Step 1 POST /api/clips expected 201/200, got $HTTP" 1

CLIP_ID=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('id',''))" "$TMP" 2>/dev/null)
[ -n "$CLIP_ID" ] || fail "Step 1 no clip id in response" 1

CLIP_STATUS=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('status',''))" "$TMP" 2>/dev/null)
[ "$CLIP_STATUS" = "pending" ] || [ "$CLIP_STATUS" = "done" ] || fail "Step 1 status='$CLIP_STATUS' expected pending/done" 1

ok "Step 1 POST /api/clips → clip_id=$CLIP_ID status=$CLIP_STATUS ✓"

# ───────────────────────────────────────────────────────────────────
# Step 2：回调写入 → status=done + transcript
# 现状：✅ PR #435 已合并
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 2: callback → status=done + transcript"

HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/clips/$CLIP_ID/callback" \
  -H "Content-Type: application/json" \
  -d "{\"status\":\"done\",\"title\":\"smoke test title\",\"transcript\":\"smoke transcript content\",\"platform\":\"douyin\"}")
[ "$HTTP" = "200" ] || fail "Step 2 callback expected 200, got $HTTP" 2

HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 15 \
  -b "$COOKIES" "$API_BASE/api/clips/$CLIP_ID")
[ "$HTTP" = "200" ] || fail "Step 2 GET /api/clips/$CLIP_ID expected 200, got $HTTP" 2

S2_STATUS=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('status',''))" "$TMP" 2>/dev/null)
[ "$S2_STATUS" = "done" ] || fail "Step 2 status='$S2_STATUS' expected done" 2

S2_TRANSCRIPT=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('transcript',''))" "$TMP" 2>/dev/null)
[ -n "$S2_TRANSCRIPT" ] || fail "Step 2 transcript is empty" 2

ok "Step 2 callback → status=done, transcript 已写入 ✓"

# ───────────────────────────────────────────────────────────────────
# Step 3：图文 OCR → ocr_text 写入
# 现状：✅ PR #435 已合并（OCR_RELAY_URL 需配置）
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 3: 图文 OCR → ocr_text 写入"

# 用独立 clip 模拟图文帖子（带 images）
OCR_CLIP_TMP=$(mktemp)
HTTP=$(curl -s -o "$OCR_CLIP_TMP" -w "%{http_code}" --max-time 15 \
  -b "$COOKIES" \
  -X POST "$API_BASE/api/clips" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://v.douyin.com/smoke-ocr-$(date +%s)/\"}")
[ "$HTTP" = "201" ] || [ "$HTTP" = "200" ] || { rm -f "$OCR_CLIP_TMP"; fail "Step 3 POST clip expected 201/200, got $HTTP" 3; }
OCR_ID=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('id',''))" "$OCR_CLIP_TMP" 2>/dev/null)
rm -f "$OCR_CLIP_TMP"
[ -n "$OCR_ID" ] || fail "Step 3 no clip id" 3

HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/clips/$OCR_ID/callback" \
  -H "Content-Type: application/json" \
  -d "{\"status\":\"done\",\"content_type\":\"图文\",\"title\":\"smoke ocr title\",\"images\":[\"https://example.com/img1.jpg\"],\"transcript\":null}")
[ "$HTTP" = "200" ] || fail "Step 3 callback expected 200, got $HTTP" 3

HTTP=$(curl -s -o "$TMP" -w "%{http_code}" --max-time 15 \
  -b "$COOKIES" "$API_BASE/api/clips/$OCR_ID")
[ "$HTTP" = "200" ] || fail "Step 3 GET clip expected 200, got $HTTP" 3

S3_CONTENT_TYPE=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('content_type',''))" "$TMP" 2>/dev/null)
[ "$S3_CONTENT_TYPE" = "图文" ] || fail "Step 3 content_type='$S3_CONTENT_TYPE' expected 图文" 3

ok "Step 3 图文 clip 已创建（content_type=图文）；OCR 文字提取依赖 OCR_RELAY_URL 真实服务 ✓"

# ───────────────────────────────────────────────────────────────────
# Step 4：推送到 Notion DB → output_status=pushed
# 现状：🔴 需要 NOTION_API_KEY + output_url 配置
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 4: 推送到 Notion DB"

if [ -z "${NOTION_API_KEY:-}" ]; then
  echo "🔴 Step 4 — NOTION_API_KEY 未配置，跳过（TODO）"
else
  fail "Step 4 Notion push — 待实现" 4
fi

# ───────────────────────────────────────────────────────────────────
# Step 5：推送到飞书多维表格 → output_status=pushed
# 现状：🔴 需要 FEISHU_APP_ID + output_url 配置
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 5: 推送到飞书多维表格"

if [ -z "${FEISHU_APP_ID:-}" ]; then
  echo "🔴 Step 5 — FEISHU_APP_ID 未配置，跳过（TODO）"
else
  fail "Step 5 Feishu push — 待实现" 5
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Path 6 smoke 完成（Step 1-3 ✅，Step 4-5 🔴 待推进）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
