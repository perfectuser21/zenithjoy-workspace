#!/usr/bin/env bash
# cs-stats-service-smoke.sh — cs-stats.ts 服务层薄 smoke（PR #837 守卫）
#
# 覆盖 apps/api/src/services/wechat/cs-stats.ts：
#   computeCsStats 口径（received/reply/served/duration）+ /api/wechat/cs/stats 端点响应结构。
# 本 smoke 是快速冒烟；完整口径 oracle 在 cs-work-stats-smoke.sh。
#
# 前提：apps/api 起在 $API_BASE，$PGHOST/$PGUSER/$PGDATABASE/$PGPASSWORD 已配置。
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
PGHOST="${PGHOST:-localhost}"
PGUSER="${PGUSER:-cecelia}"
PGDATABASE="${PGDATABASE:-cecelia}"
export PGPASSWORD="${PGPASSWORD:-cecelia}"

Q() { psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -tAc "$1" | sed -n '1p'; }
SUF="$(date +%s)$$"
WX="csstats_svc_${SUF}"

echo "── cs-stats service smoke ──"

# 种一条 in + 一条 out → 预期 received=1 reply=1 served=1
Q "INSERT INTO zenithjoy.wechat_messages(contact_key,sender_name,direction,content,cs_wechat_id,created_at)
   VALUES
    ('svc_c1_${SUF}','客户','in','问','${WX}', now() - interval '2 minutes'),
    ('svc_c1_${SUF}','客户','out','答','${WX}', now() - interval '1 minute')" >/dev/null

R=$(curl -sf "$API_BASE/api/wechat/cs/stats?date=today")
echo "$R" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
if(!d.ok||!Array.isArray(d.stats)){process.stderr.write('FAIL: 响应结构非法\n');process.exit(1);}
console.log('PASS: /api/wechat/cs/stats 响应结构 ok，stats 行数=' + d.stats.length);
"

echo "✅ cs-stats-service smoke 通过"
