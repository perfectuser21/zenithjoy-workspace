---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: works.publish_status Migration

**范围**: 新建 `apps/api/db/migrations/20260519_000000_step6_dispatch_chain.sql`，为 `zenithjoy.works` 加 `publish_status` 列
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 文件存在 `apps/api/db/migrations/20260519_000000_step6_dispatch_chain.sql`
  Test: node -e "require('fs').accessSync('apps/api/db/migrations/20260519_000000_step6_dispatch_chain.sql')"

- [ ] [ARTIFACT] migration SQL 含 `publish_status` 列定义
  Test: node -e "const c=require('fs').readFileSync('apps/api/db/migrations/20260519_000000_step6_dispatch_chain.sql','utf8');if(!c.includes('publish_status'))process.exit(1)"

- [ ] [ARTIFACT] migration SQL 含 `CREATE INDEX` 语句加速状态查询
  Test: node -e "const c=require('fs').readFileSync('apps/api/db/migrations/20260519_000000_step6_dispatch_chain.sql','utf8');if(!c.includes('CREATE INDEX'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] publish_status CHECK 约束允许 queued/success/failed 三值（字面量核查）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/db/migrations/20260519_000000_step6_dispatch_chain.sql\",\"utf8\");const ok=[\"queued\",\"success\",\"failed\"].every(v=>c.includes(v));if(!ok)process.exit(1);console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] publish_status 列不含 NOT NULL 约束（可空，未发布 work 为 NULL）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/db/migrations/20260519_000000_step6_dispatch_chain.sql\",\"utf8\");const colDef=c.match(/publish_status[^,;\n]+/)?.[0]||\"\";if(colDef.includes(\"NOT NULL\"))process.exit(1);console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] migration SQL 不含禁用状态值 pending/dispatched/created（CHECK 约束严格三值）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/db/migrations/20260519_000000_step6_dispatch_chain.sql\",\"utf8\");const chk=c.match(/CHECK[^;]+/s)?.[0]||\"\";if(chk.includes(\"pending\")||chk.includes(\"dispatched\")||chk.includes(\"created\"))process.exit(1);console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] migration 含 ADD COLUMN IF NOT EXISTS（幂等安全，可重复执行）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/db/migrations/20260519_000000_step6_dispatch_chain.sql\",\"utf8\");if(!c.includes(\"ADD COLUMN IF NOT EXISTS\")||!c.includes(\"zenithjoy.works\"))process.exit(1);console.log(\"OK\")"'
  期望: OK

---

## Risks

### Risk 1: CHECK 约束值集合漏字或多字

Migration 若写 `IN ('queued', 'success')` 漏 `failed`，或多写 `pending`，会导致 ackPublishTask 写入失败。**缓解**: WS1 BEHAVIOR 3 精确验证 CHECK 约束不含 pending/dispatched/created，BEHAVIOR 1 验 queued/success/failed 三值均存在。

### Risk 2: Migration 非幂等导致 CI 重跑失败

若未用 `ADD COLUMN IF NOT EXISTS`，CI 重复执行 migration 时报 `column already exists` 错误。**缓解**: WS1 BEHAVIOR 4 验证 `ADD COLUMN IF NOT EXISTS` 关键字存在。
