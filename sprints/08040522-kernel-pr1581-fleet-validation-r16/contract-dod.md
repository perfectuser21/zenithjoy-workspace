---
skeleton: false
journey_type: autonomous
---
# Contract DoD — PR #1581 严格 Fleet 真实验证 r16

**范围**: 仅验证精确目标头、三角色真实 Fleet 路由/新鲜证据、fail-closed verdict 与 merge 时序；不修改 PR 产品实现。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] Fleet evidence validator 验签、精确命令、目标 SHA、摘要链与失败语义均有机械断言
  Test: node --check sprints/08040522-kernel-pr1581-fleet-validation-r16/tests/validate-fleet-evidence.mjs

- [ ] [ARTIFACT] Test Contract 的四项覆盖名均为 Vitest it() 名字面子串
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/08040522-kernel-pr1581-fleet-validation-r16/tests/fleet-validation.test.ts','utf8');for(const s of ['Fleet start/completion attestation 签名有效','每项检查均记录在冻结目标 SHA 执行','completion receipt 绑定各角色 evidence','fail-closed verdict'])if(!c.includes(s))process.exit(1)"

- [ ] [ARTIFACT] 共享 Red fixture 相对目标 SHA 不在本合同分支被修改
  Test: git diff --exit-code c305f6217da65bb69413c39e621b7e797e0fb189 -- apps/api/tests/routes/acquisition-dispatch.test.ts

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L3] B-01: 冻结 PR 头保持 OPEN 且三角色命中各自严格 Fleet 路由 [接缝×2]
  动作: 真查 PR #1581 head/state，并校验 Generator、Evaluator、Judge 各自 Fleet 签名 start/completion receipt
  预期观察: head 精确为 c305f621；verdict 前 OPEN；三个 dispatch/attempt/capability 独立，from_target=to_target 且 machine=us-mac-m4
  等待预算: 60s
  留证: GitHub PR JSON、六份签名 receipt、validator stdout
  Test: manual:bash -c ': "${HARNESS_RUNNER_PUBLIC_KEY_PATH:?}"; D="sprints/08040522-kernel-pr1581-fleet-validation-r16"; gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid,state,mergedAt > /tmp/pr1581-final.json; node "$D/tests/validate-fleet-evidence.mjs" "$D/evidence" /tmp/pr1581-final.json "$HARNESS_RUNNER_PUBLIC_KEY_PATH"'

- [ ] [BEHAVIOR] [L3] B-02: Generator 在 detached c305 空库执行完整检查集 [接缝×2]
  动作: Generator 由 Fleet 新派发，在 detached target worktree 先验 HEAD，再 migration 并执行 product-map、真 PG 集成与共享 smoke
  预期观察: 五个 stable check ID 各一次，executed_head_sha 全为 c305f621，集成 7/7 与 smoke 1/1 pass；completion 签名绑定 evidence 摘要
  等待预算: 2400s
  留证: runner-start/complete-generator、generator.json 的命令/exit/log/可信时间窗
  Test: manual:bash -c ': "${HARNESS_RUNNER_PUBLIC_KEY_PATH:?}"; D="sprints/08040522-kernel-pr1581-fleet-validation-r16"; gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid,state,mergedAt > /tmp/pr1581-final.json; node "$D/tests/validate-fleet-evidence.mjs" "$D/evidence" /tmp/pr1581-final.json "$HARNESS_RUNNER_PUBLIC_KEY_PATH"'

- [ ] [BEHAVIOR] [L3] B-03: Evaluator 用独立 detached c305 空库复验并引用 Generator [接缝×2]
  动作: Evaluator 用新的 Fleet dispatch/DB_URL/worktree 重跑相同五项，并现场计算 Generator evidence SHA-256
  预期观察: 与 Generator identity/dispatch 不同；所有 check 在 c305；Generator 摘要相等；completion receipt 签名有效
  等待预算: 2400s
  留证: runner-start/complete-evaluator、evaluator.json、Generator digest 与真实 log_tail
  Test: manual:bash -c ': "${HARNESS_RUNNER_PUBLIC_KEY_PATH:?}"; D="sprints/08040522-kernel-pr1581-fleet-validation-r16"; gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid,state,mergedAt > /tmp/pr1581-final.json; node "$D/tests/validate-fleet-evidence.mjs" "$D/evidence" /tmp/pr1581-final.json "$HARNESS_RUNNER_PUBLIC_KEY_PATH"'

- [ ] [BEHAVIOR] [L3] B-04: Judge 只按签名新证据给 fail-closed verdict [接缝×2]
  动作: Judge 以自己的 late-bound identity 和 Fleet receipt 读取本 run 两份 digest、十项 check exit code 与四项 behavior exit code
  预期观察: PASS 仅在全部检查 exit 0 时允许；签名、摘要、命令、head 或时间窗任一错误只能 FAIL/BLOCKED
  等待预算: 2400s
  留证: runner-start/complete-judge、judge.json、failure-semantics evidence 与 validator stdout
  Test: manual:bash -c ': "${HARNESS_ATTEMPT_ID:?}"; : "${CAPABILITY_SNAPSHOT_ID:?}"; : "${HARNESS_RUNNER_PUBLIC_KEY_PATH:?}"; D="sprints/08040522-kernel-pr1581-fleet-validation-r16"; gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid,state,mergedAt > /tmp/pr1581-final.json; node "$D/tests/validate-fleet-evidence.mjs" "$D/evidence" /tmp/pr1581-final.json "$HARNESS_RUNNER_PUBLIC_KEY_PATH"'

- [ ] [BEHAVIOR] [L3] B-05: verdict 前未合并且结论锚定精确头 [接缝×2]
  动作: Judge verdict 前后真查 head/state/mergedAt，并与签名时间窗及 verdict_at 对账
  预期观察: capture 时 OPEN/null；head 始终精确；若 verdict 后 merge 则 mergedAt 不早于 verdict_at；结论不改写
  等待预算: 60s
  留证: /tmp/pr1581-final.json、judge merge 字段、verdict_at 与 validator stdout
  Test: manual:bash -c ': "${HARNESS_RUNNER_PUBLIC_KEY_PATH:?}"; D="sprints/08040522-kernel-pr1581-fleet-validation-r16"; gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid,state,mergedAt > /tmp/pr1581-final.json; node "$D/tests/validate-fleet-evidence.mjs" "$D/evidence" /tmp/pr1581-final.json "$HARNESS_RUNNER_PUBLIC_KEY_PATH"'

## Invariant 映射

- INV-1 N/A：不触及 cortex learning。
- INV-2：migration、应用与检查只使用同一 Fleet 注入 `DB_URL`。
- INV-3 N/A：不触及 agents 表字段。
- INV-4 N/A：不新增 status 枚举。
- INV-5 N/A：不触及 watchdog recovery。
- INV-6：只按真实 exit_code、签名 receipt 与 verdict 语义判成功。
- INV-7 N/A：不修改依赖 advisory。
- INV-8：Fleet 长等待须有 Runner completion 或明确超时，沉默按失败。
- INV-9：必跑 product-map 与目标头原测试；测试只精确 add 本 Sprint 路径。
- INV-10：B-01 至 B-05 保存真实 exit code，批准前必须真跑。
- INV-11：Node validator 必须真执行，bash -n 不替代行为。
- INV-12：第一条 smoke 铁律映射为 shared-red-smoke 非零阻塞。
- INV-13：第二条 smoke 铁律映射为 fixture diff + smoke 双闸。
- INV-14 N/A：无跨扫描周期行为。
- INV-15 N/A：无付费周期重扫。
- INV-16 N/A：不改跨模块时间常数。
- INV-17：签名 from_target/to_target 必须真实相等，不得文字规避。
- INV-18：target_environment 从 PRD 读取 local_api，Fleet machine 为 us-mac-m4。
- INV-19：Judge 顶层含 exit_code/log_tail/behavior_tests，行为含 exit_code/log_tail/evidence。
- INV-20 N/A：不写长度受限 DB 字段。
- INV-21 N/A：不是退役能力复活。
- INV-22：缺 receipt、签名失败、摘要错配和非零检查均显式 fail-closed。
- INV-23：第三条 smoke 铁律映射为 exact check set 缺项/非零均禁止 PASS。
- INV-24 N/A：不触及 journey_features report。
- INV-25 N/A：不修改 controller merge 后 report。
- INV-26 N/A：不新增 headed 白名单。
- INV-27 N/A：不点火 headed relay。
- INV-28 N/A：不做退役判断。
- INV-29：Fleet/bridge/migration/test 错误不得吞掉，原 exit/log 留证。
- INV-30：只由目标头真实 migration 创建既有表，不新造业务表。
- INV-31 N/A：不新增后台 job。
- INV-32 N/A：不新增重叠字段或设备展示。
- INV-33：Generator/Evaluator/Judge 使用同一 target 与 fail-closed 策略。
- INV-34：git ref 存在性使用 `git rev-parse --verify "<ref>^{commit}"`；head 另真查 GitHub。
- INV-35：临时 detached worktree 只连接 attempt 空 DB，不碰生产资源。
- INV-36：route/migration/test/validator 任一失败均非零并阻塞。
- INV-37：判变基准为 GitHub PR head，不用当前合同工作区 diff 代替。
- INV-38 N/A：不新增 lint-test-quality 源码 inspection。
- INV-39：Test Contract 固定四列，Test File 位于第三列且用反引号。
- INV-40：Red commit 只 add 本 Sprint tests 精确路径。
- INV-41：PR Router/Service/Postgres 接缝由目标头真 migration + 真集成测试覆盖。
- INV-42 N/A：不新增 cron。
- INV-43：Generator 禁止合并 PR，合并权属于 controller。
- INV-44：三角色 Harness 变量由各自 Runner 显式注入并 late-bind。
- INV-45：禁止复用 r15 或上一合同证据；签名 dispatch/time/digest 全量核对。
- INV-46：Generator 不改共享 CI 基础设施或 Red fixture。
- INV-47：提前 merge 时以 head、mergedAt、verdict_at 对账并判违规。
- INV-48：第四条 smoke 铁律映射为 smoke 非零不得 warning 降级。
- INV-49 N/A：不改 brain 源码，无新 allowlist。
- INV-50 N/A：不新增 task_type。
- INV-51 N/A：不检查或修改常驻服务。
- INV-52 N/A：不新增美国 Mac LaunchAgent/Daemon。
- INV-53 N/A：不新增常驻宿主服务或 patrol 条目。
- INV-54：第五条 smoke 铁律映射为 stable shared-red-smoke 与真实 exit code。
- INV-55：单 slot 内 Generator→Evaluator→Judge 串行，同一时刻仅一个实现者。
- INV-56：角色 identity 不写死，全部从 Runner 注入并由签名 receipt 绑定。
- INV-57：Fleet/GitHub/Postgres/目标 worktree 接缝必须真验后才 done。
- INV-58：Final E2E 真实 signup 两个 tenant/cookie 并断言隔离。
- INV-59：DB_URL、Harness secrets、Runner 私钥不硬编码、不进 git/log；私钥不挂载。
- INV-60：log_tail 禁止 cookie/token/email 等 PII；临时文件由 trap 删除。
- INV-61：不新增 API；Final E2E 用现有 signup/session 访问受鉴权 config endpoint。
- INV-62：两个 signup tenant 分别读写并按 session scope，禁止跨租户混读写。
