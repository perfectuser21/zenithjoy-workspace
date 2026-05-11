---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Workstream 2: publish_tasks status enum migration superset (Round 2 修)

**范围**：DROP 老 chk_publish_tasks_status + ADD 新 constraint 含 9 status (向后兼容老 row)
**大小**: S
**依赖**: 无（与 ws1/ws3 并行）

> **Round 2 修订要点**：所有 `psql -c` 内 PG 字符串字面量改单引号（`'string'`）；BEHAVIOR 命令调 helper script 避免三层引号嵌套地狱。helper script 由 generator 在 commit-2 同时创建：`apps/api/scripts/h1-ws2-helper.sh`。

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 文件 apps/api/db/migrations/ 含 publish_tasks_status_enum 关键字
  Test: bash -c 'ls apps/api/db/migrations/ | grep -E "publish_tasks_status_enum" | head -1'

- [ ] [ARTIFACT] 新 migration SQL 含 9 个 status 字面量（pending/running/success/failed/done/queued/dispatched/in_progress/completed）
  Test: bash -c 'F=$(ls apps/api/db/migrations/*publish_tasks_status_enum*.sql | head -1); for s in pending running success failed done queued dispatched in_progress completed; do grep -q "${s}" "$F" || { echo "missing $s"; exit 1; }; done; echo OK'

- [ ] [ARTIFACT] migration 含 DROP CONSTRAINT IF EXISTS chk_publish_tasks_status + ADD CONSTRAINT chk_publish_tasks_status
  Test: bash -c 'F=$(ls apps/api/db/migrations/*publish_tasks_status_enum*.sql | head -1); grep -q "DROP CONSTRAINT.*chk_publish_tasks_status" "$F" && grep -q "ADD CONSTRAINT chk_publish_tasks_status" "$F"'

- [ ] [ARTIFACT] migration filename 严按 sprint convention `20260511_HHMMSS_publish_tasks_status_enum*.sql`，且 >= 20260510 排序（防 R2）
  Test: bash -c 'F=$(ls apps/api/db/migrations/*publish_tasks_status_enum*.sql | head -1); B=$(basename "$F"); [[ "$B" =~ ^20260511_[0-9]{6}_publish_tasks_status_enum.*\.sql$ ]]'

- [ ] [ARTIFACT] migration SQL 含 deprecate COMMENT (canonical=completed/in_progress；deprecated=success/done/running)
  Test: bash -c 'F=$(ls apps/api/db/migrations/*publish_tasks_status_enum*.sql | head -1); grep -qi "canonical" "$F" && grep -qi "deprecat" "$F"'

- [ ] [ARTIFACT] helper script apps/api/scripts/h1-ws2-helper.sh 存在且 chmod +x
  Test: bash -c 'test -x apps/api/scripts/h1-ws2-helper.sh'

## BEHAVIOR 条目（manual:bash 真跑 migration 真验 INSERT — 通过 helper 命令避免三层引号地狱）

- [ ] [BEHAVIOR] migration 应用后 INSERT publish_tasks status='queued'/'dispatched'/'in_progress'/'completed' 全过 constraint
  Test: manual:bash -c 'apps/api/scripts/h1-ws2-helper.sh test_new_statuses'
  期望: helper 内部跑 4 个 INSERT 全返 UUID，exit 0

- [ ] [BEHAVIOR] migration 应用后 INSERT publish_tasks status='banana' 仍被 constraint 拒
  Test: manual:bash -c 'apps/api/scripts/h1-ws2-helper.sh test_invalid_status'
  期望: helper 内部 grep 命中 violates，exit 0

- [ ] [BEHAVIOR] migration 应用后 pg_constraint 元数据中 chk_publish_tasks_status 的 condef 同时含 9 个 status 字面量
  Test: manual:bash -c 'apps/api/scripts/h1-ws2-helper.sh verify_constraint_def'
  期望: 9 status 全在 condef 中，exit 0

- [ ] [BEHAVIOR] 老 status 'success'/'failed'/'pending'/'running'/'done' 仍可 INSERT（向后兼容 R1）
  Test: manual:bash -c 'apps/api/scripts/h1-ws2-helper.sh test_legacy_statuses'
  期望: 5 老 status 全 INSERT 过，exit 0

---

## helper script 期望内容（generator commit-2 必创建）

```bash
#!/usr/bin/env bash
# apps/api/scripts/h1-ws2-helper.sh — H-1 ws2 BEHAVIOR helper
# 调 PG 用单引号字符串 — 不嵌 manual:bash 多层 quote
set -euo pipefail
PSQL="psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -tA"
export PGPASSWORD="$DATABASE_PASSWORD"

case "${1:-}" in
  apply_migration)
    F=$(ls apps/api/db/migrations/*publish_tasks_status_enum*.sql | head -1)
    $PSQL -f "$F"
    ;;
  test_new_statuses)
    "$0" apply_migration >/dev/null 2>&1 || true
    TS=$(date +%s)
    AID=$($PSQL -c "INSERT INTO zenithjoy.agents (agent_id, capabilities, version, status) VALUES ('h1ws2-${TS}', ARRAY['douyin'], '0.1.0', 'online') RETURNING id")
    for st in queued dispatched in_progress completed; do
      R=$($PSQL -c "INSERT INTO zenithjoy.publish_tasks (agent_id, platform, status) VALUES ('${AID}', 'douyin', '${st}') RETURNING id" 2>&1)
      echo "$R" | grep -qE '^[0-9a-f-]{36}$' || { echo "FAIL $st: $R"; exit 1; }
    done
    echo OK
    ;;
  test_invalid_status)
    TS=$(date +%s)
    AID=$($PSQL -c "INSERT INTO zenithjoy.agents (agent_id, capabilities, version, status) VALUES ('h1ws2bad-${TS}', ARRAY['douyin'], '0.1.0', 'online') RETURNING id")
    R=$($PSQL -c "INSERT INTO zenithjoy.publish_tasks (agent_id, platform, status) VALUES ('${AID}', 'douyin', 'banana') RETURNING id" 2>&1 || true)
    echo "$R" | grep -qiE 'violates check constraint|chk_publish_tasks_status'
    ;;
  verify_constraint_def)
    CDEF=$($PSQL -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'chk_publish_tasks_status'")
    for s in pending running success failed done queued dispatched in_progress completed; do
      echo "$CDEF" | grep -q "'${s}'" || { echo "missing $s"; exit 1; }
    done
    echo OK
    ;;
  test_legacy_statuses)
    TS=$(date +%s)
    AID=$($PSQL -c "INSERT INTO zenithjoy.agents (agent_id, capabilities, version, status) VALUES ('h1ws2bc-${TS}', ARRAY['douyin'], '0.1.0', 'online') RETURNING id")
    for st in pending running success failed done; do
      R=$($PSQL -c "INSERT INTO zenithjoy.publish_tasks (agent_id, platform, status) VALUES ('${AID}', 'douyin', '${st}') RETURNING id" 2>&1)
      echo "$R" | grep -qE '^[0-9a-f-]{36}$' || { echo "FAIL $st: $R"; exit 1; }
    done
    echo OK
    ;;
  *)
    echo "Usage: $0 {apply_migration|test_new_statuses|test_invalid_status|verify_constraint_def|test_legacy_statuses}" >&2
    exit 2
    ;;
esac
```
