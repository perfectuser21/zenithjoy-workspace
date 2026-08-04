# Sprint PRD — 获客配置合并后上下界校验

## OKR 对齐

- **对应 KR**：ZenithJoy 产品全线上线 — AI双线创作 + 小程序 + 网站 + Dashboard 可交付
- **当前进度**：77%
- **本次推进预期**：保持获客配置更新的正确性，消除无效配置进入运行态的风险

## 背景

租户可能只提交获客配置的部分字段。校验必须针对补丁与租户当前配置合并后的有效配置，避免单独看补丁时漏过 `keywords_per_round_min` 大于 `keywords_per_round_max` 的组合。本 sprint 从冻结 Red SHA `0dc4e3c07ff19a0ac95440723986bf3cb78580b2` 起步，并以 TDD 固化回归行为。

## Golden Path（核心场景）

租户从提交获客配置更新 → 系统将更新与该租户当前配置合并并校验关键词每轮数量上下界 → 合法更新被保存，无效更新以明确错误拒绝且不产生持久化变化。

具体：
1. 已鉴权租户提交只含 `keywords_per_round_min` 或 `keywords_per_round_max` 的部分更新，或同时提交两者的完整更新。
2. 系统按当前租户配置形成有效配置；当 `keywords_per_round_min > keywords_per_round_max` 时返回 HTTP 400，响应中的 `error.code` 为 `INVALID_CONFIG`。
3. 无效有效配置不持久化任何补丁字段；合法的部分更新与完整更新继续成功，并只影响当前租户。

## 边界情况

- 补丁本身看似合法，但与当前配置合并后上下界倒置，必须拒绝。
- 同时提交上下界且合并后相等或最小值小于最大值，维持既有成功行为。
- 仅提交一个边界且合并后合法，维持既有部分更新行为。
- 拒绝请求后再次读取配置，内容必须与请求前完全一致，不能发生部分写入。
- 另一租户的配置与本租户的校验、读取和写入互不影响。

## 范围限定

**在范围内**：获客配置部分/完整更新的合并后上下界校验；HTTP 400 与 `INVALID_CONFIG` 错误；无效请求零持久化；合法更新回归验证；对应 smoke test 先红后绿。

**不在范围内**：修改共享 Red fixture；查看或复制 One-session 候选 worktree、patch、logs、PR 或 feedback；改变其他获客规则；合并 blind A/B verdict 之前的任何候选分支。

## 假设

- [ASSUMPTION: `gp_anchor=line02/keyword_acquisition#step7` 是本 sprint 的产品锚点，任务未提供 Journey/Step UUID，故末尾使用稳定 step code。]
- [ASSUMPTION: 现有配置更新入口、鉴权方式及合法更新响应保持不变；本 sprint 只新增无效有效配置的拒绝行为。]
- [ASSUMPTION: 具体受影响实现文件由 proposer 从现有 API 注册与测试入口确定，Planner 不探索代码。]

## 预期受影响文件

- `.github/workflows/scripts/smoke/golden-path-2-smoke.sh`: 为 Line 02 `keyword_acquisition` 的 step7 增加合并后配置校验回归验收
- `apps/api/` 中既有获客配置更新入口及其测试：承载可观察的 API 行为变更，精确文件由 proposer 锚定

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 冻结基线 SHA `0dc4e3c07ff19a0ac95440723986bf3cb78580b2`
- 可观测: 无效请求以 HTTP 400 和 `error.code=INVALID_CONFIG` 明确呈现；不得记录凭据、PII 或候选实验材料

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [租户隔离] 碰租户数据的查询与写入必须限定当前租户，跨租户数据不得混读或混写（来源: area）
- [多租户测试] 单元与 E2E 测试默认至少种两个租户并断言互不串扰（来源: area）
- [端点鉴权] 每个 API 端点必须鉴权，无鉴权端点不得交付（来源: area）
- [凭据安全] secrets 不得硬编码、进入 git 或日志（来源: area）
- [日志脱敏] 客户隐私、PII 与聊天内容不得明文进入日志（来源: area）
- [真环境验证] 依赖真实环境或调用方的接缝断言必须在真实目标验证后才算完成（来源: area）
- [环境假设] 环境假设值不得写死，必须从环境推导或真实校准（来源: area）
- [单会话串行] 一个 slot 内任务严格串行，写代码的实现者同一时刻只能有一个（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；任务未提供 journey_id，无法通过 Journey API聚合 -->
- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 模板填入真实 curl + PostgreSQL 脚本。
# 期望验收点：先建立两个租户及当前配置；对目标租户提交合并后 min>max 的部分更新，断言 HTTP 400、error.code=INVALID_CONFIG、前后持久化快照相同且另一租户不变；再断言合法部分更新与完整更新成功。
```

## journey_type: autonomous
## journey_type_reason: 需求是纯后端获客配置 API 的校验与持久化行为修复，无 UI 或远端 agent 交互。
## target_environment: local_api
## target_environment_reason: payload 显式指定 local_api，使用本地 API 与 PostgreSQL 完成端到端验收。
## journey_id: line02/keyword_acquisition
## step_id: step7
