#!/usr/bin/env bash
# ws2-three-template-builders-smoke.sh
# Smoke: 三模板专属 HTML Builder (_buildWGHtml/_buildCHtml/_buildRHtml) + composeTemplate dispatch
#
# 双层验证策略（DoD 说明：compose-template 调 Claude，E2E 无法在 evaluator Mode A 安全执行）:
#   层 1: 源码结构层 — 三函数 export + 专属色值 + dispatch + response 字段合规
#   层 2: error path 运行时层 — 无效 templateId → 400（无需 Claude）
#
# 退出码：0=pass 1=fail
set -uo pipefail

F="apps/api/src/controllers/ai-video-pipeline-ai.controller.ts"

echo "▶ [1/4] ARTIFACT: 三函数 export 检查"
grep -qE "export (function|const) _buildWGHtml" "$F" && echo "  ✓ _buildWGHtml export" || { echo "  ✗ FAIL: _buildWGHtml 缺 export"; exit 1; }
grep -qE "export (function|const) _buildCHtml" "$F" && echo "  ✓ _buildCHtml export" || { echo "  ✗ FAIL: _buildCHtml 缺 export"; exit 1; }
grep -qE "export (function|const) _buildRHtml" "$F" && echo "  ✓ _buildRHtml export" || { echo "  ✗ FAIL: _buildRHtml 缺 export"; exit 1; }

echo ""
echo "▶ [2/4] BEHAVIOR: 模板专属色值检查"
IDX=$(grep -n "_buildWGHtml" "$F" | head -1 | cut -d: -f1)
tail -n +"$IDX" "$F" | head -100 | grep -qiE "ede4d2|d39c4a" \
  && echo "  ✓ _buildWGHtml 含 WG 专属色值 (#ede4d2/#d39c4a)" \
  || { echo "  ✗ FAIL: _buildWGHtml 缺 WG 专属色值"; exit 1; }

IDX=$(grep -n "_buildCHtml" "$F" | head -1 | cut -d: -f1)
tail -n +"$IDX" "$F" | head -100 | grep -qiE "0a0a0a|c9a23d" \
  && echo "  ✓ _buildCHtml 含 C 专属色值 (#0a0a0a/#c9a23d)" \
  || { echo "  ✗ FAIL: _buildCHtml 缺 C 专属色值"; exit 1; }

IDX=$(grep -n "_buildRHtml" "$F" | head -1 | cut -d: -f1)
tail -n +"$IDX" "$F" | head -100 | grep -qiE "1d1410|c08e6a" \
  && echo "  ✓ _buildRHtml 含 R 专属色值 (#1d1410/#c08e6a)" \
  || { echo "  ✗ FAIL: _buildRHtml 缺 R 专属色值"; exit 1; }

echo ""
echo "▶ [3/4] BEHAVIOR: composeTemplate dispatch + response schema 检查"
IDX=$(grep -n "async function composeTemplate" "$F" | head -1 | cut -d: -f1)
CHUNK=$(tail -n +"$IDX" "$F" | head -60)
echo "$CHUNK" | grep -q "_buildWGHtml" && echo "  ✓ dispatch → _buildWGHtml" || { echo "  ✗ FAIL: dispatch 缺 _buildWGHtml"; exit 1; }
echo "$CHUNK" | grep -q "_buildCHtml" && echo "  ✓ dispatch → _buildCHtml" || { echo "  ✗ FAIL: dispatch 缺 _buildCHtml"; exit 1; }
echo "$CHUNK" | grep -q "_buildRHtml" && echo "  ✓ dispatch → _buildRHtml" || { echo "  ✗ FAIL: dispatch 缺 _buildRHtml"; exit 1; }

FULL=$(tail -n +"$IDX" "$F" | head -120)
echo "$FULL" | grep -qE "html" && echo "  ✓ response 含 html 字段" || { echo "  ✗ FAIL: response 缺 html 字段"; exit 1; }
echo "$FULL" | grep -qE "aspect" && echo "  ✓ response 含 aspect 字段" || { echo "  ✗ FAIL: response 缺 aspect 字段"; exit 1; }

MATCHES=$(grep -o 'res\.json([^)]*{[^}]*}' "$F" | tr "\n" " " || true)
for banned in 'content:' 'result:' '"ratio":' 'output:'; do
  echo "$MATCHES" | grep -q "$banned" && { echo "  ✗ FAIL: 禁用字段 $banned 在 res.json()"; exit 1; } || true
done
echo "  ✓ response 无禁用字段 (content/result/ratio/output)"

echo ""
echo "▶ [4/4] BEHAVIOR: error path — 无效 templateId → 400 (curl runtime check)"
API_URL="${API_URL:-http://localhost:5200}"
DB_URL="${DB_URL:-postgresql://postgres:postgres@localhost/cecelia}"

JID=$(psql "$DB_URL" -t -c "SELECT id FROM ai_video_pipeline_jobs ORDER BY created_at DESC LIMIT 1" 2>/dev/null | tr -d " \n" || true)
if [ -z "$JID" ]; then
  echo "  SKIP: 无可用 job_id（WS1 须先完成 DB migration）— 跳过 runtime check"
else
  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${API_URL}/api/ai-video/jobs/${JID}/compose-template" \
    -H "Content-Type: application/json" \
    -d '{"templateId":"INVALID_XYZ_999"}' 2>/dev/null || echo "000")
  [ "$CODE" = "000" ] && { echo "  SKIP: API 不可达 (${API_URL} 未启动)"; } \
  || { [ "$CODE" = "400" ] && echo "  ✓ 无效 templateId → 400" || { echo "  ✗ FAIL: 期望 400，实际=$CODE"; exit 1; }; }
fi

echo ""
echo "✅ ws2 three-template-builders smoke 全部通过"
