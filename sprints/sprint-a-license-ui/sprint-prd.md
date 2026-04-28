# Sprint PRD — ZenithJoy v1.2 Sprint A · 客户中台 License 状态页 + Logo 升级

## OKR 对齐

- **对应 KR**：KR — ZenithJoy 产品全线上线（AI 双线创作 + 小程序 + 网站 + Dashboard 可交付，77%）
- **当前进度**：v1.2 Day 1-2（License 系统核心）已合并至 main（PR #226）
- **本次推进预期**：把 License 系统从"后端可用"推进到"客户在 Dashboard 自助可见 + 系统托盘真品牌化"，预计 OKR 推进 +3%

## 背景

v1.2 Day 1-2 已建立 zenithjoy.licenses + license_machines 表与后端 admin 端点（PR #226），客户登录后却仍看不到自己的 License 状态，且 Windows Agent 系统托盘显示的是占位图标而非真 ZenithJoy logo。本 Sprint A 是 v1.2 商业化闭环的"客户感知"层 — 让客户飞书登录后能看到 License 信息、查看自己已激活的机器列表、并且在客户端体验中看到正式品牌。

## 目标

客户飞书登录中台后，访问 `/license` 看到自己的 License 状态卡片（套餐 / 配额 / 已用机器数 / 到期日 / 已激活 Agent 列表），同时 Admin 用户可在 `/admin/license` 自助生成、列出与吊销 License；Windows Agent 系统托盘和 Dashboard 顶部展示真 ZenithJoy logo。

## User Stories

- **US-001**（P0）：作为已购买 License 的飞书登录客户，我希望访问 `/license` 看到自己的套餐、配额、已用机器数、到期日和激活机器列表，以便了解自己的服务状态并申请续费。
- **US-002**（P0）：作为 super-admin 用户，我希望在 `/admin/license` 后台页面生成、查看、吊销 License，以便完成客户开通与终止流程。
- **US-003**（P1）：作为 Windows 客户端用户，我希望任务栏托盘显示真 ZenithJoy logo（不是默认占位图标），以便在多任务窗口中识别 Agent。
- **US-004**（P1）：作为 Dashboard 访客，我希望页面顶部展示真 ZenithJoy logo，以便强化品牌一致性。
- **US-005**（P0，反向场景）：作为飞书登录但无 License 的访客，我希望 `/license` 显示明确的"暂无 License"状态与申请入口，而不是空白或报错。

## 验收场景（Given-When-Then）

**场景 1**（US-001）：
- Given 客户 A 已通过飞书登录，且其 customer_id 已绑定一条 active 的 License（matrix 套餐，3 台配额，已激活 1 台）
- When 客户 A 访问 `/license`
- Then 页面显示 tier="matrix"、max_machines=3、used=1、expires_at 日期、status="active"、机器列表 1 行（hostname + 上次心跳时间）

**场景 2**（US-002）：
- Given super-admin 已飞书登录
- When 在 `/admin/license` 提交 tier=basic、customer_email=test@example.com、duration_days=30 的创建请求
- Then 列表新增一条 License，license_key 不为空且唯一，状态 active

**场景 3**（US-002 吊销）：
- Given super-admin 已登录且至少存在一条 active License
- When 点击该 License 的"吊销"按钮并确认
- Then 该 License status 变为 revoked，列表刷新显示新状态

**场景 4**（US-003）：
- Given Windows Agent 已部署
- When 用户启动 Agent
- Then 系统托盘图标是 ZenithJoy 品牌图（非 Electron 默认占位）

**场景 5**（US-005）：
- Given 飞书已登录但 customer_id 未绑定任何 License
- When 访问 `/license`
- Then 页面显示"暂无 License"提示与"申请微信"按钮（不返回 404、不抛错误）

## 功能需求

- **FR-001**：后端新增 `GET /admin/license/me`（用户态鉴权），返回当前飞书登录用户的 License + 机器列表，无 License 返回 `{ license: null, machines: [] }`。
- **FR-002**：后端 `/admin/license`（POST/GET-list/DELETE）需识别 super-admin 身份；非 super-admin 返回 403。
- **FR-003**：Dashboard 新增受保护路由 `/license`，飞书未登录跳转登录页，登录后展示 License 卡片 + 机器列表 + 续费弹窗。
- **FR-004**：Dashboard 新增受保护路由 `/admin/license`，仅 super-admin 可见；包含创建表单、列表、吊销按钮。
- **FR-005**：navigation.config.ts 加入 `/license`（所有登录用户）与 `/admin/license`（super-admin only）入口。
- **FR-006**：services/agent/build/icon.png 与 tray-icon.png 替换为 ZenithJoy 品牌资源（若资源缺失则用 ImageMagick 生成"ZenithJoy"文字 PNG 占位）。
- **FR-007**：Dashboard 顶部 logo 引用 apps/dashboard/public/logo-color.png（已存在），新增 navbar logo 显示组件（如未引用则补上）。
- **FR-008**：所有 License 数据请求必须经过飞书登录态鉴权，无登录态返回 401。

## 成功标准

- **SC-001**：Playwright `apps/dashboard/e2e/license.spec.ts` 测试 5 个场景（US-001/002/003 吊销/005）全 PASS。
- **SC-002**：`.github/workflows/scripts/smoke/dashboard-license-smoke.sh` 含 ≥5 行实质 curl 调用，覆盖 `/admin/license/me`（200）、`/admin/license` POST（200）、`/admin/license` GET（200）、`/admin/license/:id` DELETE（200），CI 中 PASS。
- **SC-003**：CI lint-feature-has-smoke、lint-tdd-commit-order、lint-test-pairing、lint-test-quality、lint-no-fake-test 五道门禁全 PASS。
- **SC-004**：合并后 `services/agent/build/icon.png` 与 `tray-icon.png` 文件大小 > 0、可被 Electron-builder 打包识别（不是 0 字节占位）。
- **SC-005**：实测：admin 用户登录可以创建 License；非 admin 用户访问 `/admin/license` 返回 403/重定向。

## 假设

- `[ASSUMPTION]` super-admin 身份通过环境变量 `ADMIN_FEISHU_OPENIDS`（逗号分隔）或现有 user.role 字段识别；本 Sprint 选其一稳妥实现并写在 contract 里。
- `[ASSUMPTION]` 飞书登录后端会在 cookie/session 中暴露 user.feishu_openid，可作为查询 `licenses.customer_id` 的键。
- `[ASSUMPTION]` license_machines.last_seen 字段实时反映心跳；前端展示时格式化为相对时间（"3 分钟前"）。
- `[ASSUMPTION]` 现有 admin-license.ts 的 internalAuth 用于服务间调用；本次会改造为同时支持"用户态鉴权 + super-admin 校验"两种入口，或拆分路由。
- `[ASSUMPTION]` 真 ZenithJoy logo 资源若主理人未提供，用 ImageMagick `convert` 生成 256×256 ICO + PNG 文字 logo（白色背景 + ZenithJoy 文字）作为 v1 占位。

## 边界情况

- **无 License**：`/license` 页面不报错，显示"暂无 License" + 微信申请入口
- **License expired**：状态显示 expired，机器列表保留但标记 stale
- **License revoked**：状态显示 revoked，禁用续费按钮
- **超配额**：machines 数等于 max_machines 时高亮提示"已满"
- **非 super-admin 访问 /admin/license**：返回 403 或重定向回 `/license`
- **未登录访问 /license**：重定向至飞书登录
- **license_machines.last_seen 超过 30 天**：标记为 inactive 但仍计入 used 数

## 范围限定

**在范围内**：
- `/license` 客户面板与无 License 状态
- `/admin/license` super-admin 后台（创建 / 列表 / 吊销）
- `GET /admin/license/me` 后端端点
- super-admin 鉴权保护
- 系统托盘 logo + Dashboard 顶部 logo 替换
- E2E smoke + Playwright 测试
- navigation.config 路由集成

**不在范围内**：
- 真支付集成（v2.0 接微信支付）
- License 自动续费 / 提醒邮件
- 多套品牌 logo 设计（只换 1 套 PNG/ICO 占位即可）
- 客户自助升级套餐（v2.0）
- License Token 二次校验或防破解机制
- license_machines RLS 行级安全

## 预期受影响文件

- `apps/api/src/routes/admin-license.ts`：新增 `GET /me` 端点，加 super-admin 守卫
- `apps/api/src/services/license.service.ts`：新增按 customer_id 查询用户 License 的服务函数
- `apps/api/src/middleware/super-admin.ts`：新增 super-admin 中间件（识别 ADMIN_FEISHU_OPENIDS）
- `apps/api/tests/admin-license.test.ts`：扩展或新建测试，覆盖 `/me` 和 super-admin 守卫
- `apps/dashboard/src/api/license.api.ts`：新建 client（fetchMyLicense / listAllLicenses / createLicense / revokeLicense）
- `apps/dashboard/src/pages/LicensePage.tsx`：新建客户面板
- `apps/dashboard/src/pages/AdminLicensePage.tsx`：新建 super-admin 后台
- `apps/dashboard/src/config/navigation.config.ts`：新增两条路由入口
- `apps/dashboard/src/components/navbar/`（可能）：补 logo 显示
- `apps/dashboard/e2e/license.spec.ts`：新建 Playwright 端到端测试
- `.github/workflows/scripts/smoke/dashboard-license-smoke.sh`：新建 curl smoke
- `services/agent/build/icon.png`：替换为 ZenithJoy 占位
- `services/agent/build/tray-icon.png`：替换为 ZenithJoy 占位
- `services/agent/build/icon.ico`（可能）：Windows 打包需要 ICO，新增或替换
- `apps/dashboard/public/logo-color.png`：核对存在与正确引用（不一定改）
