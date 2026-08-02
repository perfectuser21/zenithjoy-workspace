---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Acquisition 有效配置校验

**范围**: 仅修复 PUT acquisition config 对合并后 keyword bounds 的校验。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 真实 Postgres 集成测试覆盖对称冲突、合法更新和双租户隔离
  Test: node -e "const c=require('fs').readFileSync('sprints/08021518-ab-kernel-acquisition-config-recovery-7/tests/acquisition-config-effective-validation.integration.test.ts','utf8');for(const s of ['仅更新 min','仅更新 max','合法部分更新','合法完整更新','tenantB'])if(!c.includes(s))process.exit(1)"

- [ ] [ARTIFACT] 共享冻结 Red fixture 未被本 Sprint 合同修改
  Test: git diff --exit-code 0dc4e3c07ff19a0ac95440723986bf3cb78580b2 -- apps/api/tests/routes/acquisition-dispatch.test.ts

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 仅更新 min 造成有效配置冲突时拒绝且零写入 [接缝×2]
  动作: 预置 min=3/max=5，仅 PUT keywords_per_round_min=6
  预期观察: HTTP 400、error.code=INVALID_CONFIG，写前写后 bounds 相同
  等待预算: 10s
  留证: vitest stdout 与 Postgres 写前/写后断言
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/08021518-ab-kernel-acquisition-config-recovery-7/tests/acquisition-config-effective-validation.integration.test.ts -t "仅更新 min 后有效配置 min>max 返回 400 INVALID_CONFIG 且零持久化"'

- [ ] [BEHAVIOR] [L2] B-02: 仅更新 max 造成有效配置冲突时拒绝且零写入 [接缝×2]
  动作: 预置 min=8/max=12，仅 PUT keywords_per_round_max=7
  预期观察: HTTP 400、error.code=INVALID_CONFIG，写前写后 bounds 相同
  等待预算: 10s
  留证: vitest stdout 与 Postgres 写前/写后断言
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/08021518-ab-kernel-acquisition-config-recovery-7/tests/acquisition-config-effective-validation.integration.test.ts -t "仅更新 max 后有效配置 min>max 返回 400 INVALID_CONFIG 且零持久化"'

- [ ] [BEHAVIOR] [L2] B-03: 合法部分更新成功且不串租户 [接缝×2]
  动作: 对租户 A 仅 PUT keywords_per_round_min=4，并保留租户 B 快照
  预期观察: HTTP 200，响应与 DB 为 min=4/max=5，租户 B 不变
  等待预算: 10s
  留证: vitest stdout 与双租户 Postgres 断言
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/08021518-ab-kernel-acquisition-config-recovery-7/tests/acquisition-config-effective-validation.integration.test.ts -t "合法部分更新成功持久化并可读取且不改变另一租户"'

- [ ] [BEHAVIOR] [L2] B-04: 合法完整更新与 min=max 边界保持成功 [接缝×2]
  动作: 同时 PUT keywords_per_round_min=9 与 keywords_per_round_max=9
  预期观察: HTTP 200，响应与 DB 的两个字段均为 9
  等待预算: 10s
  留证: vitest stdout 与 Postgres 查询断言
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/08021518-ab-kernel-acquisition-config-recovery-7/tests/acquisition-config-effective-validation.integration.test.ts -t "合法完整更新与 min=max 等值边界成功持久化"'

## Invariant 映射

- INV-1 `[TDD顺序]`：冻结 Red commit `0dc4e3c0` 已先于实现存在；本合同保留其失败证据。
- INV-2 `[真失败]`：Red 用例命中目标 200/400 行为差异，不以语法或服务未启动制造失败。
- INV-3 `[零Mock验收]`：B-01 至 B-04 真调 Express 路由、相邻 service 和真实 Postgres。
- INV-4 `[语义判定]`：同时断言 HTTP、`error.code`、成功响应字段及 DB 状态。
- INV-5 `[冻结基线]`：ARTIFACT 守卫断言共享 Red fixture 相对冻结 SHA 无变化。
- INV-6 `[候选隔离]`：合同仅复用 payload 明确许可的 Kernel proposal context；盲评前不合并。
