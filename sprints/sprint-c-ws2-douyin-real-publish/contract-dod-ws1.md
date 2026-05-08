---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: DB migration + 中台 createPublishTask 加 type 字段

**范围**: 给 publish_tasks 表加 type 字段 + 中台写入 + API 校验
**大小**: M
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 文件存在且含 type 字段定义
  Test: ls apps/api/db/migrations/2026*publish_tasks_add_type*.sql && grep -E "ADD COLUMN.*type.*TEXT" apps/api/db/migrations/2026*publish_tasks_add_type*.sql

- [ ] [ARTIFACT] migration 含 CHECK 约束限定 type 值域
  Test: grep -E "CHECK.*type.*IN.*video.*image.*article" apps/api/db/migrations/2026*publish_tasks_add_type*.sql

- [ ] [ARTIFACT] walking-skeleton.service.ts createPublishTask 接 type 参数
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/walking-skeleton.service.ts','utf8');if(!/createPublishTask.*\{[^}]*type/s.test(c))process.exit(1)"

- [ ] [ARTIFACT] publish 路由 zod schema 含 type 字段白名单
  Test: grep -rE "z\.enum\(\[.*video.*image.*article" apps/api/src/routes/ | head -1 | grep -q .

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/publish-task-type.test.ts`，覆盖：
- DB migration 后 publish_tasks 有 type 字段 + NOT NULL + CHECK 约束
- createPublishTask({type:'video'}) 持久化 type='video'
- 缺 type 参数 → 422 拒绝（或缺省 'image'，二选一明确策略）
- type='banana' → 422 invalid value
