#!/usr/bin/env bash
# create-staging-db.sh — ZenithJoy staging建真正独立库
#
# 背景：staging后端(5201端口)目前DATABASE_NAME=zenithjoy_test借用测试库，
# 不是真正独立的staging库。本脚本新建zenithjoy_staging库，跑全量migration，
# 切换staging plist的DATABASE_NAME，重启验证health。
# 决策依据：decision d76d715b
#
# 用法：bash scripts/create-staging-db.sh
# 前提：本机可直连localhost postgres；本脚本依赖本机psql/createdb默认认证方式
# （.pgpass或本地peer/trust认证），不显式传密码。
#
# 若中途失败：迁移步骤本身幂等可安全重跑；plist改动前有自动回滚保护，
# 不会让staging长期停服。

set -euo pipefail

DB_NAME="zenithjoy_staging"
REF_DB="zenithjoy"
PLIST="$HOME/Library/LaunchAgents/com.zenithjoy.api.staging.plist"
PLIST_LABEL="com.zenithjoy.api.staging"
HEALTH_URL="http://localhost:5201/health"
API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/apps/api"

echo "=== Step 1: 建库 $DB_NAME（幂等） ==="
EXISTS=$(psql -h localhost -U cecelia -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME';" -d postgres | tr -d ' ')
if [ "$EXISTS" = "1" ]; then
  echo "  ℹ️  $DB_NAME 已存在，跳过建库"
else
  createdb -h localhost -U cecelia "$DB_NAME"
  echo "  ✅ 已建库 $DB_NAME"
fi

echo ""
echo "=== Step 2: 跑全量migration（显式传DATABASE_*，避免落到run-migration.ts默认值cecelia库） ==="
(
  cd "$API_DIR"
  DATABASE_HOST=localhost \
  DATABASE_PORT=5432 \
  DATABASE_NAME="$DB_NAME" \
  DATABASE_USER=cecelia \
  npm run migrate
)
echo "  ✅ migration执行完成"

echo ""
echo "=== Step 3: 校验migration行数与独立zenithjoy库一致 ==="
STAGING_COUNT=$(psql -h localhost -U cecelia -d "$DB_NAME" -tc "SELECT count(*) FROM zenithjoy.schema_migrations;" | tr -d ' ')
REF_COUNT=$(psql -h localhost -U cecelia -d "$REF_DB" -tc "SELECT count(*) FROM zenithjoy.schema_migrations;" | tr -d ' ')
if [ "$STAGING_COUNT" != "$REF_COUNT" ]; then
  echo "  ❌ migration行数不一致: ${DB_NAME}=${STAGING_COUNT} ${REF_DB}=${REF_COUNT}，中止（未改plist）"
  exit 1
fi
echo "  ✅ migration行数一致: ${STAGING_COUNT}"

echo ""
echo "=== Step 4: 备份当前staging plist ==="
BACKUP_PLIST="${PLIST}.bak.$(date +%s)"
cp "$PLIST" "$BACKUP_PLIST"
echo "  ✅ 备份到 ${BACKUP_PLIST}"

echo ""
echo "=== Step 5: 切换DATABASE_NAME ==="
plutil -replace EnvironmentVariables.DATABASE_NAME -string "$DB_NAME" "$PLIST"
echo "  ✅ DATABASE_NAME 已改为 $DB_NAME"

echo ""
echo "=== Step 6: 重启staging服务 ==="
launchctl unload "$PLIST" 2>/dev/null || true
sleep 1
launchctl load "$PLIST"
echo "  ✅ 服务已重启"

echo ""
echo "=== Step 7: health check 轮询 ==="
HEALTHY=false
for i in $(seq 1 12); do
  STATUS=$(curl -sf --connect-timeout 5 --max-time 10 "$HEALTH_URL" 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
  if [ "$STATUS" = "ok" ]; then
    HEALTHY=true
    break
  fi
  echo "  尝试 $i/12: status=${STATUS}，等待..."
  sleep 10
done

if [ "$HEALTHY" = "true" ]; then
  echo ""
  echo "✅ staging已切到独立库 ${DB_NAME}，health check通过"
  exit 0
else
  echo ""
  echo "❌ health check失败，自动回滚plist到迁移前状态"
  cp "$BACKUP_PLIST" "$PLIST"
  launchctl unload "$PLIST" 2>/dev/null || true
  sleep 1
  launchctl load "$PLIST"
  echo "  已回滚并重启，staging应恢复到旧库(zenithjoy_test)状态，请人工排查${DB_NAME}问题"
  exit 1
fi
