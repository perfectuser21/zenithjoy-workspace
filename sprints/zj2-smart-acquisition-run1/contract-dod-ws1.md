---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: DB Migration — acquisition_keyword_tasks + acquisition_videos 表

**范围**: 创建 `zenithjoy.acquisition_keyword_tasks` 和 `zenithjoy.acquisition_videos` 两张新表
**大小**: S（< 100 行，1 文件）
**依赖**: 无（depends_on: []）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] 迁移文件存在 `apps/api/db/migrations/20260524_100000_acquisition_tables.sql`
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('apps/api/db/migrations/20260524_100000_acquisition_tables.sql','utf8');if(!c.includes('acquisition_keyword_tasks'))process.exit(1);if(!c.includes('acquisition_videos'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] 迁移文件包含 `expanded_keywords JSONB` 字段定义
  Test: node -e "const c=require('fs').readFileSync('apps/api/db/migrations/20260524_100000_acquisition_tables.sql','utf8');if(!c.includes('expanded_keywords'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] 迁移文件包含 `comment_task_status` 字段定义（acquisition_videos 表）
  Test: node -e "const c=require('fs').readFileSync('apps/api/db/migrations/20260524_100000_acquisition_tables.sql','utf8');if(!c.includes('comment_task_status'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌 manual:bash 命令，evaluator 直接执行）

- [ ] [BEHAVIOR] 迁移后 `acquisition_keyword_tasks` 表存在于 zenithjoy schema
  Test: manual:bash -c 'COUNT=$(psql $DB -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='"'"'zenithjoy'"'"' AND table_name='"'"'acquisition_keyword_tasks'"'"'" | tr -d " "); [ "$COUNT" -ge 1 ] || { echo "FAIL: 表不存在"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 迁移后 `acquisition_videos` 表存在于 zenithjoy schema
  Test: manual:bash -c 'COUNT=$(psql $DB -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='"'"'zenithjoy'"'"' AND table_name='"'"'acquisition_videos'"'"'" | tr -d " "); [ "$COUNT" -ge 1 ] || { echo "FAIL: 表不存在"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `acquisition_keyword_tasks` 含 `expanded_keywords`（JSONB 类型）列
  Test: manual:bash -c 'DTYPE=$(psql $DB -t -c "SELECT data_type FROM information_schema.columns WHERE table_schema='"'"'zenithjoy'"'"' AND table_name='"'"'acquisition_keyword_tasks'"'"' AND column_name='"'"'expanded_keywords'"'"'" | tr -d " "); [ "$DTYPE" = "jsonb" ] || { echo "FAIL: 类型非 jsonb，实际=$DTYPE"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `acquisition_videos` 含 `comment_task_status` 列（TEXT 类型）
  Test: manual:bash -c 'DTYPE=$(psql $DB -t -c "SELECT data_type FROM information_schema.columns WHERE table_schema='"'"'zenithjoy'"'"' AND table_name='"'"'acquisition_videos'"'"' AND column_name='"'"'comment_task_status'"'"'" | tr -d " "); [ "$DTYPE" = "text" ] || { echo "FAIL: 类型非 text，实际=$DTYPE"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 向 `acquisition_keyword_tasks` 插入并查询一条记录（端到端可写可读，status 用业务无关占位值 'test_roundtrip'，仅验证 DB 读写通路，不代表业务合法状态）
  Test: manual:bash -c 'TEST_ID=$(psql $DB -t -c "INSERT INTO zenithjoy.acquisition_keyword_tasks (keyword, expanded_keywords, status) VALUES ('"'"'test_kw'"'"', '"'"'[\"a\",\"b\"]'"'"'::jsonb, '"'"'test_roundtrip'"'"') RETURNING id" | tr -d " "); COUNT=$(psql $DB -t -c "SELECT count(*) FROM zenithjoy.acquisition_keyword_tasks WHERE id='"'"'$TEST_ID'"'"'" | tr -d " "); [ "$COUNT" -ge 1 ] || { echo "FAIL: 插入读回失败"; exit 1; }; psql $DB -c "DELETE FROM zenithjoy.acquisition_keyword_tasks WHERE id='"'"'$TEST_ID'"'"'" > /dev/null; echo OK'
  期望: OK
