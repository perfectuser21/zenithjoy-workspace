# Sprint PRD — acquisition 配置合并校验恢复

## OKR 对齐

- **对应 KR**：ZenithJoy 产品全线上线 — AI双线创作 + 小程序 + 网站 + Dashboard 可交付
- **当前进度**：77%
- **本次推进预期**：保持 77%，消除关键词采集配置更新的数据完整性回归

## 背景

租户对 acquisition 配置做部分更新时，必须以补丁与该租户当前配置合并后的有效配置为校验对象，避免保存 `keywords_per_round_min` 大于 `keywords_per_round_max` 的组合。本次仅恢复该校验行为，并遵守盲测 A/B 边界。

## Golden Path（核心场景）

调用方从提交租户 acquisition 配置更新 → 系统合并补丁与该租户当前配置并校验 `keywords_per_round_min`、`keywords_per_round_max` → 获得明确响应且只在有效时持久化。

具体：
1. 调用方提交只含最小值、只含最大值或同时包含两者的 acquisition 配置更新。
2. 系统以租户当前配置补齐缺失字段；若有效配置中 `keywords_per_round_min > keywords_per_round_max`，返回 HTTP 400，且 `error.code` 为 `INVALID_CONFIG`。
3. 无效更新不产生任何持久化变化；有效的部分更新与完整更新继续成功并可读取到新值。

## 边界情况

- 补丁自身看似有效，但与当前配置合并后上下界倒置时仍须拒绝。
- 最小值等于最大值属于有效配置。
- 拒绝响应后，租户原配置完整保持不变。
- 其他租户的配置不参与合并，也不被读取或写入。

## 范围限定

**在范围内**：合并后 acquisition 关键词每轮上下界校验、HTTP 400/`INVALID_CONFIG` 错误合同、无效更新零持久化、有效部分及完整更新回归验证、先红后绿测试。

**不在范围内**：共享 Red fixture 变更；One-session 候选 worktree、patch、日志、PR 或反馈的检查与复制；盲测裁决前合并；其他 acquisition 参数或 UI 行为变更。

## 假设

- [ASSUMPTION: `line02/keyword_acquisition#step7` 是本次 PrepPRD 的 Golden Path 锚点。]
- [ASSUMPTION: 现有更新入口、鉴权与成功响应格式保持不变；本次只新增合并后上下界无效时的既定错误行为。]

## 预期受影响文件

- `apps/api/`: acquisition 租户配置更新行为所在后端模块；具体文件由 proposer 在仓库既有布局中定位。
- `apps/api/` 对应测试：先证明合并后的无效部分更新会被错误接受，再覆盖拒绝、零持久化与有效更新回归。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 冻结 Red SHA `0dc4e3c07ff19a0ac95440723986bf3cb78580b2`
- 可观测: 无效有效配置返回 HTTP 400 与稳定的 `error.code=INVALID_CONFIG`；不得记录或暴露租户敏感配置

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；以下为与本 scope 直接相关的 area 铁律 -->
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户；跨租户数据绝不混读/混写（来源: area）
- [测试多租户] 单元/E2E 测试默认种至少 2 个租户并断言互不串（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII 与配置敏感内容不得明文进日志（来源: area）
- [真环境验证] 依赖真实调用方的接缝断言必须在目标环境验证过才算 done（来源: area）
- [环境假设] 环境假设值不得写死，必须从环境推导或校准（来源: area）
- [单写手] 一个任务内部同一时刻只有一个实现者写代码（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 填入真实脚本。
# 期望验收点：在隔离租户数据上提交导致合并后 min>max 的部分更新，断言 HTTP 400、INVALID_CONFIG 且持久层前后不变；再提交有效部分/完整更新并断言成功持久化，另一租户始终不变。
```

## journey_type: autonomous
## journey_type_reason: 本次是纯后端租户 acquisition 配置更新校验，无用户界面步骤。
## target_environment: local_api
## target_environment_reason: payload 显式指定 local_api，由本地 API 与隔离测试数据库完成验收。
## journey_id: none
## step_id: line02/keyword_acquisition#step7
