#!/usr/bin/env bash
# 路② 协同笔记 DoD 供给脚本 —— 只负责用 vitest.collab-notes.config.ts 跑对应合同测试文件。
# 判据 = vitest exit code（判定归 DoD.md，供给归本脚本，沿用路③ 范式）。
#
# 用法：bash sprints/08221200-line11-path2-collab-notes/dod-run.sh <a1|a2|a4|ws|a9|all>
# 环境：需 E2E_DATABASE_URL（或 DATABASE_URL），指向含 zenithjoy schema 的库；未设即退出，不落缺省库。
set -euo pipefail

SUITE="${1:-all}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PG="${E2E_DATABASE_URL:-${DATABASE_URL:-}}"
if [ -z "$PG" ]; then
  echo "[dod-run] 需要 E2E_DATABASE_URL / DATABASE_URL（指向含 zenithjoy schema 的库）" >&2
  exit 2
fi
export E2E_DATABASE_URL="$PG"
export DATABASE_URL="$PG"

# 测试库前置（幂等）：better-auth 会话表对齐 zenithjoy schema + 路① learnings 账本，
# 让清库 CI/evaluator 与有历史的本地库都跑绿（详见 ensure-test-db.sh）。
bash "$SCRIPT_DIR/ensure-test-db.sh" "$PG" || true

case "$SUITE" in
  a1) FILE="cross-tenant-isolation.test.ts" ;;
  a2) FILE="documents-crud-xss.test.ts" ;;
  a4) FILE="permissions.test.ts" ;;
  ws) FILE="collab-ws.test.ts" ;;
  a9) FILE="route1-regression.test.ts" ;;
  all) FILE="" ;;
  *) echo "[dod-run] 未知 suite: $SUITE（可选 a1/a2/a4/ws/a9/all）" >&2; exit 2 ;;
esac

cd "$REPO_ROOT/apps/api"
if [ -z "$FILE" ]; then
  exec npx vitest run --config vitest.collab-notes.config.ts
else
  exec npx vitest run --config vitest.collab-notes.config.ts \
    "../../sprints/08221200-line11-path2-collab-notes/tests/$FILE"
fi
