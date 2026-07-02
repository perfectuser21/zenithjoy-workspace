#!/usr/bin/env bash
# Line02 获客工作台 IA 重设计（Track A）smoke
#
# 真链路：seed tenant + collect_task → agent report 上报视频+评论(落 acquisition_collect_videos +
#   acquisition_leads) → GET collect-tasks/:id/videos 拿到视频卡片 → GET videos/:videoId/leads
#   拿到该视频命中的评论 → IDOR 校验（跨 tenant 均 404）→ 非法 UUID 404。
# 依赖 env：API_BASE / DB / SMOKE_TOKEN
set -euo pipefail

[ -z "${API_BASE:-}" ]    && { echo "FAIL: API_BASE 未设置"; exit 99; }
[ -z "${DB:-}" ]          && { echo "FAIL: DB 未设置"; exit 99; }
[ -z "${SMOKE_TOKEN:-}" ] && { echo "FAIL: SMOKE_TOKEN 未设置"; exit 99; }

source "$(dirname "$0")/../../../../sprints/06181904-acquisition-feishu-doc-collect/tests/seed.sh"

echo "=== Step 1: seed tenant A + collect_task(running) ==="
SFX="${RANDOM}-${RANDOM}"
seed_acq "acq-ia-a-$SFX" 1
TENANT_A="$TENANT_ID"
seed_collect_task "$TENANT_A" running
TASK_A="$COLLECT_TASK_ID"

echo "=== Step 2: agent report 上报 1 个视频 + 1 条评论 → 落 acquisition_collect_videos ==="
R=$(curl -sf -X POST "$API_BASE/api/acquisition/collect/report" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_A\",\"keyword\":\"美甲\",\"video_id\":\"v-ia-smoke-$SFX\",\"commenters\":[{\"sec_uid\":\"MS4wIA1\",\"nickname\":\"美甲爱好者\",\"comment_text\":\"怎么预约\"}],\"terminal\":\"done\"}")
echo "$R" | jq -e '.data.inserted==1' >/dev/null \
  || { echo "FAIL Step2: report inserted!=1"; echo "$R"; exit 1; }

echo "=== Step 3: GET collect-tasks/:id/videos — 本 tenant 能看到视频卡片 ==="
R=$(curl -sf "$API_BASE/api/acquisition/collect-tasks/$TASK_A/videos" -H "X-Tenant-Id: $TENANT_A")
echo "$R" | jq -e --arg vid "v-ia-smoke-$SFX" \
  '.success==true and (.data.videos|length==1) and .data.videos[0].video_id==$vid and .data.videos[0].comment_count==1' >/dev/null \
  || { echo "FAIL Step3: videos 列表异常"; echo "$R"; exit 1; }

echo "=== Step 4: GET videos/:videoId/leads — 本 tenant 能看到评论 ==="
R=$(curl -sf "$API_BASE/api/acquisition/videos/v-ia-smoke-$SFX/leads" -H "X-Tenant-Id: $TENANT_A")
echo "$R" | jq -e '.success==true and (.data.leads|length==1) and .data.leads[0].commenter_id=="美甲爱好者" and .data.leads[0].comment_text=="怎么预约"' >/dev/null \
  || { echo "FAIL Step4: leads 列表异常"; echo "$R"; exit 1; }

echo "=== Step 5: IDOR — 另一个 tenant B 访问 tenant A 的任务/视频 → 均 404 ==="
seed_acq "acq-ia-b-$SFX" 1
TENANT_B="$TENANT_ID"
C=$(curl -s -o /tmp/acq-ia-idor-task.json -w "%{http_code}" "$API_BASE/api/acquisition/collect-tasks/$TASK_A/videos" -H "X-Tenant-Id: $TENANT_B")
[ "$C" = "404" ] || { echo "FAIL Step5: 跨 tenant 访问任务未 404 (http=$C)"; cat /tmp/acq-ia-idor-task.json; exit 1; }
C=$(curl -s -o /tmp/acq-ia-idor-video.json -w "%{http_code}" "$API_BASE/api/acquisition/videos/v-ia-smoke-$SFX/leads" -H "X-Tenant-Id: $TENANT_B")
[ "$C" = "404" ] || { echo "FAIL Step5: 跨 tenant 访问视频未 404 (http=$C)"; cat /tmp/acq-ia-idor-video.json; exit 1; }

echo "=== Step 6: 非法 UUID taskId → 404 ==="
C=$(curl -s -o /tmp/acq-ia-baduuid.json -w "%{http_code}" "$API_BASE/api/acquisition/collect-tasks/not-a-uuid/videos" -H "X-Tenant-Id: $TENANT_A")
[ "$C" = "404" ] || { echo "FAIL Step6: 非法 UUID 未 404 (http=$C)"; cat /tmp/acq-ia-baduuid.json; exit 1; }

echo "✅ acquisition-ia-redesign smoke PASS"
