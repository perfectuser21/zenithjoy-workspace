# PrepPRD：客户端「我的作品」页（line01 刀5a）

> Brain task 6035fa7f · golden_path c5c0e259 · 分支 cp-09091830-works-page
> 主理人拍板（2026-09-09"能不能把客户端和飞书版一起做出来"→"做"）

## 本次要做的（用户语言）
客户在 dashboard 打开「我的作品」：传过的素材自动成作品卡片（缩略图/标题/文案/平台/状态）；点开能改标题文案、勾平台；点「发布」走真机链；每平台回执 ✅/❌ 徽章可见；失败可改后重发。

## Golden Path
1. 客户传素材（已有链路）→ 打开 dashboard「我的作品」→ 看到新作品卡片（缩略图+草稿态）
2. 点卡片 → 编辑标题/文案/平台 → 保存 → 卡片更新
3. 点「发布」→ 状态变"排队中"、按钮禁用 → （执行器发布）
4. 回执后卡片出现每平台 ✅/❌；全成=已发布，有败=部分失败
出错恢复：无活跃 agent 点发布 → 明确报错文案"设备离线，请确认客户端在线后重试"；排队中不可编辑不可重发（防双发，服务端 CAS 兜底）。

## 新增 API（apps/api，复用 X-Upload-Token 鉴权与 publish-dispatch 惯例）
- GET /api/contents?status=&limit=&offset=：本租户作品列表，每条含 id/title/body/type/platforms/status/created_at/素材（file_name+缩略图签名URL 首图）/回执聚合（per-platform status from publish_tasks content_publish）
- PATCH /api/contents/:id：title/body/platforms（白名单校验复用 PUBLISH_PLATFORMS）；status='queued' 时 409 不可改；跨租户 404
- 发布复用既有 POST /api/contents/:id/publish

## 前端（apps/dashboard）
- 新 contents.api.ts + MyContentsPage（卡片列表+编辑抽屉/弹窗+发布按钮+回执徽章），照仓库既有页面惯例（react-query/组件库/路由/导航注册方式以现状为准，设计审查核）
- 前端鉴权：与 materials.api.ts 同源方式取上传凭据（以现状为准）

## 判定点登记表
| 判定点 | 候选 | 所选 | 依据 | 误判后果 |
|---|---|---|---|---|
| 可编辑态判定 | 前端只读 status / 服务端强校验 | 双层：前端禁用+服务端 status='queued' 409 | 防绕过 | 低：改了也被 409 |
（无接缝判定点，纯 UI+API）

## 前置
- [x] 刀1-3a API 全部已合并可复用；staging 有真数据（2 条作品）可开发验证
- [x] E2E 路由死规则：ZenithJoy UI E2E → windows_cloud runner（本刀 vitest 组件测试 + smoke API 面；Playwright E2E 若仓库有既有基建则挂 windows_cloud）

## 验收标准
- [ ] API：列表（含缩略图签名URL+回执聚合）/编辑（queued 409/白名单/跨租户404）vitest 全绿
- [ ] 页面组件测试（列表渲染/编辑保存/发布调用/徽章渲染）
- [ ] smoke：contents 列表+编辑 API 真链路进基线 [CONFIG]
- [ ] staging 真验：页面上看到《傍晚的调色盘》已发+douyin✅ 徽章；新传一张图→页面出卡片→改文案→发布→徽章
