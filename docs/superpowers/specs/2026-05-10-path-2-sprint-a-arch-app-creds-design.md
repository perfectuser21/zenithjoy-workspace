# Path 2 Sprint A — Architecture Hotfix: app credentials (tenant_access_token) 替代 user OAuth

**日期**: 2026-05-10
**分支**: `cp-05100828-feishu-app-creds-arch`
**状态**: design APPROVED (user 直接指明 architecture 错误，verifier 已 curl 验证 PASS)

---

## 1. 现状（错在哪）

PR #267 / #274 / #275 / #276 实现了**多余的 user OAuth dance**：

```
客户填 app_id/app_secret → 后端生成 authorize_url + 跳转飞书 → 客户扫码登录飞书 →
飞书 callback?code → 后端 handleCallback → 入 token → provisionBitable
```

问题：
- **客户必须扫码** — 但客户已经在自己的飞书企业里装好 app（`drive:write` `bitable:app` `bitable:app:readonly` 等权限），扫码再产生一个 user 身份是多余的
- 飞书有两种 token：
  - `user_access_token` — 扫码后拿，代表 user 身份
  - `tenant_access_token` — POST `app_id+app_secret` 拿，**代表整个 app 在该飞书企业的全部授权范围**
- Path 2 实际操作（建 Bitable 文档 + 建 3 张表 + 读写 records）是**企业级**操作，**`tenant_access_token` 已足够**
- 现状把 `tenant_access_token` 当作 OAuth 流程附属，但 `getValidToken` 内部已经只用 `app_id/app_secret` POST 飞书拿 token — **OAuth 那段 code/state 的换是无效空操作**（`feishu-token.ts:156` `void code;` 已经暗示）

verifier curl 已验证（Phase 0）：
- POST `auth/v3/tenant_access_token/internal` body `{app_id, app_secret}` → `tenant_access_token` PASS
- POST `bitable/v1/apps` 用 token → 建 Bitable PASS
- POST `bitable/v1/apps/<token>/tables` → 建表 PASS
- GET `bitable/v1/apps/<token>/tables/<id>/records` → 读 PASS
- DELETE `drive/v1/files/<token>?type=bitable` 99991672 缺 `drive:drive` 权限（不影响生产 flow，可让 user 后台开权限作 follow-up）

## 2. 新 Architecture

### 2.1 客户视角（0 扫码）

1. 客户在飞书 admin 后台新建 app + 配 `bitable:app` `drive:drive`（建议）权限 + "全员可见"（一次性 install）
2. 客户在 ZenithJoy dashboard `/dashboard/feishu-bind` 表单填 `app_id` + `app_secret`
3. 点"开始绑定"
4. 后端**同步**：
   a. POST 飞书拿 `tenant_access_token`
   b. 用 token 建 Bitable 文档
   c. 用 token 建 3 张表（获客画像 / 对标视频 / Lead 名单）
   d. 写 `tenant_feishu_bindings`（4 个 ID + tenant_access_token + expires_at）
   e. 返回 `{success: true, app_token, table_ids, bitable_doc_url}`
5. dashboard 显示"飞书已绑定 ✓ + Bitable 链接"

**0 扫码、0 OAuth 跳转、0 user 身份。**

### 2.2 后端 API 变更

| 变更 | 端点 | 状态 |
|---|---|---|
| 新增 | `POST /api/feishu/oauth/bind` (body: app_id, app_secret) — 直接同步建 Bitable，返回 4 ID | 新建 |
| 保留 | `GET /api/feishu/oauth/status` — frontend mount 时查绑定状态 | 不动 |
| 保留 | `POST /api/feishu/oauth/start` + `GET /api/feishu/oauth/callback` — deprecated，但保留兼容 CI smoke + 历史 | 不动 |
| 保留 | `POST /api/feishu/oauth/rebuild` (TODO 现有 frontend 已经引用，但当前 router 没实现 — 顺便补上) | 新建 |

不改 mount 路径 `/api/feishu/oauth/*`（避免冲击 fake-feishu-server / smoke / dashboard nginx config）。

### 2.3 后端实现变更

`apps/api/src/routes/feishu-oauth.ts`：
- 新增 `router.post('/bind', tenantContext, ...)` — 一气呵成 provision flow
- 新增 `router.post('/rebuild', tenantContext, ...)` — 强制 re-provision（删 bindings 行 + 重 provision）

`apps/api/src/services/feishu-token.ts`：
- 不动（getValidToken 已经是 app credentials 模式）
- handleCallback 保留（CI/legacy）

`apps/api/src/services/feishu-bitable-multitenant.ts`：
- `provisionBitable` 不动（已经正确）
- 新增辅助：直接接受 `appId, appSecret` 参数（避免必须先 UPDATE tenants 表再调 — 但**仍写回 tenants** 让 getValidToken 能拿到 secret refresh）

### 2.4 Frontend 变更

`apps/dashboard/src/pages/FeishuBindTenant.tsx`：
- `onSubmit` 改：`POST /api/feishu/oauth/bind` 取代 `/start` + `window.location.href` 跳转
- 等响应（5-15s — 需要 loading state「建表中...」）
- 成功 → 直接渲染绑定状态 + Bitable 链接（不再依赖 callback 跳回）
- 失败 → 现有 `leadConfigError` UI 渲染（已存在）

### 2.5 DB Migration

无 schema 变更需要 — `tenant_feishu_bindings` 已经是 tenant_token 设计。

可选优化（**本 PR 不做**）：删除 `tenants.feishu_app_id/secret` 反正只 dashboard / route 用 — 留作以后 follow-up。

## 3. 影响范围

| 文件 | 改动 |
|---|---|
| `apps/api/src/routes/feishu-oauth.ts` | 新增 `/bind` `/rebuild` |
| `apps/api/src/routes/feishu-oauth.test.ts` | 新增 `/bind` happy/error 测试，新增 `/rebuild` 测试 |
| `apps/dashboard/src/pages/FeishuBindTenant.tsx` | `onSubmit` 改 endpoint + 去 OAuth 跳转 + loading state |
| `apps/dashboard/src/pages/FeishuBindTenant.test.tsx` (如果已有) | 更新断言 |
| `.github/workflows/scripts/smoke/golden-path-2-smoke.sh` | 增加 0-touch bind smoke（可选） |
| `.agent-knowledge/path-2/lead-acceptance-sprint-a.md` | 全替换为 0-touch 自验证据 |

**不动**：
- `feishu-bitable-multitenant.ts` 核心
- `feishu-token.ts`
- `tenant_feishu_bindings` schema
- fake-feishu-server (CI mock)
- 飞书 app 后台 redirect URL 配置（保留兼容）

## 4. 测试策略

### 4.1 TDD 后端

**commit 1 RED**：
- `feishu-oauth.test.ts` 新增 4 个 case：
  - `POST /bind` happy — provisionBitable 被调用 + 返回 4 ID + bitable_doc_url
  - `POST /bind` 缺 app_id → 400 MISSING_FIELDS
  - `POST /bind` ALREADY_BOUND → 400 (rebind_required: true)
  - `POST /bind` provisionBitable throw ProvisionFailedError → 502 PROVISION_FAILED
- 所有 case 都 fail（`/bind` 还不存在）

**commit 2 GREEN**：
- 实现 `POST /bind` + `POST /rebuild`
- 复用 `provisionBitable`
- 测试 PASS

### 4.2 Frontend Component Test

如果有 `FeishuBindTenant.test.tsx`，更新：
- mock `POST /api/feishu/oauth/bind` → success → 断言 "飞书已绑定 ✓" 渲染
- mock `POST /bind` → 502 → 断言 error banner

### 4.3 Lead 0-touch E2E（手动跑）

ROG (Windows + msedge headless via Playwright):
1. API 注册新 user → 拿 tenantId
2. 浏览器 goto `/dashboard/feishu-bind`
3. 填 ZenithJoy real `app_id` + `app_secret`（test app — 同 verifier 用过的）
4. 点"开始绑定"
5. 等 5-15s
6. 断言：dashboard 显示"飞书已绑定 ✓"
7. GET `/api/lead-config/<tenantId>` 返 200 + 3 张表 metadata
8. 截图 6+ 张

**0 user 介入**（除了 Playwright 自动操作 — 没有人扫码）。

### 4.4 lint-tdd-commit-order

新增 `/bind` 是 route 改动 — TDD 顺序：
- commit 1: 改 `feishu-oauth.test.ts` 加新 case
- commit 2: 改 `feishu-oauth.ts` 实现

frontend 改动小，frontend test 可与实现同 commit。

## 5. 不在本 sprint 内

- 删除 `tenants.feishu_app_id/secret` 字段（留 follow-up）
- 删除 `feishu-token.ts:handleCallback` 死代码（留兼容，follow-up）
- dispatcher 多机调度设计（已有 proposal doc，本 sprint 让物理瓶颈消失后会变成"为并发"而非"为扫码"，会写 follow-up note）
- `drive:drive` 权限申请（让 user 后台手工申请以支持自动清理测试 Bitable）

---

**Approved by**: user (直接指明 architecture 错误)
**Verified by**: curl test (Phase 0, 2026-05-10 08:30 CST)
