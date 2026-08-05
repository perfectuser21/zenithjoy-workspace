---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Fleet Worker 正确 payload 结构验证

**范围**: 仅以生产 Brain→dispatcher→Fleet Worker 链验证既有行为；不新增本地 verifier，不修改 PR #1581 业务实现或 Harness 调度。

## ARTIFACT 条目

- [ ] [ARTIFACT] 合同不存在独立 verifier/伪 receipt 实现
  Test: bash -c 'test ! -e sprints/08051500-kernel-pr1581-fleet-validation-r36/verify-fleet-payload.mjs'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 正确 payload 经真实 Fleet Worker 绑定同一目标 [接缝×2]
  动作: 通过 Brain 生产 task 入口连续派发两次正确 Harness Initiative
  预期观察: 两个 task 均 completed，execution surface 为 Fleet，result/evidence 同时含 repo/head/anchor 与当前 Runner provenance
  等待预算: 7200s
  留证: 两份 Brain task JSON 与 SHA-256
  Test: manual:bash -c 'npx vitest run sprints/08051500-kernel-pr1581-fleet-validation-r36/tests/fleet-worker-production-chain.test.ts -t "正确 payload 经真实 Fleet Worker 绑定目标"'

- [ ] [BEHAVIOR] [L2] B-02: 错误仓库 fail-closed
  动作: 通过同一生产入口派发 base_repo=wrong/repo
  预期观察: 真实 Fleet task 进入非 completed 终态并留下失败证据
  等待预算: 7200s
  留证: Brain task 失败 JSON
  Test: manual:bash -c 'npx vitest run sprints/08051500-kernel-pr1581-fleet-validation-r36/tests/fleet-worker-production-chain.test.ts -t "错误仓库 fail-closed"'

- [ ] [BEHAVIOR] [L2] B-03: 缺失、畸形或不一致 SHA 均 fail-closed
  动作: 分别删除 target_head_sha、传 HEAD、传完整但非 PR head 的 SHA
  预期观察: 三个真实 Fleet task 均非 completed，且不回退工作区 HEAD
  等待预算: 7200s
  留证: 三份 Brain task 失败 JSON
  Test: manual:bash -c 'npx vitest run sprints/08051500-kernel-pr1581-fleet-validation-r36/tests/fleet-worker-production-chain.test.ts -t "畸形或不一致 SHA fail-closed"'

- [ ] [BEHAVIOR] [L2] B-04: 缺失或不可解析锚点均 fail-closed
  动作: 分别删除 gp_anchor、传 line02/keyword_acquisition#step999
  预期观察: 两个真实 Fleet task 均非 completed，不猜其他 Step
  等待预算: 7200s
  留证: 两份 Brain task 失败 JSON
  Test: manual:bash -c 'npx vitest run sprints/08051500-kernel-pr1581-fleet-validation-r36/tests/fleet-worker-production-chain.test.ts -t "不可解析锚点 fail-closed"'

## Invariant 映射

- ref 使用 `git rev-parse --verify '<ref>^{commit}'`；当前 HEAD 不作目标真值。
- 生产 Brain→dispatcher→Fleet Worker 边禁止 mock；不得自行写成功 receipt。
- 共享 CI、生产调度、PR #1581 业务代码均未授权修改。
- 临时证据用 session 独享路径；secrets/PII 不进日志；validation identity late-bound。
- status 枚举、租户、API auth、cron、launchd、UI/真机、业务写库等其余铁律：N/A，本 Sprint 不改对应模块。
