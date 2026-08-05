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

- [ ] [ARTIFACT] 冻结基线 Red 记录含真实非零终态
  Test: bash -c 'grep -q "exit_code: 1" sprints/08051500-kernel-pr1581-fleet-validation-r36/tests/red-evidence.log && grep -q "terminal_verdict: FAIL" sprints/08051500-kernel-pr1581-fleet-validation-r36/tests/red-evidence.log && grep -q "result: RED_CONFIRMED" sprints/08051500-kernel-pr1581-fleet-validation-r36/tests/red-evidence.log'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 正确 payload 经真实 Fleet Worker 绑定同一目标
  动作: 通过 Brain 生产 task 入口派发一次正确 Harness Initiative
  预期观察: task completed，execution surface 为 Fleet，result/evidence 同时含 repo/head/anchor 与当前 Runner provenance
  等待预算: 7200s
  留证: Brain task JSON 与 SHA-256
  Test: manual:bash -c 'FLEET_TERMINAL_TIMEOUT_MS=7200000 npx vitest run sprints/08051500-kernel-pr1581-fleet-validation-r36/tests/fleet-worker-production-chain.test.ts -t "正确 payload 经真实 Fleet Worker 绑定目标"'

- [ ] [BEHAVIOR] [L2] B-02: 错误仓库 fail-closed
  动作: 通过同一生产入口派发 base_repo=wrong/repo
  预期观察: 真实 Fleet task 进入非 completed 终态并留下失败证据
  等待预算: 7200s
  留证: Brain task 失败 JSON
  Test: manual:bash -c 'FLEET_TERMINAL_TIMEOUT_MS=7200000 npx vitest run sprints/08051500-kernel-pr1581-fleet-validation-r36/tests/fleet-worker-production-chain.test.ts -t "错误仓库 fail-closed"'

- [ ] [BEHAVIOR] [L2] B-03: 缺失 target_head_sha fail-closed
  动作: 删除 target_head_sha 后通过生产入口派发
  预期观察: 真实 Fleet task 为 failed/validation_input_invalid，错误点名 target_head_sha
  等待预算: 7200s
  留证: Brain task 失败 JSON
  Test: manual:bash -c 'FLEET_TERMINAL_TIMEOUT_MS=7200000 npx vitest run sprints/08051500-kernel-pr1581-fleet-validation-r36/tests/fleet-worker-production-chain.test.ts -t "缺失 target_head_sha fail-closed"'

- [ ] [BEHAVIOR] [L2] B-03A: 缺失 base_repo fail-closed
  动作: 删除 base_repo 后通过生产入口派发
  预期观察: 真实 Fleet task 为 failed/validation_input_invalid，错误点名 base_repo
  等待预算: 7200s
  留证: Brain task 失败 JSON
  Test: manual:bash -c 'FLEET_TERMINAL_TIMEOUT_MS=7200000 npx vitest run sprints/08051500-kernel-pr1581-fleet-validation-r36/tests/fleet-worker-production-chain.test.ts -t "缺失 base_repo fail-closed"'

- [ ] [BEHAVIOR] [L2] B-04: 畸形 SHA fail-closed
  动作: 传 target_head_sha=HEAD
  预期观察: 真实 Fleet task 为 failed/validation_input_invalid，错误点名 target_head_sha，且不回退工作区 HEAD
  等待预算: 7200s
  留证: Brain task 失败 JSON
  Test: manual:bash -c 'FLEET_TERMINAL_TIMEOUT_MS=7200000 npx vitest run sprints/08051500-kernel-pr1581-fleet-validation-r36/tests/fleet-worker-production-chain.test.ts -t "畸形 SHA fail-closed"'

- [ ] [BEHAVIOR] [L2] B-05: 可解析但非 PR head SHA fail-closed
  动作: 先确认冻结 base SHA 是可解析 commit，再将它作为 target_head_sha 派发
  预期观察: 真实 Fleet task 为 failed/validation_input_invalid，证明拒绝原因是 PR head 不一致而非 SHA 不可解析
  等待预算: 7200s
  留证: rev-parse 输出与 Brain task 失败 JSON
  Test: manual:bash -c 'FLEET_TERMINAL_TIMEOUT_MS=7200000 npx vitest run sprints/08051500-kernel-pr1581-fleet-validation-r36/tests/fleet-worker-production-chain.test.ts -t "可解析但非 PR head SHA fail-closed"'

- [ ] [BEHAVIOR] [L2] B-06: 缺失或不可解析锚点均 fail-closed
  动作: 分别删除 gp_anchor、传 line02/keyword_acquisition#step999
  预期观察: 两个真实 Fleet task 均非 completed，不猜其他 Step
  等待预算: 7200s
  留证: 两份 Brain task 失败 JSON
  Test: manual:bash -c 'FLEET_TERMINAL_TIMEOUT_MS=7200000 npx vitest run sprints/08051500-kernel-pr1581-fleet-validation-r36/tests/fleet-worker-production-chain.test.ts -t "缺失或不可解析锚点 fail-closed"'

## Invariant 映射

- ref 使用 `git rev-parse --verify '<ref>^{commit}'`；当前 HEAD 不作目标真值。
- 生产 Brain→dispatcher→Fleet Worker 边禁止 mock；不得自行写成功 receipt。
- 共享 CI、生产调度、PR #1581 业务代码均未授权修改。
- 临时证据用 session 独享路径；secrets/PII 不进日志；validation identity late-bound。
- status 枚举、租户、API auth、cron、launchd、UI/真机、业务写库等其余铁律：N/A，本 Sprint 不改对应模块。
