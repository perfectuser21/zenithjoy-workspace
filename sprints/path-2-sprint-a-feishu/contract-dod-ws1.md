---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: DB migration `tenant_feishu_bindings`

**范围**: 新增 `apps/api/db/migrations/<timestamp>_tenant_feishu_bindings.sql`，建表 + FK + 索引
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 文件存在且文件名 ISO 8601 时间戳 + 含 `tenant_feishu_bindings` 字样
  Test: `bash -c "ls apps/api/db/migrations/2026*_tenant_feishu_bindings.sql 2>/dev/null | wc -l | grep -q '^1$'"`

- [ ] [ARTIFACT] migration SQL 含 `CREATE TABLE` + 必需列（含 R2 用 needs_retry / provision_error）
  Test: `node -e "const f=require('fs').readdirSync('apps/api/db/migrations').find(n=>n.includes('tenant_feishu_bindings'));const c=require('fs').readFileSync('apps/api/db/migrations/'+f,'utf8');['CREATE TABLE','tenant_id','tenant_access_token','expires_at','app_token','table_id_lead_profile','table_id_target_videos','table_id_leads','last_refreshed_at','needs_retry','provision_error'].forEach(k=>{if(!c.includes(k))process.exit(1)})"`

- [ ] [ARTIFACT] migration 含 FK 指向 `zenithjoy.tenants(id) ON DELETE CASCADE`
  Test: `node -e "const f=require('fs').readdirSync('apps/api/db/migrations').find(n=>n.includes('tenant_feishu_bindings'));const c=require('fs').readFileSync('apps/api/db/migrations/'+f,'utf8');if(!/REFERENCES\s+zenithjoy\.tenants\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i.test(c))process.exit(1)"`

- [ ] [ARTIFACT] migration 含索引 `idx_tfb_tenant`
  Test: `node -e "const f=require('fs').readdirSync('apps/api/db/migrations').find(n=>n.includes('tenant_feishu_bindings'));const c=require('fs').readFileSync('apps/api/db/migrations/'+f,'utf8');if(!c.includes('idx_tfb_tenant'))process.exit(1)"`

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/migration.test.ts`，覆盖：
- migration 在干净 DB 上幂等执行成功
- `tenant_feishu_bindings` 8 列齐全（postgres `information_schema.columns`）
- FK 约束有效（删 tenant 级联删 binding）
