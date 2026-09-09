# 我的作品页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 客户在 dashboard「我的作品」里编辑并一键发布上传的作品，回执徽章可见。

**Architecture:** apps/api 在 createContentsPublishRouter 加 GET /（列表+回执聚合+首图签名）与 PATCH /:id（编辑锁）；apps/dashboard 新 my-contents.api.ts + MyWorksPage + 注册三件套。

**Tech Stack:** Express/pg/vitest（mock pg）；React+react-query+Tailwind+lucide-react+testing-library。

## Global Constraints

- spec：`docs/superpowers/specs/2026-09-09-my-works-page-design.md`（字段/错误码/重发子集语义以它为准）
- 前端 API 文件名必须 `my-contents.api.ts`（contents.api.ts 已被占用）；页面 MyWorksPage；路由 /dashboard/my-works；featureKey 'my-works' 且必须同步进 InstanceContext.tsx features 表
- 重发只传失败平台子集（platformsOverride）——组件测试必须钉死这个断言
- preview_url 签名失败降级 null（照 apps/api/src/routes/materials.ts 列表端点惯例），前端 null 显示占位
- TDD 两段式（commit-1 测试红 / commit-2 实现绿）；lint-test-pairing 闸：新 src 文件要有同名配套测试
- 既有测试全程保绿；分支 cp-09091830-works-page

---

### Task 1: API——GET /api/contents 列表 + PATCH /:id 编辑

**Files:**
- Modify: `apps/api/src/routes/publish-dispatch.ts`（createContentsPublishRouter 内加两个 handler；storage 依赖：该 router 工厂当前无 storage 参数，改造为 `createContentsPublishRouter(deps: {storage?: MaterialStorage} = {})` 并在 app.ts 挂载处保持无参调用兼容——default createMaterialStorage()）
- Test: `apps/api/src/routes/__tests__/publish-dispatch.test.ts`（追加两个 describe）

**Interfaces:**
- Consumes: `pool`、`MaterialStorage.getSignedUrl`、`PUBLISH_PLATFORMS`（content-publish-dispatch）、既有 authenticate/fail/ok/UUID_RE
- Produces: 列表条目形状 `{id,title,body,type,platforms,status,created_at,materials:[{file_name,preview_url}],receipts:[{platform,status}]}`；PATCH 错误码 EDIT_LOCKED(409)/INVALID_PLATFORMS(400)/NOT_FOUND(404)

- [ ] **Step 1: 追加失败测试（describe 'GET /api/contents 列表' 与 'PATCH /api/contents/:id'）**

用例（mock 模式照文件内既有 stubQueries/stubTx 惯例，makeApp 需给 createContentsPublishRouter 注入 InMemoryMaterialStorage）：
1. 列表：mock contents 两行 + content_materials 首图行 + publish_tasks 聚合行（一条 SQL 带 `= ANY`）→ 断言响应 items[0] 字段齐、receipts group 到对的 content、preview_url 含 storage_key（InMemory 签名可辨认）
2. 列表：签名抛错 → 该条 preview_url=null 其余正常（单条降级不拖垮整页）
3. 列表：status 过滤参数进 SQL、limit 上限 100
4. PATCH：queued 作品 → 409 EDIT_LOCKED 且无 UPDATE
5. PATCH：platforms 含白名单外 → 400 INVALID_PLATFORMS
6. PATCH：只给 title → UPDATE SQL 只含 title 与 updated_at；跨租户（查询空）→ 404；无凭据 401
跑红后 commit-1：`test(line01): 我的作品 API 契约先行——列表聚合/编辑锁（红）`

- [ ] **Step 2: 实现两个 handler**

GET /：① 查 contents（tenant+status?+limit/offset，ORDER BY created_at DESC）② ids 一次查 content_materials 首图（`DISTINCT ON (cm.content_id) ... ORDER BY cm.content_id, cm.sort_order`）③ 一次查 publish_tasks 聚合（spec 的 ANY SQL）④ 逐条 getSignedUrl try/catch null ⑤ ok({items})。
PATCH /:id：UUID 预检 404 → 查 status（tenant 限定）无→404 → queued→409 EDIT_LOCKED → platforms 白名单校验 → 动态 SET 子句（仅给到字段，参数化）→ ok({id, updated:true})。
跑绿 + tsc + 全量 publish-dispatch 测试保绿，commit-2：`feat(line01): 我的作品 API——列表(回执聚合+首图签名降级)+编辑锁（绿）`

---

### Task 2: 前端——my-contents.api.ts + MyWorksPage + 注册三件套

**Files:**
- Create: `apps/dashboard/src/api/my-contents.api.ts`、`apps/dashboard/src/pages/MyWorksPage.tsx`
- Modify: `apps/dashboard/src/config/navigation.config.ts`（组件映射+第一组菜单项）、`apps/dashboard/src/contexts/InstanceContext.tsx`（features 表加 'my-works': true）
- Test: `apps/dashboard/src/pages/__tests__/MyWorksPage.test.tsx`、`apps/dashboard/src/api/__tests__/my-contents.api.test.ts`

**Interfaces:**
- Consumes: Task 1 API 形状；materials.api.ts 的 getUploadToken 模式（可 import 复用其导出，若未导出则同模式实现）
- Produces: `listMyContents({status?})`、`updateMyContent(id,{title?,body?,platforms?})`、`publishMyContent(id, platforms?)`

- [ ] **Step 1: 失败测试**
- api 测试：mock apiClient——三个函数带 X-Upload-Token 头、publishMyContent 传 platforms 子集进 body
- 页面测试（照 WorkersPage.test.tsx：vi.mock my-contents.api + MemoryRouter + QueryClientProvider 包裹）：
  1. 渲染两卡片（一张已发含 douyin✅ 徽章、一张草稿）
  2. 空态文案
  3. 点草稿卡→编辑面板→改标题保存→updateMyContent 被调
  4. 草稿点发布→publishMyContent(id, undefined)
  5. **failed 作品（douyin done + weibo failed）点「重发失败平台」→ publishMyContent(id, ['weibo'])**——关键断言
  6. queued 卡片发布按钮 disabled
跑红 commit-1：`test(line01): 我的作品页组件契约先行——徽章/编辑/重发子集（红）`

- [ ] **Step 2: 实现**
按 spec 前端段实现（react-query useQuery key ['my-contents'] refetchInterval 30_000 + useMutation invalidate；卡片 grid 照 MaterialsPage Tile 风格；状态徽章色：draft 灰/queued 蓝⏳/published 绿/failed 红）。注册三件套一次做完。
跑绿：`cd apps/dashboard && npx vitest run src/pages/__tests__/MyWorksPage.test.tsx src/api/__tests__/my-contents.api.test.ts` + `npx tsc --noEmit`。commit-2：`feat(line01): 我的作品页——卡片/编辑/发布/回执徽章 + 导航注册（绿）`

---

### Task 3: smoke + 入册

**Files:**
- Create: `.github/workflows/scripts/smoke/my-works-api-smoke.sh`（照 content-publish-dispatch-smoke.sh 的种子模式：种 tenant/license/agent→传素材→GET /api/contents 断言 items[0].materials[0].file_name 与 receipts=[]→PATCH title 断言 200→派发后 PATCH → 409 EDIT_LOCKED→列表 receipts 出现 douyin queued）
- Modify: `.github/workflows/scripts/smoke-baseline.txt`（追加一行）、`test-registry.yaml`（新测试文件入册，照既有条目格式：publish-dispatch 区段旁）

bash -n + commit：`test(line01): 我的作品 API smoke 进基线 + 测试入册`

---

### Task 4: 全量验证（控制者执行）

`apps/api npx vitest run`（除既存 boot-fail 活体外全绿）+ `apps/dashboard npx vitest run` + 两侧 tsc + eslint（警告不升）。product-map：把 my-works-api-smoke.sh 登记进 customer_first_success smoke_files（GP-Anchor 闸）+ regenerate。
