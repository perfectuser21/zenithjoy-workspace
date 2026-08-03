---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Kernel acquisition effective-config guard v2 实机队列验证 r13

**范围**: 只对 `perfectuser21/zenithjoy-workspace` PR #1581 固定 SHA 在获准 US M4 完成新鲜双裁决验证；不修改产品行为、不合并。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] Golden Path 合同、DoD 与 TDD Red 测试结构齐全
  Test: node -e "const fs=require('fs'),d=fs.readFileSync('sprints/08040114-kernel-pr1581-fleet-validation-r13/contract-draft.md','utf8'),t=fs.readFileSync('sprints/08040114-kernel-pr1581-fleet-validation-r13/tests/fleet-validation-evidence.test.ts','utf8');if(!d.includes('GP-Anchor: line02/keyword_acquisition keep-green')||!d.includes('## E2E 验收')||!t.includes('机械合并门重算会拒绝 SHA 漂移'))process.exit(1)"

- [ ] [ARTIFACT] 本 run 运行清单记录固定 repo/PR/base/final SHA 与 Runner late-bound 完整 Fleet attestation
  Test: node -e "const d=require('./sprints/08040114-kernel-pr1581-fleet-validation-r13/evidence/run-manifest.json');for(const k of ['attempt_id','provider','account','model','machine','capability_snapshot_id','runner_digest'])if(typeof d[k]!=='string'||!d[k])process.exit(1);if(d.machine!=='us-mac-m4'||d.actual_final_sha!=='c305f6217da65bb69413c39e621b7e797e0fb189')process.exit(1)"

- [ ] [ARTIFACT] 合并门重算器具备三源读取、SHA-256 绑定、fail-closed 写出与非零退出
  Test: node -e "const c=require('fs').readFileSync('sprints/08040114-kernel-pr1581-fleet-validation-r13/scripts/recompute-merge-gate.mjs','utf8');for(const s of ['run-manifest.json','evaluator-verdict.json','independent-judge-verdict.json','merge-gate.json','createHash','source_sha256','merge_allowed','process.exitCode'])if(!c.includes(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 精确 PR HEAD、冻结基线与获准 US M4 逐字段绑定 [接缝×2]
  动作: 读取真实 `refs/pull/1581/head`、计算 merge-base，并核对当前执行角色 run-manifest 的 Fleet attestation
  预期观察: PR HEAD=固定候选 SHA、merge-base=冻结基线，machine/digest 符合冻结约束，provider/account/model/snapshot/attempt 均非空且来自当前 Runner
  等待预算: 30s
  留证: Vitest stdout、git ls-remote/merge-base 结果与 `evidence/run-manifest.json`
  Test: manual:bash -c 'npx vitest run sprints/08040114-kernel-pr1581-fleet-validation-r13/tests/fleet-validation-evidence.test.ts -t "精确 PR HEAD 与冻结基线及获准 US M4 能力绑定" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-02: 目标 SHA 在 attempt 空库完成真实 signup 双租户产品验证 [接缝×2]
  动作: 在 detached 目标 worktree `npm ci`，对同一 `DB_URL` 跑真实 migration，启动真实 API，注册两个临时主体并用 cookie 调 PUT/PATCH
  预期观察: 非法局部更新均 400 `INVALID_CONFIG` 且 A/B 完整快照不变；同租户并发的两次单独合法 patch 恰一 200、一 400，最终 `min<=max`，B 不变
  等待预算: 7200s
  留证: candidate integration stdout、API log、HTTP body、DB before/after diff 与 E2E exit code
  Test: manual:bash -c 'awk '"'"'/^## E2E 验收/{f=1;next} f&&/^## /{exit} f&&/^```bash/{b=1;next} b&&/^```/{exit} b{print}'"'"' sprints/08040114-kernel-pr1581-fleet-validation-r13/contract-draft.md > /tmp/kernel-pr1581-r13-e2e.sh; bash /tmp/kernel-pr1581-r13-e2e.sh'

- [ ] [BEHAVIOR] [L2] B-03: Evaluator 产生其 runtime attempt 新鲜 PASS 证据 [接缝×2]
  动作: 完成产品 E2E 后由 Evaluator 写独立 verdict，记录真实 exit code、log_tail 与逐行为结果
  预期观察: verdict=`PASS`、role=`evaluator`、run/final SHA 匹配冻结对象；attempt/provider/account/model/machine/snapshot/digest 匹配 Evaluator Runner 现场写入的 run-manifest，produced_at 与 mtime 均在其 7200 秒窗口内
  等待预算: 7200s
  留证: `evidence/evaluator-verdict.json`、行为日志尾部与文件 SHA-256
  Test: manual:bash -c 'npx vitest run sprints/08040114-kernel-pr1581-fleet-validation-r13/tests/fleet-validation-evidence.test.ts -t "Evaluator 裁决为本 attempt 新鲜 PASS 且绑定精确最终 SHA" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-04: Independent Judge 独立产生同 SHA APPROVED 证据 [接缝×2]
  动作: Judge 在 Evaluator 后独立审查合同、真实日志和证据摘要，并写自己的 verdict
  预期观察: verdict=`APPROVED`、role=`independent_judge`、producer_execution_id 与 runtime attempt 均与 Evaluator 不同、final SHA 一致，Judge 保留自己的 capability，并记录 Evaluator attempt/capability 引用与文件真实 SHA-256
  等待预算: 7200s
  留证: `evidence/independent-judge-verdict.json`、独立行为日志与 evaluator_evidence_sha256
  Test: manual:bash -c 'npx vitest run sprints/08040114-kernel-pr1581-fleet-validation-r13/tests/fleet-validation-evidence.test.ts -t "Independent Judge 裁决独立新鲜 APPROVED 且绑定同一最终 SHA" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-05: 双裁决机械 AND 门只对新鲜同 SHA 证据放行 [接缝×2]
  动作: 执行 `scripts/recompute-merge-gate.mjs` 读取同一 run 的 run-manifest、Evaluator 与 Judge 三份文件（各角色保留自己 attempt/capability），覆盖生成 merge-gate.json 并运行 SHA 漂移自测
  预期观察: 仅双裁决通过且新鲜同 SHA 时 `merge_allowed=true`、`reasons=[]` 并记录三源 SHA-256；SHA 漂移自测非零且明确给出 `judge_final_sha_mismatch`
  等待预算: 30s
  留证: 现场重算的 `evidence/merge-gate.json`、三源 SHA-256、Vitest stdout 与漂移拒绝原因
  Test: manual:bash -c 'npx vitest run sprints/08040114-kernel-pr1581-fleet-validation-r13/tests/fleet-validation-evidence.test.ts -t "机械合并门" --reporter=verbose'

## Invariant 映射

- INV-1 N/A：不触及 cortex learning，也不以 source inspection 代替本轮真 E2E。
- INV-2：B-02 的 migration、API 写入与 DB oracle 只使用同一 `DB_URL`。
- INV-3 N/A：本合同不读写 agents 表字段。
- INV-4 N/A：不新增或硬编码产品 status 枚举。
- INV-5 N/A：不触及 watchdog recovery。
- INV-6：B-02 检查 `success`、`error.code` 与真 DB，不以 `ok:true` 代替业务成功。
- INV-7 N/A：不修改依赖或 advisory 白名单；`npm ci` 只恢复锁定环境。
- INV-8 N/A：本角色不运行长时 headed relay；Fleet controller 负责心跳。
- INV-9：合同产物提交前运行 `lint-tdd-commit-order` 与 `check-test-coverage`（仓库存在时）。
- INV-10：B-01 至 B-05 均记录真实 exit code；B-02 明确启动 node/Vitest 解释器。
- INV-11 N/A：BEHAVIOR 不使用 `manual:node -e` 双引号 `${}`。
- INV-12：B-01、B-03、B-04、B-05 在证据尚未生成时真实 Red，禁止吞错。
- INV-13：共享产品 Red/fixture 只读，不允许修改。
- INV-14 N/A：不验证周期扫描逻辑。
- INV-15 N/A：不新增或调用付费第三方 API。
- INV-16 N/A：不改扫描间隔/TTL 时间常数。
- INV-17 N/A：合同不以 Android 排除说明冒充真机覆盖。
- INV-18：task payload 与合同均明确 `target_environment=local_api`，实际机器另由 Fleet attestation 绑定。
- INV-19：B-03/B-04 强制顶层 `exit_code`、`log_tail` 与 `behavior_tests[]`，每项也含 exit_code/log_tail。
- INV-20 N/A：不写 varchar 路径字段。
- INV-21 N/A：不是退役功能复活。
- INV-22：B-02 的错误码契约显式断言失败分支，不能依赖异常。
- INV-23：所有 smoke/验证失败传播非零。
- INV-24 N/A：本 proposer 不更新 journey_features；report 由 controller 后续执行。
- INV-25：B-05 只负责合并门；controller 不得仅凭容器 exit 0 收账。
- INV-26：B-01 核对本次真实 US M4 attestation；可变角色身份从 Runner late-bind，不复用 host 白名单或 GAN 作者先例。
- INV-27：run-manifest 明确 repo、PR、run/attempt 与固定 SHA，供 finalize/watchdog 反查。
- INV-28 N/A：不做模块退役判断。
- INV-29：B-02 API/DB 失败均非零并保留去敏日志，不吞错。
- INV-30：B-02 使用既有 `zenithjoy.acquisition_config`，不建同义表。
- INV-31 N/A：不新增后台 job。
- INV-32 N/A：不新增重叠字段、设备类型或 UI 展示。
- INV-33：Evaluator/Judge/gate 对 final SHA 的 unknown/漂移语义统一为失败。
- INV-34：B-01/E2E 使用 `git rev-parse HEAD` 的已检出 commit 与 `merge-base --is-ancestor`，不以裸 rev-parse 判 ref 存在。
- INV-35：B-02 使用隔离 mktemp worktree 与 attempt DB，不触碰生产 deploy root。
- INV-36：E2E `set -euo pipefail`，任一路径失败非零，不 warning 降级。
- INV-37：B-01 用远端 PR ref 与实际 worktree HEAD 对账，不用 workspace diff 判变。
- INV-38：B-02 真启动 Vitest/Node；不以同步 readFileSync 冒充产品行为。
- INV-39：contract-draft 的 Test Contract 固定四列，测试路径用 backtick。
- INV-40：提交只精确 add 本 Sprint 合同、测试与 task plan，禁止 `git add .`。
- INV-41：B-02 真实覆盖 route/middleware/service/Postgres 接缝，不 mock 被改边。
- INV-42 N/A：不新增 scheduler job。
- INV-43：Generator/proposer 只推分支，禁止自行 merge PR #1581。
- INV-44 N/A：不依赖 headed tmux 子 shell 的隐式环境继承；Fleet attestation 为显式必填。
- INV-45：B-01 核对本 task 的真实远端 PR，每个验收角色只使用其 Runner 当场注入的 capability snapshot，不照抄历史派发结果。
- INV-46：共享 `.github/workflows/*.yml`、smoke allowlist 与质量基础设施不在 scope，禁止修改。
- INV-47：若任何自动机制提前合并，仍必须用 PR head SHA 与双 verdict SHA 对账；不一致即失败。
- INV-48：所有 smoke 铁律由 `set -euo pipefail` 与非零 oracle 执行。
- INV-49 N/A：不改 brain/src。
- INV-50 N/A：不新增 task_type。
- INV-51 N/A：不新增常驻宿主服务。
- INV-52 N/A：不新增 LaunchAgent/LaunchDaemon。
- INV-53 N/A：不改 launchd patrol manifest。
- INV-54：B-01 至 B-05 均可机检，失败非零。
- INV-55：当前 slot 只执行本 proposer 任务，不并发推进其他任务。
- INV-56 N/A：无屏幕坐标/UIA阈值或假设 `.env` 值。
- INV-57：三条接缝在真目标通过前均为 `logic-done-pending`，不得标 done。
- INV-58：B-02 通过真实 signup 创建 A/B 两租户并断言互不串。
- INV-59：DB_URL 与动态 auth secret/cookie 不硬编码、不进 git、不打印。
- INV-60：使用 `example.invalid` 随机邮箱，无客户 PII/聊天内容进日志。
- INV-61：B-02 走真实 better-auth session；无 cookie 不得访问业务端点。
- INV-62：B-02 所有业务读写由 cookie scope 到当前租户，并比较 A/B 全量快照。
