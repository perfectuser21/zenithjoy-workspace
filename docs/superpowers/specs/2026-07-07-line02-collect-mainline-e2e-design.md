# Line02 智能获客采集主链 P0 断链修复 —— 设计（第一刀）

**Goal:** 修好"网页输入关键词点搜索 → 安卓机被唤醒去采集"这条主链的起点断链，让 dashboard 触发的采集任务真正带上租户、被同租户安卓 agent 拉到并执行。

**Architecture:** 三处最小改动——(1) 后端 `POST /keyword-search` 挂 `tenantContextOptional` 从 session cookie/头解析租户；(2) 后端新增只读 `GET /keyword-tasks` 让前端列表对齐到 keyword 管线（A 表）；(3) 前端 `AcquisitionConfigPage.load()` 改读该端点。安卓 agent 与租户身份机制零改动。

**Tech Stack:** Express + pg（apps/api）、React + 裸 fetch（apps/dashboard）、既有 `tenantContextOptional` 中间件、既有安卓 `AcquisitionKeywordPollLoop`。

## Global Constraints（护栏，改动必须遵守）

- **租户隔离铁律**：`/keyword-search` 写库、`/keyword-tasks` 查询、`pending-keyword-tasks`、`comment-score-result` 一律 `WHERE/带 tenant_id=$1`；`comment-score-result` 必须按 `keyword_task_id` 反查真实租户，**禁止 `LIMIT 1` 猜任意租户**（已有回归 `acquisition.test.ts:289-343`，不得破坏）。
- **向后兼容**：`tenantContextOptional` 保留 `X-Tenant-Id` 头 / `body.tenant_id` 显式路径 → CI smoke、agent 直调、桌面 agent 全部照常。
- **第一刀边界**：只 1 关键词「麻婆豆腐」；**不做**视频抓 list、不做视频维度回传（`video-search-result`）、不做多关键词/自动选词；`/keyword-tasks` 列表**砍掉"视频数/Lead 数"两列**（A 表无直接计数，防 scope 爆炸）。

---

## 根因（已实证复现）

`POST /api/acquisition/keyword-search`(`acquisition.ts:31`) 没挂任何 tenant 中间件，只手读 `X-Tenant-Id` 头 / `body.tenant_id`（都没有就写 `null`）。浏览器裸 fetch 不传这两者 → 任务 `acquisition_keyword_tasks.tenant_id = NULL`。安卓拉取端 `pending-keyword-tasks`(`acquisition.ts:118`) 用 `WHERE tenant_id=$1`（按 `x-agent-license` 反查的租户）过滤 → NULL 任务永不匹配 → 安卓永远拉不到 → 手机不动。

复现证据（staging zenithjoy_test）：裸 body 建的任务 `tenant_id` 为空；以 Honor100 同 license 查 `pending-keyword-tasks` 拉到 **0 条**。

## 组件与数据流

```
浏览器(已登录, better-auth session cookie)
  │ POST /keyword-search {keyword:"麻婆豆腐"}   ← 同源裸 fetch, cookie 自动带
  ▼
keyword-search + tenantContextOptional         ← 【改1】挂中间件, req.tenantId 从 session 解析
  │ INSERT acquisition_keyword_tasks(tenant_id=真租户, status=dispatched)
  ▼
安卓 AcquisitionKeywordPollLoop (30s)
  │ GET /pending-keyword-tasks  header x-agent-license=license_key   ← agent 零改
  │ WHERE tenant_id=$1(反查) AND status=dispatched  → 拉到, 标 processing
  ▼
DouyinCollectService: 抖音搜关键词 → 第1条视频 → 抓评论
  │ POST /comment-score-result {keyword_task_id,...}  → acquisition_leads(按 task 反查租户)
  ▼
dashboard: LeadsPage GET /leads(看 Lead)  +  AcquisitionConfigPage GET /keyword-tasks(看任务在跑) ← 【改3】
```

前端列表对齐（【改2】+【改3】）：现状 `AcquisitionConfigPage` 提交去 `/keyword-search`（写 A 表）却 `load()` 读 `/collect-tasks`（读 B 表 `acquisition_collect_tasks`）→ 提交的任务永不出现在列表。新增只读 `GET /keyword-tasks`（挂 `tenantContextOptional`，`SELECT id,keyword,status,created_at FROM acquisition_keyword_tasks WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`，**不 mutate status**，区别于 agent 面向的 `pending-keyword-tasks`），前端 `load()` 改读它。

## 错误处理

- **无租户会话**（既无 cookie 也无显式头）→ `tenantContextOptional` 返回 401/403（与 `/leads` 一致）。这是本 P0 应有的行为收紧：`acquisition.test.ts` 中 2 个无头 200 用例（`:88`/`:97`）+ 1 个"无 header 写 null"回归（`:1028-1044`）需改为"补租户头 / 无租户→401"。
- **采集失败**（抖音没登录 / 搜不到 / 掉线）→ 任务标 `failed`，前端 `/keyword-tasks` 列表显示失败状态，用户知道重试。
- **license 无租户 / 余额为 0** → `pending-keyword-tasks` 静默返回空（既有行为）；真机验收时若安卓拉不到，先查 `licenses.tenant_id` 与 `tenant_credits.balance>0`。

## 测试策略

- **复现 failing test（先写，RED）**：模拟浏览器"有 session、无显式 X-Tenant-Id 头"发 `/keyword-search` → 现状 handler 不解析 session → 任务 `tenant_id=NULL` → 同租户 agent 身份查 `pending-keyword-tasks` 拉到 0 条（RED）。挂中间件后 → 解析出租户 → 拉到 1 条（GREEN）。永久留 CI。
- **integration/unit**：(a) `keyword-search` 挂中间件后从 `X-Tenant-Id` 头 / session 解析租户写库；(b) `pending-keyword-tasks` 只返回同租户 dispatched 任务；(c) 新增 `GET /keyword-tasks` 只列本租户任务、不跨租户、不 mutate status；(d) 收紧后的 3 个无头用例（无租户→401）。
- **smoke.sh**（`.github/workflows/scripts/smoke/keyword-collect-mainline-smoke.sh`，真库端到端）：curl 带 `X-Tenant-Id` 建 keyword 任务 → `pending-keyword-tasks`（带 `x-agent-license`）拉到该任务 → `POST /comment-score-result` 回传 1 个评论者 → 查 `acquisition_leads` 落库且 `tenant_id` 正确。
- **E2E（Honor100 真机手动，用户在场验收）**：staging 网页输入「麻婆豆腐」点搜索 → 手机被唤醒搜索→点第1条视频→抓评论→出 Lead→Lead 页展示 → 第4步真发 1 条触达（企微号由用户提供）。这是采集真机接缝，CI 测不到，靠真机验收兜底。

## 不包含（下一刀）

视频抓 list、视频维度回传写库（TasksPage 视频卡）、多关键词/自动选词、`/keyword-tasks` 的视频数/Lead 数聚合列。
