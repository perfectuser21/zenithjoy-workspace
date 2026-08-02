# Sprint PRD — Acquisition 合并配置校验

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：以一次配置一致性缺陷修复提升 API 可靠性；Brain 未提供可量化增量

## 背景

租户提交 acquisition 配置的部分更新时，单独校验补丁会遗漏与当前配置合并后产生的上下界冲突。本 Sprint 从冻结 Red SHA `0dc4e3c07ff19a0ac95440723986bf3cb78580b2` 出发，用 TDD 固定合并后校验行为，并保持盲测 A/B 隔离。

## Golden Path（核心场景）

调用方从提交 acquisition 配置更新 → 系统以租户当前配置补全未提供字段并校验有效配置 → 得到明确响应且仅合法配置被持久化。

具体：
1. 调用方为当前租户提交部分或完整 acquisition 配置更新。
2. 系统将补丁与该租户当前配置合并；若有效配置中 `keywords_per_round_min > keywords_per_round_max`，返回 HTTP 400，且 `error.code` 为 `INVALID_CONFIG`。
3. 非法有效配置不产生任何持久化变更；合法的部分更新和完整更新继续成功并可被后续读取观察到。

## 边界情况

- 仅更新 `keywords_per_round_min` 后超过现有 `keywords_per_round_max`，必须拒绝且不写入。
- 仅更新 `keywords_per_round_max` 后低于现有 `keywords_per_round_min`，必须拒绝且不写入。
- 同时更新上下界且 `min <= max` 时保持成功；等值边界合法。
- 校验与写入均限定当前租户，不得读取或改写其他租户配置。

## 范围限定

**在范围内**：合并补丁与租户当前 acquisition 配置后的上下界校验；HTTP 400/`INVALID_CONFIG` 错误契约；非法更新零持久化；合法部分/完整更新回归；TDD 验证。

**不在范围内**：修改共享 Red fixture；读取或复制 One-session 候选 worktree、补丁、日志、PR 或反馈；新增配置字段；更改其他配置校验；盲测 A/B verdict 前合并。

## 假设

- [ASSUMPTION: `line02/keyword_acquisition#step7` 是本 Sprint 的 Golden Path 锚点，因 payload 未提供 Journey UUID，使用路径代码记录。]
- [ASSUMPTION: 现有更新 API 已能定位当前租户并支持合法的部分与完整更新，本 Sprint 只改变冲突有效配置的拒绝行为。]

## 预期受影响文件

- `line02/keyword_acquisition` 对应的 acquisition 配置更新 API：在更新请求的用户可观察行为中增加有效配置校验。
- 对应 API 测试文件：先新增合并后上下界冲突的 Red 用例，再保留合法部分/完整更新回归用例。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 从冻结 Red SHA `0dc4e3c07ff19a0ac95440723986bf3cb78580b2` 开始
- 可观测: 非法请求以 HTTP 400 和 `error.code=INVALID_CONFIG` 明确失败，且持久化状态可核验为未变化

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；以下为与本 Sprint 交付边界直接相关的 area 铁律 -->
- [TDD提交] Red commit 只精确加入测试路径，禁止把非测试文件混入（来源: area）
- [真实判定] 通知或写库接口的成功必须检查语义结果，不能只凭通用成功字段判定（来源: area）
- [真实执行] 合同批准前记录 manual oracle 的真实 exit code，并确认目标解释器启动（来源: area）
- [失败分支] 返回 null/false 表示失败的调用必须显式处理失败分支，不能只依赖异常捕获（来源: area）
- [单槽串行] 一个 slot 内任务串行；同一时刻只有一个代码实现者（来源: area）
- [环境假设] 环境假设值不得写死，必须从环境推导或真实校准（来源: area）
- [真实环境] 接缝断言必须在目标环境验证才可标记完成（来源: area）
- [多租户测试] 单元与 E2E 默认覆盖至少两个租户并断言互不串扰（来源: area）
- [凭据安全] secrets 不硬编码、不进入 git、不进入日志（来源: area）
- [日志脱敏] 客户隐私、PII 与聊天内容不得明文进入日志（来源: area）
- [端点鉴权] API 端点必须有鉴权，无鉴权端点不得交付（来源: area）
- [租户隔离] 查询与写入必须限定当前租户，跨租户数据不得混读或混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 填入真实脚本（API 请求 + 持久化状态核验）
# 期望验收点：冲突的部分更新返回 400/INVALID_CONFIG 且当前租户配置完全不变；合法部分和完整更新成功；第二租户不受影响。
```

## 可执行验收计划

1. 在冻结 Red 基线上新增测试：当前配置与仅更新 min 的补丁合并后 min>max，断言 HTTP 400、`INVALID_CONFIG`、写前写后状态相同。
2. 新增对称测试：仅更新 max 后与当前 min 冲突，断言同一拒绝与零持久化契约。
3. 保留并执行合法部分更新、合法完整更新和 min=max 边界用例，断言成功持久化。
4. 使用至少两个租户，断言目标租户的失败或成功均不改变另一租户。
5. 记录 Red 失败与修复后通过证据；不读取另一候选证据，不修改共享 Red fixture，不在盲测 verdict 前合并。

## journey_type: autonomous
## journey_type_reason: 任务是纯后端 acquisition 配置更新 API 的行为修复，无用户界面或远端代理协议。
## target_environment: local_api
## target_environment_reason: payload 明确指定 local_api，由本地 evaluator 对 API 与持久化状态执行验证。
## journey_id: line02/keyword_acquisition
## step_id: step7
