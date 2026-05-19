# Sprint PRD — WS1 统一设置入口 + 侧边栏分组重构

## OKR 对齐

- **对应 KR**：KR5（ZenithJoy OKR1）— Dashboard 可交付：3 大模块无阻断 bug，可完整演示 20 分钟
- **当前进度**：58%
- **本次推进预期**：~65%（设置模块从散乱 → 统一可演示）

## 背景

Journey 1（注册→登录→下载 Agent→完成基础配置→发布）的"基础配置"步骤目前体验破碎：下载 Agent、抖音绑定、文件夹绑定分散为 3 个独立侧边栏顶级入口，没有统一入口。文件夹配置仅支持手动输入路径，没有 GUI picker。侧边栏共 18 个平铺菜单项，用户无法判断优先级。

## Golden Path（核心场景）

用户登录 Dashboard → 侧边栏看到「设置」分组 → 点击进入 `/settings` → 看到三个配置区块（Agent 安装 / 平台绑定 / 本地路径）→ 选择本地文件夹（GUI picker，无需手动输入路径）→ 提交成功 → 配置完成可继续发布

具体：
1. 用户登录后，侧边栏呈现 5 组（核心 / 内容 / 数据 / 设置 / 系统）
2. 点击「设置」→ 路由到 `/settings`
3. `/settings` 页展示 3 个 Card：Agent 安装状态 + 下载入口 / 平台绑定（抖音 / 飞书）/ 本地配置（文件夹）
4. 本地配置 Card：点击「选择文件夹」→ 浏览器原生 `<input webkitdirectory>` 触发文件夹选择 → 路径自动填入 → 提交调用 `POST /api/agent/folder/bind`
5. 成功后 Card 显示已绑定路径

## Response Schema

N/A — 本 sprint 复用现有 API（`POST /api/agent/folder/bind`、`GET /api/agent/status`），无新 HTTP 端点

## 边界情况

- Agent 离线：文件夹提交按钮禁用，显示「Agent 未连接」（沿用现有逻辑）
- `webkitdirectory` 仅在 Chromium 系浏览器可用；其他浏览器降级为文本输入框

## 范围限定

**在范围内**：
- `navigation.config.ts` 侧边栏改为 5 个分组
- 新建 `SettingsPage.tsx`（路由 `/settings`），整合 AgentDownload / DouyinBind / FolderBind 三个入口
- `FolderBindPage` / 设置页内文件夹配置加 `<input webkitdirectory>` picker
- 从侧边栏移除「下载 Agent」「抖音绑定」「文件夹绑定」等顶级单独入口（功能收进 /settings）

**不在范围内**：
- Journey 1 → medium（抖音短帖 / 长文 / 视频三种内容类型打通）
- 飞书/抖音小号 Bind 页面 UI 改造（只是将入口收进 /settings，页面本身不动）
- Agent 模块化架构
- 新后端 API

## 假设

- [ASSUMPTION: `<input webkitdirectory>` 在客户主力机（xian-pc，Chrome）可用]
- [ASSUMPTION: 侧边栏分组标题用中文：「核心」「内容」「数据」「设置」「系统（超管）」]
- [ASSUMPTION: AdminSettingsPage.tsx 现有内容（Claude Monitor / VPS 监控）归入「系统」分组]

## 预期受影响文件

- `apps/dashboard/src/config/navigation.config.ts`：改分组结构
- `apps/dashboard/src/pages/SettingsPage.tsx`：新建统一设置页
- `apps/dashboard/src/pages/FolderBindPage.tsx`：加 webkitdirectory picker

## DoD（最多 8 条）

1. 侧边栏呈现 5 个分组标题，「设置」分组可见且可点击
2. 路由 `/settings` 可访问，页面包含 3 个功能 Card
3. Agent 状态 Card 显示在线/离线实时状态（10s 轮询）
4. 文件夹配置 Card 包含「选择文件夹」按钮，点击触发系统文件夹选择对话框
5. 选择目录后，路径自动填入，点击「保存」调用 `POST /api/agent/folder/bind` 成功
6. 原侧边栏顶级「下载 Agent」「抖音绑定」「文件夹绑定」三个独立入口从菜单移除
7. Smoke：`playwright` 可访问 `/settings`，page 含「选择文件夹」按钮

---

## journey_type: user_facing
## journey_type_reason: 本 sprint 全部变更在 apps/dashboard/（React 前端），直接影响客户操作路径
## target_environment: mac_web
## target_environment_reason: 本机 Playwright 验收（localhost:5213），无需 Windows 或 VPS
