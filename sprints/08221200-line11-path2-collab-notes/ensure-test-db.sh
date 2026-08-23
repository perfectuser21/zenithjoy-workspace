#!/usr/bin/env bash
# 路② 测试库前置（幂等）—— 清库 CI 与有历史的本地库都能跑绿
#
# 两件事，都不在本仓 zenithjoy migrations 里、但合同测试真需要：
#   ① better-auth 会话/用户表对齐到 zenithjoy schema。生产/本地即在此（connection.ts 注释：
#      user/session/account/verification 已挪到 zenithjoy schema，search_path=zenithjoy,public）。
#      但 run-migration.ts 的池不带 search_path，CREATE 落进了 public。清库 CI 于是把它们建在 public，
#      导致合同的 killSession（DELETE FROM zenithjoy.session）与本刀 sessionAlive 都打到不存在的表。
#      迁到 zenithjoy 后：better-auth 写读、killSession、sessionAlive 三者同用 zenithjoy.session，一致。
#   ② 路① cecelia 账本 public.learnings（属 cecelia repo，不在本仓 migrations）：套用路① fixture 建表，
#      A9 回归（POST /entries / GET /recent）才有处可写可读。
#
# 用法：bash ensure-test-db.sh [PG连接串]   （缺省取 E2E_DATABASE_URL / DATABASE_URL）
set -euo pipefail

PG="${1:-${E2E_DATABASE_URL:-${DATABASE_URL:-}}}"
if [ -z "$PG" ]; then
  echo "[ensure-test-db] 需要 PG 连接串（参数或 E2E_DATABASE_URL/DATABASE_URL）" >&2
  exit 2
fi
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# ① better-auth 表迁 zenithjoy schema（幂等：已在 zenithjoy 时 public.* 不存在，ALTER IF EXISTS 无操作）
psql "$PG" -v ON_ERROR_STOP=0 -q -c 'ALTER TABLE IF EXISTS public.session SET SCHEMA zenithjoy;' >/dev/null 2>&1 || true
psql "$PG" -v ON_ERROR_STOP=0 -q -c 'ALTER TABLE IF EXISTS public."user" SET SCHEMA zenithjoy;' >/dev/null 2>&1 || true

# ② public.learnings 账本（不在本仓 migrations，套用路① fixture 幂等建表）
if [ -z "$(psql "$PG" -tAc "SELECT to_regclass('public.learnings')" 2>/dev/null || true)" ]; then
  FIXTURE="$REPO_ROOT/sprints/08192114-员工知识中枢-路-经验沉淀与问答-ade79e4e/fixtures/learnings-ledger.sql"
  [ -f "$FIXTURE" ] && psql "$PG" -q -f "$FIXTURE" >/dev/null 2>&1 || true
fi

echo "[ensure-test-db] OK: zenithjoy.session=$(psql "$PG" -tAc "SELECT to_regclass('zenithjoy.session')" 2>/dev/null) learnings=$(psql "$PG" -tAc "SELECT to_regclass('public.learnings')" 2>/dev/null)"
