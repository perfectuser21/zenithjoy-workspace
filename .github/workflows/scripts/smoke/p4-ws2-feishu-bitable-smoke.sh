#!/usr/bin/env bash
# p4-ws2-feishu-bitable-smoke.sh
#
# Path 4 WS2 smoke: 飞书 Bitable 审批表 + draft-submit 路由
# Step 2: 微信发布任务 → 飞书 Bitable 审批表单向推送

set -euo pipefail

API="${ZJ_API:-http://localhost:5200}"
DB="${DATABASE_NAME:-cecelia}"
DBUSER="${DATABASE_USER:-postgres}"
PASS=0
FAIL=0

assert() {
  if [ "$1" = "$2" ]; then echo "  PASS: $3"; PASS=$((PASS+1));
  else echo "  FAIL: $3 (expected '$2', got '$1')"; FAIL=$((FAIL+1)); fi
}

echo "=== WS2 Step 1: DB 列 — table_id_wechat_approval + feishu_record_id ==="
HAS_TWA=$(psql -U "$DBUSER" -d "$DB" -tA \
  -c "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='tenant_feishu_bindings' AND column_name='table_id_wechat_approval')" 2>/dev/null || echo "f")
assert "$HAS_TWA" "t" "tenant_feishu_bindings.table_id_wechat_approval 列存在"

HAS_FRI=$(psql -U "$DBUSER" -d "$DB" -tA \
  -c "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='wechat_publish_task' AND column_name='feishu_record_id')" 2>/dev/null || echo "f")
assert "$HAS_FRI" "t" "wechat_publish_task.feishu_record_id 列存在"

echo ""
echo "=== WS2 Step 2: draft-submit（已删除，2026-06-30 去飞书重构由 draft-generate 取代，语义不同不可 1:1 替换）==="
echo "  SKIP: /api/wechat/draft-submit 路由已随飞书审批链路整条删除（见 wechat.ts 头注释），此检查随之移除"

echo ""
echo "Smoke PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
