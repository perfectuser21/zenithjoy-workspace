---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Line04 客服层多租户隔离（tenant scope）

**范围**: `apps/api` 客服读写路径补 tenant scope —— scheduler-tick 客户枚举、draft-generate 写入按 `agents.tenant_id` 过滤；缺租户拒绝不回退全量。不动 tenant 模型 / schema 结构 / 前端。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 2 租户隔离 regression 测试存在且断言 SQL 层 tenant scope
  Test: node -e "const c=require('fs').readFileSync('apps/api/tests/regression/line04-cs-tenant-isolation.test.ts','utf8');if(!/tenant_id/.test(c)||!/agent_platform_sessions/.test(c)||!/not\.toContain/.test(c))process.exit(1)"
  期望: exit 0（测试文件含 tenant_id / agent_platform_sessions / 跨租户负向断言）

- [ ] [ARTIFACT] scheduler-tick 客户枚举查询补 agents JOIN + tenant 过滤
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/wechat.ts','utf8');if(!/agents/.test(c)||!/tenant_id/i.test(c))process.exit(1)"
  期望: exit 0（wechat.ts 客服查询出现 agents 关联 + tenant_id）

## BEHAVIOR 条目（autonomous — apps/api vitest，mock pg pool，断言真实 SQL 文本+绑定参数）

> oracle = repo 既定 supertest + `vi.mock` pg pool。DB 是外部边界（允许 mock）；被测真实逻辑 = tenant-scope SQL 构造 + 缺租户拒绝。断言对象是 route 真实发给 `pool.query` 的 SQL 与参数 → 不写真隔离 SQL 无法转绿。每条对应一个 Golden Path 步骤。

- [ ] [BEHAVIOR] (Golden Path 1) 租户A 客户枚举按 agents.tenant_id 过滤并绑定 A 参数
  Test: manual:bash -c 'cd apps/api && npx vitest run tests/regression/line04-cs-tenant-isolation.test.ts -t "租户A 客户枚举按 agents.tenant_id 过滤并绑定 A 参数" --reporter=basic'
  期望: exit 0

- [ ] [BEHAVIOR] (Golden Path 2) 租户B 客户枚举绑定 B 参数，绝不串到租户A（物理隔离）
  Test: manual:bash -c 'cd apps/api && npx vitest run tests/regression/line04-cs-tenant-isolation.test.ts -t "租户B 客户枚举绑定 B 参数，绝不串到租户A" --reporter=basic'
  期望: exit 0

- [ ] [BEHAVIOR] (Golden Path 4) 缺租户上下文拒绝(4xx)且绝不执行无 tenant_id 过滤的全量客户查询
  Test: manual:bash -c 'cd apps/api && npx vitest run tests/regression/line04-cs-tenant-isolation.test.ts -t "缺租户上下文时拒绝（4xx）且绝不执行无 tenant_id 过滤的全量客户查询" --reporter=basic'
  期望: exit 0

- [ ] [BEHAVIOR] (Golden Path 3) draft-generate 缺租户上下文拒绝且绝不写入草稿
  Test: manual:bash -c 'cd apps/api && npx vitest run tests/regression/line04-cs-tenant-isolation.test.ts -t "draft-generate 缺租户上下文时拒绝且绝不写入草稿" --reporter=basic'
  期望: exit 0

- [ ] [BEHAVIOR] (Golden Path 3 正路径) draft-generate 带租户上下文放行并把 tenant scope 透传写入
  Test: manual:bash -c 'cd apps/api && npx vitest run tests/regression/line04-cs-tenant-isolation.test.ts -t "draft-generate 带租户上下文时放行并按当前租户写入" --reporter=basic'
  期望: exit 0
