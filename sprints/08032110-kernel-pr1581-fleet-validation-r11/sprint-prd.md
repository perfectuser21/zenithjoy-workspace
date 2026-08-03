# Sprint PRD — Kernel acquisition effective-config guard v2 真实 Fleet 验证 r11

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：以一次新鲜、可追溯的真实业务验证提高 Kernel Harness 可信度；不预设百分点

## 背景

PR #1581 的 Kernel acquisition effective-config guard v2 需要在固定目标提交 `c305f6217da65bb69413c39e621b7e797e0fb189` 上完成第 11 次真实 Fleet 验证。上次运行因 `callback_runner_failure` 失败；本次只使用已准入的 US M4 Runner，西安节点继续排空，直到固定镜像可经离线 NAS 中继。

## Golden Path（核心场景）

Harness 从 PR #1581 的精确 head SHA 进入 → 在 US M4 Runner 运行完整 provider-neutral pipeline → 新鲜 Evaluator 与 Independent Judge 均对同一 SHA 给出结论后，才允许进入合并出口。

具体：
1. 调度器仅接纳 `us-mac-m4`，并将验证对象固定为 PR #1581 的 `c305f6217da65bb69413c39e621b7e797e0fb189`。
2. 系统完成 Planner、合同对抗、Generator、Evaluator 与 Independent Judge 全链路；各结论均可追溯到本次运行和同一目标 SHA。
3. 只有新鲜 Evaluator 与 Independent Judge 均通过，且未触碰禁止项，系统才报告可合并；任一失败、缺席、SHA 漂移或环境漂移均保持未合并并明确失败原因。

## 边界情况

- US M4 Runner 不可用、目标 SHA 不一致或 PR head 发生漂移时立即失败，不回退到其他机器。
- Xian 节点保持 drained；固定镜像未通过离线 NAS 中继前不得参与本次验证。
- Evaluator 或 Independent Judge 任一结果缺失、非新鲜、未锚定目标 SHA，均不得判定可合并。
- 禁止读取或复制其他 candidate、修改共享 red fixture、在 blind verdict 前合并。

## 范围限定

**在范围内**：PR #1581 精确 SHA 的一次新鲜真实业务 Fleet 验证；完整 provider-neutral pipeline；US M4 单节点严格亲和；Evaluator 与 Independent Judge 双闸；合并前 SHA 与禁区核对。

**不在范围内**：改写 PR #1581 功能；修复验证中发现的问题；使用 Xian 节点；在线分发固定镜像；借用历史 verdict；自动放宽机器或 provider 约束。

## 假设

- [ASSUMPTION: payload 未提供 `thin_prd`；本 PRD 以任务 description 中“Fresh real-business Kernel Harness validation”及 `gp_anchor=line02/keyword_acquisition#step7` 锚定范围，不把 title 当作额外产品需求。]
- [ASSUMPTION: payload 显式 `target_environment=local_api` 是本次第三方仓库环境真相，优先于路径猜测；实际执行机器仍由 strict affinity 固定为 `us-mac-m4`。]
- [ASSUMPTION: 本 sprint 只产出验证结论；若发现产品缺陷，另行立项，不在本轮隐式修改。]

## 预期受影响文件

- `sprints/08032110-kernel-pr1581-fleet-validation-r11/sprint-prd.md`: 固化本轮范围与验收入口
- 本 sprint 后续合同、证据与 verdict 文件：记录同一运行、同一目标 SHA 的可审计验证结果

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 全流程上限 7200 秒
- 频控: 单次执行，commander 重试预算为 0
- 版本要求: 目标 PR head 必须精确为 `c305f6217da65bb69413c39e621b7e797e0fb189`；Runner 版本 `1.267.97`
- 可观测: Evaluator、Independent Judge、运行 ID、目标 SHA、失败原因与禁区核对结果必须可追溯

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；本任务 step/feature 源为空，area 源共 62 条 -->
- [窄路径验证] 高成本窄触发路径可用零 mock 源码检查与同机制真实触发交叉验证，但必须披露覆盖余留，不得等同全链路（来源: area）
- [数据库同源] 冒烟写入侧与校验侧的 DB_NAME 必须同源，禁止各自默认值（来源: area）
- [字段核实] 涉及 agents 表字段前必须用 psql 核对真实列名（来源: area）
- [枚举复查] 新增状态值时必须全仓复查合同与测试中的枚举硬编码断言（来源: area）
- [安全恢复] watchdog_overdue 后仅可经 orphan requeue、外部真相核查后从头重跑（来源: area）
- [语义成功] 通知或写库成功必须检查 sent/accepted 等语义字段，不得只看 ok（来源: area）
- [依赖修复] dep-audit 新 advisory 先查 fixAvailable，兼容修复优先 npm audit fix（来源: area）
- [等待心跳] headed relay 长 CI 等待必须周期性更新心跳（来源: area）
- [毕业门禁] 测试毕业 rename 后 push 前必须运行 lint-tdd-commit-order 与 check-test-coverage（来源: area）
- [Oracle实跑] 合同批准前记录 manual oracle 真实退出码并确认目标解释器启动（来源: area）
- [Shell展开] 双引号 node -e 中的 JavaScript 模板表达式必须逐条真跑，bash -n 不足够（来源: area）
- [冒烟铁律一] smoke 铁律（来源: area）
- [冒烟铁律二] smoke 铁律（来源: area）
- [跨轮测试] 周期扫描测试至少包含状态不重置且时间真实流逝的多轮集成场景（来源: area）
- [重复付费] 周期重扫接外部付费调用时必须先检查是否已处理（来源: area）
- [时间关系] 跨模块时间常数的大小关系必须显式写为不变量断言或注释（来源: area）
- [剧场匹配] 合同环境关键词必须与实际 theater 匹配，不以排除说明规避路由检查（来源: area）
- [环境真相] target_environment 必须从任务 payload 正确登记并作为路由真相（来源: area）
- [Judge格式] Brain judge 结果必须含顶层 exit_code、log_tail 与逐条含退出码和日志的 behavior_tests（来源: area）
- [字段长度] 无天然长度保证的数据写入受限 DB 字段前必须显式约束长度（来源: area）
- [历史死因] 复活退役功能前必须读删除历史与退役前真实代码核对死因（来源: area）
- [失败返回] 返回 null/false 表示失败的函数调用必须显式处理失败分支（来源: area）
- [冒烟铁律三] smoke 铁律（来源: area）
- [进度探针] journey_features.updated_at 长期早于对应 PR 合并时间视为 report 漏跑信号（来源: area）
- [报告收账] 不得仅凭容器退出码判完成，必须核验合并与 report 产出物（来源: area）
- [接管白名单] host 或环境白名单合同必须覆盖 headed 人工接管场景（来源: area）
- [Relay锚点] headed relay payload 必须含 base_repo 或 pr_url，分支名必须带 task short id（来源: area）
- [退役实证] 退役判断必须依据生产数据与消费方检索，不得依靠记忆（来源: area）
- [后台告警] catch 吞错的后台任务必须计数并在连续失败越阈值时告警（来源: area）
- [表名认领] 建表或复用表前检索全部写入方，共用表必须做 schema 对齐评审（来源: area）
- [消费方] 新增后台 job 必须同时声明真实消费方（来源: area）
- [多端完整] 多设备或操作系统字段必须在设计、合同与展示层明确区分（来源: area）
- [语义一致] 同一未知值语义在判变端与终验端必须采用同一策略（来源: area）
- [Ref校验] git ref 存在性必须使用 rev-parse --verify 且解析为 commit（来源: area）
- [隔离冒烟] 真实 worktree 冒烟前必须隔离生产资源并显式列出跳过钩子（来源: area）
- [部署失败] 部署链失败不得 warning 降级，必须告警并非零退出（来源: area）
- [生产自报] 判变基准必须以生产实体自报 SHA 对账 origin/main，不得用工作区 diff（来源: area）
- [异步测试] lint-test-quality 所需源码读取测试必须经可 await 的异步函数（来源: area）
- [合同表格] Test Contract 固定四列，测试文件路径用反引号并位于第三列（来源: area）
- [Red提交] Red commit 只能精确暂存测试路径，不得使用 git add 点或整个 harness 目录（来源: area）
- [接线回归] 调度接线优先用源码检查做直接回归验证（来源: area）
- [调度入口] 新 cron 必须先检查 scheduler-jobs.js JOBS，不使用已弃用 tick-runner 路径（来源: area）
- [合并权] Generator 禁止自行合并，只能推分支并报告 ready，合并权属于 Controller（来源: area）
- [环境传递] tmux innerCmd 所需 Harness 环境变量必须显式 export（来源: area）
- [合同复用] 复用历史合同前必须核对本次真实派发和执行历史（来源: area）
- [共享禁区] 共享 CI 基础设施文件未经合同明确授权不得修改（来源: area）
- [提前合并] 若 CI 提前合并，必须核对实际合并 SHA 与 evaluator/judge verdict 锚定 SHA 一致（来源: area）
- [冒烟铁律四] smoke 铁律（来源: area）
- [Brain冒烟] feat 与 brain/src PR 开 PR 前必须同时准备 smoke.sh 和 smoke allowlist 登记（来源: area）
- [任务接线] 新 task_type 必须覆盖数据库约束、router、executor、override、relay skill、cap/lock/bridge 全链（来源: area）
- [服务存活] 常驻服务存活必须同时核验 launchctl 状态与端口监听（来源: area）
- [宿主服务] 美国 Mac mini 常驻服务必须使用系统域 LaunchDaemon，不得放用户 LaunchAgents（来源: area）
- [巡检清单] 新常驻宿主服务必须同步加入 launchd-patrol manifest（来源: area）
- [冒烟铁律五] smoke 铁律（来源: area）
- [单槽串行] 一个 slot 仅运行一个任务；跨 slot 可并行，单任务内只能有一个写代码实现者（来源: area）
- [环境假设] 环境相关值不得硬编码，必须从环境推导或在真机校准（来源: area）
- [真环境完成] 接缝断言必须在真实目标验证；未真验只能标 logic-done-pending（来源: area）
- [多租户测试] 涉及租户数据的单元与 E2E 默认至少两个租户并断言隔离（来源: area）
- [凭据安全] secrets 不硬编码、不进入 Git、不进入日志（来源: area）
- [日志脱敏] 客户隐私、PII 与聊天内容不得明文进入日志（来源: area）
- [端点鉴权] 每个 API 端点必须有鉴权（来源: area）
- [租户隔离] 租户数据查询与写入必须限定当前租户，绝不跨租户混读混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 与 us-mac-m4 严格亲和要求填入真实脚本
# 期望验收点：在 US M4 Runner 对 PR #1581 精确 SHA 完成完整 provider-neutral pipeline；Evaluator 与 Independent Judge 均为本次新鲜结论并锚定同一 SHA；双闸通过前保持未合并，Xian 节点不参与。
```

## journey_type: autonomous
## journey_type_reason: payload 显式指定 autonomous，核心路径为无人值守 Harness 后端验证链。
## target_environment: local_api
## target_environment_reason: 第三方仓库不做路径猜测，采用 payload 显式 local_api；执行机器由 strict affinity 固定为 us-mac-m4。
## journey_id: bb50964c-f8f7-4843-87da-7148a2611d80
## step_id: line02/keyword_acquisition#step7
