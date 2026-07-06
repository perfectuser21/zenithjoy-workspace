# Reviewer Feedback — Round 1

## RUBRIC SCORES

```json
{
  "dod_machineability": 9,
  "scope_match_prd": 6,
  "test_is_red": 9,
  "internal_consistency": 7,
  "risk_registered": 5,
  "verification_oracle_completeness": 10,
  "ci_workflow_alignment": 10
}
```

- **DoD 机检性 = 9**：全部 [BEHAVIOR]/[ARTIFACT] 都是 `manual:bash` 真跑 `gradle :app:testDebugUnitTest` + grep exit code，非 echo/自然语言描述。`ANDROID_HOME` 缺失时 SKIP→exit 0 是既定 local_api 降级约定（同 07052218 先例），不算弱化。
- **Scope 匹配 PRD = 6**：PRD NFR 明确写"频控：关注 ≤10 次/小时，点赞 ≤15 次/小时"，但 contract-draft.md 和 contract-dod.md 全文搜索"频控"只命中一处——已有 `classifyOutcome` 的私信频控（与本次无关），**关注/点赞这两个新动作的频控要求在合同里完全没出现**：既没有对应 ARTIFACT/BEHAVIOR，也没有显式"不在范围内"声明+理由。PRD"不在范围内"段只排除了"跨批次持久化查询去重"，这解决的是"重复关注/点赞"问题，不解决"每小时次数上限"问题——两者是不同机制，不能互相顶替。这是漏覆盖，不是锦上添花。
- **Test 真红 = 9**：`tests/android/DouyinDmWarmupSearchLogicTest.kt` 引用 `DouyinDmOutreachService.matchProfileByDouyinId` / `needsFollowClick` / `needsLikeClick` / `isLeadTimedOut` 均未定义，Test Contract 表列了编译失败证据（3+6+3 failures），不动代码跑必红。
- **内部一致 = 7**：轻微不一致——Step 3 的"对应 test case"只列了 `zero matches -> NO_MATCH` 一条，但测试文件实际拆成两条 (`zero matches -> NO_MATCH` 和 `empty search results -> NO_MATCH`)，DoD 第 2 条 [BEHAVIOR] 的 grep 断言也只锚定前者，后者未被任何 DoD 命令显式验证（虽同属 NO_MATCH 分支，逻辑覆盖到，但文档没写全）。
- **风险登记 = 5**：接缝清单（无障碍树读取/按钮文本稳定性/全链路真机验证）覆盖了技术假设类风险，但漏了两条 PRD 明确点出的产品风险：(1) 关注/点赞频控超限风险（同上，无 mitigation）；(2) PRD"关于关注的产品决策"段明确写"关注是不可逆的社交动作，本次决策为不做取消关注机制"——这是一个用户会真实遇到的风险点（误关注不可撤销），合同没有把它登记为 Risk 并说明 mitigation（哪怕 mitigation 就是"产品决策接受该风险，不做修复"，也该写明白，而不是只字不提）。
- **Verification Oracle 完整性 = 10**：PRD 显式声明本 sprint 无 HTTP 响应（N/A），contract-draft.md 开头已注明来源 N/A，符合豁免条件。
- **CI Workflow 内容对齐 = 10**：`target_environment=local_api`（非 windows_cloud/windows_wechat/linux_server），按 rubric 规则填 10（N/A）。已额外核对 `.github/workflows/android-agent-ci.yml` 内容作为交叉验证：CI 跑 `gradle :app:testDebugUnitTest`（无过滤 tests 参数，会连带跑本次新增测试文件），语义与合同一致，无 MOCK_* 注入。

## VERDICT: REVISION

阈值固定 7/10。`scope_match_prd=6`、`risk_registered=5` 均 < 7 → REVISION。

### 需要 Proposer 修的（block 项）

**问题 1**（维度：scope_match_prd，当前 6 分，目标 ≥ 7）
**描述**：PRD NFR"频控：关注 ≤10 次/小时，点赞 ≤15 次/小时"在合同里完全未被处理——无对应纯函数、无 ARTIFACT/BEHAVIOR、无显式排除声明。PRD"不在范围内"里排除的是"跨批次持久化去重查询"，这不等于排除"每小时次数上限"这个独立机制，两者不能混为一谈。
**修复**：二选一，且必须显式：
  (a) 在合同里新增一个频控判断纯函数（如 `isFollowRateLimited(countInLastHour: Int): Boolean` 及点赞对应版本）连同单测，纳入本 sprint 范围；或
  (b) 在 PRD"不在范围内"新增一条明确排除"关注/点赞每小时频控计数"，并说明理由（例如：频控计数依赖跨批次持久化状态，本 sprint 决策推迟到下个 sprint，本次只做按钮态实时判断防重复点击）——但这个决策需要用户/PRD 层面显式拍板，不能由 Proposer 自行悄悄吞掉。

**问题 2**（维度：risk_registered，当前 5 分，目标 ≥ 7）
**描述**：接缝清单只覆盖技术假设风险，遗漏 PRD 明确指出的两个产品风险：频控超限（与问题 1 联动）、关注不可逆且不做撤销机制。
**修复**：在合同新增一个"产品风险"条目（可并入接缝清单或单列 Risks 栏），至少覆盖：
  - 频控超限风险 + mitigation（联动问题 1 的修复方案）
  - 误关注不可逆风险 + mitigation（哪怕 mitigation 就是"PRD 已拍板接受该风险，不做撤销"，也要写明这是有意识的产品决策而非遗漏）

### Non-blocking（不影响 verdict，供 Proposer 参考）

- Step 3 的"对应 test case"列表建议补全 `empty search results -> NO_MATCH`，避免文档与测试文件条目对不齐。
