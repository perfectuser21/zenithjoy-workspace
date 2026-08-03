---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Kernel PR #1581 Fleet validation r11

**范围**: 在 US M4 对 PR #1581 精确 SHA 做一次新鲜真实 provider-neutral Harness 验证，双闸后只报告可合并。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] Fleet 报告 verifier 已落地且只消费显式报告路径
  Test: node -e "const fs=require('fs');const p='sprints/08032110-kernel-pr1581-fleet-validation-r11/verify-fleet-validation.mjs';const c=fs.readFileSync(p,'utf8');if(!c.includes('--report')||!c.includes('--check'))process.exit(1)"

- [ ] [ARTIFACT] 本 attempt 的真实证据报告存在且不含凭据字段
  Test: node -e "const fs=require('fs');const p='sprints/08032110-kernel-pr1581-fleet-validation-r11/fleet-validation-report.json';const c=fs.readFileSync(p,'utf8');JSON.parse(c);if(/cookie|token|password|authorization/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] TDD 测试注册四个合同覆盖名
  Test: node -e "const c=require('fs').readFileSync('sprints/08032110-kernel-pr1581-fleet-validation-r11/tests/fleet-validation-report.test.ts','utf8');for(const s of ['拒绝非 US M4、版本漂移、Xian 或 SHA 漂移','要求五阶段属于同一 run、attempt 和目标 SHA','拒绝缺失、陈旧或复制的 Evaluator 与 Judge verdict','只有双闸和禁区核对全过才报告可合并且不执行合并'])if(!c.includes(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L3] B-01: 精确 SHA 与 US M4 严格亲和 [接缝×2]
  动作: 在本 attempt 的 US M4 执行面读取真实 Fleet attestation、checkout SHA，并 live 查询 PR #1581 head。
  预期观察: 三个 SHA 均为 `c305f6217da65bb69413c39e621b7e797e0fb189`；machine=`us-mac-m4`、version=`1.267.97`、admitted=true、无 fallback、Xian 未参与。
  等待预算: 30s（超时=FAIL）
  留证: fleet-validation-report.json 的 target/runner 段 + 两次 live ref 输出。
  Test: manual:bash -c 'node sprints/08032110-kernel-pr1581-fleet-validation-r11/verify-fleet-validation.mjs --report sprints/08032110-kernel-pr1581-fleet-validation-r11/fleet-validation-report.json --check affinity && H=$(git ls-remote --exit-code origin refs/pull/1581/head | awk '"'"'{print $1}'"'"'); [ "$H" = c305f6217da65bb69413c39e621b7e797e0fb189 ]'

- [ ] [BEHAVIOR] [L3] B-02: provider-neutral 五阶段全链同源完成 [接缝×2]
  动作: 读取本次真实 Planner、合同对抗、Generator、Evaluator、Independent Judge 阶段回执并核对运行身份。
  预期观察: 五阶段均 PASS，均绑定本 run、本 attempt、同一目标 SHA，evidence URI 非空，总耗时不超过 7200 秒。
  等待预算: 7200s（超时=FAIL）
  留证: pipeline stages 的逐阶段回执、时间与 evidence URI；behavior_tests.log_tail 记录 verifier 输出。
  Test: manual:bash -c 'node sprints/08032110-kernel-pr1581-fleet-validation-r11/verify-fleet-validation.mjs --report sprints/08032110-kernel-pr1581-fleet-validation-r11/fleet-validation-report.json --check pipeline'

- [ ] [BEHAVIOR] [L3] B-03: 新鲜 Evaluator 锚定同一 SHA [接缝×2]
  动作: 在 Generator 完成后读取本 attempt 的真实 Evaluator verdict 与逐条行为日志。
  预期观察: Evaluator `PASS/fresh/exit_code=0`，run、attempt、SHA 完全匹配，behavior_tests 每条退出码为 0 且日志非空。
  等待预算: 1800s（超时=FAIL）
  留证: evaluator 原始 evidence URI、顶层 exit_code/log_tail 与 behavior_tests 日志。
  Test: manual:bash -c 'node sprints/08032110-kernel-pr1581-fleet-validation-r11/verify-fleet-validation.mjs --report sprints/08032110-kernel-pr1581-fleet-validation-r11/fleet-validation-report.json --check evaluator'

- [ ] [BEHAVIOR] [L3] B-04: Independent Judge 独立且新鲜 [接缝×2]
  动作: Evaluator 回执后读取本 attempt 的真实 Independent Judge verdict，并与 Evaluator evidence identity 交叉核对。
  预期观察: Judge `PASS/fresh/exit_code=0`、逐条日志完整、锚定同一 SHA，且不是复制 Evaluator 的角色/阶段/evidence。
  等待预算: 1800s（超时=FAIL）
  留证: Judge 原始 evidence URI、顶层 exit_code/log_tail、behavior_tests 与独立性核对输出。
  Test: manual:bash -c 'node sprints/08032110-kernel-pr1581-fleet-validation-r11/verify-fleet-validation.mjs --report sprints/08032110-kernel-pr1581-fleet-validation-r11/fleet-validation-report.json --check judge'

- [ ] [BEHAVIOR] [L3] B-05: 双闸和禁区全过后只报告可合并 [接缝×2]
  动作: 核对 Evaluator/Judge、禁区字段与 PR live head 后执行 merge-gate verifier，不调用合并命令。
  预期观察: 仅所有条件全过时 `merge.allowed=true`、`merge.merged=false`、reason=`evaluator_and_independent_judge_passed`。
  等待预算: 30s（超时=FAIL）
  留证: merge-gate verifier 输出、forbidden_checks 与 live PR head 输出。
  Test: manual:bash -c 'node sprints/08032110-kernel-pr1581-fleet-validation-r11/verify-fleet-validation.mjs --report sprints/08032110-kernel-pr1581-fleet-validation-r11/fleet-validation-report.json --check merge-gate && node -e '"'"'const r=require("./sprints/08032110-kernel-pr1581-fleet-validation-r11/fleet-validation-report.json");if(r.merge.merged!==false)process.exit(1)'"'"''

- [ ] [BEHAVIOR] [L2] B-06: 漂移、缺席、历史 verdict 与提前合并全部 fail closed
  动作: 执行 verifier 的负向合同测试，逐一注入 SHA/Runner 漂移、阶段缺席、旧或复制 verdict、禁区触碰和 merged=true。
  预期观察: 每个负向输入都得到非零 verdict 与明确原因码；没有 warning/404/空结果旁路。
  等待预算: 120s（超时=FAIL）
  留证: Vitest verbose 输出中全部负向 case PASS、零 skip。
  Test: manual:bash -c 'npx vitest run sprints/08032110-kernel-pr1581-fleet-validation-r11/tests/fleet-validation-report.test.ts --reporter=verbose'

## Invariant 覆盖映射

- INV-01 [窄路径验证]：B-01 至 B-05 使用真实 Fleet/Git/Verdict；负向 fixture 只验证 verifier 逻辑，不冒充全链实跑。
- INV-02 [数据库同源]：N/A，本 sprint 不读写业务数据库。
- INV-03 [字段核实]：N/A，不访问 agents 表。
- INV-04 [枚举复查]：N/A，不新增生产状态枚举；报告状态合同固定 PASS/FAIL。
- INV-05 [安全恢复]：N/A，不实现 watchdog 恢复；失败 attempt 不原地恢复。
- INV-06 [语义成功]：B-03/B-04 检查 PASS、exit_code、逐条日志，不只看 ok。
- INV-07 [依赖修复]：N/A，不修改依赖。
- INV-08 [等待心跳]：B-02 的真实 Fleet 由 Controller 按现有 headed relay 心跳规则执行；缺失即阶段失败。
- INV-09 [毕业门禁]：N/A，不做测试毕业 rename。
- INV-10 [Oracle实跑]：B-01 至 B-06 均要求真实退出码；Final E2E 直接启动 node/bash。
- INV-11 [Shell展开]：E2E 通过 bash -n 与真实执行双检；无双引号 node 模板表达式。
- INV-12 [冒烟铁律一]：B-02 全阶段回执，不以文件存在替代冒烟。
- INV-13 [冒烟铁律二]：B-01 live ref 与 attestation 交叉验证。
- INV-14 [跨轮测试]：N/A，不实现周期扫描。
- INV-15 [重复付费]：N/A，无外部付费调用。
- INV-16 [时间关系]：报告明确 started_at/finished_at/elapsed_seconds 且上限 7200 秒。
- INV-17 [剧场匹配]：target_environment=local_api，执行面另由 strict affinity 固定 US M4，不伪装 Windows theater。
- INV-18 [环境真相]：payload 的 local_api 写入合同与 DoD header。
- INV-19 [Judge格式]：B-04 强制顶层 exit_code/log_tail 与逐条 behavior_tests 退出码/日志。
- INV-20 [字段长度]：N/A，不写受限 DB 字段。
- INV-21 [历史死因]：已记录 `callback_runner_failure`，B-02 要求阶段/callback 完整。
- INV-22 [失败返回]：Verifier 非零失败必须传播，禁止 false/null 当 PASS。
- INV-23 [冒烟铁律三]：B-06 锁定错误路径无旁路。
- INV-24 [进度探针]：N/A，不更新 journey_features。
- INV-25 [报告收账]：B-02/B-05 同时核验全链报告与未合并状态，不凭容器 exit code。
- INV-26 [接管白名单]：N/A，本次 unattended autonomous，不允许人工换机接管。
- INV-27 [Relay锚点]：workspace repo、PR、run、attempt 与 target SHA 全部写入报告合同。
- INV-28 [退役实证]：N/A，不做退役判断。
- INV-29 [后台告警]：阶段/callback 缺失由 B-02 非零失败上报，不吞错。
- INV-30 [表名认领]：N/A，不建表或复用表。
- INV-31 [消费方]：N/A，不新增后台 job。
- INV-32 [多端完整]：Runner machine/version/Xian/fallback 字段明确区分。
- INV-33 [语义一致]：所有阶段缺席、未知或非 PASS 统一 fail closed。
- INV-34 [Ref校验]：B-01 使用 `git ls-remote --exit-code`，并核对精确 commit SHA。
- INV-35 [隔离冒烟]：本 attempt 独立 run/attempt；禁止其他 candidate，且不触碰生产业务数据。
- INV-36 [部署失败]：Runner/阶段失败均非零，不降级 warning。
- INV-37 [生产自报]：B-01 使用 live PR ref 与 Runner checkout 自报 SHA 交叉对账。
- INV-38 [异步测试]：测试读取与 verifier 调用使用可 await 的 Vitest async case。
- INV-39 [合同表格]：contract-draft Test Contract 固定四列，第三列为 BEHAVIOR 覆盖，Test File 路径用反引号。
- INV-40 [Red提交]：只新增 sprint tests 路径，不暂存整个仓库。
- INV-41 [接线回归]：B-02 直接检查阶段接线回执，不以间接字符串替代。
- INV-42 [调度入口]：N/A，不新增 cron 或 scheduler job。
- INV-43 [合并权]：B-05 强制 `merged=false`；Generator 只报告 ready。
- INV-44 [环境传递]：run/attempt/repo/SHA/runner 由 Fleet 显式写入报告，不依赖 tmux 隐式默认。
- INV-45 [合同复用]：报告必须是本 run/attempt，新鲜性拒绝历史合同/执行证据。
- INV-46 [共享禁区]：forbidden_checks 强制共享 Red 未修改，任务不授权共享 CI 修改。
- INV-47 [提前合并]：B-05 强制双闸前后均未合并，若已合并直接 FAIL。
- INV-48 [冒烟铁律四]：B-03/B-04 均要求逐条 behavior test 日志。
- INV-49 [Brain冒烟]：N/A，本 sprint 不改 brain/src。
- INV-50 [任务接线]：N/A，不新增 task_type。
- INV-51 [服务存活]：N/A，不新增常驻服务。
- INV-52 [宿主服务]：N/A，不安装 LaunchDaemon/LaunchAgent。
- INV-53 [巡检清单]：N/A，不新增宿主服务。
- INV-54 [冒烟铁律五]：B-01 至 B-05 的真实接缝证据缺一即失败。
- INV-55 [单槽串行]：报告 stages 必须无重复且按单 attempt 收账；只有一个实现 task ws1。
- INV-56 [环境假设]：machine/version/SHA 来自 attestation/live ref，不从未声明默认推断。
- INV-57 [真环境完成]：接缝未在 US M4 真验前标 `logic-done-pending`，B-01 至 B-05 为 L3。
- INV-58 [多租户测试]：N/A，本 sprint 不访问租户业务数据。
- INV-59 [凭据安全]：ARTIFACT 报告扫描禁止 cookie/token/password/authorization，合同不硬编码 secret。
- INV-60 [日志脱敏]：报告只留阶段日志尾与技术标识，不记录客户 PII/聊天内容。
- INV-61 [端点鉴权]：N/A，不新增或调用业务 API 端点。
- INV-62 [租户隔离]：N/A，不查询或写入租户数据。

## 完成条件

- [ ] B-01 至 B-06 全部通过且有本 attempt 新鲜证据。
- [ ] 接缝步骤各重复两次结果一致，无 FLAKY。
- [ ] `merge.allowed=true` 仅表示可进入 Controller 合并出口；`merge.merged=false`，Generator/Evaluator/Judge 均未自行合并。
