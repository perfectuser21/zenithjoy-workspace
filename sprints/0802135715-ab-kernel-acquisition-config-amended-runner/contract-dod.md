---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Acquisition 合并配置校验

**范围**: 仅修复 PUT acquisition config 对合并后 keyword bounds 的校验。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 真实 Postgres 集成测试存在并覆盖对称冲突、合法更新和双租户隔离
  Test: node -e "const c=require('fs').readFileSync('sprints/0802135715-ab-kernel-acquisition-config-amended-runner/tests/acquisition-config-effective-validation.integration.test.ts','utf8');for(const s of ['仅更新 min','仅更新 max','合法部分更新','合法完整更新','tenantB'])if(!c.includes(s))process.exit(1)"

- [ ] [ARTIFACT] 共享冻结 Red fixture 未被本 Sprint 合同修改
  Test: git diff --exit-code 0dc4e3c07ff19a0ac95440723986bf3cb78580b2 -- apps/api/tests/routes/acquisition-dispatch.test.ts

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 仅更新 min 造成合并后冲突时拒绝且零写入 [接缝×2]
  动作: 为租户 A 预置 min=3/max=5，仅 PUT keywords_per_round_min=6
  预期观察: HTTP 400、error.code=INVALID_CONFIG，租户 A 写前写后 bounds 相同
  等待预算: 10s
  留证: vitest stdout 与 Postgres 写前/写后断言结果
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/0802135715-ab-kernel-acquisition-config-amended-runner/tests/acquisition-config-effective-validation.integration.test.ts -t "仅更新 min 后有效配置 min>max 返回 400 INVALID_CONFIG 且零持久化"'

- [ ] [BEHAVIOR] [L2] B-02: 仅更新 max 造成合并后冲突时拒绝且零写入 [接缝×2]
  动作: 为租户 B 预置 min=8/max=12，仅 PUT keywords_per_round_max=7
  预期观察: HTTP 400、error.code=INVALID_CONFIG，租户 B 写前写后 bounds 相同
  等待预算: 10s
  留证: vitest stdout 与 Postgres 写前/写后断言结果
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/0802135715-ab-kernel-acquisition-config-amended-runner/tests/acquisition-config-effective-validation.integration.test.ts -t "仅更新 max 后有效配置 min>max 返回 400 INVALID_CONFIG 且零持久化"'

- [ ] [BEHAVIOR] [L2] B-03: 合法部分更新成功且不串租户 [接缝×2]
  动作: 对租户 A 仅 PUT keywords_per_round_min=4，同时保留租户 B 快照
  预期观察: HTTP 200；响应和 DB 均为 min=4/max=5；租户 B 完全不变
  等待预算: 10s
  留证: vitest stdout、两个 tenant 的 Postgres 查询断言
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/0802135715-ab-kernel-acquisition-config-amended-runner/tests/acquisition-config-effective-validation.integration.test.ts -t "合法部分更新成功持久化并可读取且不改变另一租户"'

- [ ] [BEHAVIOR] [L2] B-04: 合法完整更新与 min=max 边界保持成功 [接缝×2]
  动作: 对租户 A 同时 PUT keywords_per_round_min=9 与 keywords_per_round_max=9
  预期观察: HTTP 200；响应和 DB 的两个字段均为 9
  等待预算: 10s
  留证: vitest stdout 与 Postgres 查询断言
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/0802135715-ab-kernel-acquisition-config-amended-runner/tests/acquisition-config-effective-validation.integration.test.ts -t "合法完整更新与 min=max 等值边界成功持久化"'

## Invariant 映射

- INV-1 `[TDD提交]`：由流水线核对冻结 Red SHA 与测试-only Red commit；本合同不修改共享 fixture。
- INV-2 `[真实判定]`：B-01 至 B-04 同时断言 HTTP 语义字段与真实 DB 结果。
- INV-3 `[真实执行]`：B-01 至 B-04 的 manual oracle 以真实 exit code 为 verdict；解释器/DB 不可用即 FAIL。
- INV-4 `[失败分支]`：N/A，本 Sprint 不新增返回 null/false 的调用；HTTP 错误分支显式断言。
- INV-5 `[单槽串行]`：N/A，由 Harness 调度器保证，本实现不触及 slot 调度。
- INV-6 `[环境假设]`：DATABASE_URL 强制从环境注入，tenant id 每轮随机生成。
- INV-7 `[真实环境]`：B-01 至 B-04 均为 L2 接缝断言，须在 local_api + 真 Postgres 验过才 done。
- INV-8 `[多租户测试]`：B-03 显式核对 A/B 两租户互不串扰。
- INV-9 `[凭据安全]`：N/A，不新增凭据；DATABASE_URL 不输出到日志。
- INV-10 `[日志脱敏]`：N/A，测试数据只有随机 tenant id 和数值配置，无 PII。
- INV-11 `[端点鉴权]`：沿用 tenantContextOptional；合同不改鉴权，B-01 至 B-04 使用生产允许的 X-Tenant-Id smoke shape。
- INV-12 `[租户隔离]`：B-03 真实查询两个租户并断言第二租户不变。
