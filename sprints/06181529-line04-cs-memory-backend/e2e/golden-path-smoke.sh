#!/bin/bash
# final-e2e — Line04 对话记忆三层后端（target_environment=local_api）
# 起真 apps/api 服务（zenithjoy_test 库）→ HTTP 层端到端跑 Golden Path 六步 →
# curl|jq 验三层 schema + 隔离 + 缺 tenant 拒绝；psql 带 5 分钟时间窗断言落库。
# consolidate 阶段不依赖外网：无 OPENROUTER_API_KEY 时服务走确定性降级 summary（仍非空）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
API_DIR="$ROOT/apps/api"
PORT="${E2E_PORT:-3999}"
export DATABASE_NAME="${DATABASE_NAME:-zenithjoy_test}"
export DATABASE_HOST="${DATABASE_HOST:-localhost}"
export DATABASE_PORT="${DATABASE_PORT:-5432}"
export DATABASE_USER="${DATABASE_USER:-postgres}"
export DATABASE_PASSWORD="${DATABASE_PASSWORD:-postgres}"
export NODE_ENV=test
export PORT
PSQL="postgresql://${DATABASE_USER}:${DATABASE_PASSWORD}@${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_NAME}"
BASE="http://localhost:${PORT}"
A="tenantA_e2e_smoke"; B="tenantB_e2e_smoke"; C="wxid_smoke_c"
A_SECRET="A暗号_smoke"; B_SECRET="B暗号_smoke"

# 0) 确保库 + schema + 迁移（幂等）
psql "postgresql://${DATABASE_USER}:${DATABASE_PASSWORD}@${DATABASE_HOST}:${DATABASE_PORT}/postgres" \
  -tc "SELECT 1 FROM pg_database WHERE datname='${DATABASE_NAME}'" | grep -q 1 \
  || psql "postgresql://${DATABASE_USER}:${DATABASE_PASSWORD}@${DATABASE_HOST}:${DATABASE_PORT}/postgres" \
       -c "CREATE DATABASE \"${DATABASE_NAME}\""
psql "$PSQL" -c "CREATE SCHEMA IF NOT EXISTS zenithjoy; CREATE EXTENSION IF NOT EXISTS pgcrypto;"
MIG=$(ls "$API_DIR"/db/migrations/*cs_memory*.sql "$API_DIR"/db/migrations/*tenant_memory*.sql 2>/dev/null | head -1)
[ -n "$MIG" ] || { echo "FAIL: 找不到三层记忆 migration"; exit 1; }
psql "$PSQL" -f "$MIG"

# 1) 起服务
( cd "$API_DIR" && npm run dev >/tmp/line04-mem-e2e.log 2>&1 ) &
SVPID=$!
cleanup() {
  kill "$SVPID" 2>/dev/null || true
  for t in "$A" "$B"; do
    psql "$PSQL" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE tenant_id='$t'" >/dev/null 2>&1 || true
    psql "$PSQL" -c "DELETE FROM zenithjoy.cs_memory_daily    WHERE tenant_id='$t'" >/dev/null 2>&1 || true
    psql "$PSQL" -c "DELETE FROM zenithjoy.cs_memory_longterm WHERE tenant_id='$t'" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

for i in $(seq 1 30); do
  curl -sf "$BASE/health" >/dev/null 2>&1 && break
  [ "$i" = "30" ] && { echo "FAIL: 服务 30s 未就绪"; cat /tmp/line04-mem-e2e.log; exit 1; }
  sleep 1
done

H='-H Content-Type:application/json'

# 2) Step1 写消息（A 两条含暗号，B 一条不同暗号）
curl -sf $H -H "X-Tenant-Id: $A" -d "{\"contact\":\"$C\",\"role\":\"in\",\"text\":\"$A_SECRET\"}" \
  "$BASE/api/wechat/memory/message" | jq -e '.ok == true and (.message_id|type=="number")' >/dev/null \
  || { echo "FAIL: Step1 写消息(A)"; exit 1; }
curl -sf $H -H "X-Tenant-Id: $A" -d "{\"contact\":\"$C\",\"role\":\"in\",\"text\":\"最近一句原文\"}" \
  "$BASE/api/wechat/memory/message" >/dev/null
curl -sf $H -H "X-Tenant-Id: $B" -d "{\"contact\":\"$C\",\"role\":\"in\",\"text\":\"$B_SECRET\"}" \
  "$BASE/api/wechat/memory/message" >/dev/null

# 3) Step2/3 收尾
curl -sf $H -H "X-Tenant-Id: $A" -d "{\"contact\":\"$C\"}" \
  "$BASE/api/wechat/memory/consolidate" | jq -e '.daily_generated == true' >/dev/null \
  || { echo "FAIL: Step2 日收尾(A)"; exit 1; }
curl -sf $H -H "X-Tenant-Id: $B" -d "{\"contact\":\"$C\"}" "$BASE/api/wechat/memory/consolidate" >/dev/null

# 4) Step4 取上下文：三层 keys 完整 + 禁用字段反向
CTX_A=$(curl -sf -H "X-Tenant-Id: $A" "$BASE/api/wechat/memory/context?contact=$C")
echo "$CTX_A" | jq -e '.context | keys == ["longterm","mid","short"]' >/dev/null \
  || { echo "FAIL: Step4 context keys 不完整: $CTX_A"; exit 1; }
echo "$CTX_A" | jq -e '.context | (has("long_term") or has("short_term") or has("history") or has("messages")) | not' >/dev/null \
  || { echo "FAIL: Step4 出现禁用字段"; exit 1; }
echo "$CTX_A" | jq -e --arg s "$A_SECRET" '.assembled | contains($s)' >/dev/null \
  || { echo "FAIL: Step4 assembled 缺 A 内容"; exit 1; }

# 5) Step5 隔离：A 上下文不含 B 暗号，B 上下文不含 A 暗号
echo "$CTX_A" | jq -e --arg s "$B_SECRET" '.assembled | contains($s) | not' >/dev/null \
  || { echo "FAIL: Step5 A 上下文泄漏 B 内容"; exit 1; }
CTX_B=$(curl -sf -H "X-Tenant-Id: $B" "$BASE/api/wechat/memory/context?contact=$C")
echo "$CTX_B" | jq -e --arg s "$A_SECRET" '.assembled | contains($s) | not' >/dev/null \
  || { echo "FAIL: Step5 B 上下文泄漏 A 内容"; exit 1; }

# 6) Step6 缺 tenant_id → 400 MISSING_TENANT（写/查/收尾）
for EP in "POST /api/wechat/memory/message" "POST /api/wechat/memory/consolidate" "GET /api/wechat/memory/context?contact=$C"; do
  M=${EP%% *}; P=${EP#* }
  if [ "$M" = "GET" ]; then
    CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$P")
  else
    CODE=$(curl -s -o /dev/null -w "%{http_code}" $H -d "{\"contact\":\"$C\",\"role\":\"in\",\"text\":\"x\"}" "$BASE$P")
  fi
  [ "$CODE" = "400" ] || { echo "FAIL: Step6 $EP 缺 tenant 未拒绝 code=$CODE"; exit 1; }
done

# 7) psql 时间窗断言落库（防历史数据冒充）
MC=$(psql "$PSQL" -t -c "SELECT count(*) FROM zenithjoy.cs_memory_messages WHERE tenant_id='$A' AND contact='$C' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$MC" -ge 2 ] || { echo "FAIL: 短期落库时间窗内 count=$MC < 2"; exit 1; }
DC=$(psql "$PSQL" -t -c "SELECT count(*) FROM zenithjoy.cs_memory_daily WHERE tenant_id='$A' AND contact='$C' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$DC" -ge 1 ] || { echo "FAIL: 中期落库时间窗内 count=$DC < 1"; exit 1; }
LEAK=$(psql "$PSQL" -t -c "SELECT count(*) FROM zenithjoy.cs_memory_messages WHERE tenant_id='$B' AND text LIKE '%$A_SECRET%'" | tr -d ' ')
[ "$LEAK" = "0" ] || { echo "FAIL: DB 层跨租户泄漏 count=$LEAK"; exit 1; }

echo "✅ Golden Path 验证通过"
