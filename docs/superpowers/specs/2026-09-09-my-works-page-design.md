# 客户端「我的作品」页（line01 刀5a）

> Brain task 6035fa7f · golden_path c5c0e259 · 分支 cp-09091830-works-page
> PrepPRD：sprints/09091925-works-page/prep-prd.md · 设计审查 APPROVE（4 修正已并入）

## API（apps/api，加进既有 createContentsPublishRouter，同鉴权同限流）

### GET /api/contents
- query：`status?`（过滤）、`limit`（默认 30 上限 100）、`offset`
- 每条：`{id, title, body, type, platforms, status, created_at, materials:[{file_name, preview_url|null}](仅首图签名，失败降级 null 照 materials.ts 惯例), receipts:[{platform, status}]}`
- 回执聚合单查：`SELECT payload->>'content_id' AS cid, platform, status FROM zenithjoy.publish_tasks WHERE tenant_id=$1 AND task_type='content_publish' AND payload->>'content_id' = ANY($ids)` → JS group（30 条列表全程 2 条 SQL + 本地 HMAC 签名，无 N+1 网络调用）

### PATCH /api/contents/:id
- body：`{title?, body?, platforms?}`；platforms 过 `PUBLISH_PLATFORMS` 白名单（400 INVALID_PLATFORMS）
- `status='queued'` → 409 EDIT_LOCKED（排队中不可改）；跨租户/不存在 404；UUID 预检
- 只 UPDATE 给到的字段 + updated_at

### 重发语义（复用 POST /:id/publish，不新增端点）
- 前端对 failed 作品的「重发失败平台」按钮：取 receipts 里 status≠done 的平台集合，`POST /:id/publish {platforms:[失败子集]}`——**禁止整单重派**（与 Notion 侧拒绝终态重派的防线同向；服务端 CAS `status<>'queued'` 对 failed 放行属预期，靠子集语义防已成功平台双发）

## 前端（apps/dashboard）

- `src/api/my-contents.api.ts`（**不得**叫 contents.api.ts——被官网内容管理占用）：照 materials.api.ts 的 `getUploadToken()`（/account→license_key→X-Upload-Token）模式；`listMyContents / updateMyContent / publishMyContent(id, platforms?)`
- `src/pages/MyWorksPage.tsx`：react-query（照 MaterialsPage/WorksGalleryPage）+ Tailwind 卡片 grid + lucide-react；卡片=缩略图（preview_url null 显示占位不渲染破图）+标题+状态徽章+每平台回执徽章（✅/❌/⏳）；点卡片开编辑面板（标题/文案 textarea/平台 checkbox），保存调 PATCH；按钮区：草稿/failed→「发布/重发失败平台」，queued→禁用「发布中…」
- 注册三件套（WorkersPage 先例）：navigation.config.ts `autopilotPageComponents` + 第一组菜单 `{path:'/dashboard/my-works', label:'我的作品', featureKey:'my-works', component:'MyWorksPage'}` + `contexts/InstanceContext.tsx` features 表加 `'my-works': true`（漏加=菜单不显示）
- 列表 refetchInterval 30s（限流 60 次/分/IP，够余量）

## 既定行为声明（双入口并存期）

dashboard 编辑不回流 Notion 行（v1 拍板不回写）：**从哪个入口点"发"，就以那个入口当时的文案为准**（Notion 拉发时刻 Notion 行内容赢）。已记录，后刀可加 PATCH→markRow 回写。

## 测试策略

- integration（apps/api vitest，mock pg 照 publish-dispatch.test.ts）：列表字段齐/回执聚合 group 正确/首图签名降级 null/PATCH 白名单 400/queued 409/跨租户 404/只更新给到字段
- 组件测试（dashboard vitest+testing-library 照 WorkersPage.test.tsx）：列表渲染徽章/空态/编辑保存调用/发布按钮态/重发只传失败平台子集（关键断言）
- smoke [CONFIG] 进基线：真 API 列表+PATCH+queued 锁三步
- staging 真验：页面见《傍晚的调色盘》已发+douyin✅；传新图→卡片→改文案→发布→徽章

## 不做
PATCH 回写 Notion；分页 UI（limit 100 内滚动）；老 /works 页改动；删除作品。
