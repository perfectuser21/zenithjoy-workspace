# Sprint Contract Draft — Staff Hub 员工中心第一刀

## 范围声明

- 独立新建 `apps/staff-hub`
- 从 `apps/dashboard` 迁出 Skill 验收
- 新增 Path1/2/4 健康分析
- 不碰 mmv 评测执行体

## [BEHAVIOR] 合同

### [BEHAVIOR] B-1 Skill 验收入口迁移

员工访问 Staff Hub 的 `/skill-eval` 页面，可看到平台选择、归属线选择、zip 上传、轮询状态和报告 iframe；`apps/dashboard` 不再暴露 `/staff/skill-eval` 页面入口。

### [BEHAVIOR] B-2 Skill 评测失败明确报错

当 `/api/staff/skill-eval/upload` 或 `/status/:jobId` 返回 504/5xx 时，Staff Hub 页面显示“评测服务暂不可用”或等价错误提示，不永久 loading。

### [BEHAVIOR] B-3 Path 健康真实聚合

请求 `/api/staff/path-health` 返回 3 个 Path 条目（Path1/2/4），每项含 `path_key`、`journey_id`、`journey_name`、`maturity`、`feature_counts`、`smoke`、`features`。

### [BEHAVIOR] B-4 数据不可达诚实降级

当 Brain 或 GitHub Actions 数据源不可达时，`/api/staff/path-health` 仍返回 200，但对应 Path 的 `availability` 标记为 `degraded`，并给出 `message` 说明；前端显示“数据暂不可达”。

### [BEHAVIOR] B-5 dashboard 摘旧入口

`apps/dashboard` 的导航配置、动态路由和 full-bleed 规则不再包含 `/staff/skill-eval`；原员工工具入口从 dashboard 中彻底摘除。

### [BEHAVIOR] B-6 Staff Hub 禁直连 LLM SDK

`apps/staff-hub` 源码不得 import `openai`、`anthropic`、`@anthropic-ai/sdk`；校验脚本命中即失败。

## 未覆盖真实链路清单

- Path 健康页当前读的是 Brain 公开 `journey_features`，不是私有 `journey_steps`。原因：截至 2026-07-21，Brain 主机无公开 `GET /api/brain/journey-steps` 端点。
- GitHub Actions 结果当前读公开仓库最近一次 smoke run 元数据，不下钻单个 job 的全部 artifact。

## E2E 验收

1. 员工飞书登录 Staff Hub 成功。
2. 上传真实 skill zip，能看到 Cecelia Brain 返回的报告。
3. Path 健康页能看到 Path1/2/4 最近 smoke 与节点状态。
4. dashboard 已无旧员工入口。

