---
skeleton: false
journey_type: autonomous
---
# Contract DoD — PR #1581 真实 fleet 验证 r12

**范围**: 精确 SHA 的新鲜真实验证、双裁决证据与人工合并确认门；不修改产品实现。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `evidence/fleet-run.json`、`evaluator.json`、`independent-judge.json`、`merge-gate.json` 均由本 attempt 新生成并保留原始 log_tail。
  Test: node -e "for(const f of ['fleet-run.json','evaluator.json','independent-judge.json','merge-gate.json'])JSON.parse(require('fs').readFileSync('sprints/08032258-kernel-pr1581-fleet-validation-r12/evidence/'+f,'utf8'))"

- [ ] [ARTIFACT] 共享 Red fixture 与 PR #1581 产品文件未被本 Sprint 修改。
  Test: git diff --exit-code c305f6217da65bb69413c39e621b7e797e0fb189 -- apps/api/src apps/api/tests/routes/acquisition-dispatch.test.ts sprints/08030017-kernel-acquisition-config-recovery-181/tests

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 入口锁定真实 PR head、US M4 affinity 与精确 SHA [接缝×2]
  动作: 查询 GitHub PR #1581 当前 head，并读取本 attempt fleet-run 原始执行字段
  预期观察: head/final_sha、machine、provider/account/model、snapshot 与 digest 全部逐字匹配冻结 PRD
  等待预算: 30s
  留证: GitHub API stdout 与 evidence/fleet-run.json
  Test: manual:bash -c 'H=$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 --jq .head.sha); [ "$H" = c305f6217da65bb69413c39e621b7e797e0fb189 ] && jq -e ".run_id==\"bfaf1e49-a8cb-401e-9fc3-d6c62c457edc\" and .attempt_id==\"5a73ee03-e897-4209-95b1-67c91f0f182a\" and .machine==\"us-mac-m4\" and .final_sha==\"$H\" and .provider==\"codex\" and .account==\"team2\" and .model==\"gpt-5.6-sol\" and .capability_snapshot_id==\"cc3550be-875a-48d3-9be4-24343fb355a9\" and .runner_digest==\"sha256:e0797f5a440d61827d1ea86afee629e6f5a687da6f958608671ba9c873e5e94a\"" sprints/08032258-kernel-pr1581-fleet-validation-r12/evidence/fleet-run.json'

- [ ] [BEHAVIOR] [L2] B-02: 本 attempt 真产品 effective-config 验证通过 [接缝×2]
  动作: 在 attempt 空库完成 migration/signup/session-cookie 后，对精确 SHA 运行真实 API 与真 Postgres 回归
  预期观察: pipeline_status=passed、product_validation.exit_code=0，执行时间不超过 7200s
  等待预算: 7200s
  留证: fleet-run.json 的 product_validation.log_tail/log_path 与 API/Vitest 输出
  Test: manual:bash -c 'jq -e ".run_id==\"bfaf1e49-a8cb-401e-9fc3-d6c62c457edc\" and .attempt_id==\"5a73ee03-e897-4209-95b1-67c91f0f182a\" and .pipeline_status==\"passed\" and .product_validation.exit_code==0 and ((.finished_at|fromdateiso8601)-(.started_at|fromdateiso8601)<=7200)" sprints/08032258-kernel-pr1581-fleet-validation-r12/evidence/fleet-run.json'

- [ ] [BEHAVIOR] [L2] B-03: Evaluator 新鲜 PASS 且证据结构完整 [接缝×2]
  动作: 读取本 attempt Evaluator 原始 verdict 并与 fleet started_at、final SHA 对账
  预期观察: role=evaluator、verdict=PASS、exit_code=0，behavior_tests 非空且逐项完整
  等待预算: 300s
  留证: evidence/evaluator.json 与 evaluator log_tail
  Test: manual:bash -c 'npx vitest run sprints/08032258-kernel-pr1581-fleet-validation-r12/tests/fleet-validation-evidence.test.ts -t "Evaluator 新鲜 PASS 证据绑定本 attempt 和最终 SHA" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-04: Independent Judge 新鲜独立 PASS 且结构完整 [接缝×2]
  动作: 独立读取 Judge verdict，与 Evaluator 对账 run/attempt/SHA 并比较 evidence_id
  预期观察: Judge PASS、完整 behavior_tests，且 evidence_id 与 Evaluator 不同
  等待预算: 300s
  留证: evidence/independent-judge.json 与 judge log_tail
  Test: manual:bash -c 'npx vitest run sprints/08032258-kernel-pr1581-fleet-validation-r12/tests/fleet-validation-evidence.test.ts -t "Independent Judge 新鲜独立 PASS 证据绑定本 attempt 和最终 SHA" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-05: SHA 漂移或缺证时 fail-closed
  动作: 对四份原始 evidence 执行统一 schema/SHA/run/attempt 断言
  预期观察: 任一缺失、旧 attempt、非 PASS、结构不全或 SHA 不同均使测试非零
  等待预算: 30s
  留证: Vitest 四项 stdout 与 failure stack
  Test: manual:bash -c 'npx vitest run sprints/08032258-kernel-pr1581-fleet-validation-r12/tests/fleet-validation-evidence.test.ts --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-06: 双裁决完成后仅开放人工确认且未自动合并
  动作: 对账 merge gate、Evaluator 与 Judge evidence_id，并检查实际 merge 标志
  预期观察: eligible=true、human_confirmation_required=true、merge_performed=false
  等待预算: 30s
  留证: evidence/merge-gate.json 与测试 stdout
  Test: manual:bash -c 'npx vitest run sprints/08032258-kernel-pr1581-fleet-validation-r12/tests/fleet-validation-evidence.test.ts -t "双裁决齐备后仍只开放人工确认而未自动合并" --reporter=verbose'

## Invariant 映射

- INV-1 N/A：不把结构检查冒充产品全链；B-02 要求真链。
- INV-2：migration、signup、API 与校验统一使用 `DB_URL`。
- INV-3 N/A：不读取 agents 表字段。
- INV-4 N/A：不新增 status 枚举。
- INV-5：中断保留原因并从新 attempt 重跑，不借旧结果恢复。
- INV-6：所有成功判定检查 verdict/pipeline_status/exit_code 语义字段。
- INV-7 N/A：不改依赖或 audit 白名单。
- INV-8：长跑由 fleet 控制面维持心跳；失联即失败。
- INV-9 N/A：本 Sprint 不毕业产品测试。
- INV-10：B-01 至 B-06 均记录真实 exit code 与解释器输出。
- INV-11 N/A：无 manual:node 双引号插值。
- INV-12：缺 evidence 的新测试真实 Red，生成本 attempt 证据后转绿。
- INV-13：ARTIFACT diff 禁止修改共享 Red fixture。
- INV-14 至 INV-16 N/A：不改周期扫描、付费调用或时间常数。
- INV-17 N/A：任务不新增设备能力。
- INV-18：target_environment 保持 local_api，fleet machine 另由严格 affinity 校验。
- INV-19：Judge evidence 强制顶层 exit_code/log_tail/behavior_tests[] 完整。
- INV-20 至 INV-22 N/A：不改 DB 字段、退役能力或错误码实现。
- INV-23：空库 migration 或真 Postgres 不可用即非零。
- INV-24：合并前不宣称 report 完成。
- INV-25：merge gate 不以容器 exit 0 单信号完成。
- INV-26：host 白名单同时核对实际 fleet evidence，不靠字符串标签。
- INV-27 N/A：不点火 headed relay。
- INV-28 至 INV-32 N/A：不退役、不加 job/table/字段/UI。
- INV-33：PR head、final_sha 与 verdict SHA 统一 exact-match 语义。
- INV-34：git ref 验证使用精确 worktree commit，远端真相使用 GitHub API。
- INV-35 N/A：不以生产 deploy root 跑 smoke。
- INV-36：任一链路失败传播非零且禁止 warning 降级。
- INV-37：判变使用 GitHub PR 实体 head，不用 workspace diff。
- INV-38：B-02 真执行 API/Postgres；ARTIFACT 检查不冒充行为。
- INV-39：Test Contract 固定四列，路径用 backtick。
- INV-40：Red 仅允许精确 add 本 Sprint test 文件。
- INV-41：被验证的 router/service/DB 边不 mock。
- INV-42 N/A：不新增 cron。
- INV-43：Generator/验证角色禁止 merge，只写 merge gate evidence。
- INV-44 N/A：不依赖 headed shell 环境继承。
- INV-45：只使用本 run/attempt 与精确目标 SHA，禁止复用先例执行史。
- INV-46：禁止修改共享 workflow/allowlist。
- INV-47：Evaluator/Judge 完成前 merge_performed 必须 false。
- INV-48：所有 smoke 失败真实传播。
- INV-49 至 INV-53 N/A：不改 brain、task_type 或宿主服务。
- INV-54：B-01 至 B-06 可机检且失败非零。
- INV-55：本会话只执行当前 proposer 角色。
- INV-56 N/A：无坐标/UIA/隐式 env 假设。
- INV-57：三条接缝未真验前均为 logic-done-pending。
- INV-58：真实 signup 建两个租户并断言不同 tenant ID。
- INV-59：DB/secrets 仅运行时注入，不进 git/log。
- INV-60：随机 example.invalid 身份，无客户 PII 输出。
- INV-61：业务 API 仅用真实 signup session cookie 鉴权。
- INV-62：A/B cookie 对应不同 tenant，配置断言不串租户。
