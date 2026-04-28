# Sprint Contract Draft (Round 1) — Sprint A · License UI + Logo

> **测试位置说明**：本合同采用"测试直接落到 canonical 位置"路径（apps/api/tests/、apps/dashboard/src/pages/__tests__/），不使用 sprints/.../tests/ws{N}/ 中转目录。原因：避免双重路径维护、CI 路径直接生效。Generator 阶段 commit 1 落 Red 测试，commit 2 落实现。

---

## Feature 1: 用户态 License 自查端点 `GET /api/admin/license/me`

**行为描述**:
- 任意通过飞书登录的客户访问该端点应返回自己的 License 信息及已激活机器列表（通过 `X-Feishu-User-Id` 请求头识别身份）
- customer_id 与 X-Feishu-User-Id 匹配时返回完整对象；无匹配返回 license=null + machines=[]
- 缺失 X-Feishu-User-Id 头返回 401 未授权

**硬阈值**:
- 已绑定 license 的请求：`response.body.data.license.id` 不为 null；`response.body.data.machines` 是数组（可空）
- 无绑定请求：`response.body.data.license === null`；`response.body.data.machines.length === 0`
- 缺头部请求：HTTP status === 401，`response.body.error.code === 'UNAUTHORIZED'`

**BEHAVIOR 覆盖**（落在 `apps/api/tests/admin-license-me.test.ts`）:
- `it('GET /api/admin/license/me 缺 X-Feishu-User-Id 返回 401')`
- `it('GET /api/admin/license/me 已知 customer_id 返回 license 对象 + machines 数组')`
- `it('GET /api/admin/license/me 未绑定 customer_id 返回 license=null + machines=[]')`

**ARTIFACT 覆盖**（落在 `contract-dod-ws1.md`）:
- `apps/api/src/middleware/feishu-user.ts` 文件存在并 `export function feishuUser`
- `apps/api/src/services/license.service.ts` 内含 `export async function getLicenseByCustomerId`
- `apps/api/src/routes/admin-license.ts` 内出现字符串 `'/me'` 路由声明

---

## Feature 2: super-admin 鉴权保护 `POST/GET-list/DELETE /api/admin/license`

**行为描述**:
- 客户端必须携带 `X-Feishu-User-Id` 头，且其值必须包含在环境变量 `ADMIN_FEISHU_OPENIDS`（逗号分隔）才能调用 admin 操作
- 非 super-admin 调用返回 403；super-admin 调用通过

**硬阈值**:
- 非 admin 用户 POST 请求：HTTP 403，`response.body.error.code === 'FORBIDDEN'`
- admin 用户 POST 请求：HTTP 200，`response.body.data.license_key` 不为空字符串
- admin 用户 GET：HTTP 200，`response.body.data.licenses` 是数组
- admin 用户 DELETE 已存在 license：HTTP 200，`response.body.data.status === 'revoked'`

**BEHAVIOR 覆盖**（落在 `apps/api/tests/admin-license-me.test.ts`）:
- `it('POST /api/admin/license 非 admin 返回 403')`
- `it('POST /api/admin/license admin 创建 license 返回 200 + license_key')`
- `it('GET /api/admin/license admin 返回 license 列表')`
- `it('DELETE /api/admin/license/:id admin 吊销 license 返回 status=revoked')`

**ARTIFACT 覆盖**（`contract-dod-ws1.md`）:
- `apps/api/src/middleware/super-admin.ts` 文件存在并 `export function superAdminGuard`
- `apps/api/src/routes/admin-license.ts` 引用 `superAdminGuard`（不再独占 internalAuth 在 admin 操作上）

---

## Feature 3: Dashboard 客户面板 `/license`

**行为描述**:
- 飞书登录的用户访问 `/license` 看到自己的 license 状态卡片（套餐 / 配额 / 已用机器 / 到期日 / 状态）和已激活机器列表
- 无 license 时显示"暂无 License"占位文案 + "申请微信"按钮
- 点击"申请续费"按钮弹出包含微信号的对话框

**硬阈值**:
- 接收 license=null 的 mock fetch 后，DOM 中包含文案 `暂无 License`
- 接收 license={tier:'matrix',...} 的 mock fetch 后，DOM 中包含 `matrix`
- 点击 button "申请续费" 后，DOM 中出现 `role=dialog` 元素或包含"微信"二字的浮层

**BEHAVIOR 覆盖**（落在 `apps/dashboard/src/pages/__tests__/LicensePage.test.tsx`）:
- `it('LicensePage 在 license=null 时渲染 "暂无 License" 文案')`
- `it('LicensePage 在 license 存在时渲染 tier 文案')`
- `it('LicensePage 在 license 存在时渲染机器列表行（hostname）')`
- `it('LicensePage 点击 "申请续费" 按钮打开包含微信号的对话框')`

**ARTIFACT 覆盖**（`contract-dod-ws2.md`）:
- `apps/dashboard/src/pages/LicensePage.tsx` 存在
- `apps/dashboard/src/api/license.api.ts` 存在并 export `fetchMyLicense`
- `apps/dashboard/src/config/navigation.config.ts` 含字面量 `/license`

---

## Feature 4: Dashboard super-admin 后台 `/admin/license`

**行为描述**:
- super-admin 访问 `/admin/license` 看到 license 列表 + 创建表单
- 提交创建表单调用 createLicense API，列表刷新
- 点击吊销按钮 + 确认调用 revokeLicense API，列表中该行 status 变 revoked
- 非 super-admin 访问该页面被重定向（或显示 403 提示）

**硬阈值**:
- 模拟 `isSuperAdmin: true`：DOM 包含 `<form>` 含 tier select 和 customer_email input
- 模拟 `isSuperAdmin: false`：DOM 包含文案 `403` 或导航跳转触发
- 提交合法表单后：fetch mock 收到匹配的 POST 请求 1 次
- 点击吊销 + confirm 后：fetch mock 收到匹配的 DELETE 请求 1 次

**BEHAVIOR 覆盖**（落在 `apps/dashboard/src/pages/__tests__/AdminLicensePage.test.tsx`）:
- `it('AdminLicensePage super-admin 渲染创建表单 + 列表')`
- `it('AdminLicensePage 非 super-admin 不渲染表单（显示 403 或重定向标识）')`
- `it('AdminLicensePage 提交创建表单调用 createLicense API 一次')`
- `it('AdminLicensePage 点击吊销按钮 + 确认调用 revokeLicense API 一次')`

**ARTIFACT 覆盖**（`contract-dod-ws3.md`）:
- `apps/dashboard/src/pages/AdminLicensePage.tsx` 存在
- `apps/dashboard/src/api/license.api.ts` export `listAllLicenses`、`createLicense`、`revokeLicense`
- `apps/dashboard/src/config/navigation.config.ts` 含字面量 `/admin/license`

---

## Feature 5: Logo 替换 + smoke 脚本 + Dashboard logo 引用

**行为描述**:
- Windows Agent 系统托盘启动时读取 `services/agent/build/tray-icon.png`，文件必须存在且非空
- Electron-builder 打包时读取 `services/agent/build/icon.png`，文件必须存在且非空
- Dashboard 顶部 sidebar 引用 `/logo-white.png` 或 `/logo-color.png`（文件已存在）
- `.github/workflows/scripts/smoke/dashboard-license-smoke.sh` 在 API 已起的环境下能执行多步 curl 链路

**硬阈值**:
- `services/agent/build/icon.png` 文件大小 ≥ 1000 字节
- `services/agent/build/tray-icon.png` 文件大小 ≥ 1000 字节
- `dashboard-license-smoke.sh` 内 `curl` 命令出现次数 ≥ 5
- `dashboard-license-smoke.sh` 在含 `set -e` 与 shebang `#!/usr/bin/env bash`

**BEHAVIOR 覆盖**（落在 `.github/workflows/scripts/smoke/dashboard-license-smoke.sh` 自身的执行行为，由 lint-feature-has-smoke 在 CI 抓取）:
- 脚本含至少 5 次 curl 调用（GET /me / POST / GET list / DELETE / 401 缺头部）
- 脚本退出码 0 在合规环境（API 已起 + ADMIN_FEISHU_OPENIDS 设置）

**ARTIFACT 覆盖**（`contract-dod-ws4.md`）:
- `services/agent/build/icon.png` 存在 size > 1000
- `services/agent/build/tray-icon.png` 存在 size > 1000
- `.github/workflows/scripts/smoke/dashboard-license-smoke.sh` 存在 + 内容含 5 个 curl + shebang + set -e
- `apps/dashboard/src/components/DynamicSidebar.tsx` 已引用 `logo-white.png` 或 `logo-color.png`（已存在，验证不退化）

---

## Workstreams

workstream_count: 4

### Workstream 1: License 后端鉴权 + /me 端点

**范围**: apps/api 后端 — 新增 feishu-user 中间件、super-admin 中间件、admin-license.ts 加 /me 路由 + 替换 internalAuth 为 superAdminGuard、license.service.ts 增加 getLicenseByCustomerId 函数。
**大小**: M（约 250 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `apps/api/tests/admin-license-me.test.ts`
**ARTIFACT 文件**: `sprints/sprint-a-license-ui/contract-dod-ws1.md`

### Workstream 2: Dashboard /license 客户面板

**范围**: apps/dashboard — 新建 LicensePage、license.api.ts client、navigation.config 注册路由。
**大小**: M（约 200 行）
**依赖**: Workstream 1（API 端点 + admin/license/me 才能调通）

**BEHAVIOR 覆盖测试文件**: `apps/dashboard/src/pages/__tests__/LicensePage.test.tsx`
**ARTIFACT 文件**: `sprints/sprint-a-license-ui/contract-dod-ws2.md`

### Workstream 3: Dashboard /admin/license super-admin 后台

**范围**: apps/dashboard — 新建 AdminLicensePage（含创建表单 / 列表 / 吊销）、扩展 license.api.ts、navigation.config 加 super-admin only 入口。
**大小**: M（约 250 行）
**依赖**: Workstream 1（API 端点）

**BEHAVIOR 覆盖测试文件**: `apps/dashboard/src/pages/__tests__/AdminLicensePage.test.tsx`
**ARTIFACT 文件**: `sprints/sprint-a-license-ui/contract-dod-ws3.md`

### Workstream 4: Logo 替换 + smoke 脚本

**范围**: services/agent/build/ 新增 logo PNG 文件、`.github/workflows/scripts/smoke/dashboard-license-smoke.sh` 新建。
**大小**: S（< 100 行；不含二进制文件）
**依赖**: 无（与其他 workstream 并行）

**BEHAVIOR 覆盖测试文件**: smoke 脚本本身（CI 中执行）
**ARTIFACT 文件**: `sprints/sprint-a-license-ui/contract-dod-ws4.md`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `apps/api/tests/admin-license-me.test.ts` | /me 401 / /me 已知 customer / /me 未绑定 / POST 非 admin 403 / POST admin 创建 / GET admin 列表 / DELETE admin 吊销 | `npx vitest run apps/api/tests/admin-license-me.test.ts` → 7 failures（import 失败或断言失败） |
| WS2 | `apps/dashboard/src/pages/__tests__/LicensePage.test.tsx` | 无 license 暂无 / 有 license tier / 机器列表 / 续费弹窗 | `npx vitest run apps/dashboard/src/pages/__tests__/LicensePage.test.tsx` → 4 failures |
| WS3 | `apps/dashboard/src/pages/__tests__/AdminLicensePage.test.tsx` | super-admin 表单+列表 / 非 admin 403 / 创建调用 / 吊销调用 | `npx vitest run apps/dashboard/src/pages/__tests__/AdminLicensePage.test.tsx` → 4 failures |
| WS4 | `.github/workflows/scripts/smoke/dashboard-license-smoke.sh`（CI 内执行） | 5 个 curl 真实链路 + 退出码 0 | bash dashboard-license-smoke.sh → 退出码非 0（API 端点未实现） |

---

## 注意事项 — 偏离 skill 模板部分

1. 测试文件直接放 canonical 位置（apps/api/tests/、apps/dashboard/src/pages/__tests__/）而不是 sprints/.../tests/wsN/。理由：CI 直接抓取，避免 Generator 复制步骤。
2. WS4 的 BEHAVIOR 覆盖由 smoke 脚本自身担保（CI 中执行），不写独立 vitest .test.ts。理由：smoke 脚本就是端到端测试本身，重复包一层 vitest 无收益。
3. 4 个 workstream 在同一 PR 中合并交付（Sprint A = 1 PR，TDD commit-1 = 全部 Red 测试，commit-2 = 全部实现）。理由：Sprint A 工程量约 1 天，4 PR 的 CI 开销不划算。
