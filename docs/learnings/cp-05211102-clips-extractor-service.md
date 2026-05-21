## ZenithJoy Content Clipper 移植（2026-05-21）

### 根本原因

将 Cecelia 已验证的 Content Clipper 功能移植到 ZenithJoy，核心挑战有两点：

1. **多 worktree 分支管理**：Task 4（clips.service.ts）被子 agent 意外在新 worktree/分支创建，需要手动 cherry-pick 文件回主 worktree 合并。
2. **Feature flag 是静态 hardcode**：ZenithJoy 的 `InstanceContext.tsx` 用 `autopilotConfig` 常量管理所有 feature flag，不是动态 API 拉取，需手动添加 `'content-clipper': true`。

### 下次预防

- [ ] 派 subagent 实现任务时，prompt 必须明确指定 worktree 绝对路径 + 分支名，防止 agent 自行创建新 worktree
- [ ] ZenithJoy 新功能上线前，先检查 `InstanceContext.tsx` 里的 `autopilotConfig.features`，确认目标 featureKey 已加入
- [ ] 多平台 URL 解析（Notion/飞书）逻辑已落在 `clip-output.service.ts`，后续若增加新平台（如语雀、Confluence）直接在该文件扩展 `parseOutputUrl()`
- [ ] DB migration 文件命名规范 `YYYYMMDD_HHMMSS_*.sql`，勿用其他格式（ZenithJoy migration runner 按文件名排序执行）
