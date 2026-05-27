contract_branch: cp-05280756-ws-70ac50db-ws1
workstream_index: 1
sprint_dir: sprints/line00-session-health-medium

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: DB Migration — operator_sessions 表

**范围**: 新建 `db/migrations/20260527_operator_sessions.sql`，创建 `operator_sessions` 表，含 platform/secret_name/status/last_checked_at/last_valid_at 字段，status CHECK 约束 (active/expired/missing)
**大小**: S（~55 行净增，1 文件）
**依赖**: 无（串行链起点）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 文件存在于 `db/migrations/`，含 `operator_sessions` 关键字
  Test: bash -c 'F=$(ls db/migrations/ 2>/dev/null | grep -E "operator_sessions" | grep "\.sql$" | sort | tail -1); [ -n "$F" ] || { echo "FAIL: migration 文件未找到"; exit 1; }; grep -q "operator_sessions" "db/migrations/$F" || { echo "FAIL: 文件缺 operator_sessions"; exit 1; }; echo OK'

- [ ] [ARTIFACT] migration SQL 含 `secret_name` 字段定义（非 secret_key/token_name）
  Test: bash -c 'F=$(ls db/migrations/ 2>/dev/null | grep "operator_sessions" | grep "\.sql$" | sort | tail -1); grep -q "secret_name" "db/migrations/$F" || { echo "FAIL: 缺 secret_name 字段"; exit 1; }; echo OK'

- [ ] [ARTIFACT] migration SQL 含 `last_checked_at` 和 `last_valid_at` 字段（驱动 GET sessions response）
  Test: bash -c 'F=$(ls db/migrations/ 2>/dev/null | grep "operator_sessions" | grep "\.sql$" | sort | tail -1); grep -q "last_checked_at" "db/migrations/$F" && grep -q "last_valid_at" "db/migrations/$F" || { echo "FAIL: 缺时间戳字段"; exit 1; }; echo OK'

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] operator_sessions 表在 DB 中已存在（psql runtime oracle）
  Test: manual:bash -c 'COUNT=$(psql "${DB_URL:-postgresql://postgres:postgres@localhost/cecelia}" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_name='"'"'operator_sessions'"'"'" 2>/dev/null | tr -d " \n"); [ "$COUNT" = "1" ] || { echo "FAIL: operator_sessions 表不存在 count=$COUNT"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] operator_sessions 表含 5 核心字段（platform/secret_name/status/last_checked_at/last_valid_at）
  Test: manual:bash -c 'COUNT=$(psql "${DB_URL:-postgresql://postgres:postgres@localhost/cecelia}" -t -c "SELECT count(*) FROM information_schema.columns WHERE table_name='"'"'operator_sessions'"'"' AND column_name IN ('"'"'platform'"'"','"'"'secret_name'"'"','"'"'status'"'"','"'"'last_checked_at'"'"','"'"'last_valid_at'"'"')" 2>/dev/null | tr -d " \n"); [ "$COUNT" = "5" ] || { echo "FAIL: 字段数=$COUNT 期望 5"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] status CHECK 约束仅允许 active/expired/missing（禁止 ok/healthy/valid 写入）
  Test: manual:bash -c 'psql "${DB_URL:-postgresql://postgres:postgres@localhost/cecelia}" -c "INSERT INTO operator_sessions (platform, secret_name, status) VALUES ('"'"'test-platform-check'"'"', '"'"'TEST_COOKIES'"'"', '"'"'ok'"'"')" 2>&1 | grep -q "violates check constraint\|CHECK\|check_oper\|check" || { echo "FAIL: ok 值被接受，CHECK 约束未生效"; exit 1; }; psql "${DB_URL:-postgresql://postgres:postgres@localhost/cecelia}" -c "DELETE FROM operator_sessions WHERE platform='"'"'test-platform-check'"'"'" 2>/dev/null; echo OK'
  期望: OK

- [ ] [BEHAVIOR] status = active 可正常写入（CHECK 约束允许合法值）
  Test: manual:bash -c 'TS=$(date +%s); psql "${DB_URL:-postgresql://postgres:postgres@localhost/cecelia}" -c "INSERT INTO operator_sessions (platform, secret_name, status) VALUES ('"'"'test-active-'"'"'$TS'"'"', '"'"'TEST_COOKIES'"'"', '"'"'active'"'"') ON CONFLICT (platform) DO UPDATE SET status='"'"'active'"'"'" 2>&1 | grep -qv "ERROR" || { echo "FAIL: active 写入报错"; exit 1; }; COUNT=$(psql "${DB_URL:-postgresql://postgres:postgres@localhost/cecelia}" -t -c "SELECT count(*) FROM operator_sessions WHERE platform='"'"'test-active-$TS'"'"' AND status='"'"'active'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " \n"); [ "$COUNT" = "1" ] || { echo "FAIL: active 写入后查不到"; exit 1; }; psql "${DB_URL:-postgresql://postgres:postgres@localhost/cecelia}" -c "DELETE FROM operator_sessions WHERE platform='"'"'test-active-$TS'"'"'" 2>/dev/null; echo OK'
  期望: OK

- [ ] [BEHAVIOR] migration SQL 禁用字段反向 — 不含 status 值 ok/healthy/valid（CHECK 约束不允许这些值）
  Test: manual:bash -c 'F=$(ls db/migrations/ 2>/dev/null | grep "operator_sessions" | grep "\.sql$" | sort | tail -1); grep -qE "CHECK.*ok[^a-z]|CHECK.*healthy|CHECK.*valid\b" "db/migrations/$F" && { echo "FAIL: migration status CHECK 约束含禁用值 ok/healthy/valid"; exit 1; } || echo OK'
  期望: OK
