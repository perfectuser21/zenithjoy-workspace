# Sprint PRD — 获客配置局部更新的有效配置校验

## OKR 对齐

- **对应 KR**：KR 待定（Brain context 未返回活跃 KR）
- **当前进度**：待定
- **本次推进预期**：完成 line02/keyword_acquisition Step 7 的配置校验缺口

## 背景

租户可能只提交 `keywords_per_round_min` 或 `keywords_per_round_max`。校验必须基于补丁与租户当前配置合并后的有效配置，避免写入上下界倒置的数据。本 Sprint 从冻结 Red SHA `0dc4e3c07ff19a0ac95440723986bf3cb78580b2` 开始，以 TDD 完成恢复验证。

## Golden Path（核心场景）

系统从租户提交获客配置局部或完整更新 → 形成包含现有值与提交值的有效配置并判断关键词轮次上下界 → 对无效配置返回明确错误且不改变持久状态，对有效配置正常保存。

具体：
1. 租户提交仅含一个边界值的局部更新，或同时含两个边界值的完整更新。
2. 系统以提交值覆盖租户当前值后校验：`keywords_per_round_min` 不得大于 `keywords_per_round_max`。
3. 无效有效配置返回 HTTP 400 且 `error.code` 为 `INVALID_CONFIG`，持久化内容保持原样；合法局部或完整更新成功并可再次读取。

## 边界情况

- 仅更新最小值时，与现有最大值合并后倒置，必须拒绝且不产生部分写入。
- 仅更新最大值时，与现有最小值合并后倒置，必须拒绝且不产生部分写入。
- 最小值等于最大值属于合法配置。
- 同时更新两个值且顺序合法，或局部更新后有效配置合法，必须保留既有成功行为。

## 范围限定

**在范围内**：获客配置局部与完整更新的有效配置校验、HTTP 400/`INVALID_CONFIG` 错误行为、无效更新零持久化、合法更新回归验证。

**不在范围内**：修改共享 Red fixture；查看或复制 One-session 候选 worktree、patch、日志、PR 或反馈；盲评前合并；改动其他获客流程或配置字段。

## 假设

- [ASSUMPTION: `gp_anchor=line02/keyword_acquisition#step7` 即本次 Golden Path 锚点，未提供 Journey/Step UUID。]
- [ASSUMPTION: API 的既有成功响应与配置读取契约保持不变，本 Sprint 只新增无效有效配置的拒绝行为。]

## 预期受影响文件

- `apps/api/`：获客配置更新入口及其行为测试所在模块；具体文件由后续阶段依据仓库现有布局确认。
- `test-registry.yaml`：若新增 smoke test，登记其 Golden Path 覆盖关系。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 冻结 Red 基线 SHA `0dc4e3c07ff19a0ac95440723986bf3cb78580b2`
- 可观测: 无效更新必须以 HTTP 400 和 `error.code=INVALID_CONFIG` 明确可观察，且持久状态不变

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；与本 Sprint 直接相关的全局铁律 -->
- [TDD顺序] 必须先提交并验证失败的 Red 测试，再提交实现使其转绿（来源: area）
- [真失败] 测试失败必须来自目标行为缺失，不得来自语法、环境或解释器未启动（来源: area）
- [零Mock验收] 验收必须覆盖真实 API 与真实持久化结果，不以 mock 替代目标行为（来源: area）
- [语义判定] 写库接口的成功与失败必须检查语义字段和持久化结果，不得只检查通用成功标记（来源: area）
- [冻结基线] 不修改共享 Red fixture，并从指定冻结 SHA 开始（来源: task payload）
- [候选隔离] 不读取或复制 One-session 候选产物，盲评前不得合并（来源: task payload）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 填入真实 curl + 数据库读取脚本。
# 期望验收点：先建立租户当前配置；分别提交会导致有效 min>max 的最小值局部更新、最大值局部更新，均观察 HTTP 400/INVALID_CONFIG 并确认数据库未变化；再提交合法局部更新、相等边界和合法完整更新，确认成功且读取值正确。
```

## journey_type: autonomous
## journey_type_reason: 本 Sprint 是 apps/api 的纯后端配置更新行为，无用户界面交互。
## target_environment: local_api
## target_environment_reason: payload 明确指定 local_api，由本地 API 与数据库完成端到端验证。
## journey_id: line02/keyword_acquisition
## step_id: step7
