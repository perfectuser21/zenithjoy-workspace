---
skeleton: false
journey_type: autonomous
---
# Contract DoD — PR #1581 严格 Fleet 验证 r16

**范围**: 仅验证冻结 PR head 的全新 Generator/Evaluator/Judge 证据链；不修改产品实现或共享 Red fixture。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `evidence/run-manifest.json` 固定本 run/repo/PR/head/strict machine/runner digest，且不含角色 attempt/account/capability 字面值
  Test: node -e "const j=require('./sprints/08040522-kernel-pr1581-fleet-validation-r16/evidence/run-manifest.json');if(j.run_id!=='5a037785-2708-489e-9912-b20494f11fd9'||j.target_head_sha!=='c305f6217da65bb69413c39e621b7e797e0fb189')process.exit(1)"

- [ ] [ARTIFACT] `generator.json`、`evaluator.json`、`judge.json` 均符合证据格式且由摘要串联
  Test: node sprints/08040522-kernel-pr1581-fleet-validation-r16/tests/validate-fleet-evidence.mjs sprints/08040522-kernel-pr1581-fleet-validation-r16/evidence /tmp/pr1581-final.json

- [ ] [ARTIFACT] 共享 Red fixture 相对目标头无修改
  Test: git diff --exit-code c305f6217da65bb69413c39e621b7e797e0fb189 -- apps/api/tests/routes/acquisition-dispatch.test.ts

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L3] B-01: 严格 us-mac-m4 Generator 对精确 PR 头生成全新证据 [接缝×2]
  动作: Fleet 将 Generator 派发到严格目标，真查 PR #1581 head/state 并在精确 checkout 上执行 PR 原合同测试
  预期观察: receipt 无 fallback，machine=us-mac-m4，head 精确匹配，PR=OPEN，真实 checks 全部保留 exit_code/log_tail
  等待预算: 2400s
  留证: evidence/generator.json、routing receipt、测试 stdout 尾部与共享 fixture diff
  Test: manual:bash -c 'F="sprints/08040522-kernel-pr1581-fleet-validation-r16/evidence/generator.json"; H=$(gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid -q .headRefOid); [ "$H" = "c305f6217da65bb69413c39e621b7e797e0fb189" ] && jq -e --arg h "$H" '\''(.role=="generator") and (.run_id=="5a037785-2708-489e-9912-b20494f11fd9") and (.target_head_sha==$h) and (.provenance.machine=="us-mac-m4") and (.routing.fallback_used==false) and (.pr_state_at_capture=="OPEN") and (.checks|length>0) and ([.checks[].exit_code]|all(.==0))'\'' "$F"'

- [ ] [BEHAVIOR] [L3] B-02: Evaluator 独立重跑并引用 Generator 真实摘要 [接缝×2]
  动作: 在严格 us-mac-m4 上以新的 Evaluator attempt 对同一 head 重跑，不读取 r15 证据
  预期观察: Evaluator attempt 与 Generator 不同；generator_evidence_sha256 等于现场计算值；失败信号与 exit code 保留
  等待预算: 2400s
  留证: evidence/evaluator.json、Generator SHA-256、Evaluator checks stdout/log_tail
  Test: manual:bash -c 'D="sprints/08040522-kernel-pr1581-fleet-validation-r16/evidence"; G=$(shasum -a 256 "$D/generator.json"|awk "{print \\$1}"); GA=$(jq -er .provenance.attempt_id "$D/generator.json"); jq -e --arg g "$G" --arg ga "$GA" '\''(.role=="evaluator") and (.generator_evidence_sha256==$g) and (.provenance.attempt_id!=$ga) and (.provenance.machine=="us-mac-m4") and (.routing.fallback_used==false) and (.checks|length>0) and ([.checks[]|has("exit_code") and has("log_tail")]|all)'\'' "$D/evaluator.json"'

- [ ] [BEHAVIOR] [L3] B-03: Judge 用自己的 runtime identity 锚定两份证据并给合法 verdict [接缝×2]
  动作: Independent Judge 读取本 run Generator/Evaluator 文件并现场计算两个 SHA-256
  预期观察: Judge provenance 等于 Judge 当前 HARNESS_* 与 CAPABILITY_SNAPSHOT_ID；三个 attempt 两两不同；verdict 仅 PASS/FAIL/BLOCKED
  等待预算: 2400s
  留证: evidence/judge.json、两份输入摘要、behavior_tests exit_code/log_tail
  Test: manual:bash -c ': "${HARNESS_ATTEMPT_ID:?}"; : "${CAPABILITY_SNAPSHOT_ID:?}"; D="sprints/08040522-kernel-pr1581-fleet-validation-r16/evidence"; G=$(shasum -a 256 "$D/generator.json"|awk "{print \\$1}"); E=$(shasum -a 256 "$D/evaluator.json"|awk "{print \\$1}"); jq -e --arg g "$G" --arg e "$E" --arg a "$HARNESS_ATTEMPT_ID" --arg c "$CAPABILITY_SNAPSHOT_ID" '\''(.role=="judge") and (.generator_evidence_sha256==$g) and (.evaluator_evidence_sha256==$e) and (.provenance.attempt_id==$a) and (.provenance.capability_snapshot_id==$c) and (.verdict|IN("PASS","FAIL","BLOCKED")) and (.behavior_tests|length>=4) and ([.behavior_tests[]|has("exit_code") and has("log_tail")]|all)'\'' "$D/judge.json"'

- [ ] [BEHAVIOR] [L3] B-04: verdict 前保持未合并且失败不降级 [接缝×2]
  动作: Judge 写 verdict 前真查 PR state/mergedAt，写完后再次真查 head 与 mergedAt 并运行时序 validator
  预期观察: judge 记录 verdict 前 OPEN/null；当前 head 未变化；若之后已 merge，其 mergedAt 不早于 verdict_at；FAIL/BLOCKED 原样输出
  等待预算: 60s
  留证: /tmp/pr1581-final.json、judge verdict_at/pr_state_before_verdict、validator stdout
  Test: manual:bash -c 'D="sprints/08040522-kernel-pr1581-fleet-validation-r16"; gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid,state,mergedAt > /tmp/pr1581-final.json; node "$D/tests/validate-fleet-evidence.mjs" "$D/evidence" /tmp/pr1581-final.json'

- [ ] [BEHAVIOR] [L2] B-05: 角色 provenance 独立且时间顺序有效
  动作: 对 run manifest 与三角色 JSON 执行 schema、时间窗、attempt 唯一性及摘要完整性校验
  预期观察: started_at≤generator≤evaluator≤judge≤started_at+7200s；角色 identity 非空且 attempt 两两不同
  等待预算: 0s
  留证: validate-fleet-evidence.mjs stdout 与失败字段名
  Test: manual:bash -c 'D="sprints/08040522-kernel-pr1581-fleet-validation-r16"; node "$D/tests/validate-fleet-evidence.mjs" "$D/evidence" /tmp/pr1581-final.json'

## Invariant 映射

- INV-1 N/A：不触及 cortex learning。
- INV-2 N/A：本验证不写业务 DB，DB_NAME 规则不适用。
- INV-3 N/A：不触及 agents 表字段。
- INV-4 N/A：不新增 status 枚举。
- INV-5 N/A：不触及 watchdog_overdue relay recovery。
- INV-6：三角色必须按 exit_code/verdict 语义判成功，禁止只看文件存在。
- INV-7 N/A：不改依赖或 advisory。
- INV-8：Fleet/bridge 长等待由角色 receipt 保留心跳/失败信号；无心跳超时按失败。
- INV-9：PR 原测试入册状态不改；目标头须执行既有 lint-tdd-commit-order 与 check-test-coverage 并保存 exit code。
- INV-10：B-01 至 B-05 均保留 manual oracle 真实 exit code 与解释器/工具输出。
- INV-11：manual Node validator 必须真执行，bash -n 仅用于合同语法自查。
- INV-12：第一条 smoke 铁律映射为 PR 原 smoke 真执行且失败不可吞掉。
- INV-13：第二条 smoke 铁律映射为共享 Red fixture 相对目标头 diff 为空且原 smoke 真执行。
- INV-14 N/A：无跨扫描周期行为。
- INV-15 N/A：无付费周期重扫。
- INV-16 N/A：不改跨模块时间常数。
- INV-17：严格 machine/digest/routing receipt 与目标产品环境真实匹配。
- INV-18：target_environment 从任务 payload/PRD 读取为 local_api，真实角色由 Fleet 锁定 us-mac-m4。
- INV-19：Judge evidence 顶层及 behavior_tests 均含 exit_code/log_tail。
- INV-20 N/A：不写有长度约束的 DB 字段。
- INV-21 N/A：不是退役功能复活。
- INV-22：缺证/错 SHA/null/false 全部显式失败。
- INV-23：第三条 smoke 铁律映射为证据 validator 与 PR 原 smoke 均以真实非零退出阻塞。
- INV-24 N/A：不触及 journey_features report。
- INV-25 N/A：不修改 controller merge 后 report 逻辑；controller 仍须完成 report。
- INV-26 N/A：无 headed 人工接管白名单变更。
- INV-27 N/A：不点火 headed relay。
- INV-28 N/A：不做退役判断。
- INV-29：Fleet/bridge/test catch 不得吞错，证据记录失败原因与连续失败信号。
- INV-30 N/A：不新建或复用业务表。
- INV-31 N/A：不新增后台 job。
- INV-32 N/A：不新增重叠字段或设备展示。
- INV-33：Generator/Evaluator/Judge 对 head、失败和 verdict 采用同一 fail-closed 策略。
- INV-34：需要判断 Git ref 时使用 `git rev-parse --verify "<ref>^{commit}"`；PR head 另以 GitHub API 对账。
- INV-35：目标 checkout 只跑声明测试，不触碰生产业务资源。
- INV-36：任何 Fleet/test/validator 失败必须告警并非零退出。
- INV-37：候选基准使用 PR 自报 head 与 GitHub 对账，不使用工作区 diff 判变。
- INV-38 N/A：不新增 lint-test-quality 源码检查测试。
- INV-39：Test Contract 固定四列，Test File 位于第三列且路径用反引号。
- INV-40：Red commit 只 add 本 Sprint tests 精确路径。
- INV-41：调度接线虽可做零 mock 源码检查，但本合同仍以真实 Fleet receipt 提供直接证据。
- INV-42 N/A：不新增 cron。
- INV-43：Generator 禁止合并 PR，合并权属于 controller。
- INV-44：每个角色子 shell 所需 HARNESS 上下文由 Runner 显式注入。
- INV-45：不复用历史合同证据；run/head/attempt/digest 与本次真实派发全量核对。
- INV-46：Generator 不改共享 CI 基础设施。
- INV-47：PR 提前 merge 时用 PR head、verdict head、mergedAt/verdict_at 对账并判违规。
- INV-48：第四条 smoke 铁律映射为所有 smoke 失败不可吞掉。
- INV-49 N/A：不改 brain 源码，无 smoke/allowlist 新登记。
- INV-50 N/A：不新增 task_type。
- INV-51 N/A：不检查常驻服务 launchctl/port。
- INV-52 N/A：不新增美国 Mac LaunchAgent/Daemon。
- INV-53 N/A：不新增常驻宿主服务或 launchd-patrol 条目。
- INV-54：第五条 smoke 铁律映射为目标头既有 smoke 真执行、真实 exit code 留证。
- INV-55：单 slot 角色按 Generator→Evaluator→Judge 串行，同一时刻仅一个实现者。
- INV-56：除稳定 machine/head/digest 外不写死环境假设；role identity late-bound。
- INV-57：Fleet/GitHub/真实测试接缝只有真目标通过才 done。
- INV-58：本 Sprint 不新增租户读写；PR 原测试与 E2E 仍须覆盖两个租户并断言隔离。
- INV-59：secrets 仅由 Runner/Fleet 注入，不进 git/log。
- INV-60：log_tail 禁止包含 token/cookie/PII。
- INV-61 N/A：不新增 API 端点；PR 原端点鉴权测试必须保持。
- INV-62：不新增租户查询/写入；PR 原隔离断言必须保持，禁止跨租户混读写。
