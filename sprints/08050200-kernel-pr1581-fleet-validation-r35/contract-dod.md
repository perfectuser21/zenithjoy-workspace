---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Fleet Worker 正确 payload 结构验证

**范围**: 当前 Brain Harness Initiative 到当前 Fleet attempt 的真实链路、冻结目标校验与失败分类；不修改 PR #1581、调度或共享 CI。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 单一验收入口、负例矩阵和 TDD 测试存在
  Test: bash -c 'test -f sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.mjs && test -f sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-negative-matrix.sh && test -f sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.test.ts'

- [ ] [ARTIFACT] Generator 只改本 sprint 目录
  Test: bash -c 'test -z "$(git diff --name-only 49fa4ebddde73b8f3d2d800793f2a13c79434b06...HEAD | grep -v "^sprints/08050200-kernel-pr1581-fleet-validation-r35/" || true)"'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: Step 1 真实 Fleet task 与当前 attempt 绑定冻结目标 [接缝×2]
  动作: 连续两次从 Brain 查询 Runner 当前任务，并由验收入口绑定当前 run/attempt
  预期观察: 两次均输出 passed，repo/head/anchor/base 与当前 task/run/attempt 精确一致
  等待预算: 30s
  留证: 两份 JSON 输出及 SHA-256
  Test: manual:bash -c 'for n in 1 2; do node sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.mjs --task-id "$HARNESS_TASK_ID" | jq -e --arg r "$HARNESS_RUN_ID" --arg a "$HARNESS_ATTEMPT_ID" '\''.status=="passed" and .failure_class==null and .run_id==$r and .attempt_id==$a and .base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7"'\''; done'

- [ ] [BEHAVIOR] [L2] B-02: Step 2 GitHub PR head 与 payload target 精确相等 [接缝×2]
  动作: 真调两次 Brain task API 和 GitHub PR API
  预期观察: task payload target 与两次 PR head 都为冻结完整 SHA
  等待预算: 30s
  留证: Brain/GitHub 三个 SHA 输出
  Test: manual:bash -c 'T=$(curl -sf "$BRAIN_URL/api/brain/tasks/$HARNESS_TASK_ID" | jq -er .payload.target_head_sha); [ "$T" = c305f6217da65bb69413c39e621b7e797e0fb189 ]; for n in 1 2; do H=$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 --jq .head.sha); echo "$H"; [ "$H" = "$T" ] || exit 1; done'

- [ ] [BEHAVIOR] [L2] B-03: Step 2 base 与 target 均严格解析且 GP 唯一
  动作: 用 strict commit ref 与 product-map SSOT 校验冻结对象
  预期观察: 两个 commit 精确命中，anchor 匹配数为 1
  等待预算: 0s
  留证: 两个 SHA 与 jq exit code
  Test: manual:bash -c 'B=676fed7de12023d355deac7849af8a525ae53f8d; T=c305f6217da65bb69413c39e621b7e797e0fb189; git rev-parse --verify "${B}^{commit}" | grep -qx "$B"; git rev-parse --verify "${T}^{commit}" | grep -qx "$T"; jq -e '\''[.golden_paths[]|select(.line_id=="line02" and .id=="keyword_acquisition" and any(.steps[];.id=="step7"))]|length==1'\'' product-map/generated/product-map.json'

- [ ] [BEHAVIOR] [L2] B-04: Step 3 成功结论 schema 完整且禁用同义字段缺席
  动作: 运行同一验收入口并检查完整 JSON schema
  预期观察: keys 精确且 repo/head_sha/anchor/ok 均不存在
  等待预算: 30s
  留证: jq 输出与命令 exit code
  Test: manual:bash -c 'node sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.mjs --task-id "$HARNESS_TASK_ID" | jq -e '\''keys==["attempt_id","base_repo","base_sha","failure_class","gp_anchor","run_id","status","target_head_sha"] and (has("repo")|not) and (has("head_sha")|not) and (has("anchor")|not) and (has("ok")|not)'\'''

- [ ] [BEHAVIOR] [L2] B-05: Step 4 六种错误均由同一入口给出精确失败分类
  动作: 对缺/错 repo、短 SHA、错 head、错 anchor、GitHub 失败、Postgres 失败逐项执行入口
  预期观察: 每个子进程非零，status 不为 passed，failure_class 逐字匹配
  等待预算: 60s
  留证: 六行 `REJECTED name class exit_code` 与汇总 exit code
  Test: manual:bash -c 'bash sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-negative-matrix.sh'

- [ ] [BEHAVIOR] [L2] B-06: Step 2 Postgres 依赖失败不能冒充业务通过 [接缝×2]
  动作: 先真连 Fleet 注入 DB 两次，再让同一入口连接不可达地址
  预期观察: 真连接两次返回 1；故障调用非零且只报 environment_failed/postgres_unavailable
  等待预算: 10s
  留证: psql 输出、故障 JSON 与 exit code
  Test: manual:bash -c 'for n in 1 2; do psql "$DB_URL" -v ON_ERROR_STOP=1 -XtAc "SELECT 1" | grep -qx 1; done; O=$(mktemp); if DB_URL="postgresql://127.0.0.1:1/unavailable?connect_timeout=1" node sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.mjs --task-id "$HARNESS_TASK_ID" >"$O"; then rm -f "$O"; exit 1; fi; jq -e '\''.status=="environment_failed" and .failure_class=="postgres_unavailable"'\'' "$O"; rm -f "$O"'

## Invariant 映射

- INV-01（真实派发、strict ref、同义语义一致、依赖失败、DB 同源、真实 exit code）由 B-01/B-02/B-03/B-05/B-06 覆盖。
- INV-02（GP anchor、Test Contract 四列、secret/PII 不落证据、共享 CI 禁区）由 B-03/B-04 与 ARTIFACT-02 覆盖。
- N/A：本 sprint 不新增服务、状态值、表、job、API、租户数据、通知、RPA、UI、cron、部署、relay、watchdog 或付费 API；其余 thin PRD 铁律不触及。
