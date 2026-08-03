# Sprint PRD — Kernel acquisition effective-config guard v2 真实 Fleet 验证 r16

## OKR 对齐

- **对应 KR**：ZenithJoy 产品全线上线 — AI双线创作 + 小程序 + 网站 + Dashboard 可交付
- **当前进度**：77%
- **本次推进预期**：以 PR #1581 精确头提交的真实 Fleet 证据关闭 Line 02 Step 7 的交付风险

## 背景

Line 02 `keyword_acquisition` 的 Step 7 是“评论区挖客闭环——抓评论→触达带企微号→企微 webhook 收好友→AI 首答→写本地 Lead 表”。本 sprint 只验证 PR #1581 的 Kernel acquisition effective-config guard v2：在生产 Fleet transport secret 已恢复后，由严格绑定的 `us-mac-m4` 目标重新产出证据。此前 r15 在远端 bridge prepare 阶段超时，不能复用为本次结论。

## Golden Path（核心场景）

Harness 从 PR #1581 的精确目标头 `c305f6217da65bb69413c39e621b7e797e0fb189` 进入 → 在严格 `us-mac-m4` Fleet 路由上依次获得全新的 Generator、Evaluator 与 Judge 证据 → 仅在三方证据均绑定同一目标头且 Judge 给出 verdict 后到达可决策出口。

具体：
1. 以 `perfectuser21/zenithjoy-workspace` PR #1581 和目标头 `c305f6217da65bb69413c39e621b7e797e0fb189` 启动本次验证，目标机器必须是 `us-mac-m4`，不得降级到其他机器或账号。
2. Generator 在本次 run 内生成独立证据；不得读取或复制其他 candidate，不得修改共享 red fixture。
3. Evaluator 对同一精确目标头生成全新验证证据，明确记录执行结果和失败信号；历史 r15 证据不得代替本次证据。
4. Judge 只基于本次 Generator 与 Evaluator 证据给出 verdict，并证明 verdict 锚定同一精确目标头。
5. verdict 出现前 PR #1581 保持未合并；verdict 后输出可观察的通过或失败结论，失败不得被降级为成功。

## 边界情况

- Fleet transport、远端 bridge 或 `us-mac-m4` 不可用时，本次结果必须失败或阻塞，不得改路由后假绿。
- 任一证据缺失、不是本次新生成、或绑定 SHA 不等于目标头时，不得形成通过 verdict。
- PR 头在验证期间变化时，现有证据立即失效，必须对新头重跑完整链路。
- 发现 PR 已在 verdict 前合并时，标记流程违规并停止把该 run 判为合格验证。

## 范围限定

**在范围内**：PR #1581 的 Kernel acquisition effective-config guard v2；严格 `us-mac-m4` Fleet 单机亲和；本次 run 的 Generator、Evaluator、Judge 新证据；精确 SHA 一致性；verdict 前禁止合并。

**不在范围内**：修改 PR #1581 的产品实现；扩大 Line 02 其他步骤；读取其他 candidate；修改共享 red fixture；验证前合并；用 r15 或更早 run 的证据替代 r16。

## 假设

- [ASSUMPTION: payload 未提供 thin_prd；以 `gp_anchor=line02/keyword_acquisition#step7`、PR #1581、精确目标头、严格 Fleet 路由和禁止项共同锚定本 sprint scope。]
- [ASSUMPTION: 本 sprint 是既有 bug fix 的真实环境验证，不新增用户可见行为。]

## 预期受影响文件

- `sprints/08040522-kernel-pr1581-fleet-validation-r16/sprint-prd.md`: 固化本次范围与验收出口。
- `sprints/08040522-kernel-pr1581-fleet-validation-r16/`: 下游角色写入本次 run 的 Generator、Evaluator 与 Judge 独立证据；不得复用历史证据。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 整体运行上限 7200 秒；单阶段未另行指定
- 频控: 待定（PrepPRD 未指定）
- 版本要求: runner digest 必须为 `sha256:e0797f5a440d61827d1ea86afee629e6f5a687da6f958608671ba9c873e5e94a`
- 可观测: 三类证据必须为本次新生成并绑定目标头 `c305f6217da65bb69413c39e621b7e797e0fb189`；失败原因和 verdict 必须可追溯

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [全局规则] learning: cortex.js::recordLearnings 等触发条件窄的路径，真实端到端验证成本高时，可用结构性 source-code inspection（零 mock）+ 同机制其他调用点的真实端到端触发（零 mock）两层交叉验证兜底，但必须如实标注覆盖余留（来源: area）
- [全局规则] 冒烟/校验类脚本的写入侧与校验侧 DB_NAME 必须来自同一变量或同一解析逻辑（来源: area）
- [全局规则] proposer 起草涉及 agents 表字段的合同或测试前必须用 psql 核对真实列名（来源: area）
- [全局规则] 新增 status 枚举时必须全仓复查硬编码断言（来源: area）
- [全局规则] watchdog_overdue 的 relay run 仅可经 orphan requeue、外部真相核查后从头重跑（来源: area）
- [全局规则] 通知或写库接口必须按 sent/accepted 等语义字段判定成功（来源: area）
- [全局规则] dep-audit 新 advisory 必须先检查 fixAvailable，再决定修复或白名单（来源: area）
- [全局规则] headed relay 长等待必须周期性上报心跳，避免存活 session 被误判失败（来源: area）
- [全局规则] 测试入册后必须本地通过 lint-tdd-commit-order 与 check-test-coverage 再 push（来源: area）
- [全局规则] 合同批准前必须记录 manual oracle 的真实 exit code，并确认目标解释器确实启动（来源: area）
- [全局规则] manual 的 node 命令必须逐条真跑，bash -n 不能替代（来源: area）
- [全局规则] smoke 铁律（来源: area）
- [全局规则] smoke 铁律（来源: area）
- [全局规则] 跨扫描周期行为必须有不重置状态且时间真实流逝的集成测试（来源: area）
- [全局规则] 周期性重扫涉及付费调用时必须先判断数据是否已处理（来源: area）
- [全局规则] 有依赖关系的跨模块时间常数必须显式声明并断言大小关系（来源: area）
- [全局规则] theater_mismatch 必须按目标产品环境真实匹配，不得以文字规避（来源: area）
- [全局规则] target_environment 只能从 Brain task payload 读取，任务注册时必须正确写入（来源: area）
- [全局规则] Brain judge 结果必须有顶层 exit_code、log_tail、behavior_tests，行为项也必须含 exit_code 与 log_tail（来源: area）
- [全局规则] 写入有长度约束的 DB 字段前必须显式处理无天然长度保证的输入（来源: area）
- [全局规则] 复活已退役功能前必须读取删除历史和退役前真实代码核对 death cause（来源: area）
- [全局规则] 对以 null/false 表示失败的函数必须显式处理失败分支（来源: area）
- [全局规则] smoke 铁律（来源: area）
- [全局规则] journey_features.updated_at 长期停滞应作为 report 漏跑探针（来源: area）
- [全局规则] controller 在 merge 后也必须完成 report，不能仅凭容器 exit code 判完成（来源: area）
- [全局规则] host 或环境白名单断言必须覆盖 headed 人工接管场景（来源: area）
- [全局规则] headed relay 点火必须在 payload 写 base_repo 或 pr_url，且分支名带 task short id（来源: area）
- [全局规则] 退役判断必须依赖生产库和消费方等外部真相，不依赖记忆（来源: area）
- [全局规则] catch 吞错的后台 job 必须有失败计数和连续失败告警（来源: area）
- [全局规则] 新建或复用表前必须检查全部写入方，多个写入模块必须通过 schema 对齐评审（来源: area）
- [全局规则] 新增后台 job 必须同时声明真实消费方（来源: area）
- [全局规则] 新字段与既有字段语义重叠时必须本 sprint 消解或建立正式 decision 与后续任务，多设备类型必须有展示层区分（来源: area）
- [全局规则] 同一语义在判变端和终验端必须采用相同处理策略（来源: area）
- [全局规则] git ref 存在性必须用 `git rev-parse --verify "<ref>^{commit}"` 判断（来源: area）
- [全局规则] 真实 worktree 用作部署根时必须先确认测试不会触碰生产资源（来源: area）
- [全局规则] 部署链任何失败路径必须显式失败、告警并非零退出，禁止 warning 降级（来源: area）
- [全局规则] 判变基准必须用生产实体自报 SHA 与 origin/main 对账，不得使用工作区 diff（来源: area）
- [全局规则] lint-test-quality 的源码检查测试必须包装成含 await 的异步函数（来源: area）
- [全局规则] Test Contract 表格必须保持四列，testFile 用反引号包裹并位于第三列（来源: area）
- [全局规则] Red commit 只能 add 精确测试路径，禁止 add 整个目录或仓库（来源: area）
- [全局规则] 调度接线回归可用零 mock 的结构性源码检查提供直接证据（来源: area）
- [全局规则] 新增 cron 必须先检查 scheduler-jobs.js JOBS，不得接入 deprecated tick-runner.js（来源: area）
- [全局规则] generator 禁止自行合并 PR；合并权属于 controller（来源: area）
- [全局规则] headed relay 子 shell 需要的 Harness 上下文变量必须显式传入（来源: area）
- [全局规则] proposer 复用历史合同前必须核对本次真实派发与执行历史（来源: area）
- [全局规则] generator 默认不得修改共享 CI 基础设施文件（来源: area）
- [全局规则] PR 若在 evaluator/judge 完成前提前合并，必须用 PR head SHA 核对 verdict 锚定 SHA 与实际合并 SHA（来源: area）
- [全局规则] smoke 铁律（来源: area）
- [全局规则] brain 源码 PR 必须同时具备 smoke 和 allowlist 登记（来源: area）
- [全局规则] 新 task_type 接线必须覆盖约束、路由、executor、relay 映射和 dispatcher 防线（来源: area）
- [全局规则] 服务存活必须同时检查 launchctl 状态与端口监听（来源: area）
- [全局规则] 美国 Mac mini 常驻服务必须使用系统域 LaunchDaemon，禁止放入用户 LaunchAgents（来源: area）
- [全局规则] 新增常驻宿主服务必须同步加入 launchd-patrol manifest（来源: area）
- [全局规则] smoke 铁律（来源: area）
- [全局规则] 单 slot 内任务必须串行；任务内部只读角色可并行，但同一时刻只能有一个代码实现者（来源: area）
- [环境推导] 环境假设值禁止写死，必须从环境推导或经真机校准（来源: area）
- [真机验收] 依赖真机、生产环境或真实调用方的接缝断言必须在真目标验证后才算 done（来源: area）
- [多租户] 单元和 E2E 测试默认至少覆盖两个租户并断言隔离（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII、聊天内容不得明文进入日志（来源: area）
- [端点鉴权] 每个 API 端点必须有鉴权，无鉴权端点不得交付（来源: area）
- [租户隔离] 涉及租户数据的查询和写入必须限定当前租户，禁止跨租户混读混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment 填入真实脚本。
# 期望验收点：确认执行目标严格为 us-mac-m4；确认 Generator、Evaluator、Judge 证据均由本次 run 新生成；
# 逐份校验目标 SHA 均精确等于 c305f6217da65bb69413c39e621b7e797e0fb189；
# 确认 Judge verdict 生成前 PR #1581 未合并；任何缺证、错 SHA、错机器或提前合并均以非零结果退出。
```

## journey_type: autonomous
## journey_type_reason: payload 明确指定 autonomous，且本 sprint 是 Kernel Harness 后台验证链路。
## target_environment: local_api
## target_environment_reason: 第三方 repo 不做路径猜测，沿用 payload 显式 local_api；真实执行目标由严格 Fleet 亲和锁定为 us-mac-m4。
## journey_id: bb50964c-f8f7-4843-87da-7148a2611d80
## step_id: line02/keyword_acquisition#step7
