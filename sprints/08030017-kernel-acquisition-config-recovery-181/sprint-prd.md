# Sprint PRD — Kernel 获客配置有效态校验恢复

## OKR 对齐

- **对应 KR**：ZenithJoy 产品全线上线 — AI双线创作 + 小程序 + 网站 + Dashboard 可交付
- **当前进度**：77%
- **本次推进预期**：恢复 Line 02 关键词获客 Step 7 的配置更新安全性；不臆测百分比增量

## 背景

从冻结 Red SHA `0dc4e3c07ff19a0ac95440723986bf3cb78580b2` 出发，恢复获客配置更新守卫。当前风险是局部补丁本身看似合法，但与租户当前配置合并后的有效配置可能出现 `keywords_per_round_min greater than keywords_per_round_max`，从而让评论区挖客闭环使用无效参数。本 Sprint 只锚定 Line 02 `keyword_acquisition` 的 `step7`，且沿用既有仓库感知提案发现与有界 Fleet workspace 清理修复。

## Golden Path（核心场景）

租户从获客配置更新入口提交局部或完整配置 → 系统基于该租户当前配置形成有效配置并校验关键词轮次上下界 → 无效更新以 HTTP 400 明确拒绝且零持久化，合法更新正常保存并可读回。

具体：

1. 已有租户配置的调用方提交只包含部分获客字段的更新。
2. 系统以补丁和该租户当前配置形成的有效配置为判定对象；若 `keywords_per_round_min > keywords_per_round_max`，返回 HTTP 400，且 `error.code` 为 `INVALID_CONFIG`。
3. 被拒绝后，该租户配置与其他租户配置均保持原值；有效的局部更新和完整更新继续成功并可读回。

## 边界情况

- 仅提高 `keywords_per_round_min`，与现有 `keywords_per_round_max` 合并后越界。
- 仅降低 `keywords_per_round_max`，与现有 `keywords_per_round_min` 合并后越界。
- 上下界相等时有效；未涉及上下界的合法局部更新不被误拒。
- 无效请求不得产生部分写入、更新时间变化或跨租户影响。
- 并发更新按每次请求实际可见的租户当前配置校验，禁止以补丁孤立判定。

## 范围限定

**在范围内**：获客配置局部/完整更新的有效配置上下界校验；HTTP 400 + `INVALID_CONFIG`；无效更新零持久化；有效更新兼容；至少两个租户的隔离验收；先有失败 smoke test 再实现。
**不在范围内**：改变共享 Red fixture；检查、复制或借鉴 One-session 候选 worktree、patch、日志、PR 或反馈；新增获客能力；改变 Line 02 Step 7 业务流程；盲评前合并；清零或减免此前 Kernel 失败及基础设施修复耗时。

## 假设

- [ASSUMPTION: 现有获客配置入口支持局部/完整更新和读取；两个上下界均为现有字段，本 Sprint 不改变其类型或默认值。]
- [ASSUMPTION: API 的具体 URL 与鉴权值由执行环境注入，避免在 PRD 中猜测仓库路由或硬编码凭据。]

## 验收准则

- 无效局部更新同时满足 HTTP 400、`error.code=INVALID_CONFIG`，且请求前后目标租户配置完全一致。
- 第二租户在目标租户成功或失败更新后均不变化；合法局部更新只改变请求字段。
- 合法完整更新成功，上下界相等时亦成功。
- smoke test 先在冻结 Red SHA 上因缺失有效态守卫而失败，再由实现使其通过。

## 预期受影响文件

- `apps/api/`：现有获客配置更新入口的行为修复（具体文件由 proposer 基于 registry 锚定）。
- `apps/api/` 对应测试目录：新增先红后绿的有效配置合并校验 smoke test。
- `test-registry.yaml`：仅当新增测试按仓库门禁要求需要登记时更新。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 冻结 Red 基线 `0dc4e3c07ff19a0ac95440723986bf3cb78580b2`
- 可观测: 错误以 HTTP 400 与 `INVALID_CONFIG` 可机检；不得记录凭据、PII 或完整敏感租户配置

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [约束] learning: cortex.js::recordLearnings 等触发条件窄的路径，真实端到端验证成本高时，可用结构性 source-code inspection(零mock)+同机制其他调用点的真实端到端触发(零mock)两层交叉验证兜底，但需在 cortex.js::recordLearnings 等触发条件窄的路径，真实端到端验证成本高时，可用结构性 source-code inspection(零mock)+同机制其他调用点的真实端到端触发(零mock)两层交叉验证兜底，但需在报告里如实标注为已知覆盖余留，不能算作等价于全链路测试（来源: area）
- [约束] learning: 冒烟/校验类脚本涉及数据库连接目标时，写入侧与校验侧的 DB_NAME 必须来自同一变量/同一解析逻辑，禁止两处各自默认值——本次因此导致一次真实生产库脏数据污染 冒烟/校验类脚本涉及数据库连接目标时，写入侧与校验侧的 DB_NAME 必须来自同一变量/同一解析逻辑，禁止两处各自默认值——本次因此导致一次真实生产库脏数据污染（来源: area）
- [约束] learning: proposer起草涉及agents表字段的合同/测试前先psql核对真实列名，不要凭经验假设常见字段名（machine_id vs 真实agent_id已有历史回归测试仍会重蹈） proposer起草涉及agents表字段的合同/测试前先psql核对真实列名，不要凭经验假设常见字段名（machine_id vs 真实agent_id已有历史回归测试仍会重蹈）（来源: area）
- [约束] learning: contract-dod.md/测试里涉及 status 枚举的硬编码断言，GAN 新增状态值（如本次的 'stale'）时应做一次全仓库 grep 复查，避免遗漏同类枚举检查点 contract-dod.md/测试里涉及 status 枚举的硬编码断言，GAN 新增状态值（如本次的 'stale'）时应做一次全仓库 grep 复查，避免遗漏同类枚举检查点（来源: area）
- [约束] learning: watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查（查 PR/sprint 目录）从头重跑是安全恢复路径（f90ddca3 实证成功） watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查（查 PR/sprint 目录）从头重跑是安全恢复路径（f90ddca3 实证成功）（来源: area）
- [约束] learning: 通知/写库接口的成功判定必须看语义字段（sent/accepted），只 grep ok:true 会把 sent=false 误判为送达（harness/notify 实证） 通知/写库接口的成功判定必须看语义字段（sent/accepted），只 grep ok:true 会把 sent=false 误判为送达（harness/notify 实证）（来源: area）
- [约束] learning: dep-audit 因新披露 advisory 突然翻红时先查 fixAvailable：布尔 true = semver 兼容修复，直接 npm audit fix，不要急着加白名单 dep-audit 因新披露 advisory 突然翻红时先查 fixAvailable：布尔 true = semver 兼容修复，直接 npm audit fix，不要急着加白名单（来源: area）
- [约束] learning: headed relay session 在长 CI 等待循环中应周期性 PATCH relay-runs 心跳，防止 Brain reaper 单信号把存活 session 的任务误标 failed（failed 是状态机死端，收账链会断 headed relay session 在长 CI 等待循环中应周期性 PATCH relay-runs 心跳，防止 Brain reaper 单信号把存活 session 的任务误标 failed（failed 是状态机死端，收账链会断裂）（来源: area）
- [约束] learning: 毕业（测试入册）commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push：毕业 rename 是这两个门的高危触发点（contract 表路径失效 + Red 计数失 毕业（测试入册）commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push：毕业 rename 是这两个门的高危触发点（contract 表路径失效 + Red 计数失效）（来源: area）
- [约束] learning: 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。（来源: area）
- [约束] learning: manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion failure。 manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion failure。（来源: area）
- [约束] smoke 铁律（来源: area）
- [约束] smoke 铁律（来源: area）
- [约束] learning: [ ] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至少一条"真实多轮扫描、状态不重置、时间真实流逝"的集成测试，否则这类"跨扫描周期"的 bug 永远测 [ ] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至少一条"真实多轮扫描、状态不重置、时间真实流逝"的集成测试，否则这类"跨扫描周期"的 bug 永远测不出来（来源: area）
- [约束] learning: [ ] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用（LLM/第三方API），必须同时设计"是否已处理过"的前置检查，不能假设"重扫不常发生"就不用防——扩大扫描窗口（为了修一个 bug）反而可能意外放大另一个本来隐藏很浅的 [ ] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用（LLM/第三方API），必须同时设计"是否已处理过"的前置检查，不能假设"重扫不常发生"就不用防——扩大扫描窗口（为了修一个 bug）反而可能意外放大另一个本来隐藏很浅的问题（来源: area）
- [约束] learning: [ ] 跨模块的"时间常数"（扫描间隔、闲置阈值、缓存 TTL 等）如果彼此之间有隐含的大小关系依赖，必须在设计阶段显式写一条不变量断言或注释（比如"必须保证 LOOKBACK_WINDOW > IDLE_THRESHOLD"），不能指望测 [ ] 跨模块的"时间常数"（扫描间隔、闲置阈值、缓存 TTL 等）如果彼此之间有隐含的大小关系依赖，必须在设计阶段显式写一条不变量断言或注释（比如"必须保证 LOOKBACK_WINDOW > IDLE_THRESHOLD"），不能指望测试覆盖到——本次这个 bug 潜伏在 3 个独立 Task 的接缝处，任何单个 Task 的测试都测不出来，只有对整个分支做"跨任务组合"审查的最后一轮才抓到（来源: area）
- [约束] theater_mismatch 检查机制：contract 文本中出现 android 关键词，即使在排除说明列表内，也会触发 theater 不匹配警告。可将 target_environment 设为 windows_cloud 绕过该检查，因为 agent-offline-alert 功能本身属于后端服务，不依赖 Android 真机。（来源: area）
- [约束] target_environment 字段由 Brain orchestrator 从 DB tasks.payload 读取，不从本地文件读取。务必在 POST /api/brain/tasks 注册时在 payload 中正确设置 target_environment，否则 harness 会用错环境路由。（来源: area）
- [约束] Brain judge API 格式要求：必须有顶层 exit_code + log_tail + behavior_tests[]（每条需 exit_code + log_tail）。缺失任一字段 judge 会报格式错误。sprint 07201705-agent-offline-alert 实证。（来源: area）
- [约束] learning: [ ] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长度保证（如文件系统路径/目录名），必须显式截断，不能假设"看起来不会太长"——本次触发条件（嵌套 worktree 路径）就存在于开发者自己的日常工 [ ] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长度保证（如文件系统路径/目录名），必须显式截断，不能假设"看起来不会太长"——本次触发条件（嵌套 worktree 路径）就存在于开发者自己的日常工作模式里，不是边缘 case（来源: area）
- [约束] learning: [ ] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` + `git show <commit>:<path>` 读退役前的真实代码，逐字核对 death cause，不要只信退役 commit m [ ] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` + `git show <commit>:<path>` 读退役前的真实代码，逐字核对 death cause，不要只信退役 commit message 的一句话总结——本次靠这个方法把"死因不明的历史教训"变成了"可复现、可规避的具体 bug 模式"（来源: area）
- [约束] learning: [ ] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `if (成功分支)` 一定要显式写 `else` 处理失败分支，不能只依赖外层 `try/catch`——这类"错误码而非异常"的契约在本仓库很常见 [ ] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `if (成功分支)` 一定要显式写 `else` 处理失败分支，不能只依赖外层 `try/catch`——这类"错误码而非异常"的契约在本仓库很常见（`pushCapture`/`claimDedupeKey` 等），review 时应主动搜索"这个函数会不会抛异常"再判断调用方的错误处理是否对得上（来源: area）
- [约束] smoke 铁律（来源: area）
- [约束] learning: journey_features 表的 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探针信号，建议定期巡检 journey_features 表的 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探针信号，建议定期巡检（来源: area）
- [约束] learning: harness-controller relay 容器可能在 Step 6(merge) 后异常退出而跳过 Step 7(report)，因为该硬约束只写在 prompt 里没有机械闸门；Brain 侧不应仅凭容器 exit code 0 harness-controller relay 容器可能在 Step 6(merge) 后异常退出而跳过 Step 7(report)，因为该硬约束只写在 prompt 里没有机械闸门；Brain 侧不应仅凭容器 exit code 0 判定 task 完成，应校验 pr_merged_at/notion_synced_at 等 report 产出物是否真的写入（来源: area）
- [约束] learning: contract-proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景，本次 round1 误判直到 judge 实测才暴露、多耗 4 轮 GAN contract-proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景，本次 round1 误判直到 judge 实测才暴露、多耗 4 轮 GAN（来源: area）
- [约束] learning: headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task short id，否则 finalizeHarnessTask 收账守卫与 watchdog GitHub headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task short id，否则 finalizeHarnessTask 收账守卫与 watchdog GitHub 反查双双失明（pr_not_found 拒绝 completed）（来源: area）
- [约束] learning: [ ] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（conversation-consolidator 同名族但活着，已验证保留） [ ] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（conversation-consolidator 同名族但活着，已验证保留）（来源: area）
- [约束] learning: [ ] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖） [ ] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖）（来源: area）
- [约束] learning: [ ] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审 [ ] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审（来源: area）
- [约束] learning: [ ] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消费者） [ ] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消费者）（来源: area）
- [约束] 1) contract-dod模板加规则：新字段与既有字段语义重叠时必须本sprint内消解或建正式decision+挂任务队列，禁止只在文档里写'留给后续技术债sprint'了事，harness-contract-reviewer遇到此类表述直接判needs_revision；2) harness-planner 4问加第5问：涉及几种设备/操作系统类型？每种是否都有对应UI区分？3) golden-path-reviewer 6维rubric加'多端完整性'维度：功能涉及多个os_type/device_platform时验收需确认展示层是否区分，不区分则FAIL；4) 已排一次全仓一次性扫描找同类'字段有但下游UI未接线'模式。（来源: area）
- [约束] learning: [ ] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面 [ ] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area）
- [约束] learning: [ ] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-parse 失败回显字面量 [ ] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-parse 失败回显字面量（来源: area）
- [约束] learning: [ ] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（brain-deploy、git tag 向上找共享 refs、/tmp 状态文件）——SKIP 钩子 [ ] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（brain-deploy、git tag 向上找共享 refs、/tmp 状态文件）——SKIP 钩子逐个显式设，跳过项列在 smoke 头注释（来源: area）
- [约束] learning: [ ] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚本尤其注意管道赋值 `|| echo ""` 兜底，grep 空结果 + pipefail 会静默炸 [ ] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚本尤其注意管道赋值 `|| echo ""` 兜底，grep 空结果 + pipefail 会静默炸死 set -e 脚本）（来源: area）
- [约束] learning: [ ] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用"工作区 diff"——部署根 reset 后 diff 恒空是结构性陷阱 [ ] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用"工作区 diff"——部署根 reset 后 diff 恒空是结构性陷阱（来源: area）
- [约束] learning: lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFileSync lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFileSync（来源: area）
- [约束] learning: Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解析路徑 Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解析路徑（来源: area）
- [约束] learning: Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness/，防非測試文件混入 Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness/，防非測試文件混入（来源: area）
- [约束] learning: 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area）
- [约束] learning: 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径（来源: area）
- [约束] learning: harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller，generator 只推 branch 并报告 branch ready harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller，generator 只推 branch 并报告 branch ready（来源: area）
- [约束] learning: headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude session 内部感知 harness 上下文的变量（HARNESS_TASK_ID、HARNESS_NOD headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude session 内部感知 harness 上下文的变量（HARNESS_TASK_ID、HARNESS_NODE 等），必须在 innerCmd 字符串中显式 export，而非依赖 _spawnHeadedSession 调用方的进程环境。（来源: area）
- [约束] learning: Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同——本次task 63db6f8a的自动headed spawn从未走通，若照抄049ebf93先例断言会误判FAIL Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同——本次task 63db6f8a的自动headed spawn从未走通，若照抄049ebf93先例断言会误判FAIL（来源: area）
- [约束] learning: 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml、packages/quality/smoke-allowlist.txt 等跨 sprint 共享 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml、packages/quality/smoke-allowlist.txt 等跨 sprint 共享判定文件未经合同显式授权不可修改），遇到自身改动触发 CI 红时必须另开独立 sprint 走 GAN 流程（来源: area）
- [约束] learning: PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict 文件锚定的 sha 与实际合 PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict 文件锚定的 sha 与实际合并 sha 一致，确认无代码漂移后才能在报告中标注流程完整性未受损（来源: area）
- [约束] smoke 铁律（来源: area）
- [约束] learning: [ ] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红 [ ] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红（来源: area）
- [约束] learning: [ ] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch 分支 / executor override 排除 / re [ ] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch 分支 / executor override 排除 / relay loadSkill 映射 / dispatcher cap+lock+bridge 三防线（来源: area）
- [约束] learning: [ ] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d172e54a） [ ] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d172e54a）（来源: area）
- [约束] learning: [ ] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务**——gui 域不存在，永不加载；用系统域 LaunchDaemon + `UserName=administrator [ ] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务**——gui 域不存在，永不加载；用系统域 LaunchDaemon + `UserName=administrator`（bridge 先例）（来源: area）
- [约束] learning: [ ] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（MUST_RUN_DAEMONS / MUST_LOAD_DAEMONS / MUST_LISTE [ ] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（MUST_RUN_DAEMONS / MUST_LOAD_DAEMONS / MUST_LISTEN_PORTS）（来源: area）
- [约束] smoke 铁律（来源: area）
- [约束] 一个 slot/会话内严格串行执行任务——同一 slot 同时只允许一个任务在跑，任务与任务之间必须前一个收口（handoff）后才起下一个；需要并行时用多个 slot/独立 session 各跑各的任务。澄清边界：单个任务内部的子代理扇出（如 /dev Phase2 的 Agent B/C/D 三路补全、subagent-driven 的实现者+审查者）属于任务内部实现，不算违反；违反的形态=一个 slot 里两个任务并发推进。 【07-07 补充（Alex 追问后定型三层并发模型）】slot 之间随便并行；一个 slot 内任务串行；一个任务内部：只读工种（分析/补全/审查类子代理）可扇出，但动手写代码的实现者同一时刻永远只有一个（与 subagent-driven 的禁并行实现者规则一致，防多写手改冲同一文件）。分水岭不是 agent 数量，是任务状态数量：一个会话里只允许存在一个任务的状态。（来源: area）
- [约束] 屏幕外坐标/UIA气泡阈值/假设调用方传X/假设.env有Y 等环境假设值禁止写死，要么从环境推导要么真机校准——这类值是接缝，必真验（来源: area）
- [约束] 依赖真机/生产env/真实调用方的【接缝断言】必须在真目标上验证过才算done；未真验的只能标 logic-done-pending，绝不标 done。接缝清单通常1-3条，不是全功能跑真机。（来源: area）
- [约束] 单元/E2E 测试默认种≥2个租户并断言互不串(让隔离漏洞当场暴露)（来源: area）
- [约束] secrets 不硬编码、不进 git、不进日志（来源: area）
- [约束] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [约束] 每个 API 端点必须有 auth;无鉴权端点不准 ship（来源: area）
- [约束] 碰租户数据的查询/写入必须 scope 到当前租户;跨租户数据绝不混读/混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

以下脚本由 proposer 将真实路由与鉴权注入后直接执行；`CONFIG_URL` 与 `OTHER_TENANT_CONFIG_URL` 必须分别指向两个租户的同一获客配置资源。

```bash
set -euo pipefail
: "${CONFIG_URL:?需注入目标租户配置 URL}"
: "${OTHER_TENANT_CONFIG_URL:?需注入第二租户配置 URL}"
: "${AUTH_HEADER:?需注入鉴权 Header 值}"
req() { curl -sS -H "Authorization: ${AUTH_HEADER}" -H 'Content-Type: application/json' "$@"; }
req -X PUT "${CONFIG_URL}" -d '{"keywords_per_round_min":5,"keywords_per_round_max":10}' >/tmp/config-base.json
req -X PUT "${OTHER_TENANT_CONFIG_URL}" -d '{"keywords_per_round_min":2,"keywords_per_round_max":8}' >/tmp/config-other-base.json
req "${CONFIG_URL}" | jq -S . >/tmp/config-before.json
req "${OTHER_TENANT_CONFIG_URL}" | jq -S . >/tmp/config-other-before.json
code=$(req -o /tmp/config-error.json -w '%{http_code}' -X PATCH "${CONFIG_URL}" -d '{"keywords_per_round_min":11}')
test "$code" = 400
jq -e '.error.code == "INVALID_CONFIG"' /tmp/config-error.json
req "${CONFIG_URL}" | jq -S . | diff -u /tmp/config-before.json -
code=$(req -o /tmp/config-error-2.json -w '%{http_code}' -X PATCH "${CONFIG_URL}" -d '{"keywords_per_round_max":4}')
test "$code" = 400
jq -e '.error.code == "INVALID_CONFIG"' /tmp/config-error-2.json
req "${CONFIG_URL}" | jq -S . | diff -u /tmp/config-before.json -
req -X PATCH "${CONFIG_URL}" -d '{"keywords_per_round_min":8}' >/tmp/config-valid-partial.json
req "${CONFIG_URL}" | jq -e '.keywords_per_round_min == 8 and .keywords_per_round_max == 10'
req -X PUT "${CONFIG_URL}" -d '{"keywords_per_round_min":12,"keywords_per_round_max":12}' >/tmp/config-valid-complete.json
req "${CONFIG_URL}" | jq -e '.keywords_per_round_min == 12 and .keywords_per_round_max == 12'
req "${OTHER_TENANT_CONFIG_URL}" | jq -S . | diff -u /tmp/config-other-before.json -
```

## journey_type: autonomous
## journey_type_reason: 任务是 Line 02 关键词获客配置更新的纯 API 行为修复，无用户界面或远端 agent 协议变化。
## target_environment: local_api
## target_environment_reason: payload 显式指定 local_api；在本地 API 环境执行鉴权 curl 与持久化读回断言。
## journey_id: bb50964c-f8f7-4843-87da-7148a2611d80
## step_id: line02/keyword_acquisition#step7
