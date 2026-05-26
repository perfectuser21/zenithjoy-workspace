# Sprint PRD — ZenithJoy 运营中枢：Session 全平台健康管理（Tab 1）

## OKR 对齐

- **对应 KR**：运营自动化 — Session 自主续期与多平台监控
- **当前进度**：抖音单平台 thin（PR #453 已完成：check-health.js + sync 脚本 + Bark 告警）
- **本次推进预期**：9 大平台全覆盖，运营员无需人工介入保持多账号矩阵持续在线

## 背景

PR #453 已建立抖音单平台 session 管理基础（check-health.js 仅 DOUYIN_COOKIES、sync-from-xian-rog.sh 仅同步抖音、Bark 单渠道告警）。当前 7 个平台完全空白，无维稳机制，无飞书告警，运营员只能盯 Bark 手动处理掉线。本 sprint 扩展到 9 大平台全覆盖并加入自动化维稳和 Operator 面板。

## Golden Path（核心场景）

运营员打开 `/operator` 页面，一眼看到 9 平台 × 4 账号（MAIN + SUB_1/2/3）= 36 个 session + 3 个 API key 的状态矩阵，所有账号绿灯在线。

具体步骤：

1. **健康检查触发**：每天 4 次（00/06/12/18 时）CI job 运行 check-health.js，对 9 大平台各账号发起 HTTP 登录验证
2. **告警双推**：任一 session 过期或 HTTP 检查失败 → Bark 推送手机 + 飞书机器人 webhook 同步推送告警消息（https://open.feishu.cn/open-apis/bot/v2/hook/5bde68e0-9879-4a45-88ed-461a88229136）
3. **自动同步**：xian-pc Windows 计划任务每 2 小时从 `C:\Users\asus\.zenithjoy-agent\sessions\` 读取各平台 session，通过 SSH + gh CLI 推送到 GitHub Secrets（36 个 Secret：DOUYIN_MAIN / DOUYIN_SUB_1 / DOUYIN_SUB_2 / DOUYIN_SUB_3，其余 8 平台同规范）
4. **维稳心跳**：Agent 对视频号（SHIPINHAO）等高挥发平台每 45 分钟执行一次 CDP 模拟活动保持在线；其他 8 平台每 4 小时一次；检测到掉线后自动触发重新同步流程
5. **Operator 面板查看**：is_operator 用户（xuxiao21xx@icloud.com）访问 `/operator` 路由，看到状态灯（🟢在线 / 🔴离线 / ⚫未配置）、上次同步时间、一键手动触发同步按钮
6. **CI 拉取**：GitHub Actions windows-latest runner 跑 E2E 时直接从 Secrets 读取各平台 cookies，无需人工扫码

## Response Schema

N/A — 本 sprint 无新增 HTTP API endpoint。Dashboard 状态数据来源于健康检查脚本输出；内部数据流由 Proposer 设计。

## 边界情况

- 某平台 Secret 未配置 → Dashboard 显示⚫"未配置"，不计入异常告警
- 飞书 webhook 请求超时 → 不影响 Bark 告警，记录失败日志继续运行
- xian-pc 计划任务触发时 SSH 不通 → 保留上次 Secret 值，Bark 推送"同步失败"告警
- API key（飞书/Notion/企微）检查失败 → 仅告警，不触发 session 重新同步
- 小号（SUB_1/2/3）Secret 不存在 → 跳过检查，不报错（optional 模式）

## 范围限定

**在范围内**：
- 9 大平台 session 健康检查扩展：快手/小红书/视频号/头条/微博/知乎/公众号（抖音已有）
- 3 个 API key 健康检查：飞书 / Notion / 企微
- 飞书机器人 webhook 双推告警（与 Bark 并行）
- 36 个 GitHub Secrets 命名规范迁移（DOUYIN_MAIN/SUB_1/2/3 → 9 平台同规范）
- Windows 计划任务 XML 配置文件（xian-pc，每 2 小时自动触发）
- Agent 维稳心跳任务配置（视频号 45min / 其他 8 平台 4hr）
- 掉线后自动触发重新同步
- `/operator` 路由及 Session Health Dashboard（Tab 1，仅 is_operator 可见）

**不在范围内**：
- B站（架构预留，本次不接）
- 客户管理 Tab 2
- Session 自动刷新或自动扫码登录（只通知，不自动登录）
- 非 ZenithJoy 平台账号

## 假设

- [ASSUMPTION: 各平台 session 文件路径规范为 `C:\Users\asus\.zenithjoy-agent\sessions\{platform}\default.json`（MAIN）和 `{platform}\burner\*.json`（SUB），与抖音现有路径一致]
- [ASSUMPTION: xian-pc 上已有 SSH、gh CLI，GITHUB_CLASSIC_TOKEN 存于 1Password CS Vault，可写 repo Secrets]
- [ASSUMPTION: 飞书 webhook URL 和 Bark URL 通过 GitHub Secret 注入（不硬编码），Secret 名 FEISHU_BOT_WEBHOOK / BARK_URL]
- [ASSUMPTION: is_operator 权限判断基于 Dashboard 现有 user.email 字段比对 xuxiao21xx@icloud.com]
- [ASSUMPTION: xian-pc 可直接通过 SSH 别名连通，与 xian-rog 同配置]

## 预期受影响文件

- `scripts/sessions/check-health.js` — 扩展 PLATFORMS 数组（+8 平台 +3 API key +飞书告警发送）
- `scripts/sessions/sync-from-xian-rog.sh` — 扩展 sync_one 调用（36 个 Secrets，支持 MAIN/SUB_1/2/3 矩阵）
- `scripts/sessions/windows-task-scheduler.xml` — 新建 Windows 计划任务配置文件（xian-pc 导入）
- `apps/dashboard/src/pages/OperatorPage.tsx` — 新建 /operator 页面（Session Health Dashboard Tab 1）
- `apps/dashboard/src/config/navigation.config.ts` — 注册 /operator 路由（is_operator 权限守卫）
- `.github/workflows/session-health-check.yml` — 更新 Secrets 引用（36 个 + FEISHU_BOT_WEBHOOK）
- `.github/workflows/scripts/smoke/session-health-smoke.sh` — E2E smoke 脚本（验收健康检查输出格式）

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/ 新增 /operator 路由和 UI 页面（Tab 1 Session Health Dashboard）
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy 产品（非 Cecelia），E2E 走 GitHub Actions windows-latest runner，无需本机 Playwright
