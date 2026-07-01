#!/usr/bin/env bash
# line02-stage2-collect-smoke.sh
# Path 2 Stage 2: 评论采集 terminal 语义 smoke
#
# 验证 resolveTerminalStatus 的两个关键分支：
#   terminal='stage_1'  → task status = stage_1_done
#   terminal='done'     → task status = done（真正完成，含 commenters 写入 acquisition_leads）
#
# 依赖: API_BASE / DB / SMOKE_TOKEN
set -uo pipefail

API_BASE="${API_BASE:-http://localhost:3001}"
DB="${DB:-}"
SMOKE_TOKEN="${SMOKE_TOKEN:-smoke-test-token}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit 1; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  line02 Stage 2 评论采集 terminal smoke"
echo "  API_BASE=$API_BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

TMP=$(mktemp)
TENANT="smoke-s2-$$"
TASK_ID="smoke-task-s2-$$"

# 建 tenant 和 running 采集任务（直接写 DB，跳过 feishu 绑定）
if [ -n "$DB" ]; then
  psql "$DB" -v tenant="$TENANT" -c "
    INSERT INTO zenithjoy.tenants(id,name,created_at,updated_at)
    VALUES(:'tenant','smoke-s2','now()','now()')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO zenithjoy.acquisition_tasks(id,tenant_id,status,keywords,started_at,created_at,updated_at)
    VALUES('$TASK_ID',:'tenant','running','{\"smoke\"}','now()','now()','now()')
    ON CONFLICT (id) DO NOTHING;
  " >/dev/null 2>&1 || true
fi

VIDEO_A="7111111111111111111"
VIDEO_B="7222222222222222222"

echo "--- Stage 1: 上报视频 URL（空 commenters），末条 terminal=stage_1 ---"
# 非末条：无 terminal
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" -X POST "$API_BASE/api/acquisition/collect/report" \
  -H "Content-Type: application/json" -H "X-Smoke-Token: $SMOKE_TOKEN" \
  -d "{\"task_id\":\"$TASK_ID\",\"keyword\":\"火锅\",\"video_id\":\"$VIDEO_A\",\"commenters\":[]}")
[ "$HTTP" = "200" ] || { cat "$TMP"; fail "Stage1 非末条 report 返回 $HTTP，期望 200"; }
ok "Stage1 非末条 report -> 200"

# 末条：terminal=stage_1
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" -X POST "$API_BASE/api/acquisition/collect/report" \
  -H "Content-Type: application/json" -H "X-Smoke-Token: $SMOKE_TOKEN" \
  -d "{\"task_id\":\"$TASK_ID\",\"keyword\":\"火锅\",\"video_id\":\"$VIDEO_B\",\"commenters\":[],\"terminal\":\"stage_1\"}")
[ "$HTTP" = "200" ] || { cat "$TMP"; fail "Stage1 末条 report 返回 $HTTP，期望 200"; }
ok "Stage1 末条 report (terminal=stage_1) -> 200"

# 检查任务状态 = stage_1_done
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" "$API_BASE/api/acquisition/collect/$TASK_ID")
[ "$HTTP" = "200" ] || { cat "$TMP"; fail "GET collect/$TASK_ID 返回 $HTTP"; }
STATUS=$(jq -r '.data.status // empty' "$TMP" 2>/dev/null)
[ "$STATUS" = "stage_1_done" ] || { cat "$TMP"; fail "terminal=stage_1 后 status=$STATUS，期望 stage_1_done"; }
ok "terminal=stage_1 → status=stage_1_done ✓"

echo "--- Stage 2: 上报评论者，末条 terminal=done ---"
# 非末条：有 commenters，无 terminal
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" -X POST "$API_BASE/api/acquisition/collect/report" \
  -H "Content-Type: application/json" -H "X-Smoke-Token: $SMOKE_TOKEN" \
  -d "{\"task_id\":\"$TASK_ID\",\"keyword\":\"火锅\",\"video_id\":\"$VIDEO_A\",\"commenters\":[{\"sec_uid\":\"MS4wABC\",\"nickname\":\"张三\"}]}")
[ "$HTTP" = "200" ] || { cat "$TMP"; fail "Stage2 非末条 report 返回 $HTTP"; }
ok "Stage2 非末条 report (有 commenters) -> 200"

# 末条：terminal=done
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" -X POST "$API_BASE/api/acquisition/collect/report" \
  -H "Content-Type: application/json" -H "X-Smoke-Token: $SMOKE_TOKEN" \
  -d "{\"task_id\":\"$TASK_ID\",\"keyword\":\"火锅\",\"video_id\":\"$VIDEO_B\",\"commenters\":[{\"sec_uid\":\"MS4wXYZ\",\"nickname\":\"李四\"}],\"terminal\":\"done\"}")
[ "$HTTP" = "200" ] || { cat "$TMP"; fail "Stage2 末条 report 返回 $HTTP"; }
ok "Stage2 末条 report (terminal=done) -> 200"

# 检查任务状态 = done
HTTP=$(curl -s -o "$TMP" -w "%{http_code}" "$API_BASE/api/acquisition/collect/$TASK_ID")
[ "$HTTP" = "200" ] || { cat "$TMP"; fail "GET collect/$TASK_ID 返回 $HTTP"; }
STATUS=$(jq -r '.data.status // empty' "$TMP" 2>/dev/null)
[ "$STATUS" = "done" ] || { cat "$TMP"; fail "terminal=done 后 status=$STATUS，期望 done"; }
ok "terminal=done → status=done ✓"

rm -f "$TMP"
echo ""
echo "✅ line02 Stage 2 collect smoke PASS"
