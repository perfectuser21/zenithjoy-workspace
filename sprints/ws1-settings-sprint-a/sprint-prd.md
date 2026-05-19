# Sprint PRD — WS1 统一设置入口 + 侧边栏分组重构

## OKR 对齐

- **对应 KR**：Path 1 客户首次成功（not_started）
- **本次推进预期**：清理导航噪音，提升核心路径可见性

## 背景

侧边栏所有项平铺无分组，License / 会员管理散落在主导航。本次把设置类入口收拢到 `/settings`，主导航按功能分组。

## Golden Path（核心场景）

用户从 [侧边栏] → 看到按功能分组的导航 → 点击"⚙ 设置"进入统一设置入口

具体：
1. 侧边栏显示 3 个分组：**核心功能** / **账号绑定** / **系统**
2. **核心功能**：工作台、新媒体运营、AI员工、作品管理、内容工厂、AI视频、智能对标
3. **账号绑定**：下载Agent、抖音绑定、文件夹绑定、一键发布
4. **系统**：`/settings` 统一设置入口（super admin 另见管理员入口）
5. 点击"设置" → `SettingsPage` 卡片页：License 卡片 + 管理员专区卡片（仅 super admin）
6. 点击卡片 → 跳转已有子页面（路由不变）

## Response Schema

N/A — 纯前端 UI 重构，无 HTTP 响应

## 边界情况

- 非 super admin：设置页不显示管理员卡片；侧边栏不显示 `/admin/*`
- 折叠侧边栏：分组标题隐藏，分组间显示分隔线
- feature flag 关闭项：沿用现有 `filterNavGroups` 过滤逻辑

## 范围限定

**在范围内**：`navigation.config.ts` 拆 3 组、新建 `SettingsPage.tsx`、将 `/license` `/admin/*` 移出主导航收进 `/settings`

**不在范围内**：子页面内部逻辑、API 改动、Path 2/3 功能

## 假设

- [ASSUMPTION: 飞书绑定/抖音小号绑定归入账号绑定组，由 feature flag 控制显示]
- [ASSUMPTION: SettingsPage 卡片风格同 AdminSettingsPage]

## 预期受影响文件

- `apps/dashboard/src/config/navigation.config.ts`：拆分 navGroups 为 3 组
- `apps/dashboard/src/pages/SettingsPage.tsx`：新建统一设置入口页

## E2E 验收

Playwright spec：`apps/dashboard/e2e/settings-sidebar.spec.ts`（mac_web 本地 localhost:5174）
验证点：侧边栏出现"核心功能"/"账号绑定"/"系统"分组标题；点击"设置"导航到 `/settings`；页面含 License 卡片；super admin 可见管理员专区卡片。

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/ 前端侧边栏与路由，用户直接可见
## target_environment: mac_web
## target_environment_reason: Dashboard 在 localhost:5174，Playwright 本机执行
