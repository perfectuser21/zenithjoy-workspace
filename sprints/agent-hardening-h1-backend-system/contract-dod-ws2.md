---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Workstream 2: publish_tasks status enum migration superset

**范围**：DROP 老 chk_publish_tasks_status + ADD 新 constraint 含 9 status (向后兼容老 row)
**大小**: S
**依赖**: 无（与 ws1/ws3 并行）

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 文件 apps/api/db/migrations/ 含 publish_tasks_status_enum 关键字
  Test: bash -c 'ls apps/api/db/migrations/ | grep -E "publish_tasks_status_enum" | head -1'

- [ ] [ARTIFACT] 新 migration SQL 含 9 个 status 字面量（pending/running/success/failed/done/queued/dispatched/in_progress/completed）
  Test: bash -c 'F=$(ls apps/api/db/migrations/*publish_tasks_status_enum*.sql | head -1); for s in pending running success failed done queued dispatched in_progress completed; do grep -q "${s}" "$F" || { echo "missing $s"; exit 1; }; done; echo OK'

- [ ] [ARTIFACT] migration 含 DROP CONSTRAINT IF EXISTS chk_publish_tasks_status + ADD CONSTRAINT chk_publish_tasks_status
  Test: bash -c 'F=$(ls apps/api/db/migrations/*publish_tasks_status_enum*.sql | head -1); grep -q "DROP CONSTRAINT.*chk_publish_tasks_status" "$F" && grep -q "ADD CONSTRAINT chk_publish_tasks_status" "$F"'

## BEHAVIOR 条目（manual:bash 真跑 migration 真验 INSERT）

- [ ] [BEHAVIOR] migration 应用后 INSERT publish_tasks status='queued' / 'dispatched' / 'in_progress' / 'completed' 全过 constraint
  Test: manual:bash -c 'cd apps/api && PGPASSWORD=$DATABASE_PASSWORD psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -f $(ls db/migrations/*publish_tasks_status_enum*.sql | head -1) 2>&1 | tail -3; AID=$(PGPASSWORD=$DATABASE_PASSWORD psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -tA -c "INSERT INTO zenithjoy.agents (agent_id, capabilities, version, status) VALUES (\"h1ws2-$(date +%s)\", ARRAY[\"douyin\"], \"0.1.0\", \"online\") RETURNING id"); ALL_OK=1; for st in queued dispatched in_progress completed; do R=$(PGPASSWORD=$DATABASE_PASSWORD psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -tA -c "INSERT INTO zenithjoy.publish_tasks (agent_id, platform, status) VALUES (\"$AID\", \"douyin\", \"$st\") RETURNING id" 2>&1); echo "$R" | grep -qE "^[0-9a-f-]{36}$" || { echo "FAIL status=$st: $R"; ALL_OK=0; }; done; [ "$ALL_OK" = "1" ]'
  期望: 4 个 INSERT 全返 UUID，exit 0

- [ ] [BEHAVIOR] migration 应用后 INSERT publish_tasks status='banana' 仍被 constraint 拒
  Test: manual:bash -c 'AID=$(PGPASSWORD=$DATABASE_PASSWORD psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -tA -c "INSERT INTO zenithjoy.agents (agent_id, capabilities, version, status) VALUES (\"h1ws2bad-$(date +%s)\", ARRAY[\"douyin\"], \"0.1.0\", \"online\") RETURNING id"); R=$(PGPASSWORD=$DATABASE_PASSWORD psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -tA -c "INSERT INTO zenithjoy.publish_tasks (agent_id, platform, status) VALUES (\"$AID\", \"douyin\", \"banana\") RETURNING id" 2>&1 || true); echo "$R" | grep -qiE "violates check constraint|chk_publish_tasks_status"'
  期望: grep 命中 violates，exit 0

- [ ] [BEHAVIOR] migration 应用后 pg_constraint 元数据中 chk_publish_tasks_status 的 condef 同时含 9 个 status 字面量
  Test: manual:bash -c 'CDEF=$(PGPASSWORD=$DATABASE_PASSWORD psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -tA -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname=\"chk_publish_tasks_status\""); ALL_OK=1; for s in pending running success failed done queued dispatched in_progress completed; do echo "$CDEF" | grep -q "\"$s\"\\|'\\''$s'\\''" || { echo "missing $s in: $CDEF"; ALL_OK=0; }; done; [ "$ALL_OK" = "1" ]'
  期望: 9 status 全在 condef 中，exit 0

- [ ] [BEHAVIOR] 老 status 'success'/'failed'/'pending'/'running'/'done' 仍可 INSERT（向后兼容）
  Test: manual:bash -c 'AID=$(PGPASSWORD=$DATABASE_PASSWORD psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -tA -c "INSERT INTO zenithjoy.agents (agent_id, capabilities, version, status) VALUES (\"h1ws2bc-$(date +%s)\", ARRAY[\"douyin\"], \"0.1.0\", \"online\") RETURNING id"); ALL_OK=1; for st in pending running success failed done; do R=$(PGPASSWORD=$DATABASE_PASSWORD psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME -tA -c "INSERT INTO zenithjoy.publish_tasks (agent_id, platform, status) VALUES (\"$AID\", \"douyin\", \"$st\") RETURNING id" 2>&1); echo "$R" | grep -qE "^[0-9a-f-]{36}$" || ALL_OK=0; done; [ "$ALL_OK" = "1" ]'
  期望: 5 老 status 全 INSERT 过，exit 0
