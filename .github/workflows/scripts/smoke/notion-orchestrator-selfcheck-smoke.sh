#!/usr/bin/env bash
# 编排台同步器启动自检 smoke：CI 环境没有 NOTION_* env，
# 断言 API 进程照常活着（缺配置=红日志跳过启动，绝不 crash 拖垮整个中台）。
# 真正的 Notion 双向同步是环境接缝（真 Notion API），CI 测不到——
# 由 vitest（mock 契约 10 用例）+ 合并后 staging 真验兜住。
set -euo pipefail
API_BASE="${API_BASE:-http://localhost:5200}"
fail() { echo "❌ $*"; exit 1; }

echo "[1] 无 NOTION env 下 API 健康"
C=$(curl -s -o /dev/null -w '%{http_code}' "$API_BASE/api/health")
[ "$C" = "200" ] || fail "/api/health expected 200 got $C"

echo "[2] 派发路由仍在（worker 与 route 共用 service 未破坏 HTTP 面）"
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_BASE/api/contents/00000000-0000-4000-8000-000000000000/publish")
[ "$C" = "401" ] || fail "无凭据派发 expected 401 got $C"

echo "[3] contents 有 scheduled_at 列（定时发送 migration 生效；DB 访问照 my-works-api-smoke.sh 模式）"
if [ -z "${DATABASE_URL:-}" ] && [ -z "${PGHOST:-}" ]; then
  echo "SKIP: 找不到 DATABASE_URL/PGHOST——本环境没有可用 DB，跳过本关"
else
  PSQL=(psql -tA -v ON_ERROR_STOP=1)
  [ -n "${DATABASE_URL:-}" ] && PSQL=(psql -tA -v ON_ERROR_STOP=1 "$DATABASE_URL")
  COL=$("${PSQL[@]}" -c \
    "SELECT column_name FROM information_schema.columns \
      WHERE table_schema='zenithjoy' AND table_name='contents' AND column_name='scheduled_at'")
  [ "$COL" = "scheduled_at" ] || fail "contents.scheduled_at 列不存在——20260910_083000_contents_scheduled_at.sql 未生效"
fi

echo "✅ notion-orchestrator selfcheck smoke PASS"
