---
skeleton: false
journey_type: autonomous
---
# Contract DoD — acquisition 配置合并校验恢复

## ARTIFACT 条目

- [ ] [ARTIFACT] 真 HTTP + 真 Postgres integration 测试存在且不 mock 路由、服务或 DB
  Test: node -e "const c=require('fs').readFileSync('sprints/08021518-ab-kernel-acquisition-config-recovery-7/tests/acquisition-config-effective-validation.integration.test.ts','utf8');if(!c.includes('supertest')||!c.includes('new Pool')||/vi\.mock|jest\.mock|stub\(/.test(c))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 真 HTTP 对合并后无效的 min-only patch 返回 400 INVALID_CONFIG 且零持久化 [接缝×2]
  动作: A 当前 min=3/max=8，使用 X-Tenant-Id 连续两次 PUT 只提交 min=9
  预期观察: 两次均返回 HTTP 400/INVALID_CONFIG，A/B 配置均不变
  等待预算: 30s
  留证: HTTP 状态、响应 JSON、A/B 前后 DB 快照
  Test: manual:bash -c 'cd apps/api && TEST_DATABASE_URL="$DB_URL" npx vitest run --config ../../sprints/08021518-ab-kernel-acquisition-config-recovery-7/tests/vitest.config.ts -t "真 HTTP 对合并后无效的 min-only patch 返回 400 INVALID_CONFIG 且零持久化" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-02: 错误 schema 完整且不误映射为 500
  动作: 在真 Postgres 预置 A 当前 min=3/max=8 后，通过真 HTTP 提交 min=9
  预期观察: 状态恰为 400；顶层仅 error/success/timestamp；error.code 为 INVALID_CONFIG
  等待预算: 30s
  留证: Vitest 真 HTTP 状态与完整响应断言输出
  Test: manual:bash -c 'cd apps/api && TEST_DATABASE_URL="$DB_URL" npx vitest run --config ../../sprints/08021518-ab-kernel-acquisition-config-recovery-7/tests/vitest.config.ts -t "真 HTTP 对合并后无效的 min-only patch 返回 400 INVALID_CONFIG 且零持久化" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-03: max-only 合并倒置同样拒绝且零写入 [接缝×2]
  动作: A 当前 min=3/max=8，连续两次只提交 max=2
  预期观察: 两次均为 400/INVALID_CONFIG，A/B 的整行快照均不变
  等待预算: 30s
  留证: Vitest 两次真 HTTP 响应与 A/B 前后 DB 快照断言输出
  Test: manual:bash -c 'cd apps/api && TEST_DATABASE_URL="$DB_URL" npx vitest run --config ../../sprints/08021518-ab-kernel-acquisition-config-recovery-7/tests/vitest.config.ts -t "真 HTTP 对合并后无效的 max-only patch 返回 400 INVALID_CONFIG 且零持久化" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-04: 有效部分、完整和相等边界更新继续成功且不串租户
  动作: A 依次提交有效 min-only、max-only 和 min=max 完整更新
  预期观察: 均成功且 DB 最终为 7/7，B 配置不变
  等待预算: 30s
  留证: Vitest 真 HTTP 与真 DB 输出
  Test: manual:bash -c 'cd apps/api && TEST_DATABASE_URL="$DB_URL" npx vitest run --config ../../sprints/08021518-ab-kernel-acquisition-config-recovery-7/tests/vitest.config.ts -t "有效部分、完整和相等边界更新继续成功且不串租户" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-05: 冻结 Red 与盲测 A/B 仓库边界保持完整
  动作: 仅审计冻结 Red 文件 blob、从 planner base 起的变更路径和 merge commit 祖先，不读取任何 One-session 候选 worktree、patch、日志、PR 或反馈
  预期观察: 共享 Red 文件与冻结 SHA 完全一致；变更全部位于本 sprint 合同目录；盲测裁决前没有 merge commit
  等待预算: 0s
  留证: git rev-parse/hash-object、git diff --name-only 与 git rev-list 的退出码及命令输出
  Test: manual:bash -c 'BASE=18333a8293ea3a9c8fac1a3111142fa6491fbb59; RED=0dc4e3c07ff19a0ac95440723986bf3cb78580b2; RED_PATH=apps/api/tests/routes/acquisition-dispatch.test.ts; test "$(git rev-parse "$RED:$RED_PATH")" = "$(git hash-object "$RED_PATH")" && test -z "$(git diff --name-only "$BASE" HEAD -- . ":(exclude)sprints/08021518-ab-kernel-acquisition-config-recovery-7/**")" && test -z "$(git rev-list --min-parents=2 "$BASE"..HEAD)"'

## Invariant 映射

- INV-1 租户隔离、INV-2 测试多租户：B-01/B-04 使用 A/B 真租户并断言 B 不变。
- INV-3 端点鉴权：沿用 X-Tenant-Id；鉴权行为不改，N/A。
- INV-4 凭据安全、INV-5 日志脱敏：连接串仅由环境注入，响应不回显配置。
- INV-6 真环境验证：B-01/B-03 在 local_api + 真 Postgres 重复两次。
- INV-7 环境假设：API_URL、DB_URL、tenant id 均由环境或隔离 fixture 提供。
- INV-8 单写手：task-plan 仅 ws1。
