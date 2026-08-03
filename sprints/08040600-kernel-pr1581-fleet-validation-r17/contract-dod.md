---
skeleton: false
journey_type: autonomous
---
# Contract DoD — PR #1581 真实 fleet 验证 r17

**范围**: 精确 SHA、strict us-mac-m4、Fleet 前置身份 receipt、三角色完整成功/失败证据和一致最终裁决；不修改产品实现、不合并。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 三角色 schema v2 evidence、Fleet 前置 receipt 副本、Generator receipt SHA-256 与原始日志齐全。
  Test: node -e "for(const r of ['generator','evaluator','judge']){const e=JSON.parse(require('fs').readFileSync('sprints/08040600-kernel-pr1581-fleet-validation-r17/evidence/'+r+'.json'));if(e.schema_version!==2||!Number.isInteger(e.exit_code)||!e.log_tail||!Array.isArray(e.behavior_tests)||!e.behavior_tests.length)process.exit(1);JSON.parse(require('fs').readFileSync('sprints/08040600-kernel-pr1581-fleet-validation-r17/evidence/'+r+'.fleet-receipt.json'))}"

- [ ] [ARTIFACT] role helper 中不存在创建、覆盖或回写 Fleet receipt 的代码，GAN authoring UUID 未固化为未来角色期望。
  Test: bash -c "! rg -n '(writeFile|writeFileSync|cp |install ).*(HARNESS_FLEET_RECEIPT_PATH)|(attempt_id|capability_snapshot_id).*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' sprints/08040600-kernel-pr1581-fleet-validation-r17/scripts sprints/08040600-kernel-pr1581-fleet-validation-r17/tests"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: Generator 消费 Fleet 前置 receipt 并验证真实产品链 [接缝×2]
  动作: Fleet 在角色启动前签发 checkout 外 receipt；Generator 只读核验后，在 us-mac-m4 对目标 SHA 用空库 migration、两个真实 signup cookie 执行双租户和并发冲突验证
  预期观察: evidence 身份逐字段等于 receipt；并发响应状态为 200/400、错误码 INVALID_CONFIG、最终 min<=max；失败时也保留非零 exit_code、失败 behavior 和 log_tail
  等待预算: 7200s
  留证: evidence/generator.json、generator.fleet-receipt.json、generator.receipt.sha256 与原始产品日志
  Test: manual:bash -c 'npx vitest run sprints/08040600-kernel-pr1581-fleet-validation-r17/tests/fleet-validation-evidence.test.ts -t "Generator 新鲜证据绑定 Fleet 前置 receipt 和目标 SHA" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-02: Evaluator 保留失败证据并由结果确定 verdict [接缝×2]
  动作: Evaluator 以自身 Fleet receipt 读取 Generator receipt，执行全部核验并逐项记录实际 exit code、log_tail 和 evidence
  预期观察: generator_receipt_sha256 精确匹配；顶层和全部 behavior exit 0 时 verdict=PASS，否则 verdict=FAIL；失败条目不被丢弃或改写为成功
  等待预算: 600s
  留证: evidence/evaluator.json、evaluator.fleet-receipt.json 与 evaluator 原始日志
  Test: manual:bash -c 'npx vitest run sprints/08040600-kernel-pr1581-fleet-validation-r17/tests/fleet-validation-evidence.test.ts -t "Evaluator 保留失败证据并由 exit code 确定 verdict" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-03: Judge 摘要串联并输出唯一一致裁决 [接缝×2]
  动作: Judge 以自身 Fleet receipt 读取 Generator/Evaluator 原始文件，重新计算 Evaluator SHA-256并查询真实 GitHub PR
  预期观察: 缺证或不可解析为 INSUFFICIENT_EVIDENCE；完整证据任一失败为 FAIL；证据齐全且全部成功才 PASS；PR 仍 open、未合并且 head 精确匹配
  等待预算: 600s
  留证: evidence/judge.json、judge.fleet-receipt.json、Evaluator 摘要与 GitHub API 结果摘要
  Test: manual:bash -c 'PR=$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581); echo "$PR" | jq -e '\''.state=="open" and .merged==false and .merged_at==null and .head.sha=="c305f6217da65bb69413c39e621b7e797e0fb189"'\'' >/dev/null; npx vitest run sprints/08040600-kernel-pr1581-fleet-validation-r17/tests/fleet-validation-evidence.test.ts -t "Judge 引用 Evaluator 摘要并给出与证据一致的最终裁决" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-04: 角色不能事后自签且缺证不能判 PASS
  动作: 扫描 role helper 的 receipt 写入操作，并用失败/缺失证据输入执行确定性 verdict 规则
  预期观察: role helper 无 receipt 创建或回写；完整失败得到 FAIL；缺证得到 INSUFFICIENT_EVIDENCE；两种情况均不得 PASS
  等待预算: 30s
  留证: Vitest stdout、source scan 输出与失败语义断言
  Test: manual:bash -c 'npx vitest run sprints/08040600-kernel-pr1581-fleet-validation-r17/tests/fleet-validation-evidence.test.ts -t "角色不得自行生成 Fleet receipt 且缺证不得判 PASS" --reporter=verbose'

## Invariant 映射（PRD 铁律逐项）

> PRD 中重复的 `smoke 铁律` 分别保留映射；N/A 表示本 Sprint 不触及该模块，并非静默删除。

- INV-01 LaunchAgent 常驻服务：N/A，本 Sprint 不新增宿主服务。
- INV-02 status 枚举全仓复查：Judge 三值为证据协议新枚举；测试精确覆盖 PASS/FAIL/INSUFFICIENT_EVIDENCE。
- INV-03 共享 CI 基础设施默认禁区：N/A，不改 workflow/smoke allowlist。
- INV-04 git_sha 同语义同策略：Generator/Evaluator/Judge 均以 target SHA 不等即失败处理。
- INV-05 Test Contract 四列：contract-draft 的 Test Contract 固定四列且 testFile 用反引号。
- INV-06 表名认领冲突：N/A，不建表或改 schema。
- INV-07 后台 job 必有消费方：N/A，不新增 job。
- INV-08 提前合并处理：PR 在 verdict 前 merged=true 直接 FAIL 并留 GitHub 证据。
- INV-09 git ref 验证：helper 必须使用 `git rev-parse --verify '<ref>^{commit}'`。
- INV-10 smoke 铁律（第 1 次）：N/A，不改 smoke 文件。
- INV-11 服务双信号：N/A，不判断常驻服务存活。
- INV-12 headed payload 可反查：任务稳定对象包含 repo、PR、run、task short id。
- INV-13 时间常数关系：唯一总预算 7200s；各子预算不得超过总预算。
- INV-14 真环境才 done：三项接缝未真验均为 logic-done-pending。
- INV-15 feat+brain smoke 登记：N/A，不改 brain/src。
- INV-16 relay 心跳：由控制面负责；角色证据不得把无心跳的长等待伪装 PASS。
- INV-17 catch 吞错须计数：所有 helper 失败写 behavior_tests 与非零 exit_code。
- INV-18 dep audit：N/A，不改依赖。
- INV-19 日志脱敏：cookie、密码、DB_URL 不进 log_tail/evidence。
- INV-20 毕业后 lint：Generator 提交前跑仓库适用的 lint/test coverage 门。
- INV-21 smoke 铁律（第 2 次）：N/A，不改 smoke 文件。
- INV-22 端点鉴权：业务 config 只用真实 signup session cookie。
- INV-23 smoke 铁律（第 3 次）：N/A，不改 smoke 文件。
- INV-24 测试默认双租户：Generator 创建两个租户并断言互不串。
- INV-25 scheduler jobs：N/A，不新增 cron。
- INV-26 凭据安全：只用 Runner/临时 cookie jar，凭据不进 git/log。
- INV-27 生产实体自报：PR head 用 GitHub API，不以 workspace diff 判断。
- INV-28 成功看语义字段：配置接口断言 success、data 和 INVALID_CONFIG，不只看 HTTP 200。
- INV-29 journey feature freshness：N/A，不写 journey_features。
- INV-30 新 task_type 七点接线：N/A，不新增 task_type。
- INV-31 禁止环境假设：机器取 HARNESS_MACHINE，身份取 Fleet receipt，不写坐标/env 假值。
- INV-32 smoke 铁律（第 4 次）：N/A，不改 smoke 文件。
- INV-33 watchdog 恢复：N/A，不更改任务状态或执行恢复。
- INV-34 lint-test-quality await：测试文件所有 I/O helper 为 async/await。
- INV-35 deploy root 安全：N/A，不以生产 deploy root 跑 smoke。
- INV-36 租户隔离：查询与写入均由真实 session tenant scope，双租户交叉断言。
- INV-37 退役代码 death cause：N/A，不复活功能。
- INV-38 headed shell 环境：所有必需 HARNESS 变量在角色入口显式校验。
- INV-39 Red 精确 add：只提交本 Sprint tests 与合同文件。
- INV-40 单 slot 串行：Generator→Evaluator→Judge 串行；无并行任务。
- INV-41 历史模板先核实：Round 4 以 reviewer 反馈和真实 PRD 修订，不假设旧路径。
- INV-42 多设备类型：N/A，本任务仅 strict us-mac-m4。
- INV-43 部署失败不降级：所有失败通过 finalizer 留证并返回非零。
- INV-44 host 白名单核对 headed：strict affinity 核验实际 HARNESS_MACHINE，不以派发标签代替。
- INV-45 smoke 铁律（第 5 次）：N/A，不改 smoke 文件。
- INV-46 新常驻服务 manifest：N/A，不新增服务。
- INV-47 多轮扫描真实时间：N/A，不改扫描器。
- INV-48 android theater：N/A，本任务产品验证为 local_api，不声称覆盖移动真机。
- INV-49 source inspection vs mock：被改接缝不 mock；receipt 写入禁令另做 source scan。
- INV-50 DB 字段长度：N/A，不新增字段。
- INV-51 manual node 引号：DoD 的 node 命令不得含未转义 `${}`；批准前真跑。
- INV-52 窄触发两层交叉：真实产品 E2E + 证据结构测试两层核验。
- INV-53 Judge API envelope：Judge 顶层与每条 behavior 均含 exit_code/log_tail/evidence。
- INV-54 付费扫描幂等：N/A，不调用付费扫描。
- INV-55 agents 表列名：N/A，不读写 agents 表。
- INV-56 Generator 禁 merge：Generator 只产 evidence，合并权不在角色脚本。
- INV-57 report 不能只看容器 exit：Judge 验 evidence、摘要和 PR 状态，不以进程 exit 单信号 PASS。
- INV-58 null/false 失败契约：每个 helper 明确捕获非零/假值并写失败 behavior。
- INV-59 退役判断查生产库：N/A，不退役模块。
- INV-60 manual oracle 真实 exit code：每项 behavior 记录实际 exit_code，且 Vitest 证明解释器启动。
- INV-61 DB 连接同源：migration、API、产品验证均从同一 `DB_URL` 解析。
- INV-62 target_environment 路由：任务 payload 为 local_api，实际 Fleet machine 另以 us-mac-m4 receipt 严格核验。
