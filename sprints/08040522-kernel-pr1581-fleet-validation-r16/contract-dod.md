---
skeleton: false
journey_type: autonomous
---
# Contract DoD — PR #1581 严格 Fleet 验证 r16

**范围**: 只验证冻结目标头的全新 Generator/Evaluator/Judge 证据链；不修改产品实现、共享 Red fixture 或合并 PR。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `run-manifest.json` 只固化 run/repo/PR/head/machine/digest，不含未来角色 identity
  Test: node -e "const j=require('./sprints/08040522-kernel-pr1581-fleet-validation-r16/evidence/run-manifest.json');if(j.run_id!=='5a037785-2708-489e-9912-b20494f11fd9'||j.target_head_sha!=='c305f6217da65bb69413c39e621b7e797e0fb189'||'attempt_id' in j)process.exit(1)"

- [ ] [ARTIFACT] 三角色各有独立 `routing-<role>.json` 与 `<role>.json`，且 evidence 引用 routing 文件现场 SHA-256
  Test: node sprints/08040522-kernel-pr1581-fleet-validation-r16/tests/validate-fleet-evidence.mjs sprints/08040522-kernel-pr1581-fleet-validation-r16/evidence /tmp/pr1581-final.json

- [ ] [ARTIFACT] 共享 Red fixture 相对冻结目标头无修改
  Test: git diff --exit-code c305f6217da65bb69413c39e621b7e797e0fb189 -- apps/api/tests/routes/acquisition-dispatch.test.ts

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L3] B-01: 三角色各自命中严格 us-mac-m4 Runner [接缝×2]
  动作: 按 Generator→Evaluator→Judge 串行派发，逐角色读取 Runner routing attestation
  预期观察: 每份 attestation 绑定该角色自己的 attempt/capability，from_target=to_target，machine=us-mac-m4，receipt ID 两两不同
  等待预算: 7200s
  留证: evidence/routing-generator.json、routing-evaluator.json、routing-judge.json 与三个 SHA-256
  Test: manual:bash -c 'D="sprints/08040522-kernel-pr1581-fleet-validation-r16"; gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid,state,mergedAt > /tmp/pr1581-final.json; node "$D/tests/validate-fleet-evidence.mjs" "$D/evidence" /tmp/pr1581-final.json'

- [ ] [BEHAVIOR] [L3] B-02: Generator 从空库执行五个 stable check 并生成全新证据 [接缝×2]
  动作: 在 Generator attempt-scoped DB_URL 上先 migration，再执行 product-map、真 Postgres integration、共享 Red smoke 与 fixture diff
  预期观察: checks 恰含五个 stable ID，命令逐字匹配合同，目标表存在且所有 exit_code=0
  等待预算: 2400s
  留证: evidence/generator.json 的 check_id/command/exit_code/log_tail 与 migration 输出
  Test: manual:bash -c 'F="sprints/08040522-kernel-pr1581-fleet-validation-r16/evidence/generator.json"; jq -e '\''(.checks|map(.check_id)|sort)==["db-empty-bootstrap","effective-config-integration","fixture-unchanged","product-map-contract","shared-red-smoke"] and ([.checks[].exit_code]|all(.==0)) and .exit_code==0'\'' "$F"'

- [ ] [BEHAVIOR] [L3] B-03: Evaluator 用独立空库重跑同一精确检查集 [接缝×2]
  动作: Evaluator 以自己的 Runner receipt 和 DB_URL 对同一目标头重跑五项检查并现场摘要 Generator evidence
  预期观察: Evaluator 与 Generator attempt/capability/receipt 均不同，五个 exact commands 无漂移，摘要相等且全部 exit 0
  等待预算: 2400s
  留证: evidence/evaluator.json、routing-evaluator.json、Generator SHA-256 与真实 log_tail
  Test: manual:bash -c 'D="sprints/08040522-kernel-pr1581-fleet-validation-r16"; gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid,state,mergedAt > /tmp/pr1581-final.json; node "$D/tests/validate-fleet-evidence.mjs" "$D/evidence" /tmp/pr1581-final.json'

- [ ] [BEHAVIOR] [L3] B-04: Judge 独立路由且非零检查不得映射为 PASS [接缝×2]
  动作: Judge 用自己的 runtime identity/receipt 读取本 run 两份摘要与所有 exit_code，按 fail-closed 规则给 verdict
  预期观察: PASS 仅在 Generator/Evaluator 顶层和十个必跑 checks、Judge 四个 behavior checks 全为 0 时允许；否则只能 FAIL/BLOCKED
  等待预算: 2400s
  留证: evidence/judge.json、routing-judge.json、failure-semantics check 的 exit_code/log_tail/evidence
  Test: manual:bash -c ': "${HARNESS_ATTEMPT_ID:?}"; : "${CAPABILITY_SNAPSHOT_ID:?}"; D="sprints/08040522-kernel-pr1581-fleet-validation-r16"; gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid,state,mergedAt > /tmp/pr1581-final.json; node "$D/tests/validate-fleet-evidence.mjs" "$D/evidence" /tmp/pr1581-final.json'

- [ ] [BEHAVIOR] [L3] B-05: verdict 前未合并且结论锚定精确头 [接缝×2]
  动作: Judge verdict 前后真查 PR head/state/mergedAt，并将查询结果交 validator 与 verdict_at 对账
  预期观察: head 精确匹配；verdict 前 OPEN/null；若之后 merge 则 mergedAt 不早于 verdict_at；PASS/FAIL/BLOCKED 不被改写
  等待预算: 60s
  留证: /tmp/pr1581-final.json、judge verdict_at/pr_state_before_verdict/pr_merged_at_before_verdict 与 validator stdout
  Test: manual:bash -c 'D="sprints/08040522-kernel-pr1581-fleet-validation-r16"; gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid,state,mergedAt > /tmp/pr1581-final.json; node "$D/tests/validate-fleet-evidence.mjs" "$D/evidence" /tmp/pr1581-final.json'

## Invariant 映射

- INV-1 N/A：不触及 cortex learning。
- INV-2：migration 与目标表检查均使用同一 `DB_URL` 推导，不允许 DB 名分叉。
- INV-3 N/A：不触及 agents 表字段。
- INV-4 N/A：不新增 status 枚举。
- INV-5 N/A：不触及 watchdog_overdue recovery。
- INV-6：只按 stable checks/behavior_tests 的 exit_code 与 verdict 语义判成功。
- INV-7 N/A：不修改依赖 advisory。
- INV-8：Fleet 长等待须由 routing/evidence 保存心跳或明确超时，沉默超时按失败。
- INV-9：必跑 `product-map-contract` 与 PR 原测试；本 Sprint 测试仅精确 add，不改质量门禁。
- INV-10：B-01 至 B-05 均保存 manual oracle 真实 exit code，批准前必须真跑。
- INV-11：Node validator 必须真执行，bash -n 只验脚本语法而不替代行为。
- INV-12：第一条 smoke 铁律映射为 `shared-red-smoke` 非零阻塞。
- INV-13：第二条 smoke 铁律映射为 `fixture-unchanged` + `shared-red-smoke` 双闸。
- INV-14 N/A：无跨扫描周期行为。
- INV-15 N/A：无付费周期重扫。
- INV-16 N/A：不改跨模块时间常数。
- INV-17：三角色 route attestation 的真实目标必须匹配，不得文字规避。
- INV-18：target_environment 从 payload/PRD 读取为 local_api，Fleet strict machine 为 us-mac-m4。
- INV-19：Judge 顶层及 behavior_tests 均强制 exit_code/log_tail，行为另带 verification_level/evidence。
- INV-20 N/A：不写长度受限 DB 字段。
- INV-21 N/A：不是退役功能复活。
- INV-22：缺证、null/false route、摘要错配和非零检查均显式 fail-closed。
- INV-23：第三条 smoke 铁律映射为 exact check set 缺项/非零均禁止 PASS。
- INV-24 N/A：不触及 journey_features report。
- INV-25 N/A：不修改 controller merge 后 report；controller 仍须完成 report。
- INV-26 N/A：不新增 headed 白名单。
- INV-27 N/A：不点火 headed relay。
- INV-28 N/A：不做退役判断。
- INV-29：Fleet/bridge/migration/test 错误不得吞掉，原 exit_code/log_tail 留证。
- INV-30：只由真实 migration 创建既有表，不新造业务表。
- INV-31 N/A：不新增后台 job。
- INV-32 N/A：不新增语义重叠字段或设备展示。
- INV-33：Generator/Evaluator/Judge 使用同一 exact check 与 fail-closed 规则。
- INV-34：需要判断 git ref 时使用 `git rev-parse --verify "<ref>^{commit}"`；PR head 另真查 GitHub。
- INV-35：attempt worktree 只连接 Fleet 提供的短期空 DB，不碰生产资源。
- INV-36：任何 route/migration/test/validator 失败均非零并阻塞合格验证。
- INV-37：判变基准为 GitHub PR 自报 head `c305...`，不用工作区 diff 替代；fixture diff 仅查禁止修改项。
- INV-38 N/A：不新增 lint-test-quality 源码 inspection 测试。
- INV-39：Test Contract 固定四列，Test File 位于第三列且用反引号。
- INV-40：Red commit 只 add 本 Sprint 两个 tests 精确路径。
- INV-41：PR Router/Service/Postgres 接缝由真 migration + 真集成测试直接覆盖。
- INV-42 N/A：不新增 cron。
- INV-43：Generator 禁止合并 PR，合并权属于 controller。
- INV-44：三角色各自所需 Harness runtime 变量由 Runner 显式注入并 late-bind。
- INV-45：禁止复用历史 r15/合同证据；本 run/head/receipt/attempt 全量核对。
- INV-46：Generator 不改共享 CI 基础设施或 Red fixture。
- INV-47：PR 提前 merge 时以 head、mergedAt、verdict_at 对账并判流程违规。
- INV-48：第四条 smoke 铁律映射为 smoke 非零不得 warning 降级。
- INV-49 N/A：不改 brain 源码，无新 smoke/allowlist 登记。
- INV-50 N/A：不新增 task_type。
- INV-51 N/A：不检查或修改常驻服务 launchctl/port。
- INV-52 N/A：不新增美国 Mac LaunchAgent/Daemon。
- INV-53 N/A：不新增常驻宿主服务或 launchd-patrol 条目。
- INV-54：第五条 smoke 铁律映射为 stable `shared-red-smoke` command 与真实 exit code。
- INV-55：单 slot 内 Generator→Evaluator→Judge 串行；同一时刻仅一个实现者。
- INV-56：除冻结 run/head/machine/digest 外不写死角色 identity；全部 late-bound。
- INV-57：Fleet/GitHub/Postgres/真实测试接缝必须真目标验过才 done。
- INV-58：Final E2E 通过真实 signup 创建两个 tenant/cookie 并断言隔离；不预注入业务身份。
- INV-59：DB_URL 与 Harness/Fleet secrets 不硬编码、不进 git、不进日志。
- INV-60：log_tail 禁止 cookie/token/邮箱等 PII；signup 文件和 cookie jar 由 trap 删除。
- INV-61：不新增 API；Final E2E 通过现有 better-auth signup/session 访问受鉴权 config endpoint。
- INV-62：两个真实 signup tenant 分别读写，tenant ID 从本 attempt DB 查询，禁止跨租户混读写。
