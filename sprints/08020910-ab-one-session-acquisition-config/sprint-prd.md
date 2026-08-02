# Sprint PRD — Acquisition configuration 合并后边界校验

## OKR 对齐

- **对应 KR**：ZenithJoy 产品全线上线 — AI 双线创作 + 小程序 + 网站 + Dashboard 可交付
- **当前进度**：77%
- **本次推进预期**：修复 acquisition configuration partial PUT 的配置完整性回归，不扩展产品范围

## 背景

当前 acquisition configuration 的 partial PUT 可能只校验 patch 本身，未按 tenant 当前配置补全后校验有效配置，导致 `keywords_per_round_min` 与 `keywords_per_round_max` 的组合关系失效。任务仅修复这一已冻结行为。

## Golden Path（核心场景）

调用方对某一 tenant 提交 acquisition configuration 的 partial 或 complete PUT → 系统读取该 tenant 当前配置并与 patch 合并 → 系统校验 effective configuration → 合法配置持久化并保持既有成功行为，非法关键词边界返回明确错误且不改变已存配置。

具体：

1. 调用方以现有鉴权方式向指定 tenant 提交 acquisition configuration PUT。
2. 系统在接受 partial update 前读取该 tenant 当前 acquisition configuration，并以 patch 覆盖当前值形成 effective configuration。
3. 系统校验 effective `keywords_per_round_min <= keywords_per_round_max`。
4. 若 effective `keywords_per_round_min > keywords_per_round_max`，响应 HTTP 400，且 `error.code=INVALID_CONFIG`。
5. 非法 effective configuration 不得持久化；后续读取仍返回更新前配置。
6. 合法 partial update 与合法 complete update 继续成功并持久化。

## 边界情况

- patch 只包含 `keywords_per_round_min`，与当前 `keywords_per_round_max` 合并后非法。
- patch 只包含 `keywords_per_round_max`，与当前 `keywords_per_round_min` 合并后非法。
- patch 同时包含上下界且组合非法。
- patch 同时包含上下界且组合合法。
- patch 不包含任一关键词边界时，既有合法配置与其他字段更新行为保持不变。
- tenant 数据必须严格隔离，校验与持久化均只作用于请求 tenant。

## 范围限定

**在范围内**：acquisition configuration PUT 的 effective configuration 合并校验、HTTP 400 `INVALID_CONFIG` 错误、非法更新不持久化、合法 partial/complete update 回归。

**不在范围内**：新增配置字段、改变认证授权、改变响应结构的其他字段、迁移历史非法数据、修改共享 Red fixture、访问或比较任何 Kernel candidate 资产。

## 假设

- [ASSUMPTION: 当前配置存在且可由现有 tenant-scoped 读取路径取得；不存在配置时沿用现有默认/初始化语义，本 sprint 不改变。]
- [ASSUMPTION: 合法 update 的既有成功状态码与响应结构保持原样。]

## 预期受影响文件

- 现有 acquisition configuration PUT 处理与配置持久化模块：在既有模块内修复，不新增平行实现。
- 共享回归测试所在测试文件：测试已在 commit `0dc4e3c07ff19a0ac95440723986bf3cb78580b2` 提供，禁止修改、删除、跳过或弱化。
- 本 sprint 的 smoke/E2E 验收脚本与 CI 基线登记：按仓库现有约定落地。

## NFR 约束

<!-- task/ability decisions 未提供专属 NFR；PrepPRD 未冻结性能数值。 -->
- 安全：沿用现有鉴权与 tenant scope，不新增无鉴权入口。
- 数据完整性：非法 effective configuration 在任何错误路径均不得持久化。
- 兼容性：合法 partial 与 complete update 必须继续工作。
- 可观测性：使用既有错误响应约定，不记录 secrets、PII 或完整客户配置。
- 性能/超时：N/A（本任务不新增外部调用或性能合同）。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- task step 与 journey_feature invariant 为空；以下为本任务直接适用的 area/system invariant，按 id 去重。 -->
- [单会话串行] 同一 slot 同时只推进本任务；阶段严格串行（来源: area）
- [禁止环境硬编码] 环境假设值不得写死，必须使用现有配置或请求上下文推导（来源: area）
- [真环境验证] 依赖真实 API/持久化接缝的断言必须在目标环境验证，未真验不得判 done（来源: area）
- [多租户测试] 测试默认覆盖至少两个 tenant 并断言互不串读串写（来源: area）
- [凭据安全] secrets 不得硬编码、进入 git 或日志（来源: area）
- [日志脱敏] 客户隐私、PII 与完整配置内容不得明文进入日志（来源: area）
- [端点鉴权] API 端点必须保留既有 auth；无鉴权端点不得交付（来源: area）
- [租户隔离] 配置读取与写入必须 scope 到当前 tenant，跨 tenant 数据不得混读混写（来源: area）
- [语义成功] 写入接口成功必须依据真实语义结果，不能仅凭表面成功字段（来源: area）
- [合同测试四列] Test Contract 表使用固定四列，testFile 路径用反引号包裹（来源: area）
- [Red 精确提交] Red commit 只包含共享测试的既有变更，不混入生产或 Harness 文件（来源: area）
- [禁止 Generator 合并] Generator 只推送分支并报告，merge 权保留给 Controller；本实验最终停在人工盲评门（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史；task payload 未提供 journey_id）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 目标环境补为可执行验收脚本。
# 期望验收点：复跑共享 Red 观察旧代码 actual 200 / expected 400；实现后同一测试转绿；
# 再验证非法更新未持久化、合法 partial/complete update 继续工作、不同 tenant 互不影响。
```

## journey_type: autonomous
## journey_type_reason: 任务是纯 API 配置校验与持久化行为修复，不涉及用户界面或远端 agent 协议。
## target_environment: local_api
## target_environment_reason: task payload 已冻结为 local_api，应在当前 worktree 的本地 API/测试环境验收。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
