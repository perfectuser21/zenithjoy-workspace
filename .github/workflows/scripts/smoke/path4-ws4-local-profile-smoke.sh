#!/usr/bin/env bash
# Path 4 ws4-local-profile — 营销画像本地 CRUD + 朋友圈审核台本地化 smoke
#
# 验证（decision 19e6480c）：
#   1) wechat.ts GET /marketing-profile 路由存在
#   2) wechat.ts POST /marketing-profile (upsert) 路由存在
#   3) wechat.ts GET /moment-drafts 审核台列表路由存在
#   4) wechat.ts POST /moment-drafts/:taskId/approve + reject 路由存在
#   5) MomentDraftReviewPage.tsx 审核台页面组件存在
#   6) dashboard navigation 注册 /wechat/moment-drafts 路由
#   7) env-registry.ts 不再包含 FEISHU_PROFILE_TABLE_ID / FEISHU_SCHEDULE_TABLE_ID
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

ROUTE_FILE=apps/api/src/routes/wechat.ts
DASHBOARD_PAGE=apps/dashboard/src/pages/MomentDraftReviewPage.tsx
NAV_FILE=apps/dashboard/src/config/navigation.config.ts
ENV_REG=apps/api/src/env-registry.ts

echo "=== path4-ws4-local-profile-smoke 静态校验 ==="

# 1) GET /marketing-profile
grep -q "marketing-profile" "$ROUTE_FILE" \
  || { echo "FAIL: wechat.ts 缺 /marketing-profile 路由"; exit 1; }
echo "  PASS GET /marketing-profile 路由存在"

# 2) POST /marketing-profile upsert
grep -q "ON CONFLICT" "$ROUTE_FILE" \
  || { echo "FAIL: wechat.ts marketing-profile 缺 UPSERT ON CONFLICT"; exit 1; }
echo "  PASS POST /marketing-profile upsert 逻辑存在"

# 3) GET /moment-drafts
grep -q "moment-drafts" "$ROUTE_FILE" \
  || { echo "FAIL: wechat.ts 缺 /moment-drafts 路由"; exit 1; }
echo "  PASS GET /moment-drafts 路由存在"

# 4) approve + reject endpoints
grep -q "approve" "$ROUTE_FILE" && grep -q "reject" "$ROUTE_FILE" \
  || { echo "FAIL: wechat.ts 缺 approve 或 reject 端点"; exit 1; }
echo "  PASS approve/reject 端点存在"

# 5) Dashboard 页面组件
[ -f "$DASHBOARD_PAGE" ] \
  || { echo "FAIL: MomentDraftReviewPage.tsx 不存在"; exit 1; }
grep -q "handleApprove\|handleReject" "$DASHBOARD_PAGE" \
  || { echo "FAIL: MomentDraftReviewPage.tsx 缺审批逻辑"; exit 1; }
echo "  PASS MomentDraftReviewPage.tsx 存在且含审批逻辑"

# 6) Dashboard 导航注册
grep -q "moment-drafts" "$NAV_FILE" \
  || { echo "FAIL: navigation.config.ts 未注册 /wechat/moment-drafts"; exit 1; }
echo "  PASS /wechat/moment-drafts 已注册到 navigation"

# 7) env-registry 去飞书字段（排除注释行）
if grep -v "^[[:space:]]*//" "$ENV_REG" | grep -qE "FEISHU_PROFILE_TABLE_ID|FEISHU_SCHEDULE_TABLE_ID"; then
  echo "FAIL: env-registry.ts 仍含已删飞书表 ID 字段（非注释）"; exit 1
fi
echo "  PASS env-registry 已删除 FEISHU_PROFILE_TABLE_ID / FEISHU_SCHEDULE_TABLE_ID"

echo "path4-ws4-local-profile-smoke: STATIC OK"
