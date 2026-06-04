# 微信客服中台配置页 — Sprint B 设计

**日期**：2026-06-04
**Journey**：Path 4 客户私域 AI 接管 — Step 3 继续加厚（Sprint A 后端引擎已合并 #625）
**目标**：把 Sprint A 写死在 `apps/api/config/*.json` 的人设 + 企业知识库「搬上中台」，运营在页面上填、保存即生效。含「AI 帮填 A1–A5 人群画像」。
**范围**：中台编辑页 + 后端 CRUD + AI 帮填。**不含**：多租户隔离（先全局单份）、facts 飞书读回、扫微信导入。

## 1. 核心原则
引擎当前 `loadPersona()/loadBusinessKB()`（sync，读 config/默认）**保持不变**，作为兜底。新增 **config-store** 从 DB 读优先、回落到这俩 sync loader。引擎主链路改读 store。这样 Sprint A 的 persona/business-kb 单测不受影响。

数据：**单份全局配置**（单租户），存一张 key/value 表。

## 2. 后端（apps/api）

### 2.1 迁移 `apps/api/db/migrations/<ts>_create_wechat_cs_config.sql`
```sql
CREATE TABLE IF NOT EXISTS zenithjoy.wechat_cs_config (
  key        TEXT PRIMARY KEY,          -- 'persona' | 'business_kb'
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
命名/前缀对齐现有迁移（看最近一个 .sql，全部 `zenithjoy.` 前缀）。

### 2.2 `apps/api/src/services/wechat/cs-config-store.ts`（新）
```ts
export async function getPersona(): Promise<Persona>;        // DB 'persona' → 回落 loadPersona()(sync)
export async function savePersona(p: Persona): Promise<void>; // upsert key='persona'
export async function getBusinessKB(): Promise<BusinessKB>;   // DB 'business_kb' → 回落 loadBusinessKB()
export async function saveBusinessKB(kb: BusinessKB): Promise<void>;
```
- import 现有 `loadPersona`/`loadBusinessKB`（来自 ./persona、./business-kb）作兜底。
- 表名带 `zenithjoy.` 前缀；upsert 用 `INSERT ... ON CONFLICT (key) DO UPDATE`，value 用 `$1::jsonb`。
- DB 读失败/无行 → console.warn + 回落兜底（绝不抛，不阻塞回复）。
- 单测：mock pool，覆盖 DB 命中 / 无行回落 / DB 失败回落。

### 2.3 引擎接线（lead 改 `wechat-draft.ts`）
`generateChatDraft` 里 `loadPersona()/loadBusinessKB()` 改为 `await getPersona()/await getBusinessKB()`（来自 cs-config-store）。其余不变。

### 2.4 路由 `apps/api/src/routes/wechat-config.ts`（新，挂 /api/wechat）
全部用 `superAdminGuard` 中间件（写配置需管理员；env 未设时该 guard 自动放行，便于本地/测试）。Zod 校验 body。
- `GET  /api/wechat/persona` → getPersona()
- `PUT  /api/wechat/persona` → 校验 Persona → savePersona() → {success:true}
- `GET  /api/wechat/business-kb` → getBusinessKB()
- `PUT  /api/wechat/business-kb` → 校验 BusinessKB → saveBusinessKB()
- `POST /api/wechat/business-kb/suggest-audience` → body {industry, products?, value_prop?} → callOpenRouter(JSON 输出 A1–A5) → 返回 `{audience_segments: KBAudienceSegment[]}`（解析失败回 400/空数组，不写库；前端拿去填表单后由用户保存）
在 `apps/api/src/index.ts`（或现有 wechat 路由挂载处）mount。复用 types.ts 的 Persona/BusinessKB 类型。

## 3. 前端（apps/dashboard）

### 3.1 API 客户端 `src/api/wechat-cs-config.api.ts`（新）
用 `apiClient`（baseURL `/api`，自动带 cookie + X-Feishu-User-Id）。导出 getPersona/savePersona/getBusinessKB/saveBusinessKB/suggestAudience。

### 3.2 页面 `src/pages/WechatCustomerServiceConfigPage.tsx`（新）
照搬 `ContentTypeConfigPage.tsx` 范式（加载 GET、保存 PUT、saving/loading、成功/失败 toast、深色模式 class）。分区/标签：
- **人设**：自称/称呼/语气/句长/emoji/禁用词(数组)/few-shot(数组 customer+me)
- **企业信息**：name/what_we_do/value_prop/contact
- **产品信息**：products[]（name/selling_points/price）增删行
- **目标人群**：audience_segments[]（code/label/desc）增删行 + **「AI 帮我生成 A1–A5」按钮**（调 suggest-audience，填回表单，可改）
- **常用文档/Q&A**：qa_docs[]（q/a）增删行
每区独立保存或统一保存皆可，保存调对应 PUT。

### 3.3 路由注册 `src/config/navigation.config.ts`
- `autopilotPageComponents` 加 `'WechatCustomerServiceConfigPage': () => import('../pages/WechatCustomerServiceConfigPage')`
- 「设置」分组加菜单项 `{ path:'/wechat/cs-config', icon: MessageCircle, label:'微信客服配置', component:'WechatCustomerServiceConfigPage' }`

## 4. 测试（E2E-first）
- 后端：`cs-config-store` 单测（mock pool）；`wechat-config` 路由集成测试（真 DB，建表后 PUT→GET 往返 + suggest-audience mock fetch）。放 `apps/api/tests/integration/p4-wechat-cs-config/`。
- 前端：`apps/dashboard/e2e/wechat-cs-config.spec.ts`（Playwright，API mock，验加载/编辑/保存/AI帮填按钮触发请求）。**E2E 跑 windows_cloud GHA runner（ZenithJoy 死规则）**。
- smoke：`.github/workflows/scripts/smoke/wechat-cs-config-smoke.sh` 串后端单测+集成。
- 提交顺序满足 lint-tdd-commit-order（commit1 测试，commit2 实现）；新测试登记 `test-registry.yaml`；新 src 配套 test（含 store/route/page 各自 test，page 的 e2e 算配套）。

## 5. 团队分工
- **agent-cfg-backend**：迁移 + cs-config-store.ts + 单测（mock pool）。
- **agent-cfg-api**：wechat-config.ts 路由（4 CRUD + suggest-audience）+ zod + superAdminGuard + 集成测试。依赖 store 接口（按本 spec 签名编码）。
- **agent-cfg-frontend**：api 客户端 + 页面 + navigation 注册 + Playwright spec。按本 spec 的端点契约编码。
- **lead（我）**：wechat-draft 接线 store + mount 路由 + test-registry 登记 + smoke + 整合跑绿 + 提交。
