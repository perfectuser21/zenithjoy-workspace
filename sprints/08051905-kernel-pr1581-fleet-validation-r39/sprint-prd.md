# Sprint PRD — Fleet Worker 正确 payload 结构验证

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：完成 `line02/keyword_acquisition#step7` 的一次可审计验证

## 背景

本次验证锚定 `line02/keyword_acquisition#step7`。Fleet Worker 必须以 payload 中的 `base_repo`、`target_head_sha` 与 `gp_anchor` 为权威输入，在冻结基线之上验证目标 PR，不得依赖任务标题或工作区隐含状态。

## Golden Path（核心场景）

系统从收到 Fleet Worker 正确 payload 结构的 Harness Initiative → 校验仓库、目标提交与 Golden Path 锚点 → 输出绑定同一目标提交的可审计验收结论。

具体：
1. Fleet Worker 收到 `base_repo=perfectuser21/zenithjoy-workspace`、`target_head_sha=c305f6217da65bb69413c39e621b7e797e0fb189`、`gp_anchor=line02/keyword_acquisition#step7`。
2. 系统确认三个字段存在且格式有效，并以冻结的 `base_sha=676fed7de12023d355deac7849af8a525ae53f8d` 为比较基线。
3. 验收结论明确记录目标仓库、目标提交和 Step 7 锚点；任一字段缺失、不一致或不可解析时不得产生成功结论。

## 边界情况

- `base_repo` 缺失或不等于目标 PR 所属仓库时，验证失败并指出字段不一致。
- `target_head_sha` 缺失、不是完整 SHA 或与目标 PR head 不一致时，验证失败，不回退到当前工作区 HEAD。
- `gp_anchor` 缺失或不能唯一解析到 `line02/keyword_acquisition#step7` 时，验证失败，不猜测其他 Step。
- GitHub 或 Postgres 依赖不可用时，结果标记环境失败，不得误报业务通过。

## 范围限定

**在范围内**：验证 Fleet Worker 对 `base_repo`、`target_head_sha`、`gp_anchor` 三个 payload 字段的消费与验收证据绑定。

**不在范围内**：修改 PR #1581 的业务实现、扩展 keyword_acquisition 其他步骤、改变 Harness 调度策略。

## 假设

- [ASSUMPTION: `gp_anchor=line02/keyword_acquisition#step7` 是本 sprint 的 PrepPRD Golden Path 锚点。]
- [ASSUMPTION: 目标 PR #1581 的 head 严格等于 payload 的 `target_head_sha`。]
- [ASSUMPTION: 本次验证既有行为，不引入用户可见新功能。]

## 预期受影响文件

- `sprints/08051905-kernel-pr1581-fleet-validation-r39/sprint-prd.md`: 固化验证范围与验收目标。
- `sprints/08051905-kernel-pr1581-fleet-validation-r39/contract-draft.md`: 由 Proposer 写入绑定目标 SHA 的最终可执行验收脚本。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 7200 秒（来源: payload.timeout_seconds）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 目标提交必须精确为 `c305f6217da65bb69413c39e621b7e797e0fb189`
- 可观测: 结论必须同时记录 `base_repo`、`target_head_sha`、`gp_anchor` 及失败分类

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [目标绑定] 判变基准使用生产实体或权威远端提交对账，禁止用工作区 diff 代替（来源: area）
- [引用校验] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`（来源: area）
- [真目标验证] 依赖生产环境或真实调用方的接缝断言必须在真目标验证，未真验只能标 logic-done-pending（来源: area）
- [证据一致] PR 提前合并时必须核对 evaluator/judge verdict 锚定 SHA 与实际合并 SHA 一致（来源: area）
- [临时隔离] evaluator 临时脚本必须使用含 session id 的独享路径（来源: area）
- [人工真验] 合同批准前必须记录 manual oracle 的真实 exit code，并确认目标解释器确实启动（来源: area）
- [Judge 格式] Brain judge API 必须含顶层 exit_code、log_tail、behavior_tests，且每项 behavior test 含 exit_code 与 log_tail（来源: area）
- [目标环境] target_environment 必须由 Brain orchestrator 从 task payload 读取，禁止依赖本地文件（来源: area）
- [负向结论] 部署或验证链失败路径必须显式失败并以非零状态退出，不得 warning 降级（来源: area）
- [密钥保护] secrets 不硬编码、不进 git、不进日志（来源: area）
- [隐私保护] 客户隐私、PII 与聊天内容不得明文进入日志（来源: area）
- [租户隔离] 涉及租户数据的查询和写入必须限定当前租户，测试默认覆盖至少两个租户（来源: area）
- [共享禁区] 未经合同显式授权不得修改共享 CI 基础设施判定文件（来源: area）
- [串行执行] 同一 slot 同时只允许一个任务运行，任务完成 handoff 后才可启动下一个（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 模板填入真实脚本（Brain API + GitHub + Postgres 证据核对）
# 期望验收点（自然语言）：从任务 payload 入口到验收结论出口，三项字段原样保留且结论绑定目标 PR head SHA；逐项缺失或篡改时均可靠失败。
```

## journey_type: autonomous
## journey_type_reason: 验证对象是 Fleet Worker 的后端 payload 消费与验收绑定，不含用户界面步骤。
## target_environment: local_api
## target_environment_reason: payload 显式指定 local_api，验收在本地 evaluator 通过 Brain API、GitHub 与 Postgres 证据执行。
## journey_id: bb50964c-f8f7-4843-87da-7148a2611d80
## step_id: line02/keyword_acquisition#step7
