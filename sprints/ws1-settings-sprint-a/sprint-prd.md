# Sprint PRD — WS1 统一设置入口 + 侧边栏分组重构

## OKR 对齐

- **对应 KR**：Path 1 客户首次成功（Step 2: 装客户端 + Agent 自动连中台）
- **当前进度**：进行中
- **本次推进预期**：侧边栏导航可读性提升，用户能快速找到设置入口

## 背景

当前侧边栏是一个扁平列表，约 20+ 条目无分组，运营功能、账号绑定、管理工具混排。
同时 `AdminSettingsPage.tsx`（链接 Claude Monitor / VPS 监控 / Claude Stats / Agent 调试）
已存在于 `/settings` 路由，但未挂入侧边栏导航，用户无法发现。

## Golden Path（核心场景）

用户从 [打开 Dashboard 侧边栏] → 经过 [看到分组标题 + 点击"系统设置"] → 到达 [/settings 页面展示所有设置卡片]

具体步骤：
1. 用户打开 `localhost:5174`，已登录状态下看到侧边栏
2. 侧边栏显示 3 个有标题的分组（而非扁平列表）
3. 用户找到"系统管理"分组，点击"系统设置"条目
4. 跳转到 `/settings`，页面展示 4 张设置卡片（Claude Monitor、VPS 监控、Claude Stats、Agent 调试）

## Response Schema

N/A — 任务无 HTTP 响应，纯前端导航重构

## 边界情况

- 非超级管理员用户：不显示"管理员专区"下的 License 管理和会员管理条目（现有 requireSuperAdmin 逻辑保持不变）
- 侧边栏折叠状态：分组分隔线可见，分组标题文字隐藏（现有折叠逻辑保持不变）
- 已有 `/settings/claude-monitor`、`/settings/vps-monitor`、`/settings/claude-stats` 子路由由 AdminSettingsPage 内部 Link 处理，本 sprint 不改动子页面

## 范围限定

**在范围内**：
- `navigation.config.ts` 中 `autopilotNavGroups` 从单组（空标题）拆分为 3 个有标题分组
- 将 `AdminSettingsPage` 加入 `pageComponents` 映射（key: `AdminSettingsPage`）
- 在导航配置中添加"系统设置" NavItem（path: `/settings`，icon: Settings，featureKey: `admin-settings`）
- `AdminSettingsPage` 对所有已登录用户可见（非仅超级管理员）

**不在范围内**：
- AdminSettingsPage 内部子页面（claude-monitor / vps-monitor / claude-stats）的 UI 改动
- 新增任何后端 API
- 用户个人设置页（账户信息 / 密码修改）
- 移动端适配

## 假设

- [ASSUMPTION: 分组方案为 3 组 — "运营核心"（工作台/新媒体/AI员工/作品管理/平台数据/内容工厂/智能对标）/ "账号与渠道"（下载Agent/抖音绑定/文件夹绑定/一键发布/绑飞书/绑抖音小号）/ "系统管理"（License/系统设置/AI视频，admin 条目 requireSuperAdmin)]
- [ASSUMPTION: `featureKey: 'admin-settings'` 默认在 instance config 中为 enabled]
- [ASSUMPTION: `/settings` 不需要 requireSuperAdmin，普通用户也可访问监控页面]

## 预期受影响文件

- `apps/dashboard/src/config/navigation.config.ts`: 重构 `autopilotNavGroups` 为 3 个分组，增加设置 NavItem
- `apps/dashboard/src/pages/AdminSettingsPage.tsx`: 无需修改（页面已存在）
- `apps/dashboard/src/components/DynamicSidebar.tsx`: 无需修改（分组渲染逻辑已支持 group.title）

## journey_type: user_facing
## journey_type_reason: 改动在 apps/dashboard/src/ 影响用户可见的侧边栏 UI
## target_environment: mac_web
## target_environment_reason: Dashboard 跑在 localhost:5174，E2E 用本机 Playwright 测侧边栏分组渲染和路由跳转
