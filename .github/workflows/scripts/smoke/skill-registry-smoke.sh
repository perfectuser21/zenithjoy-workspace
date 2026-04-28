#!/usr/bin/env bash
# Skill Registry smoke test
# 验证 /api/skills 端点能正常返回技能列表
set -euo pipefail

BASE="${API_BASE:-http://localhost:5200}"

echo "=== Skill Registry Smoke Test ==="

# 1. skills 端点正常响应
echo "1. GET /api/skills..."
RESP=$(curl -sf "$BASE/api/skills")
echo "$RESP" | grep -q '"skills"' || { echo "FAIL: missing skills field"; exit 1; }
echo "   OK"

# 2. skills 是数组
COUNT=$(echo "$RESP" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); console.log(JSON.parse(d).skills.length)")
echo "2. skills 数量: $COUNT"
[ "$COUNT" -ge 0 ] || { echo "FAIL: skills count invalid"; exit 1; }
echo "   OK (count=$COUNT)"

# 3. 如果有 skills，检查结构
if [ "$COUNT" -gt 0 ]; then
  echo "3. 检查 skill 对象结构..."
  FIRST=$(echo "$RESP" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); console.log(JSON.stringify(JSON.parse(d).skills[0]))")
  echo "$FIRST" | grep -q '"slug"' || { echo "FAIL: missing slug"; exit 1; }
  echo "$FIRST" | grep -q '"platform"' || { echo "FAIL: missing platform"; exit 1; }
  echo "$FIRST" | grep -q '"name"' || { echo "FAIL: missing name"; exit 1; }
  echo "$FIRST" | grep -q '"agent_statuses"' || { echo "FAIL: missing agent_statuses"; exit 1; }
  echo "   OK"
fi

# 4. 当 DB 有数据时，验证种子数据
if [ "$COUNT" -gt 0 ]; then
  echo "4. 验证种子技能（kuaishou_image_publish）..."
  HAS=$(echo "$RESP" | node -e "
    const d=require('fs').readFileSync('/dev/stdin','utf8');
    const s=JSON.parse(d).skills;
    console.log(s.some(x => x.slug === 'kuaishou_image_publish') ? 'yes' : 'no');
  ")
  [ "$HAS" = "yes" ] || { echo "FAIL: seed skill kuaishou_image_publish not found"; exit 1; }
  echo "   OK"
fi

echo ""
echo "=== Skill Registry Smoke: ALL PASSED ==="
