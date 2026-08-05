---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Fleet Worker 正确 payload 结构验证

**范围**: 当前 Fleet task bundle 到可回读审计证据；不修改 PR #1581、调度或共享 CI。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 单一验收入口、负例矩阵和 TDD 测试存在
  Test: bash -c 'test -f sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.mjs && test -f sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-negative-matrix.sh && test -f sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.test.ts'

- [ ] [ARTIFACT] Generator 只改本 sprint 目录
  Test: bash -c 'test -z "$(git diff --name-only 49fa4ebddde73b8f3d2d800793f2a13c79434b06...HEAD | grep -v "^sprints/08050200-kernel-pr1581-fleet-validation-r35/" || true)"'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: Step 1 真实 Fleet bundle 与当前 attempt 绑定冻结目标 [接缝×2]
  动作: 连续两次读取 Runner 实际 task bundle，并调用验收入口交叉核对 Brain
  预期观察: execution_surface、run、attempt 与目标三字段均精确一致，两次 passed
  等待预算: 30s
  留证: positive-1.json、positive-2.json
  Test: manual:bash -c 'for n in 1 2; do node sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.mjs --task-id "$HARNESS_TASK_ID" | jq -e --arg r "$HARNESS_RUN_ID" --arg a "$HARNESS_ATTEMPT_ID" '\''.status=="passed" and .execution_surface=="fleet-worker" and .run_id==$r and .attempt_id==$a and .base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7"'\''; done'

- [ ] [BEHAVIOR] [L2] B-02: Step 2 GitHub PR head 与 payload target 精确相等 [接缝×2]
  动作: 真调两次 Brain 与 GitHub PR API
  预期观察: task payload target 与两次 PR head 都为冻结完整 SHA
  等待预算: 30s
  留证: Brain/GitHub SHA 输出
  Test: manual:bash -c 'T=$(curl -sf "$BRAIN_URL/api/brain/tasks/$HARNESS_TASK_ID" | jq -er .payload.target_head_sha); [ "$T" = c305f6217da65bb69413c39e621b7e797e0fb189 ]; for n in 1 2; do H=$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 --jq .head.sha); [ "$H" = "$T" ] || exit 1; done'

- [ ] [BEHAVIOR] [L2] B-03: Step 2 base/target 严格解析且 GP 唯一
  动作: 用 strict commit ref 与 product-map SSOT 校验冻结对象
  预期观察: 两 commit 精确命中，anchor 匹配数为 1
  等待预算: 0s
  留证: git 与 jq 输出
  Test: manual:bash -c 'B=676fed7de12023d355deac7849af8a525ae53f8d; T=c305f6217da65bb69413c39e621b7e797e0fb189; git rev-parse --verify "${B}^{commit}" | grep -qx "$B"; git rev-parse --verify "${T}^{commit}" | grep -qx "$T"; jq -e '\''[.golden_paths[]|select(.line_id=="line02" and .id=="keyword_acquisition" and any(.steps[];.id=="step7"))]|length==1'\'' product-map/generated/product-map.json'

- [ ] [BEHAVIOR] [L2] B-04: Step 3 成功 schema 完整且禁用字段缺席
  动作: 运行验收入口并检查完整 JSON schema
  预期观察: keys 精确，repo/head_sha/anchor/ok 不存在
  等待预算: 30s
  留证: positive JSON 与 jq exit code
  Test: manual:bash -c 'node sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.mjs --task-id "$HARNESS_TASK_ID" | jq -e '\''keys==["attempt_id","base_repo","base_sha","execution_surface","failure_class","gp_anchor","run_id","status","target_head_sha"] and (has("repo")|not) and (has("head_sha")|not) and (has("anchor")|not) and (has("ok")|not)'\'''

- [ ] [BEHAVIOR] [L2] B-05: Step 4 九种错误均由同一入口精确拒绝
  动作: 对三字段的缺失/错值/非法值及 GitHub、Postgres 故障逐项执行
  预期观察: 9 个子进程均非零、无 passed、failure_class 逐字匹配
  等待预算: 90s
  留证: negative.log 九行 REJECTED 与汇总 exit code
  Test: manual:bash -c 'bash sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-negative-matrix.sh'

- [ ] [BEHAVIOR] [L2] B-06: Step 3 持久化证据 manifest 可回读
  动作: Final E2E 写完 evidence 后在新 shell 中校验 manifest
  预期观察: identity、negative、两份 positive 共 4 个文件均 SHA-256 OK
  等待预算: 0s
  留证: evidence/$HARNESS_ATTEMPT_ID/SHA256SUMS 与校验输出
  Test: manual:bash -c 'D="sprints/08050200-kernel-pr1581-fleet-validation-r35/evidence/$HARNESS_ATTEMPT_ID"; test -s "$D/SHA256SUMS"; (cd "$D" && sha256sum -c SHA256SUMS)'

## Invariant 映射

- INV-01（真实派发、strict ref、同义语义一致、依赖失败、DB 同源、真实 exit code）由 B-01/B-02/B-03/B-05 覆盖。
- INV-02（GP anchor、Test Contract 四列、secret/PII 不落证据、共享 CI 禁区）由 B-03/B-04 与 ARTIFACT-02 覆盖。
- INV-03（审计 verdict 必须锚定真实 SHA、validation identity late-bound、证据可回读）由 B-01/B-02/B-06 覆盖。
- N/A：本 sprint 不新增服务、状态值、表、job、API、租户数据、通知、RPA、UI、cron、部署、relay、watchdog 或付费 API；其余 thin PRD 铁律不触及。
