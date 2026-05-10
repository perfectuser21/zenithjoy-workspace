---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: DB migration `agent_platform_sessions` add `role`

**范围**: 新增 migration 文件给 `agent_platform_sessions` 表加 `role` 字段（main/burner）+ CHECK 约束
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 文件存在且文件名 ISO 8601 时间戳 + 含 `agent_platform_sessions_add_role` 字样
  Test: `bash -c "ls apps/api/db/migrations/2026*_agent_platform_sessions_add_role.sql 2>/dev/null | wc -l | grep -q '^1$'"`

- [ ] [ARTIFACT] migration SQL 含 ALTER TABLE 加 role 列 + DEFAULT 'main' + NOT NULL
  Test: `node -e "const f=require('fs').readdirSync('apps/api/db/migrations').find(n=>n.includes('agent_platform_sessions_add_role'));const c=require('fs').readFileSync('apps/api/db/migrations/'+f,'utf8');['ALTER TABLE','agent_platform_sessions','ADD COLUMN','role','DEFAULT','main','NOT NULL'].forEach(k=>{if(!c.includes(k))process.exit(1)})"`

- [ ] [ARTIFACT] migration 含 CHECK 约束 `role IN ('main','burner')`
  Test: `node -e "const f=require('fs').readdirSync('apps/api/db/migrations').find(n=>n.includes('agent_platform_sessions_add_role'));const c=require('fs').readFileSync('apps/api/db/migrations/'+f,'utf8');if(!/CHECK\s*\(\s*role\s+IN\s*\(\s*'main'\s*,\s*'burner'\s*\)\s*\)/i.test(c))process.exit(1)"`

- [ ] [ARTIFACT] migration 用 IF NOT EXISTS 或显式幂等保护（防止重跑失败）
  Test: `node -e "const f=require('fs').readdirSync('apps/api/db/migrations').find(n=>n.includes('agent_platform_sessions_add_role'));const c=require('fs').readFileSync('apps/api/db/migrations/'+f,'utf8');if(!/IF NOT EXISTS|DO \\\$|EXCEPTION|column_name='role'/i.test(c))process.exit(1)"`

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/migration-add-role.test.ts`，覆盖：
- migration 在干净 DB 上跑成功 + role 列存在
- role 列默认值 'main'
- CHECK 约束拒绝 role NOT IN ('main','burner')
- 已有 main 行 migration 后 role='main'（幂等保护）
