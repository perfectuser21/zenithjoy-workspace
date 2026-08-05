# GAN Feedback — Round 1（Reviewer）

## RUBRIC SCORES

```json
{
  "dod_machineability": 9,
  "scope_match_prd": 8,
  "test_is_red": 8,
  "internal_consistency": 6,
  "risk_registered": 4,
  "verification_oracle_completeness": 8,
  "ci_workflow_alignment": 10
}
```

- **DoD 机检性 = 9**：7 条 [BEHAVIOR] 全部内嵌 `manual:bash` 可执行命令（真 Gradle test / 真 vitest），无 echo/grep-only 假验证。
- **Scope 匹配 PRD = 8**：Golden Path 4 步与 PRD 4 步逐一对应；发现并合理修正了 PRD 未预见的跨文件缺口（AgentService.kt/agent-burner.ts），理由充分（不透传到服务端持久化则 PRD 目标"运维免登真机排障"不成立），扣分理由见下方问题 2（来源标注不准确影响透明度）。
- **Test 真红 = 8**：Android 侧（`AccountScanFailureClassifierTest`/`AgentServiceAccountScanTest`）已在本地实跑 Gradle 确认真实编译失败（Unresolved reference），是验证过的真红；服务端集成测试（`agent-burner-routes.test.ts` 新增两个 it 块）未见任何执行日志/输出，只是"代码推理会失败"，未实证。
- **内部一致 = 6**：见下方问题 1（Invariant 覆盖条目格式缺失）与问题 2（来源标注误标）。
- **风险登记 = 4**：合同全文无 `## Risks` 或等价专门段落。判定点表的"误判后果"列部分覆盖了风险语义，但这是判定点专用的登记表，不能替代 rubric 定义的独立 Risks+mitigation 清单——见下方问题 3。
- **Verification Oracle 完整性 = 8**：服务端断言含 `created_at > NOW() - interval '5 minutes'` 时间窗（防历史数据冒充）；`AgentServiceAccountScanTest` 用 `JSONObject` 往返解析做强断言，不是弱 `.contains`；HTTP 响应 schema 本 sprint 不变，`N/A` 判断正确，不因此自动满分（已按等价 oracle 审查过）。
- **CI Workflow 内容对齐 = 10**：`target_environment=local_api`，合同全文无 `.yml` workflow 引用，本维 N/A 直接满分（已核实确无遗漏引用）。

## 收敛状态（Round 1）

- 上轮我提的阻塞问题：0（首轮）
- 本轮新增阻塞问题：3（全部可回答"PRD/协议某项要求未覆盖"，非"可以更严谨"类）
- 合同行数：contract-draft.md 245 行 + contract-dod.md 53 行。245 行偏厚，但审查后确认主要构成是两条真实 fixture 全文（占约 40 行，必要留痕）+ 八要素/判定点表（协议强制段落），非防作弊元数据堆砌，暂不判定为发散信号。

## VERDICT: REVISION

风险登记维度 4 分 < 7 阈值，触发 REVISION（其余维度均 ≥ 6，多数已达标）。

### 需要 Proposer 修的（3 项，均为可回答"协议/PRD 某项未覆盖"的真阻塞，非锦上添花）

**问题 1**（维度：内部一致，当前 6 分，目标 ≥ 7）
**描述**：proposer skill Step 1.3 强制要求"铁律清单必须逐条映射进 contract-dod.md——每条铁律一行，或显式写 `N/A：<理由>`"。本合同的 Invariant 约束在 `contract-draft.md` 里有narrative 段（继承自 PRD），但 `contract-dod.md` 本身完全没有对应的 `N/A：<理由>` 行——协议要求的落点文件（DoD）里没有，只在草案文件里有。
**修复**：在 `contract-dod.md` 的 BEHAVIOR 条目之前或之后补一行：
```
## Invariant 覆盖条目
N/A：本 line（客户智能获客路径）当前无与安卓账号扫描直接相关的 invariant 记录（已查 golden-path-decisions/invariants 三源，均为空）
```

**问题 2**（维度：内部一致 / scope_match_prd，当前 6 分，目标 ≥ 7）
**描述**：Golden Path Step 3（detail 全链路透传）标注为 `[AI_ADDED]`，但其**需求本身**（"系统在失败详情中统一附带 versionName/stage/前台包名"）逐字来自 `sprint-prd.md` Golden Path 具体步骤第 3 条，属 `[FROM_PRD]`。真正 `[AI_ADDED]` 的部分是"为达成此需求必须扩展 AgentService.kt + apps/api/agent-burner.ts 两个 PRD 未列出的文件"这个**实现范围发现**，不是需求本身。当前标注把两者混在一个 `[AI_ADDED]` 标签下，会让下游 harness-report 写入 Notion 的 GAN 标注表（FROM_PRD 来源步骤 | AI_ADDED 步骤+理由）产生失真——审计时会误以为"detail 需要三字段"是 AI 凭空加的，而非用户 PRD 原始要求。
**修复**：拆成两行标注，例如：
```
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤 3（detail 携带 versionName/stage/前台包名 的需求本身）
**范围补充**: `[AI_ADDED]` — 发现现有服务端 account-scan-result 路由（agent-burner.ts:817）只解构 screenshot_b64/tree_dump，此需求若不跟着透传到服务端持久化会在 AgentService.kt 广播转发这一步被丢弃，故补充 AgentService.kt + agent-burner.ts 两文件入范围
```

**问题 3**（维度：风险登记，当前 4 分，目标 ≥ 7）
**描述**：合同全篇没有独立的 `## Risks` 段。本任务并非零风险的机械改动，至少存在 3 条真实、值得写下来的风险，目前散落或完全未提及：
1. tree_dump 启发式分类器只用 2 条真实样本（da659ea0/236f43b1）训练直觉，未见样本的机型/系统语言（如英文系统"Swipe up to unlock"）可能不含"上滑解锁"关键词、被误判为非锁屏，继续走旧流程报回泛化错误码——**这条风险在判定点登记表的"误判后果"列已部分提及，但只针对已列的两个判定点，没有作为独立风险陈述其"新增未知机型"的开放性**。
2. `buildAccountScanResultBody()` 签名扩展新增 3 个参数——若 Generator 遗漏在 `DeviceAccountScanService.kt` 调用点补齐新参数（默认值为 null 会静默不传，不会编译报错），"版本已升级但字段悄悄没传"这种半吊子实现不会被现有 DoD 测试抓到（现有测试只测函数本身，不测调用点是否传参）。
3. `apps/api/agent-burner.ts` 的 `agent_scan_failures` 是高频写入表（本 sprint 前每天几十条真实失败记录），本次改动的是生产在跑的 INSERT 语句——新增字段解构若类型判断疏漏（比如漏掉 `typeof x === 'string'` 守卫），可能导致该 INSERT 整体抛异常，反而让现有失败记录能力（本身是排障工具）失效。
**修复**：在合同新增 `## Risks` 段，至少覆盖以上 3 条 + mitigation（如：风险1 mitigation="nightly 真机车道持续跑不同机型会自然暴露未知分类盲区，属既有可观测机制"；风险2 mitigation="补一条 [BEHAVIOR] 验证 DeviceAccountScanService.kt 调用 buildAccountScanResultBody 时确实传入了非默认值的三参数（而不仅测函数本身）"；风险3 mitigation="沿用现有代码同款 `typeof x === 'string' ? x : null` 防御写法，DoD 补一条空值/非字符串输入不炸的用例"）。

### 非阻塞观察（不计入 REVISION，仅供参考）

- 07-30 fixture 判定依据写"抖音图标可见+ZenithJoy Agent 图标"，与"我，按钮"未出现的组合逻辑并列，Generator 实现时注意别把"含'抖音'两字"当唯一判据（fixture 里"微信"/"抖音"通知描述都含平台名，需要更结构性的信号，比如"未见任何底部导航栏特征节点"）——这是实现细节提醒，不是合同缺陷，不强制要求本轮修改。
