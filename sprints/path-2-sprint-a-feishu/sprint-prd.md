# Sprint PRD — Path 2 客户智能获客 · Sprint A 飞书集成

## OKR 对齐

- **对应 KR**：[ASSUMPTION: Brain `/api/brain/context` 当前未返回 active KR 列表；本 sprint 暂归到「ZenithJoy Walking Skeleton — Path 2 客户智能获客」Maturity 推进维度（Notion Path 2 Journey ID `35ac40c2-ba63-81ed-8df4-f3fa0b64f5bf`）]
- **当前进度**：Path 2 Maturity = `not_started`（Step 1+2 已 thin done 复用 Path 1，Step 3-6 全 missing）
- **本次推进预期**：Path 2 Step 3 + Step 4 thin → thin done。Path 2 整体推进 33%（6 步中第 3-4 步贯穿）。

## 背景

ZenithJoy walking skeleton Path 2 客户智能获客的第一段。终端价值：让客户绑定自己的飞书企业，并在客户自己的飞书 Bitable 里维护「获客画像」+「对标视频清单」，给后续 Sprint B 的「评论区挖客闭环」提供配置数据来源。

约束来源：
- 用户已确认 thin 阶段微信通道走企微 webhook，不接微信个人号（避 itchat / wechaty 封号风险）
- 用户已确认每个客户绑自己的飞书企业（多租户，各存各的），不走 ZenithJoy 中央项
- 用户已确认对标视频清单 thin 阶段手填 URL，加厚后再接「对标账号 → 自动拉视频」复用 `competitor-research.ts`
- 飞书 Bitable 单租户写入已通（`apps/api/src/services/feishu-bitable.ts` 的 `pushAccountsToBitable()`），Sprint A 改造为多租户
- `tenants` 表已预留 `feishu_app_id` / `feishu_app_secret` / `feishu_bitable` / `feishu_table_crm` / `feishu_table_log` 字段（migration `20260428_132000_unify_tenant_isolation.sql`）

## Golden Path（核心场景）

用户/系统从 [客户在 dashboard 已登录] → 经过 [绑客户飞书企业 + 中台自动建 3 张 Bitable 表 + 客户在飞书填画像和对标视频] → 到达 [中台拉到完整画像配置，dashboard 显示「画像已配置 ✓」]

具体：
1. 客户在 ZenithJoy dashboard 完成注册并登录（复用 Path 1 Step 1）
2. 客户点击 dashboard 上的「绑飞书企业」按钮
3. 客户填入自己飞书内部应用的 `app_id` 和 `app_secret`（提前在客户的飞书开放平台创建）
4. 系统跳到飞书 OAuth 授权页 → 客户用自己飞书企业的管理员账号扫码授权
5. 飞书回调 → 中台拿到 `tenant_access_token` 入库（含过期时间，2h 后自动刷新）
6. 中台调飞书 Bitable API 在客户的飞书 workspace 自动建 1 个 Bitable 文档 + 3 张表：
   - 「获客画像」表：行业 / 关键词 / 钩子文案
   - 「对标视频」表：视频 URL / 备注 / 添加时间
   - 「Lead 名单」表：评论者抖音 ID / 评论内容 / 来源视频 URL / 加企微时间 / 状态（thin 阶段建表占位，写入由 Sprint B 完成）
7. dashboard 跳转回「画像配置」页 → 提示「飞书已绑定 ✓，请到飞书填画像和对标视频」+ 给出 Bitable 文档链接
8. 客户在自己飞书的「获客画像」表填 1 行（行业=装修、关键词=小户型、钩子=送装修方案 PDF）
9. 客户在自己飞书的「对标视频」表填 1 行 URL（任意一个抖音视频 URL）
10. 客户回 dashboard 点「刷新状态」→ 中台调飞书 Bitable API 拉这两张表的数据 → dashboard 显示「画像 ✓ 装修 / 小户型 / 送装修方案 PDF」+「对标视频 1 个：<URL>」

## 边界情况

- 客户填的 `app_id` / `app_secret` 错或权限不足 → OAuth 授权失败 → dashboard 显示飞书原始错误码 + 提示客户检查应用权限范围（必须勾选 Bitable 读写 + 用户身份读取）
- 客户的飞书应用没勾「文档管理 / 多维表格读写」权限 → 中台自动建 Bitable 时报权限错 → dashboard 提示客户去飞书开放平台补齐权限并重试
- `tenant_access_token` 过期（2h）→ 中台后台自动用 `app_id` + `app_secret` 重新换 token，客户无感
- 客户在飞书把 ZenithJoy 自动建的 Bitable 文档删了 → 中台拉数据时 404 → dashboard 提示「Bitable 文档已不存在，是否重建？」+ 一键重建按钮
- 客户重复点「绑飞书企业」（已绑过）→ 不重新走 OAuth，直接显示已绑租户信息 + 「换绑」二次确认按钮
- 客户在飞书表里改了表头字段名 → 中台拉数据用 field_id 不用 field_name，不受影响（schema 中固定 field_id）
- 多个客户同时绑飞书 → 每个客户的 `tenant_access_token` 按 ZenithJoy `tenants.id` 命名空间隔离，互不撞

## 范围限定

**在范围内**：
- 多租户飞书 OAuth flow（per-tenant `app_id` / `app_secret`，从 `tenants` 表读，不再 hard-code env）
- `tenant_access_token` 入库 + 自动刷新（独立表，2h 过期前主动续）
- Bitable 自动建 1 文档 + 3 张表（schema 固定，见下方「数据模型」段）
- Dashboard 飞书绑定页（`app_id` / `app_secret` 输入 + OAuth 跳转 + 状态展示 + 重建 / 换绑按钮）
- 中台 GET API 拉客户画像 + 对标视频清单（`/api/lead-config/:tenantId`）
- `golden-path-2-smoke.sh`（真飞书 API 全链 smoke，FAIL 整 sprint FAIL）
- Lead 在 xian-pc 客户机自验，证据归档 `.agent-knowledge/path-2/lead-acceptance-sprint-a.md`

**不在范围内**（明确推到后续 sprint 或永不做）：
- ❌ Path 2 Step 5 绑抖音小号（Sprint B）
- ❌ Path 2 Step 6 评论区挖客 + 企微 webhook 闭环（Sprint B）
- ❌ Lead 名单表的写入逻辑（Sprint B 的评论挖客流程才会写）
- ❌ 不动 `agent_platform_sessions` 表 schema（防撞 Path 1）
- ❌ 不动账号绑定 Dashboard UI（Path 1 主号扫码弹窗）
- ❌ 不动 `services/agent/src/handlers/qr-bind-douyin.ts`（Path 1 抖音主号扫码代码）
- ❌ 不接「对标账号 → 自动拉视频」逻辑（加厚阶段才接 `competitor-research.ts`）
- ❌ Bitable 表的 schema 演化机制（thin 阶段 schema 固定，未来字段变更需要 migration 但不在本 sprint）

### 数据模型（Bitable 3 张表 + 中台 2 张表）

**客户飞书 Bitable**（中台自动建在客户 workspace）：

| 表名 | 字段 | 类型 | thin 是否必填 |
|---|---|---|---|
| 获客画像 | 行业 | 单行文本 | ✓ |
| 获客画像 | 关键词 | 单行文本 | ✓ |
| 获客画像 | 钩子文案 | 多行文本 | ✓ |
| 对标视频 | 视频 URL | URL | ✓ |
| 对标视频 | 备注 | 多行文本 | 可空 |
| 对标视频 | 添加时间 | 日期时间（自动） | 自动 |
| Lead 名单 | 评论者抖音 ID | 单行文本 | Sprint B 写 |
| Lead 名单 | 评论内容 | 多行文本 | Sprint B 写 |
| Lead 名单 | 来源视频 URL | URL | Sprint B 写 |
| Lead 名单 | 加企微时间 | 日期时间 | Sprint B 写 |
| Lead 名单 | 状态 | 单选（评论 / 已私信 / 已加企微 / 已 AI 首答 / 已转化） | Sprint B 写 |

**ZenithJoy 中台数据库**（新增）：

| 表名 | 用途 | 关键字段 |
|---|---|---|
| `tenant_feishu_bindings` | 客户飞书 OAuth token 存储 | `tenant_id` (FK), `tenant_access_token`, `expires_at`, `app_token`（Bitable 文档 ID）, `table_id_lead_profile`, `table_id_target_videos`, `table_id_leads`, `bound_at`, `last_refreshed_at` |

`tenants` 表的 `feishu_*` 字段（已预留）继续承担 per-tenant `app_id` / `app_secret` 配置。

## 假设

- [ASSUMPTION: 客户提前在自己的飞书开放平台创建了一个内部应用（不是商店应用），并自己拿到了 `app_id` 和 `app_secret`。本 sprint 不做引导客户「如何在飞书开放平台建应用」的产品化文档（Lead 自验时手动配置一次即可，加厚到 medium 阶段再做产品化引导）]
- [ASSUMPTION: 客户给 ZenithJoy 应用授权的权限范围至少包括：`bitable:app`（Bitable 应用读写）+ `bitable:app:readonly`（读 Bitable）+ 用户身份读取]
- [ASSUMPTION: Brain OKR 没返回 active KR，本 sprint 暂归到 Path 2 Maturity 推进；Brain 后续注入 OKR 后追溯关联]
- [ASSUMPTION: Lead 客户机 xian-pc 上的自验飞书账号是 Lead 个人或团队的飞书企业账号，可作为 Sprint A 的真飞书测试租户]
- [ASSUMPTION: 飞书 OAuth 走标准 server-side flow（dashboard 跳 `https://open.feishu.cn/open-apis/authen/v1/authorize` → 回调 `/api/feishu/oauth/callback` → 后端换 token），不走 SPA 隐式授权]

## 预期受影响文件

**新增**：
- `apps/api/src/routes/feishu-oauth.ts`：OAuth start + callback 端点
- `apps/api/src/services/feishu-token.ts`：`tenant_access_token` 缓存 + 刷新 + 失效感知
- `apps/api/src/services/feishu-bitable-multitenant.ts`：多租户版 Bitable 自动建文档/建表/读写（不动现有单租户 `feishu-bitable.ts`，避免影响其他调用方）
- `apps/api/src/routes/lead-config.ts`：`GET /api/lead-config/:tenantId` 从飞书拉画像 + 对标视频
- `apps/api/db/migrations/20260508_xxxxxx_tenant_feishu_bindings.sql`：`tenant_feishu_bindings` 表
- `apps/dashboard/src/pages/FeishuBindTenant.tsx`：客户自助绑定飞书企业页
- `apps/dashboard/src/pages/LeadConfigStatus.tsx`：画像状态展示页（也可挂在现有 dashboard 主页面，by 实现选择）
- `.github/workflows/scripts/smoke/golden-path-2-smoke.sh`：真飞书全链 smoke
- `.agent-knowledge/path-2/lead-acceptance-sprint-a.md`：Lead 在 xian-pc 客户机自验证据归档

**改造（小改）**：
- `apps/api/src/middleware/feishu-user.ts`：从单租户 `X-Feishu-User-Id` 模式 → 多租户租户 ID 解析
- `apps/dashboard/src/App.tsx` 或路由表：挂新页面

**不动**（防撞 Path 1）：
- `apps/api/src/services/feishu-bitable.ts`（现有单租户实现保留，不改）
- `services/agent/src/handlers/qr-bind-douyin.ts`
- `apps/api/db/migrations/...agent_platform_sessions...`
- 现有 `apps/dashboard/src/pages/FeishuLogin.tsx`（已有 dashboard 登录扫码用，是另一回事）

## journey_type: user_facing
## journey_type_reason: 涉及 `apps/dashboard/` 客户自助绑定页面 + 客户在飞书 workspace 操作，是终端客户面的 walking skeleton 路径
