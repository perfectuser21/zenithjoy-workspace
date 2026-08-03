---
skeleton: false
journey_type: autonomous
---
# Contract DoD — PR #1581 真实 fleet 验证 r17

**范围**: 精确 SHA 的新鲜 Generator、Evaluator、Judge 证据链与裁决前未合并门；不修改产品实现。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 三角色 evidence、各自 `runner-attestation.json` 与 Generator receipt 均由对应角色新生成并保留原始 log_tail/evidence。
  Test: node -e "for(const r of ['generator','evaluator','judge'])for(const s of ['.json','.runner-attestation.json'])JSON.parse(require('fs').readFileSync('sprints/08040600-kernel-pr1581-fleet-validation-r17/evidence/'+r+s,'utf8'));require('fs').accessSync('sprints/08040600-kernel-pr1581-fleet-validation-r17/evidence/generator.receipt.sha256')"

- [ ] [ARTIFACT] 当前 GAN authoring attempt/capability UUID 未固化进合同或测试。
  Test: bash -c "! rg -n '(attempt_id|capability_snapshot_id).*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' sprints/08040600-kernel-pr1581-fleet-validation-r17/contract-draft.md sprints/08040600-kernel-pr1581-fleet-validation-r17/contract-dod.md sprints/08040600-kernel-pr1581-fleet-validation-r17/tests"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: Generator 新鲜证据绑定运行时身份和目标 SHA [接缝×2]
  动作: 在 us-mac-m4 对精确 SHA 跑空库 migration、真实 signup/cookie 与双租户产品验证
  预期观察: Generator 证据逐字段匹配其独立 Runner attestation，真实并发响应状态为 200/400、失败码为 INVALID_CONFIG、最终 min<=max，且目标 SHA 和实际机器精确匹配
  等待预算: 7200s
  留证: evidence/generator.json 中 concurrent_effective_config、generator.receipt.sha256 与产品 log_tail
  Test: manual:bash -c 'npx vitest run sprints/08040600-kernel-pr1581-fleet-validation-r17/tests/fleet-validation-evidence.test.ts -t "Generator 新鲜证据绑定运行时身份和目标 SHA" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-02: Evaluator 使用自己的身份并引用 Generator receipt 摘要 [接缝×2]
  动作: Evaluator 独立读取 Generator 证据和 receipt，以自己的 Runner identity 执行验收
  预期观察: verdict=PASS、结构完整且逐字段匹配 Evaluator Runner attestation，generator_receipt_sha256 等于真实 receipt，且 Evaluator 与 Generator 的 attempt/capability snapshot 分别不相等
  等待预算: 600s
  留证: evidence/evaluator.json、Generator receipt 与 evaluator log_tail
  Test: manual:bash -c 'npx vitest run sprints/08040600-kernel-pr1581-fleet-validation-r17/tests/fleet-validation-evidence.test.ts -t "Evaluator 使用自己的身份并引用 Generator receipt 摘要" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-03: Judge 使用自己的身份引用 Evaluator 摘要且裁决前未合并 [接缝×2]
  动作: Judge 独立读取 Evaluator evidence，以自身 Runner identity 裁决并查询 GitHub PR 状态
  预期观察: Judge evidence 逐字段匹配 Judge Runner attestation，evaluator_evidence_sha256 精确匹配；三角色 attempt/capability snapshot 各自两两不相等；最终 verdict 明确；PR 仍 open、未合并且 head 未漂移
  等待预算: 600s
  留证: evidence/judge.json、Evaluator SHA-256、GitHub PR API 与 judge log_tail
  Test: manual:bash -c 'PR=$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581); echo "$PR" | jq -e '\''.state=="open" and .merged==false and .merged_at==null and .head.sha=="c305f6217da65bb69413c39e621b7e797e0fb189"'\'' >/dev/null; npx vitest run sprints/08040600-kernel-pr1581-fleet-validation-r17/tests/fleet-validation-evidence.test.ts -t "Judge 使用自己的身份引用 Evaluator 摘要且裁决前未合并" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-04: 任一缺证或身份摘要漂移均不能判通过
  动作: 对三角色证据执行统一 schema、runtime identity、SHA 与摘要链断言
  预期观察: 缺文件、空身份、错误机器、旧 SHA、摘要断裂或不明确 verdict 任一情况均非零
  等待预算: 30s
  留证: Vitest stdout 与 failure stack
  Test: manual:bash -c 'npx vitest run sprints/08040600-kernel-pr1581-fleet-validation-r17/tests/fleet-validation-evidence.test.ts --reporter=verbose'

## Invariant 映射

- INV-01 至 INV-09：不新增宿主服务/status/共享 CI/job/table；Git ref 用 `--verify`；提前合并直接失败。
- INV-10 至 INV-18：不新增常驻服务或付费扫描；长运行依赖控制面心跳；真环境接缝未验前为 logic-done-pending；target_environment 保持 local_api、实际 machine 单独严格核验。
- INV-19 至 INV-27：不记录 PII/secrets；Judge 含 exit_code/log_tail/behavior_tests；失败不 warning 降级；验证写入/校验共用 `DB_URL`；只认 GitHub PR head 真相。
- INV-28 至 INV-36：不新增 task_type/cron/launchd/字段；不使用 deploy root smoke；Test Contract 固定四列；Red 只精确 add 测试；被改接缝不 mock。
- INV-37 至 INV-45：不复用历史合同执行假设；不 merge；不依赖 headed shell；每个角色 runtime identity late-bound；真实解释器与 exit code 留证；共享 workflow/allowlist 不修改。
- INV-46 至 INV-54：Evaluator/Judge 完成前不得合并；report 不以容器 exit 单信号完成；无 DB 字段长度/退役/多端 UI 变更；所有失败真实传播。
- INV-55 至 INV-62：单 slot 只执行当前角色；无坐标假设；三接缝真验；真实 signup 建两个租户且隔离；cookie 鉴权；凭据不进 git/log。
