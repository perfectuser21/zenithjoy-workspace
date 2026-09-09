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

echo "✅ notion-orchestrator selfcheck smoke PASS"
