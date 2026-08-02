# Sprint PRD — Kernel acquisition effective-config guard v2 显式恢复

## OKR 对齐

- **对应 KR**：KR-运行时未编号（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：完成 PR #1581 在冻结基线与精确最终 SHA 上的独立双重验收，不虚增 OKR 百分比

## 背景

PR #1581 的 Kernel acquisition effective-config guard v2 已完成 Commander profile schema 规范化。本次是更正精确 Red SHA 后的显式恢复；前序运行因远端 bridge 启动 500 失败，当前运行应从 evaluate 继续，且只有 Evaluator 与 Independent Judge 都锚定目标最终 SHA `c305f6217da65bb69413c39e621b7e797e0fb189` 给出结论后才可进入合并判断。

## Golden Path（核心场景）

Harness 从 Kernel acquisition effective-config guard v2 显式恢复入口 → 在冻结基线下从 evaluate 阶段核验 PR #1581 的 effective-config guard → Evaluator 与 Independent Judge 对同一精确最终 SHA 独立给出可追溯结论。

具体：
1. 恢复运行读取 PR #1581，确认待验收对象是精确最终 SHA `c305f6217da65bb69413c39e621b7e797e0fb189`，且冻结基线未被候选或共享 Red fixture 污染。
2. Evaluator 在 `local_api` 环境对该 SHA 的 Kernel acquisition effective-config guard v2 合同行为执行验收，并将结论明确锚定该 SHA。
3. Independent Judge 不读取或复制其他 candidate，针对同一 SHA 独立复核证据与结论。
4. 仅当两者均完成且 SHA 完全一致时产出最终可合并信号；任一缺失、SHA 漂移或证据不一致均保持未通过且不得先合并。

## 边界情况

- PR head 不等于目标 SHA、冻结基线被污染或比较输入不等价时，停止验收并报告具体漂移，不用其他 SHA 代替。
- Evaluator 或 Independent Judge 任一未完成、格式无效或未锚定 SHA 时，不得把单方结果当成最终通过。
- 远端 bridge 再次失败时保留失败原因与目标 SHA，不回退到已被本次恢复取代的 PR #1579 或前序运行。
- Commander profile 只接受当前已规范化 schema；不重新引入 `primary.strict_affinity` 等无效字段。

## 范围限定

**在范围内**：PR #1581；Kernel acquisition effective-config guard v2；从 evaluate 恢复；冻结基线检查；目标最终 SHA 一致性；Evaluator 与 Independent Judge 双重结论；禁止提前合并。

**不在范围内**：生成新 candidate；修改共享 Red fixture；读取或复制其他 candidate；重新定义 Commander profile schema；回退到 PR #1579；在双重结论前合并；扩展 Line 02 评论区挖客业务行为。

## 假设

- [ASSUMPTION: `gp_anchor=line02/keyword_acquisition#step7` 是本次恢复的 Golden Path 锚点；本 sprint 只恢复该锚点上的 Kernel 验收流程，不新增评论区挖客能力。]
- [ASSUMPTION: payload 已显式指定 `target_environment=local_api`，因此验收在本地 API/后台环境进行。]
- [ASSUMPTION: `thin_prd` 未单列；payload 的 description、recovery_context、target_pr_url 与 target_head_sha 共同构成本次 PrepPRD 范围锚点。]

## 预期受影响文件

- `sprints/08030535-kernel-acquisition-config-recovery-bb102e83/sprint-prd.md`：记录本次显式恢复的范围与验收入口；本阶段不要求修改产品代码。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 整个恢复运行最多 7200 秒
- 频控: 待定（PrepPRD 未指定）
- 版本要求: Commander profile 使用当前已规范化 schema；目标代码版本固定为 `c305f6217da65bb69413c39e621b7e797e0fb189`
- 可观测: Evaluator 与 Independent Judge 的结论、证据和失败原因必须可追溯到同一精确最终 SHA

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [窄路验证] 高成本且触发条件窄的真实 E2E 可用零 mock 的结构检查与同机制真实调用交叉验证，但须如实标注覆盖余留，不得冒充全链路测试（来源: area）
- [数据库源] 冒烟脚本写入侧与校验侧的 DB_NAME 必须来自同一变量或同一解析逻辑（来源: area）
- [字段核实] 涉及 agents 表字段的合同或测试须先以 psql 核对真实列名（来源: area）
- [枚举复查] 新增状态值时须全仓复查合同与测试中的 status 枚举硬编码断言（来源: area）
- [超时恢复] watchdog_overdue 后须经 orphan requeue、外部真相核查再从头恢复（来源: area）
- [语义成功] 通知或写库成功须检查 sent/accepted 等语义字段，不得只看 ok:true（来源: area）
- [依赖审计] 新 advisory 先检查 fixAvailable，存在兼容修复时优先修复而非加白名单（来源: area）
- [等待心跳] headed relay 长时间等待 CI 时须周期性更新 relay-run 心跳（来源: area）
- [毕业闸门] 测试入册后须先跑 lint-tdd-commit-order 与 check-test-coverage 再推送（来源: area）
- [人工预言] 合同批准前须记录 manual oracle 的真实 exit code 并确认目标解释器启动（来源: area）
- [命令真跑] manual node 命令中的模板表达式须在 GAN 批准前真实执行，bash -n 不足以替代（来源: area）
- [冒烟一] smoke 铁律（来源: area）
- [冒烟二] smoke 铁律（来源: area）
- [多轮扫描] 须覆盖状态不重置且时间真实流逝的多轮扫描集成场景（来源: area）
- [付费去重] 周期重扫触发外部付费调用时必须先检查数据是否已处理（来源: area）
- [时间关系] 跨模块时间常数的大小关系须写成显式不变量断言或注释（来源: area）
- [剧场匹配] contract 中 Android 字样会触发环境检查，后端能力应使用真实所需环境而非 Android 假设（来源: area）
- [环境路由] target_environment 必须在任务 payload 中正确设置，Brain 不从本地文件读取（来源: area）
- [裁判格式] Judge 结果须有顶层 exit_code、log_tail、behavior_tests，且每项测试含 exit_code 与 log_tail（来源: area）
- [字段长度] 无天然长度保证的数据写入有限长 DB 字段前须显式截断（来源: area）
- [复活溯源] 恢复退役功能前须读取删除历史与退役前真实代码核对死因（来源: area）
- [失败分支] 返回 null/false 表示失败的函数调用必须显式处理失败分支（来源: area）
- [冒烟三] smoke 铁律（来源: area）
- [报告探针] journey_features.updated_at 长期早于 PR 合并时间是 report 漏跑信号（来源: area）
- [收账产物] Harness 完成不能只依赖容器退出码，须核验合并与 report 产出物（来源: area）
- [环境白单] Host 或环境白名单断言须核对 headed 人工接管场景（来源: area）
- [点火锚点] Headed relay payload 须带 base_repo 或 pr_url，分支名须带 task short id（来源: area）
- [退役证据] 退役判断须用生产数据和消费方证据，不依赖记忆（来源: area）
- [吞错告警] 吞错的后台 job 须有失败计数，连续失败超过阈值须告警（来源: area）
- [表名认领] 新建或复用表前须检查全部写入方，多写入方必须完成 schema 对齐评审（来源: area）
- [真实消费] 新增后台 job 必须声明真实消费方，无下游读方不得上线（来源: area）
- [多端完整] 涉及多种 os_type/device_platform 时须在设计与验收中确认 UI 区分（来源: area）
- [语义同一] 同一语义在判变端与终验端必须采用同一处理策略（来源: area）
- [提交核实] 判断 Git ref 存在须使用 `git rev-parse --verify "<ref>^{commit}"`（来源: area）
- [生产隔离] 使用真实 worktree 冒烟前须核对生产资源接触面并显式设置跳过钩子（来源: area）
- [部署失败] 部署链失败路径须明确告警并非零退出，不得降级为 warning（来源: area）
- [判变真相] 部署判变须用生产实体自报版本对账 origin/main，不得用工作区 diff（来源: area）
- [异步测试] 受 lint-test-quality 约束的源码读取测试须包含真实异步函数调用（来源: area）
- [合同表格] Test Contract 固定四列且测试文件路径使用反引号（来源: area）
- [红测提交] Red commit 只能暂存精确测试路径，不得使用宽泛 git add（来源: area）
- [接线检查] 调度接线回归可使用 source-code inspection 直接验证（来源: area）
- [调度入口] 新增 cron 功能先检查 scheduler-jobs.js，tick-runner.js 是退役路径（来源: area）
- [合并权限] Generator 禁止自行合并 PR，只能推送 branch 并报告 ready（来源: area）
- [环境传递] Headed relay 的 tmux innerCmd 须显式 export Harness 上下文变量（来源: area）
- [先例核对] Proposer 复用历史合同前须核对本次真实派发与执行历史（来源: area）
- [共享禁区] 未经合同授权不得修改共享 CI 基础设施判定文件（来源: area）
- [提前合并] PR 意外提前合并时须核对 PR head、Evaluator、Judge 与 merge SHA 一致（来源: area）
- [冒烟四] smoke 铁律（来源: area）
- [脑部冒烟] 修改 brain 源码的 PR 须一次带齐 smoke 与 allowlist 登记（来源: area）
- [任务接线] 新 task_type 须核对约束、路由、执行器、relay 映射及派发防线（来源: area）
- [服务双信] 常驻服务存活须同时核对服务管理状态与端口监听（来源: area）
- [守护位置] 美国 Mac mini 常驻服务不得放用户 LaunchAgents，应使用系统 LaunchDaemon（来源: area）
- [服务清单] 新增常驻宿主服务须同步登记 launchd-patrol manifest（来源: area）
- [冒烟五] smoke 铁律（来源: area）
- [单槽串行] 一个 slot 内任务严格串行；任务内只读工种可扇出，但同时只能有一个写代码实现者（来源: area）
- [环境取值] 环境假设值不得硬编码，须从环境推导或在真目标校准（来源: area）
- [真验完成] 接缝断言须在真目标验证后才可标 done，未真验只能标 logic-done-pending（来源: area）
- [多租户测] 单元与 E2E 默认至少种两个租户并断言隔离（来源: area）
- [凭据安全] Secrets 不得硬编码、进入 Git 或进入日志（来源: area）
- [日志脱敏] 客户隐私、PII 与聊天内容不得明文进入日志（来源: area）
- [端点鉴权] 每个 API 端点必须有鉴权，无鉴权端点不得交付（来源: area）
- [租户隔离] 租户数据读写必须限定当前租户，不得跨租户混读混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## 验收标准

- PR #1581 的实际 head 与目标 SHA `c305f6217da65bb69413c39e621b7e797e0fb189` 完全一致。
- Evaluator 在冻结基线下完成 Kernel acquisition effective-config guard v2 验收并输出锚定目标 SHA 的结构化证据。
- Independent Judge 独立输出锚定同一目标 SHA 的结构化盲审结论。
- 两份结论均明确记录 exit code、日志尾部与行为测试证据，且不存在 SHA 漂移。
- 共享 Red fixture 未修改，未读取或复制其他 candidate，冻结比较基线未被污染。
- 在 Evaluator 与 Independent Judge 双方结论齐备前无 merge；任一失败均保持不可合并。

## E2E 验收

```bash
# proposer 按 local_api 环境补全真实 evaluator/judge 调用与产物路径。
# 期望验收点：PR #1581 的 head 等于 c305f6217da65bb69413c39e621b7e797e0fb189，Evaluator 与 Independent Judge 对该 SHA 独立通过，且双结论之前未发生 merge。
```

## journey_type: autonomous
## journey_type_reason: payload 明确指定 autonomous，且任务是 Kernel Harness 后台验收恢复，无用户界面交互。
## target_environment: local_api
## target_environment_reason: payload 明确指定 local_api，由本地 evaluator 在后台/API 环境核验精确最终 SHA。
## journey_id: bb50964c-f8f7-4843-87da-7148a2611d80
## step_id: line02/keyword_acquisition#step7
