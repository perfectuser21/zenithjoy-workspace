# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: api_registry推导 + PRD字面）

现有端点约定（来自 acquisition.ts / agent-burner.ts）：
```json
{ "success": true, "data": {...}, "timestamp": "<ISO string>" }
```

### Endpoint: GET /api/acquisition/collect-tasks/:id/videos
**来源**: 新建端点（PRD "新建 GET /api/acquisition/collect-tasks/:id/videos"）

**Success (HTTP 200)**:
```json
{
  "success": true,
  "data": {
    "videos": [
      {
        "video_id": "<string>",
        "task_id": "<uuid>",
        "title": "<string|null>",
        "thumbnail_url": "<string|null>",
        "publish_date": "<string(ISO)|null>",
        "comment_count": "<number>"
      }
    ],
    "total": "<number>"
  },
  "timestamp": "<ISO string>"
}
```
- `success` (boolean, 必填)：固定 true
- `data.videos` (array, 必填)：视频卡片列表
- `data.videos[].video_id` (string, 必填)：抖音视频 ID
- `data.videos[].title` (string|null, 必填)：标题，抓取失败为 null
- `data.videos[].thumbnail_url` (string|null, 必填)：封面 URL，抓取失败为 null
- `data.videos[].publish_date` (string|null, 必填)：发布日期 ISO 字符串，失败为 null
- `data.videos[].comment_count` (number, 必填)：评论数
- `data.total` (number, 必填)：视频总数
- `timestamp` (string, 必填)：ISO 时间戳

**禁用字段名**: `videoList`、`items`、`results`、`video_list`（统一用 `videos`）

**Error (HTTP 403/401/404)**:
```json
{ "success": false, "error": { "code": "<string>", "message": "<string>" }, "timestamp": "<string>" }
```

---

### Endpoint: GET /api/acquisition/videos/:videoId/leads
**来源**: 新建端点（PRD "新建 GET /api/acquisition/videos/:videoId/leads"）

**Success (HTTP 200)**:
```json
{
  "success": true,
  "data": {
    "leads": [
      {
        "commenter_id": "<string>",
        "comment_text": "<string>",
        "source_video_url": "<string>",
        "crawled_at": "<string(ISO)>",
        "grade": "<string>",
        "keyword": "<string>",
        "profile_url": "<string|null>"
      }
    ],
    "total": "<number>"
  },
  "timestamp": "<ISO string>"
}
```
- `data.leads` (array, 必填)：leads 列表，空时返回 `[]`
- `data.total` (number, 必填)：leads 总数

**禁用字段名**: `comments`、`results`、`items`（统一用 `leads`）

**Error (HTTP 403/401/404)**:
```json
{ "success": false, "error": { "code": "<string>", "message": "<string>" }, "timestamp": "<string>" }
```

---

## 已知约束（来自回归测试）

来源：`apps/api/src/routes/acquisition.test.ts`、`apps/dashboard/e2e/acquisition-collect.spec.ts`

- [acquisition.test.ts] → GET /api/acquisition/overview 返回 `{enabled,feature,capabilities,version}` 四字段
- [acquisition.test.ts] → POST /api/acquisition/collect/start：缺 keywords 返 400 MISSING_KEYWORDS
- [acquisition.test.ts] → POST /api/acquisition/collect/start：keywords 非空数组成功返 task_id + status=pending
- [acquisition-collect.spec.ts] → LeadsPage 有 `[data-testid=acq-collect-button]`（本 Sprint 迁移后需保留或同步删除）

> ⚠️ 注意：`acquisition-collect.spec.ts` 使用了 `page.route()` 全量 stub（历史问题）。本 Sprint 新增的 `acquisition-ia.spec.ts` 禁止使用 `page.route()`，须打真实后端。原有 spec 的 LeadsPage 采集面板 E2E 将随 LeadsPage 改动失效——LeadsPage 移除采集面板后，需同步删除或修改原有 spec 中相关断言（属 Generator 职责）。

---

## Golden Path

```
[客户打开工作台] → [Hub 展示4模块入口卡片] → [点账号管理] → [AccountsPage 小号列表+绑定]
              → [点采集任务] → [TasksPage 任务列表] → [点任务行] → [视频卡片列表]
              → [展开视频卡片] → [leads 列表]
              → [失败态] → [展示原因+重新采集]
```

---

### Step 1: 客户点左侧「智能获客」→ Hub 页 4 模块卡片可见，账号/采集卡片显示实时数字

**来源**: `[FROM_PRD]` — PRD Golden Path Step 1 "看到4个模块卡片（账号管理/采集任务/客户分析-占位/触达中心-占位），账号+采集卡片显示本 tenant 实时数字（小号数/任务数）"

**可观测行为**:
- 路由 `/area/acquisition` 渲染 `AcquisitionHubPage`
- 4张模块卡片可见：账号管理、采集任务、客户分析（占位）、触达中心（占位）
- 账号管理卡片数字 = 该 tenant 已绑小号数（来自 GET /api/agent/burner/sessions）
- 采集任务卡片数字 = 该 tenant 任务数（来自 GET /api/acquisition/collect-tasks）
- 客户分析/触达中心 卡片显示「敬请期待」或占位文案，无跳转链接

**验证命令**:
```bash
# API 侧：burner sessions 返回 success 且含 sessions 数组
BURNER=$(curl -sf -H "X-Tenant-Id: $TEST_TENANT" localhost:3000/api/agent/burner/sessions)
echo "$BURNER" | jq -e '.success == true and (.data.sessions | type == "array")' || { echo "FAIL: burner sessions API"; exit 1; }

# API 侧：collect-tasks 返回 success 且含 total 数字
TASKS=$(curl -sf -H "X-Tenant-Id: $TEST_TENANT" localhost:3000/api/acquisition/collect-tasks)
echo "$TASKS" | jq -e '.success == true and (.data.total | type == "number")' || { echo "FAIL: collect-tasks API"; exit 1; }
echo "✅ Step 1 Hub API 验证通过"
```

**硬阈值**: 两个 API 均返回 HTTP 200 + success=true；cards 数字类型为 number

---

### Step 2: 客户点「账号管理」→ AccountsPage 渲染小号列表（健康状态三色）

**来源**: `[FROM_PRD]` — PRD Golden Path Step 2 "路由跳转 /area/acquisition/accounts → 看到本 tenant 已绑小号列表（昵称/绑定时间/健康状态 ok|expired|banned）"

**可观测行为**:
- URL 变为 `/area/acquisition/accounts`
- 渲染 `AccountsPage` 组件（新建）
- 有小号时：显示表格行（account_nickname / bound_at / 健康状态徽章）
- 健康状态映射：status=active → 绿色"ok"；status=needs_rebind → 黄色"expired"；status=banned → 红色"banned"
- 无小号时：显示引导空态文案 + 「绑定新小号」按钮

**验证命令**:
```bash
# GET /api/agent/burner/sessions 返回 data.sessions 且每项含必要字段
RESP=$(curl -sf -H "X-Tenant-Id: $TEST_TENANT" localhost:3000/api/agent/burner/sessions)
echo "$RESP" | jq -e '.success == true' || { echo "FAIL: sessions API"; exit 1; }
echo "$RESP" | jq -e '.data | has("sessions")' || { echo "FAIL: missing sessions field"; exit 1; }

# 有数据时验证字段存在
COUNT=$(echo "$RESP" | jq '.data.sessions | length')
if [ "$COUNT" -gt 0 ]; then
  echo "$RESP" | jq -e '.data.sessions[0] | has("account_label") and has("status") and has("bound_at")' || { echo "FAIL: session entry missing fields"; exit 1; }
fi
echo "✅ Step 2 AccountsPage API 验证通过"
```

**硬阈值**: data.sessions 是数组；每项含 account_label、status、bound_at

---

### Step 3: 客户点「绑定新小号」→ 弹二维码；N=10 上限→ 按钮置灰

**来源**: `[FROM_PRD]` — PRD Golden Path Step 3 "已达 N=10 上限 → 按钮置灰+提示升级套餐；否则弹二维码 → 扫码成功 → 列表新增一行；超时/失败 → toast 提示重试"

**可观测行为**:
- sessions.length < 10：按钮可点，点击触发 POST /api/agent/burner/qr-bind，弹出二维码
- sessions.length >= 10：按钮 disabled，tooltip 显示套餐提示
- 前端按 length 判断上限，API 侧不强制校验（PRD thin 阶段假设）

**验证命令**:
```bash
# 验证 qr-bind 端点可到达（不伪造完整绑定流程，仅确认路由注册）
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TEST_TENANT" \
  -H "X-Agent-Id: $TEST_AGENT" \
  -d '{"account_label":"e2e-test-bind"}' \
  localhost:3000/api/agent/burner/qr-bind)
# qr-bind 路由存在：期望 200 或 4xx（取决于 agent/task 是否预置），不允许 404（路由未注册）
[ "$CODE" != "404" ] || { echo "FAIL: qr-bind 路由未注册 CODE=$CODE"; exit 1; }
echo "✅ Step 3 qr-bind 路由验证通过 CODE=$CODE"
```

**硬阈值**: POST /api/agent/burner/qr-bind 不返回 404（路由注册确认）

---

### Step 4: 客户点「采集任务」→ TasksPage 一级：关键词输入框 + 任务列表（来自 acquisition_collect_tasks）

**来源**: `[FROM_PRD]` — PRD Golden Path Step 4 "路由跳转 /area/acquisition/tasks → 看到关键词输入框 + 本 tenant 历史任务列表（关键词/状态/视频数/leads数/创建时间） → 数据来源 acquisition_collect_tasks（非旧 keyword_tasks）"

**可观测行为**:
- URL 变为 `/area/acquisition/tasks`
- 渲染 `TasksPage` 一级视图（新建/重构）
- 页面含关键词输入框 + 「开始采集」按钮
- 任务列表来自 GET /api/acquisition/collect-tasks（返回字段：keywords, status, video_count, lead_count_raw, created_at）

**验证命令**:
```bash
# collect-tasks 返回 data.tasks 数组，每项含 status 和 created_at
RESP=$(curl -sf -H "X-Tenant-Id: $TEST_TENANT" localhost:3000/api/acquisition/collect-tasks)
echo "$RESP" | jq -e '.success == true and (.data.tasks | type == "array")' || { echo "FAIL: collect-tasks API"; exit 1; }

# 若有任务，验证每项字段
LEN=$(echo "$RESP" | jq '.data.tasks | length')
if [ "$LEN" -gt 0 ]; then
  echo "$RESP" | jq -e '.data.tasks[0] | has("id") and has("keywords") and has("status") and has("video_count") and has("lead_count_raw") and has("created_at")' || { echo "FAIL: task entry missing fields"; exit 1; }
fi
echo "✅ Step 4 TasksPage collect-tasks API 验证通过"
```

**硬阈值**: data.tasks 是数组；有任务时每项含 id/keywords/status/video_count/lead_count_raw/created_at

---

### Step 5: 客户输入关键词 → 点「开始采集」→ POST /collect/start → 新任务出现

**来源**: `[FROM_PRD]` — PRD Golden Path Step 5 "点「开始采集」→ POST /collect/start → 列表出现新任务 pending/running；触发失败 → toast 报错"

**可观测行为**:
- POST /api/acquisition/collect/start 成功：返回 { task_id, status:"pending" }
- 列表实时（或刷新后）出现新任务行，status 显示 pending/running
- 失败（无小号/agent 离线）：返回 503，前端 toast 报错

**验证命令**:
```bash
# 测试新建任务（带时间窗口防造假）
RESP=$(curl -sf -X POST \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TEST_TENANT" \
  -d '{"keywords":["e2e-test-keyword"]}' \
  localhost:3000/api/acquisition/collect/start)
echo "$RESP" | jq -e '.success == true and (.data.task_id | type == "string") and .data.status == "pending"' || { echo "FAIL: collect/start schema"; exit 1; }

NEW_TASK_ID=$(echo "$RESP" | jq -r '.data.task_id')

# 验证 DB 写入（带时间窗口，防历史记录造假）
COUNT=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM zenithjoy.acquisition_collect_tasks WHERE id='$NEW_TASK_ID' AND status='pending' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$COUNT" -ge 1 ] || { echo "FAIL: DB 无 pending 任务记录（时间窗口内）"; exit 1; }
echo "✅ Step 5 collect/start + DB 验证通过"
```

**硬阈值**: POST /collect/start → success=true + task_id(string) + status="pending"；DB 有对应行（created_at 5分钟内）

---

### Step 6: 客户点任务行 → 路由跳转 TasksPage 二级 → 视频卡片列表（新 API）

**来源**: `[FROM_PRD]` — PRD Golden Path Step 6 "路由跳转 /area/acquisition/tasks/:taskId → 看到该任务下视频卡片列表（标题/封面/日期，回填失败降级只显示视频链接） → 数据来源 GET /api/acquisition/collect-tasks/:id/videos（新建，tenant过滤+IDOR校验）"

**可观测行为**:
- URL 变为 `/area/acquisition/tasks/:taskId`
- 渲染视频卡片：有 title/thumbnail_url/publish_date 时展示；任一为 null → 降级显示视频链接 URL
- 数据来自新建端点 GET /api/acquisition/collect-tasks/:id/videos

**验证命令**:
```bash
# 新端点存在且返回正确 schema（使用上一步建的任务）
RESP=$(curl -sf -H "X-Tenant-Id: $TEST_TENANT" "localhost:3000/api/acquisition/collect-tasks/${NEW_TASK_ID}/videos")
echo "$RESP" | jq -e '.success == true' || { echo "FAIL: collect-tasks/:id/videos 未返回 success=true"; exit 1; }
echo "$RESP" | jq -e '.data | (has("videos") and has("total"))' || { echo "FAIL: missing videos/total fields"; exit 1; }
echo "$RESP" | jq -e '.data.videos | type == "array"' || { echo "FAIL: videos not array"; exit 1; }
echo "$RESP" | jq -e '.data.total | type == "number"' || { echo "FAIL: total not number"; exit 1; }

# keys 完整性（有视频时）
VIDEO_COUNT=$(echo "$RESP" | jq '.data.videos | length')
if [ "$VIDEO_COUNT" -gt 0 ]; then
  echo "$RESP" | jq -e '.data.videos[0] | has("video_id") and has("title") and has("thumbnail_url") and has("publish_date") and has("comment_count")' || { echo "FAIL: video entry missing fields"; exit 1; }
fi

# 禁用字段反向检查
echo "$RESP" | jq -e '.data | has("videoList") | not' || { echo "FAIL: 禁用字段 videoList 出现"; exit 1; }
echo "$RESP" | jq -e '.data | has("items") | not' || { echo "FAIL: 禁用字段 items 出现"; exit 1; }
echo "✅ Step 6 collect-tasks/:id/videos schema 验证通过"
```

**硬阈值**: 200 + success=true + data.videos(array) + data.total(number)；无禁用字段名

---

### Step 6b: IDOR 校验 — 跨 tenant 访问视频接口 → 403

**来源**: `[AI_ADDED]` — GAN Round 1 防 IDOR 漏洞，PRD 明确要求 "tenant过滤+IDOR校验"

**可观测行为**: 用 tenant B 的凭据访问 tenant A 的任务 ID → 403；非法 taskId → 404

**验证命令**:
```bash
# IDOR：用不同 tenant 访问（期望 403）
IDOR_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Tenant-Id: $OTHER_TENANT" \
  "localhost:3000/api/acquisition/collect-tasks/${NEW_TASK_ID}/videos")
[ "$IDOR_CODE" = "403" ] || [ "$IDOR_CODE" = "401" ] || { echo "FAIL: IDOR 未拦截 CODE=$IDOR_CODE"; exit 1; }

# 非法 taskId → 404
NOT_FOUND_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Tenant-Id: $TEST_TENANT" \
  "localhost:3000/api/acquisition/collect-tasks/00000000-0000-0000-0000-000000000000/videos")
[ "$NOT_FOUND_CODE" = "404" ] || { echo "FAIL: 非法ID未返回404 CODE=$NOT_FOUND_CODE"; exit 1; }
echo "✅ Step 6b IDOR + 404 验证通过"
```

**硬阈值**: 跨 tenant 访问 → 403/401；非法 UUID → 404

---

### Step 7: 客户展开视频卡片 → leads 列表（新 API）；无评论 → 占位文案

**来源**: `[FROM_PRD]` — PRD Golden Path Step 7 "看到该视频命中的 leads 列表（昵称/留言/AI分级占位/触达状态占位） → 数据来源 GET /api/acquisition/videos/:videoId/leads（新建，tenant过滤+IDOR校验）→ 评论为空 → 「暂无评论」占位文案"

**可观测行为**:
- GET /api/acquisition/videos/:videoId/leads 返回 { success, data: { leads: [...], total } }
- leads=[] 时前端显示「暂无评论」
- 跨 tenant 访问 → 403

**验证命令**:
```bash
# 测试用 video_id（E2E 前预置或使用 seed video_id）
TEST_VIDEO_ID="${E2E_TEST_VIDEO_ID:-e2e-video-001}"

# 新端点 schema 验证
RESP=$(curl -sf -H "X-Tenant-Id: $TEST_TENANT" "localhost:3000/api/acquisition/videos/${TEST_VIDEO_ID}/leads")
echo "$RESP" | jq -e '.success == true' || { echo "FAIL: videos/:videoId/leads 未返回 success=true"; exit 1; }
echo "$RESP" | jq -e '.data | (has("leads") and has("total"))' || { echo "FAIL: missing leads/total"; exit 1; }
echo "$RESP" | jq -e '.data.leads | type == "array"' || { echo "FAIL: leads not array"; exit 1; }
echo "$RESP" | jq -e '.data.total | type == "number"' || { echo "FAIL: total not number"; exit 1; }

# 禁用字段反向检查
echo "$RESP" | jq -e '.data | has("comments") | not' || { echo "FAIL: 禁用字段 comments 出现"; exit 1; }

# IDOR 检查
IDOR_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Tenant-Id: $OTHER_TENANT" \
  "localhost:3000/api/acquisition/videos/${TEST_VIDEO_ID}/leads")
[ "$IDOR_CODE" = "403" ] || [ "$IDOR_CODE" = "401" ] || [ "$IDOR_CODE" = "404" ] || { echo "FAIL: leads IDOR 未拦截 CODE=$IDOR_CODE"; exit 1; }
echo "✅ Step 7 videos/:videoId/leads schema + IDOR 验证通过"
```

**硬阈值**: 200 + success=true + data.leads(array) + data.total(number)；跨 tenant 返回 403/401

---

### Step 8: 任务失败态 → 前端展示失败原因 + 「重新采集」按钮（复用 POST /collect/start）

**来源**: `[FROM_PRD]` — PRD Golden Path Step 8 "任务长时间无进展（sweep-timeouts 已转失败态）→ 前端展示失败原因 + 「重新采集」按钮（复用 POST /collect/start 同关键词）"

**可观测行为**:
- GET /api/acquisition/collect-tasks 中任务 status='failed' 时，前端显示失败原因（error_code 字段映射友好文案）
- 「重新采集」按钮点击 → 同关键词再次 POST /collect/start

**验证命令**:
```bash
# sweep-timeouts 将 running 任务超时转 failed（验证端点存在）
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Authorization: Bearer $SMOKE_TOKEN" \
  localhost:3000/api/acquisition/collect/sweep-timeouts)
# 期望 200（或 4xx 若无 smoke token 环境），不允许 404（路由未注册）
[ "$CODE" != "404" ] || { echo "FAIL: sweep-timeouts 路由未注册 CODE=$CODE"; exit 1; }
echo "✅ Step 8 sweep-timeouts 路由验证通过 CODE=$CODE"
```

**硬阈值**: POST /collect/sweep-timeouts 不返回 404

---

### Step 9: LeadsPage 移除采集面板 DOM 节点

**来源**: `[FROM_PRD]` — PRD "范围限定: LeadsPage 移除采集面板，只留历史 leads 表格"

**可观测行为**:
- `/dashboard/leads` 页面不再渲染采集面板（`data-testid=acq-collect-button` 不存在）
- 历史 leads 表格（AG Grid）正常渲染

**验证命令**:
```bash
# 验证 LeadsPage.tsx 源文件中不包含 acq-collect-button（静态检查）
node -e "
const c = require('fs').readFileSync('apps/dashboard/src/pages/LeadsPage.tsx','utf8');
if (c.includes('acq-collect-button')) process.exit(1);
console.log('✅ LeadsPage 无采集面板 DOM');
" || { echo "FAIL: LeadsPage 仍含采集面板"; exit 1; }
```

**硬阈值**: LeadsPage.tsx 不含 `acq-collect-button` 字符串

---

### Step 10: acquisition_collect_videos 表 migration 存在且结构正确

**来源**: `[FROM_PRD]` — PRD "新建 acquisition_collect_videos 表（video_id/task_id/tenant_id/title/thumbnail_url/publish_date/comment_count）"

**可观测行为**:
- 有 migration SQL 文件建表
- 表含 PRD 指定列；video_id 为主键；task_id FK → acquisition_collect_tasks

**验证命令**:
```bash
# migration 文件存在且含必要列名
node -e "
const {readdirSync, readFileSync} = require('fs');
const dir = 'apps/api/src/db/migrations';
const files = readdirSync(dir).filter(f => f.includes('collect_videos') || f.includes('acquisition_videos'));
if (!files.length) { console.error('FAIL: 无 acquisition_collect_videos migration 文件'); process.exit(1); }
const content = readFileSync(dir + '/' + files[0], 'utf8');
const required = ['video_id','task_id','tenant_id','title','thumbnail_url','publish_date','comment_count'];
const missing = required.filter(col => !content.includes(col));
if (missing.length) { console.error('FAIL: migration 缺列', missing); process.exit(1); }
console.log('✅ migration 文件验证通过', files[0]);
"
```

**硬阈值**: migration 文件存在，含 PRD 要求的 7 个列名

---

## 接缝清单（1-3 条）

| # | 接缝点 | 碰真实世界的位置 | 真目标验证方式 |
|---|---|---|---|
| 1 | DB 表 acquisition_collect_videos | 生产 hk-vps/mmv PostgreSQL | psql 在真实 DB 执行 migration，`\d zenithjoy.acquisition_collect_videos` 确认表结构 |
| 2 | agent DOM 选择器（title/thumbnail/publish_date） | 抖音真实网页 DOM | 在 xian-rog 运行 agent 抓一个真实视频，DB 记录有非 null 的 title/thumbnail_url（手工验，非 CI）|
| 3 | IDOR 多租户隔离 | 生产两 tenant 数据共存 | 用两组真实 E2E tenant 凭据互访，确认 403（windows_cloud E2E 用 E2E_SUPER_ADMIN 的两 tenant 账号）|

以上 #2 在 CI 无法验（真实抖音 DOM），标 `logic-done-pending`。#1 和 #3 在 E2E 验证中覆盖。

---

## E2E 验收（windows_cloud 变体C — GitHub Actions + Playwright + 真实后端）

**journey_type**: user_facing
**target_environment**: windows_cloud

> ⚠️ 本 Sprint E2E 使用 **变体C**（Dashboard Playwright）。所有 `page.route()` 禁止使用；Playwright spec 打真实后端（localhost:3000）。与旧 `acquisition-collect.spec.ts`（全量 stub）不同，本 spec 必须跑真实 API。

<!-- GOLDEN_SMOKE_ABILITY_SLUG: acquisition-ia-redesign -->
<!-- GOLDEN_SMOKE_TARGET_ENV: windows_cloud -->
<!-- GOLDEN_SMOKE_SKIP_IN_CI: true -->

### Scenario 1: Hub页4卡片可见且API就绪
<!-- GOLDEN_SMOKE_SCENARIO: hub-4-cards-visible -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 60000 -->

```bash
#!/bin/bash
set -e
# 验证 Hub 相关 API 就绪（不依赖 Playwright，只验 API）
BRAIN_URL="${BRAIN_URL:-http://localhost:3000}"
TEST_TENANT="${E2E_TEST_TENANT_ID:-e2e-tenant-001}"

RESP=$(curl -sf -H "X-Tenant-Id: $TEST_TENANT" "$BRAIN_URL/api/agent/burner/sessions")
echo "$RESP" | jq -e '.success == true and (.data.sessions | type == "array")' || { echo "FAIL: burner/sessions"; exit 1; }

RESP2=$(curl -sf -H "X-Tenant-Id: $TEST_TENANT" "$BRAIN_URL/api/acquisition/collect-tasks")
echo "$RESP2" | jq -e '.success == true and (.data.tasks | type == "array")' || { echo "FAIL: collect-tasks"; exit 1; }

echo "✅ Scenario 1 通过"
```

### Scenario 2: 新建API端点collect-tasks/:id/videos schema验证
<!-- GOLDEN_SMOKE_SCENARIO: collect-tasks-id-videos-schema -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 60000 -->

```bash
#!/bin/bash
set -e
BRAIN_URL="${BRAIN_URL:-http://localhost:3000}"
TEST_TENANT="${E2E_TEST_TENANT_ID:-e2e-tenant-001}"
DATABASE_URL="${DATABASE_URL:-$E2E_DATABASE_URL}"

# 先建一个测试任务
TASK_RESP=$(curl -sf -X POST \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TEST_TENANT" \
  -d '{"keywords":["e2e-smoke-test"]}' \
  "$BRAIN_URL/api/acquisition/collect/start")
echo "$TASK_RESP" | jq -e '.success == true' || { echo "FAIL: collect/start"; exit 1; }
TASK_ID=$(echo "$TASK_RESP" | jq -r '.data.task_id')

# 验新端点
RESP=$(curl -sf -H "X-Tenant-Id: $TEST_TENANT" "$BRAIN_URL/api/acquisition/collect-tasks/$TASK_ID/videos")
echo "$RESP" | jq -e '.success == true' || { echo "FAIL: collect-tasks/:id/videos"; exit 1; }
echo "$RESP" | jq -e '.data | (has("videos") and has("total"))' || { echo "FAIL: missing videos/total"; exit 1; }
echo "$RESP" | jq -e '.data.videos | type == "array"' || { echo "FAIL: videos not array"; exit 1; }
echo "$RESP" | jq -e '.data | has("videoList") | not' || { echo "FAIL: 禁用字段 videoList"; exit 1; }

echo "✅ Scenario 2 通过"
```

### Scenario 3: 新建API端点videos/:videoId/leads schema + IDOR验证
<!-- GOLDEN_SMOKE_SCENARIO: videos-videoid-leads-idor -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 60000 -->

```bash
#!/bin/bash
set -e
BRAIN_URL="${BRAIN_URL:-http://localhost:3000}"
TEST_TENANT="${E2E_TEST_TENANT_ID:-e2e-tenant-001}"
OTHER_TENANT="${E2E_OTHER_TENANT_ID:-e2e-tenant-002}"

# 先拿一个已知 task_id（此处用 Scenario 2 创建的，但 golden-smoke 要自包含，需重建）
TASK_RESP=$(curl -sf -X POST \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TEST_TENANT" \
  -d '{"keywords":["e2e-idor-test"]}' \
  "$BRAIN_URL/api/acquisition/collect/start")
TASK_ID=$(echo "$TASK_RESP" | jq -r '.data.task_id')

# videos/:videoId/leads（空任务下无视频，用不存在视频 ID 测）
RESP=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Tenant-Id: $TEST_TENANT" \
  "$BRAIN_URL/api/acquisition/videos/e2e-nonexistent/leads")
# 空视频 → 404 或 200({leads:[]})，不允许 500
[ "$RESP" != "500" ] || { echo "FAIL: videos/:id/leads 返 500"; exit 1; }

# IDOR：用 OTHER_TENANT 访问 TEST_TENANT 的任务 videos
IDOR_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Tenant-Id: $OTHER_TENANT" \
  "$BRAIN_URL/api/acquisition/collect-tasks/$TASK_ID/videos")
[ "$IDOR_CODE" = "401" ] || [ "$IDOR_CODE" = "403" ] || { echo "FAIL: IDOR 未拦截 CODE=$IDOR_CODE"; exit 1; }

echo "✅ Scenario 3 通过"
```

---

### Playwright Spec — `apps/dashboard/e2e/acquisition-ia.spec.ts`

```typescript
/**
 * Sprint 07021006 — AcquisitionHubPage IA 重设计 E2E
 *
 * 规则：禁止 page.route()。所有 API 调用打真实后端（localhost:3000）。
 * 前置：e2e-verify.ps1 已在 psql 中 seed 测试数据（test_tenant + burner session + collect task）
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5174';
const TEST_TENANT = process.env.E2E_TEST_TENANT_ID ?? '';

test.beforeEach(async ({ page }) => {
  // 注入 tenant 上下文 cookie（不 stub auth，dashboard 用 VITE_SKIP_AUTH=true 跳过登录检查）
  await page.context().addCookies([
    { name: 'x-tenant-id', value: TEST_TENANT, url: BASE_URL },
  ]);
});

test('Hub页展示4个模块卡片', async ({ page }) => {
  await page.goto(`${BASE_URL}/area/acquisition`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'e2e/screenshots/01-hub.png', fullPage: true });

  await expect(page.getByTestId('hub-card-accounts')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('hub-card-tasks')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('hub-card-analytics')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('hub-card-outreach')).toBeVisible({ timeout: 5_000 });

  // 账号/采集卡片数字是数值（非 NaN/undefined）
  const accountsNum = await page.getByTestId('hub-card-accounts-count').textContent();
  expect(Number(accountsNum?.trim())).toBeGreaterThanOrEqual(0);
  const tasksNum = await page.getByTestId('hub-card-tasks-count').textContent();
  expect(Number(tasksNum?.trim())).toBeGreaterThanOrEqual(0);
});

test('AccountsPage 渲染小号列表或空态', async ({ page }) => {
  await page.goto(`${BASE_URL}/area/acquisition/accounts`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'e2e/screenshots/02-accounts.png', fullPage: true });

  // 有数据时 or 空态 — 两者都合法，但容器必须可见
  const hasList = await page.getByTestId('accounts-list').isVisible().catch(() => false);
  const hasEmpty = await page.getByTestId('accounts-empty').isVisible().catch(() => false);
  expect(hasList || hasEmpty).toBe(true);

  // 「绑定新小号」按钮必须存在（可能 disabled）
  await expect(page.getByTestId('bind-new-account-btn')).toBeVisible({ timeout: 5_000 });
});

test('TasksPage 一级渲染关键词输入框 + 任务列表', async ({ page }) => {
  await page.goto(`${BASE_URL}/area/acquisition/tasks`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'e2e/screenshots/03-tasks.png', fullPage: true });

  await expect(page.getByTestId('keyword-input')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('start-collect-btn')).toBeVisible({ timeout: 5_000 });
  // 任务列表容器可见（空时也要渲染容器）
  await expect(page.getByTestId('tasks-list')).toBeVisible({ timeout: 5_000 });
});

test('LeadsPage 不再含采集面板', async ({ page }) => {
  await page.goto(`${BASE_URL}/dashboard/leads`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'e2e/screenshots/04-leads.png', fullPage: true });

  // 采集面板按钮应不存在
  const collectBtn = page.getByTestId('acq-collect-button');
  await expect(collectBtn).toBeHidden({ timeout: 5_000 }).catch(async () => {
    // 如果 hidden 检查不支持，fallback 用 count
    const count = await collectBtn.count();
    expect(count).toBe(0);
  });

  // leads 表格容器必须存在
  await expect(page.locator('.ag-root-wrapper, [data-testid="leads-table"]')).toBeVisible({ timeout: 10_000 });
});
```

---

### e2e-verify.ps1（位于 `sprints/07021006-acquisition-ia-redesign/e2e-verify.ps1`）

```powershell
# final-e2e 验证脚本 — ZenithJoy Dashboard Playwright（windows-latest）
# 变体C 死规则：禁止 page.route()，必须启动真实后端
param(
  [string]$BaseUrl = "http://localhost:5174",
  [string]$SuperAdminEmail = $env:E2E_SUPER_ADMIN_EMAIL,
  [string]$SuperAdminPassword = $env:E2E_SUPER_ADMIN_PASSWORD,
  [string]$DatabaseUrl = $env:E2E_DATABASE_URL,
  [string]$TestTenantId = $env:E2E_TEST_TENANT_ID
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VitePort = 5174
$ApiPort = 3000
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptDir\..\.."

# 1. 安装依赖
Write-Host "▶ npm ci..."
$r = Start-Process "cmd.exe" -ArgumentList "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($r.ExitCode -ne 0) { throw "FAIL: npm ci failed" }

# 2. Playwright 浏览器
$r2 = Start-Process "cmd.exe" -ArgumentList "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($r2.ExitCode -ne 0) { throw "FAIL: playwright install failed" }

# 3. Seed 测试数据（DB 预置 tenant + burner session + collect task）
Write-Host "▶ Seeding E2E test data..."
$seedSql = @"
DO `$`$
BEGIN
  -- seed test tenant (幂等)
  INSERT INTO zenithjoy.tenants (id, name, created_at)
  VALUES ('$TestTenantId', 'E2E Test Tenant', NOW())
  ON CONFLICT (id) DO NOTHING;
END
`$`$;
"@
$seedSql | psql $DatabaseUrl 2>&1 | Write-Host

# 4. 启动 API server
Write-Host "▶ Starting API server port $ApiPort..."
$env:DATABASE_URL = $DatabaseUrl
$env:NODE_ENV = "test"
$apiProc = Start-Process "cmd.exe" -ArgumentList "/c npm.cmd start" `
  -WorkingDirectory "$repoRoot\apps\api" -PassThru -NoNewWindow
$waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $ApiPort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt 30)
if (-not $conn.TcpTestSucceeded) { throw "FAIL: API server 未就绪 port=$ApiPort" }
Write-Host "✅ API server port=$ApiPort"

# 5. Build Dashboard（VITE_SKIP_AUTH=true 跳过登录，仍打真实 API）
Write-Host "▶ Building dashboard..."
$buildEnv = @{ VITE_SKIP_AUTH = "true"; VITE_API_URL = "http://localhost:$ApiPort" }
$r3 = Start-Process "cmd.exe" -ArgumentList "/c npm.cmd run build" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow -Environment $buildEnv
if ($r3.ExitCode -ne 0) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: dashboard build failed"
}

# 6. 启动 Vite preview
Write-Host "▶ Starting Vite preview port $VitePort..."
$serverProc = Start-Process "cmd.exe" -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -PassThru -NoNewWindow
$waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $conn2 = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
} while (-not $conn2.TcpTestSucceeded -and $waited -lt 30)
if (-not $conn2.TcpTestSucceeded) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: Vite 未就绪 port=$VitePort"
}
Write-Host "✅ Vite port=$VitePort"

# 7. 运行 Playwright（禁止 page.route()）
$e2eProc = Start-Process "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright test e2e\acquisition-ia.spec.ts --reporter=list" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow `
  -Environment @{
    E2E_BASE_URL = $BaseUrl
    E2E_TEST_TENANT_ID = $TestTenantId
  }

# 8. 归集截图
$screenshotDest = "$scriptDir\screenshots"
New-Item -ItemType Directory -Force -Path $screenshotDest | Out-Null
Copy-Item "$repoRoot\apps\dashboard\e2e\screenshots\*.png" -Destination $screenshotDest -ErrorAction SilentlyContinue

Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue

if ($e2eProc.ExitCode -ne 0) { throw "FAIL: Playwright E2E 失败 exit=$($e2eProc.ExitCode)" }
Write-Host "✅ windows_cloud Dashboard E2E 验证通过（真实后端）"
exit 0
```

**PASS 标准**: e2eProc.ExitCode = 0 + API server 已启动（无 page.route()）+ 4 张截图归集

**FAIL 标准**: 任何 step exit≠0 OR API 未就绪 OR Playwright 失败 OR page.route() 出现在 spec

**GHA Secrets 必须**: `E2E_SUPER_ADMIN_EMAIL`、`E2E_SUPER_ADMIN_PASSWORD`、`E2E_DATABASE_URL`、`E2E_TEST_TENANT_ID`、`E2E_OTHER_TENANT_ID`

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 新 API 端点 collect-tasks/:id/videos | `tests/acquisition-videos-api.test.ts` | schema/IDOR/404 | 端点未实现 → 路由 404 → ≥3 failures |
| 新 API 端点 videos/:videoId/leads | `tests/acquisition-videos-api.test.ts` | schema/IDOR/empty | 端点未实现 → ≥2 failures |
| acquisition_collect_videos DB migration | `tests/acquisition-videos-api.test.ts` | 表存在断言 | migration 未跑 → psql 查不到表 → 1 failure |
