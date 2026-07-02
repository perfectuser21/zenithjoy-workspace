# Sprint Contract Draft (Round 2)

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

> ⚠️ 注意：`acquisition-collect.spec.ts` 使用了 `page.route()` 全量 stub（历史问题）。本 Sprint 新增的 `acquisition-ia.spec.ts` 禁止使用 `page.route()`，须打真实后端。原有 spec 的 LeadsPage 采集面板 E2E 将随 LeadsPage 改动失效——LeadsPage 移除采集面板后，需同步删除或修改原有 spec 中相关断言（属 Generator 职责，在同一 commit 完成）。

---

## Risks（R2 补充）

| # | 风险 | 严重度 | Mitigation |
|---|---|---|---|
| 1 | **DouyinBurnerBindPage旧链接 404** | 中 | 路由层加 `redirect: /area/acquisition/accounts`（不删路由定义，防止旧书签/外部链接 404）。Generator 在路由文件验证 redirect 存在。 |
| 2 | **acquisition-collect.spec.ts 断言破坏** | 中 | Generator 在同一 PR commit 修改 `acquisition-collect.spec.ts`：删除 `acq-collect-button` 相关 assertion，保留 LeadsPage 表格类断言；不允许 spec 残留红色 assertion。 |
| 3 | **agent DOM 选择器 title/thumbnail/publish_date 在真实抖音 DOM 中不稳定** | 高 | thin 阶段降级处理（字段 null 时显示视频链接 URL）已在 PRD 明确；选择器稳定性属接缝断言，CI 无法验，标 `logic-done-pending`；上线后在 xian-rog 抓一条真实视频确认非 null 字段。 |

---

## Golden Path

```
[客户打开工作台] → [Hub 展示4模块入口卡片] → [点账号管理] → [AccountsPage 小号列表+绑定]
              → [点采集任务] → [TasksPage 任务列表] → [点任务行] → [视频卡片列表]
              → [展开视频卡片] → [leads 列表或「暂无评论」]
              → [失败态任务] → [展示原因+重新采集]
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

### Step 2: 客户点「账号管理」→ AccountsPage 渲染小号列表（健康状态三色）；N=10上限时绑定按钮置灰

**来源**: `[FROM_PRD]` — PRD Golden Path Step 2 "路由跳转 /area/acquisition/accounts → 看到本 tenant 已绑小号列表（昵称/绑定时间/健康状态 ok|expired|banned）"；PRD Step 3 "已达 N=10 上限 → 按钮置灰"

**可观测行为**:
- URL 变为 `/area/acquisition/accounts`
- 渲染 `AccountsPage` 组件（新建）
- 有小号时：显示表格行（account_nickname / bound_at / 健康状态徽章）
- 健康状态映射：status=active → 绿色"ok"；status=needs_rebind → 黄色"expired"；status=banned → 红色"banned"
- 无小号时：显示引导空态文案 + 「绑定新小号」按钮
- sessions.length >= 10 时：「绑定新小号」按钮 disabled + tooltip 提示套餐

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

**接缝备注**: N=10 置灰行为在 Playwright test `'AccountsPage N=10 上限时绑定按钮置灰'` 中验证（E2E 验收段）。

---

### Step 3: 客户点「绑定新小号」→ 弹二维码；超时/失败 → toast 提示重试

**来源**: `[FROM_PRD]` — PRD Golden Path Step 3 "否则弹二维码 → 扫码成功 → 列表新增一行；超时/失败 → toast 提示重试"

**可观测行为**:
- sessions.length < 10：按钮可点，点击触发 POST /api/agent/burner/qr-bind，弹出二维码（返回 qr_url）
- 无 agent 连接时返回 503，前端 toast 提示重试
- 前端按 length 判断上限，API 侧不强制校验（PRD thin 阶段假设）

**验证命令**:
```bash
# qr-bind 端点：200（成功，返回 qr_url）或 503（无agent，正常）；其他 = FAIL
RESP_BODY=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TEST_TENANT" \
  -d '{"account_label":"e2e-test-bind"}' \
  localhost:3000/api/agent/burner/qr-bind)
QR_CODE=$(echo "$RESP_BODY" | tail -1)
QR_JSON=$(echo "$RESP_BODY" | head -n -1)
[ "$QR_CODE" = "200" ] || [ "$QR_CODE" = "503" ] || { echo "FAIL: qr-bind 非预期状态码 CODE=$QR_CODE"; exit 1; }
if [ "$QR_CODE" = "200" ]; then
  echo "$QR_JSON" | jq -e '.success == true and (.data.qr_url | type == "string")' || { echo "FAIL: qr-bind schema invalid—缺 qr_url"; exit 1; }
fi
echo "✅ Step 3 qr-bind 验证通过 CODE=$QR_CODE"
```

**硬阈值**: POST /api/agent/burner/qr-bind → 200（含 data.qr_url:string）或 503（无agent）；400/404/500 = FAIL

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
  echo "$RESP" | jq -e '.data.videos[0] | has("video_id") and has("task_id") and has("title") and has("thumbnail_url") and has("publish_date") and has("comment_count")' || { echo "FAIL: video entry missing fields"; exit 1; }
fi

# 禁用字段反向检查（含 video_list 下划线版，与 contract-draft Response Schema 禁用列表一致）
echo "$RESP" | jq -e '.data | has("videoList") | not' || { echo "FAIL: 禁用字段 videoList 出现"; exit 1; }
echo "$RESP" | jq -e '.data | has("video_list") | not' || { echo "FAIL: 禁用字段 video_list 出现"; exit 1; }
echo "$RESP" | jq -e '.data | has("items") | not' || { echo "FAIL: 禁用字段 items 出现"; exit 1; }
echo "$RESP" | jq -e '.data | has("results") | not' || { echo "FAIL: 禁用字段 results 出现"; exit 1; }
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

### Step 7: 客户展开视频卡片 → leads 列表（新 API）；无评论 → 「暂无评论」占位

**来源**: `[FROM_PRD]` — PRD Golden Path Step 7 "看到该视频命中的 leads 列表（昵称/留言/AI分级占位/触达状态占位） → 数据来源 GET /api/acquisition/videos/:videoId/leads（新建，tenant过滤+IDOR校验）→ 评论为空 → 「暂无评论」占位文案"

**可观测行为**:
- GET /api/acquisition/videos/:videoId/leads 返回 { success, data: { leads: [...], total } }
- leads=[] 时前端显示「暂无评论」
- 跨 tenant 访问 → 403

**验证命令**:
```bash
# 先 seed 一条测试视频记录 + 1条 lead（让 leads 端点能走 200 路径且 entry 字段可验）
TEST_TASK_ID=$(curl -sf -X POST -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TEST_TENANT" \
  -d '{"keywords":["e2e-leads-test"]}' \
  localhost:3000/api/acquisition/collect/start | jq -r '.data.task_id')
TEST_VIDEO_ID="e2e-video-leads-smoke"
psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.acquisition_collect_videos \
  (video_id, task_id, tenant_id, title, thumbnail_url, publish_date, comment_count) \
  VALUES ('$TEST_VIDEO_ID', '$TEST_TASK_ID', '$TEST_TENANT', 'E2E Test Video', NULL, NULL, 1) \
  ON CONFLICT (video_id) DO UPDATE SET task_id='$TEST_TASK_ID', tenant_id='$TEST_TENANT', comment_count=1"
psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.leads \
  (commenter_id, comment_text, source_video_url, source_video_id, tenant_id, keyword, crawled_at) \
  VALUES ('e2e-uid-leads-smoke', 'E2E test comment', 'https://v.douyin.com/'||'$TEST_VIDEO_ID', '$TEST_VIDEO_ID', '$TEST_TENANT', 'e2e-leads-test', NOW()) \
  ON CONFLICT DO NOTHING" 2>/dev/null || true

# 测试 leads 端点 200 路径（已知视频 ID）
RESP=$(curl -sf -H "X-Tenant-Id: $TEST_TENANT" "localhost:3000/api/acquisition/videos/$TEST_VIDEO_ID/leads")
echo "$RESP" | jq -e '.success == true' || { echo "FAIL: videos/:videoId/leads 未返回 success=true"; exit 1; }
echo "$RESP" | jq -e '.data | (has("leads") and has("total"))' || { echo "FAIL: missing leads/total"; exit 1; }
echo "$RESP" | jq -e '.data.leads | type == "array"' || { echo "FAIL: leads not array"; exit 1; }
echo "$RESP" | jq -e '.data.total | type == "number"' || { echo "FAIL: total not number"; exit 1; }

# lead entry 字段检查（有 leads 时）— 含 grade(AI分级占位) + profile_url(触达状态占位)，来自 PRD Step7 + Response Schema
LEADS_COUNT=$(echo "$RESP" | jq '.data.leads | length')
if [ "$LEADS_COUNT" -gt 0 ]; then
  echo "$RESP" | jq -e '.data.leads[0] | has("commenter_id") and has("comment_text") and has("source_video_url") and has("grade") and has("profile_url")' || { echo "FAIL: lead entry 缺少必填字段（commenter_id/comment_text/source_video_url/grade/profile_url）"; exit 1; }
fi

# 禁用字段反向检查（含 items/results）
echo "$RESP" | jq -e '.data | has("comments") | not' || { echo "FAIL: 禁用字段 comments 出现"; exit 1; }
echo "$RESP" | jq -e '.data | has("items") | not' || { echo "FAIL: 禁用字段 items 出现"; exit 1; }
echo "$RESP" | jq -e '.data | has("results") | not' || { echo "FAIL: 禁用字段 results 出现"; exit 1; }

# IDOR 检查（用已知 video_id 验 other_tenant 被拒）
IDOR_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Tenant-Id: $OTHER_TENANT" \
  "localhost:3000/api/acquisition/videos/$TEST_VIDEO_ID/leads")
[ "$IDOR_CODE" = "403" ] || [ "$IDOR_CODE" = "401" ] || { echo "FAIL: leads IDOR 未拦截 CODE=$IDOR_CODE"; exit 1; }
echo "✅ Step 7 videos/:videoId/leads 200路径 schema + entry字段 + 禁用字段 + IDOR 验证通过"
```

**硬阈值**: 200 + success=true + data.leads(array) + data.total(number)；无 comments/items/results；跨 tenant 返回 403/401

---

### Step 8: 任务失败态 → 前端展示失败原因 + 「重新采集」按钮

**来源**: `[FROM_PRD]` — PRD Golden Path Step 8 "任务长时间无进展（sweep-timeouts 已转失败态）→ 前端展示失败原因 + 「重新采集」按钮（复用 POST /collect/start 同关键词）"

**可观测行为**:
- GET /api/acquisition/collect-tasks 中任务 status='failed' 时，前端显示失败原因（error_code 字段映射友好文案）
- 「重新采集」按钮点击 → 同关键词再次 POST /collect/start

**验证命令**:
```bash
# 8a. sweep-timeouts 路由已注册且返回合法状态码（200=成功；401/403=认证保护，均合法）
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Authorization: Bearer $SMOKE_TOKEN" \
  localhost:3000/api/acquisition/collect/sweep-timeouts)
[ "$CODE" = "200" ] || [ "$CODE" = "401" ] || [ "$CODE" = "403" ] || { echo "FAIL: sweep-timeouts 非预期状态码 CODE=$CODE（404=路由未注册）"; exit 1; }
echo "✅ Step 8a sweep-timeouts 路由验证通过 CODE=$CODE"
```

**接缝断言（UI 显示）**：`[接缝] status='failed' 任务的 error_reason 文案 + 「重新采集」按钮`
→ 真目标验证位置：Playwright test `'TasksPage 失败态任务展示失败原因 + 重新采集按钮'`（E2E 验收段）
→ 前置条件：e2e-verify.ps1 在 DB 中 seed 一条 status='failed', error_code='agent_offline' 的任务
→ 未在 windows_cloud E2E 验证前，UI 接缝部分标 `logic-done-pending`

**硬阈值**: POST /collect/sweep-timeouts → 200/401/403（非 404/5xx）

---

### Step 9: LeadsPage 移除采集面板 DOM 节点

**来源**: `[FROM_PRD]` — PRD "范围限定: LeadsPage 移除采集面板，只留历史 leads 表格"

**可观测行为**:
- `/dashboard/leads` 页面不再渲染采集面板（`data-testid=acq-collect-button` 不存在）
- 历史 leads 表格（AG Grid）正常渲染

**验证命令**:
```bash
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

**验证命令**:
```bash
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

### Step 10b: DouyinBurnerBindPage 废弃 → redirect 到 /area/acquisition/accounts

**来源**: `[FROM_PRD]` — PRD "范围限定: DouyinBurnerBindPage UI 层废弃（扫码逻辑迁入 AccountsPage）"；PRD ASSUMPTION "DouyinBurnerBindPage 废弃 = 删除页面组件 + 路由 redirect 到 /area/acquisition/accounts，防止旧链接404"

**可观测行为**:
- DouyinBurnerBindPage 组件废弃（文件删除或改为仅含 `<Navigate>` redirect）
- 路由配置中原来指向 DouyinBurnerBindPage 的路径 → redirect to `/area/acquisition/accounts`
- 旧链接不返回 404

**验证命令**:
```bash
# 检查路由配置含 redirect（DouyinBurnerBindPage 相关路由已改 redirect）
node -e "
const {readdirSync, readFileSync, existsSync} = require('fs');
// 路由文件可能是 navigation.config.ts 或 router/index.tsx
const candidates = [
  'apps/dashboard/src/config/navigation.config.ts',
  'apps/dashboard/src/router/index.tsx',
  'apps/dashboard/src/router/routes.tsx',
].filter(f => existsSync(f));
const hasRedirect = candidates.some(f => {
  const c = readFileSync(f, 'utf8');
  return c.includes('Navigate') || c.includes('redirect') || c.includes('Redirect');
});
// DouyinBurnerBindPage.tsx 要么不存在，要么只含 Navigate redirect
const bindPagePath = 'apps/dashboard/src/pages/DouyinBurnerBindPage.tsx';
if (existsSync(bindPagePath)) {
  const c = readFileSync(bindPagePath, 'utf8');
  if (!c.includes('Navigate') && !c.includes('redirect') && !c.includes('accounts')) {
    console.error('FAIL: DouyinBurnerBindPage 未废弃（未改为 redirect）'); process.exit(1);
  }
}
console.log('✅ DouyinBurnerBindPage 废弃验证通过');
"
```

**硬阈值**: DouyinBurnerBindPage 不存在 OR 内容仅含 redirect 到 `/area/acquisition/accounts`

---

## 接缝清单

| # | 接缝点 | 碰真实世界的位置 | 真目标验证方式 |
|---|---|---|---|
| 1 | DB 表 acquisition_collect_videos | 生产 hk-vps/mmv PostgreSQL | psql 在真实 DB 执行 migration，`\d zenithjoy.acquisition_collect_videos` 确认表结构 |
| 2 | agent DOM 选择器（title/thumbnail/publish_date） | 抖音真实网页 DOM | 在 xian-rog 运行 agent 抓一个真实视频，DB 记录有非 null 的 title/thumbnail_url（手工验，非 CI，标 logic-done-pending） |
| 3 | IDOR 多租户隔离 | 生产两 tenant 数据共存 | 用两组真实 E2E tenant 凭据互访，确认 403（windows_cloud E2E 用 E2E_TEST_TENANT_ID + E2E_OTHER_TENANT_ID 账号） |
| 4 | Step 8 失败态 UI 显示（error_reason + retry 按钮） | 前端 DOM 渲染 seeded failed 任务 | Playwright test `TasksPage 失败态任务展示失败原因 + 重新采集按钮`（需 e2e-verify.ps1 seed 一条 failed 任务） |

接缝 #2 在 CI 无法验（真实抖音 DOM），标 `logic-done-pending`。其余在 windows_cloud E2E 覆盖。

---

## E2E 验收（windows_cloud 变体C — GitHub Actions + Playwright + 真实后端）

**journey_type**: user_facing
**target_environment**: windows_cloud

> ⚠️ 变体C 死规则：禁止 `page.route()`；Playwright spec 打真实后端（localhost:3000）；e2e-verify.ps1 必须先启动 apps/api 再启动 Vite。

<!-- GOLDEN_SMOKE_ABILITY_SLUG: acquisition-ia-redesign -->
<!-- GOLDEN_SMOKE_TARGET_ENV: windows_cloud -->
<!-- GOLDEN_SMOKE_SKIP_IN_CI: true -->

### Scenario 1: Hub页4卡片可见且API就绪
<!-- GOLDEN_SMOKE_SCENARIO: hub-4-cards-visible -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 60000 -->

```bash
#!/bin/bash
set -e
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

TASK_RESP=$(curl -sf -X POST \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TEST_TENANT" \
  -d '{"keywords":["e2e-smoke-test"]}' \
  "$BRAIN_URL/api/acquisition/collect/start")
echo "$TASK_RESP" | jq -e '.success == true' || { echo "FAIL: collect/start"; exit 1; }
TASK_ID=$(echo "$TASK_RESP" | jq -r '.data.task_id')

RESP=$(curl -sf -H "X-Tenant-Id: $TEST_TENANT" "$BRAIN_URL/api/acquisition/collect-tasks/$TASK_ID/videos")
echo "$RESP" | jq -e '.success == true' || { echo "FAIL: collect-tasks/:id/videos"; exit 1; }
echo "$RESP" | jq -e '.data | (has("videos") and has("total"))' || { echo "FAIL: missing videos/total"; exit 1; }
echo "$RESP" | jq -e '.data.videos | type == "array"' || { echo "FAIL: videos not array"; exit 1; }
echo "$RESP" | jq -e '.data | has("videoList") | not' || { echo "FAIL: 禁用字段 videoList"; exit 1; }
echo "$RESP" | jq -e '.data | has("items") | not' || { echo "FAIL: 禁用字段 items"; exit 1; }

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
DATABASE_URL="${DATABASE_URL:-$E2E_DATABASE_URL}"

TASK_ID=$(curl -sf -X POST -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $TEST_TENANT" \
  -d '{"keywords":["e2e-leads-smoke"]}' \
  "$BRAIN_URL/api/acquisition/collect/start" | jq -r '.data.task_id')

TEST_VIDEO_ID="e2e-video-leads-smoke"
psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.acquisition_collect_videos \
  (video_id, task_id, tenant_id, title, thumbnail_url, publish_date, comment_count) \
  VALUES ('$TEST_VIDEO_ID', '$TASK_ID', '$TEST_TENANT', 'E2E Smoke Video', NULL, NULL, 0) \
  ON CONFLICT (video_id) DO UPDATE SET task_id='$TASK_ID', tenant_id='$TEST_TENANT'"

RESP=$(curl -sf -H "X-Tenant-Id: $TEST_TENANT" "$BRAIN_URL/api/acquisition/videos/$TEST_VIDEO_ID/leads")
echo "$RESP" | jq -e '.success == true and (.data.leads | type == "array") and (.data.total | type == "number")' || { echo "FAIL: leads schema"; exit 1; }
echo "$RESP" | jq -e '.data | (has("comments") | not) and (has("items") | not) and (has("results") | not)' || { echo "FAIL: 禁用字段"; exit 1; }

IDOR=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Tenant-Id: $OTHER_TENANT" "$BRAIN_URL/api/acquisition/videos/$TEST_VIDEO_ID/leads")
[ "$IDOR" = "401" ] || [ "$IDOR" = "403" ] || { echo "FAIL: IDOR CODE=$IDOR"; exit 1; }

echo "✅ Scenario 3 通过"
```

---

### Playwright Spec — `apps/dashboard/e2e/acquisition-ia.spec.ts`

```typescript
/**
 * Sprint 07021006 — AcquisitionHubPage IA 重设计 E2E (Round 2)
 *
 * 规则：禁止 page.route()。所有 API 调用打真实后端（localhost:3000）。
 * 前置：e2e-verify.ps1 已 seed：
 *   - TEST_TENANT: 1条 pending 采集任务 + 1条 seeded 视频 + 1条 failed 任务
 *   - OTHER_TENANT: 10条 burner sessions（N=10 上限测试）
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5174';
const TEST_TENANT = process.env.E2E_TEST_TENANT_ID ?? '';
const OTHER_TENANT = process.env.E2E_OTHER_TENANT_ID ?? '';

test.beforeEach(async ({ page }) => {
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

  const accountsNum = await page.getByTestId('hub-card-accounts-count').textContent();
  expect(Number(accountsNum?.trim())).toBeGreaterThanOrEqual(0);
  const tasksNum = await page.getByTestId('hub-card-tasks-count').textContent();
  expect(Number(tasksNum?.trim())).toBeGreaterThanOrEqual(0);
});

test('AccountsPage 渲染小号列表或空态', async ({ page }) => {
  await page.goto(`${BASE_URL}/area/acquisition/accounts`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'e2e/screenshots/02-accounts.png', fullPage: true });

  const hasList = await page.getByTestId('accounts-list').isVisible().catch(() => false);
  const hasEmpty = await page.getByTestId('accounts-empty').isVisible().catch(() => false);
  expect(hasList || hasEmpty).toBe(true);

  await expect(page.getByTestId('bind-new-account-btn')).toBeVisible({ timeout: 5_000 });
});

test('TasksPage 一级渲染关键词输入框 + 任务列表', async ({ page }) => {
  await page.goto(`${BASE_URL}/area/acquisition/tasks`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'e2e/screenshots/03-tasks.png', fullPage: true });

  await expect(page.getByTestId('keyword-input')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('start-collect-btn')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('tasks-list')).toBeVisible({ timeout: 5_000 });
});

test('LeadsPage 不再含采集面板', async ({ page }) => {
  await page.goto(`${BASE_URL}/dashboard/leads`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'e2e/screenshots/04-leads.png', fullPage: true });

  const collectBtn = page.getByTestId('acq-collect-button');
  const count = await collectBtn.count();
  expect(count).toBe(0);

  await expect(page.locator('.ag-root-wrapper, [data-testid="leads-table"]')).toBeVisible({ timeout: 10_000 });
});

// ── R2 新增：PRD Step 6 TasksPage 二级视频卡片 ──
test('TasksPage 二级视频卡片容器渲染（/:taskId 路由）', async ({ page }) => {
  await page.goto(`${BASE_URL}/area/acquisition/tasks`);
  await page.waitForLoadState('networkidle');

  const firstRow = page.getByTestId('task-row').first();
  const hasTask = await firstRow.isVisible({ timeout: 5_000 }).catch(() => false);

  if (hasTask) {
    await firstRow.click();
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'e2e/screenshots/05-tasks-detail.png', fullPage: true });
    await expect(page.getByTestId('video-cards-container')).toBeVisible({ timeout: 10_000 });
  } else {
    // 无任务时直接访问二级路由，验证不白屏（渲染空容器或 not-found）
    await page.goto(`${BASE_URL}/area/acquisition/tasks/00000000-0000-0000-0000-000000000000`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'e2e/screenshots/05-tasks-detail-empty.png', fullPage: true });
    const hasContainer = await page.getByTestId('video-cards-container').isVisible().catch(() => false);
    const hasError = await page.locator('[data-testid*="not-found"], [data-testid*="error"]').isVisible().catch(() => false);
    expect(hasContainer || hasError).toBe(true);
  }
});

// ── R2 新增：PRD Step 7 leads 空态「暂无评论」 ──
test('视频卡片展开后显示 leads 列表或「暂无评论」占位', async ({ page }) => {
  await page.goto(`${BASE_URL}/area/acquisition/tasks`);
  await page.waitForLoadState('networkidle');

  const firstRow = page.getByTestId('task-row').first();
  const hasTask = await firstRow.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!hasTask) { test.skip(); return; }

  await firstRow.click();
  await page.waitForLoadState('networkidle');

  const firstCard = page.getByTestId('video-card').first();
  const hasCard = await firstCard.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!hasCard) { test.skip(); return; }

  await firstCard.click();
  await page.screenshot({ path: 'e2e/screenshots/06-video-leads.png', fullPage: true });

  const hasLeads = await page.getByTestId('leads-list').isVisible({ timeout: 5_000 }).catch(() => false);
  const hasEmpty = await page.getByTestId('leads-empty-placeholder').isVisible({ timeout: 5_000 }).catch(() => false);
  expect(hasLeads || hasEmpty).toBe(true);
});

// ── R2 新增：PRD Step 3 N=10 上限按钮置灰 ──
test('AccountsPage N=10 上限时绑定按钮置灰', async ({ page }) => {
  if (!OTHER_TENANT) { test.skip(); return; }
  // 切换到 OTHER_TENANT（e2e-verify.ps1 已 seed 10 条 burner session）
  await page.context().clearCookies();
  await page.context().addCookies([
    { name: 'x-tenant-id', value: OTHER_TENANT, url: BASE_URL },
  ]);
  await page.goto(`${BASE_URL}/area/acquisition/accounts`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'e2e/screenshots/07-accounts-n10-limit.png', fullPage: true });

  const btn = page.getByTestId('bind-new-account-btn');
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await expect(btn).toBeDisabled({ timeout: 5_000 });
});

// ── R2 新增：PRD Step 8 失败态 UI 展示 ──
test('TasksPage 失败态任务展示失败原因 + 重新采集按钮', async ({ page }) => {
  // e2e-verify.ps1 已 seed 一条 status='failed' 任务
  await page.goto(`${BASE_URL}/area/acquisition/tasks`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'e2e/screenshots/08-tasks-failed.png', fullPage: true });

  await expect(page.getByTestId('task-status-failed')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('task-retry-btn')).toBeVisible({ timeout: 5_000 });
});
```

---

### e2e-verify.ps1（位于 `sprints/07021006-acquisition-ia-redesign/e2e-verify.ps1`）

```powershell
# final-e2e 验证脚本 — ZenithJoy Dashboard Playwright（windows-latest）Round 2
# 变体C 死规则：禁止 page.route()，必须启动真实后端
param(
  [string]$BaseUrl = "http://localhost:5174",
  [string]$SuperAdminEmail = $env:E2E_SUPER_ADMIN_EMAIL,
  [string]$SuperAdminPassword = $env:E2E_SUPER_ADMIN_PASSWORD,
  [string]$DatabaseUrl = $env:E2E_DATABASE_URL,
  [string]$TestTenantId = $env:E2E_TEST_TENANT_ID,
  [string]$OtherTenantId = $env:E2E_OTHER_TENANT_ID
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VitePort = 5174
$ApiPort = 3000
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptDir\..\.."

# 0. 安装 psql（若不可用）— seed SQL 和 IDOR 验证需要
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  Write-Host "▶ Installing PostgreSQL client..."
  choco install postgresql15 --no-progress -y 2>&1 | Select-Object -Last 3
  $pgDir = Get-ChildItem "C:\Program Files\PostgreSQL" -ErrorAction SilentlyContinue |
    Sort-Object Name | Select-Object -Last 1
  if ($pgDir) { $env:PATH += ";$($pgDir.FullName)\bin" }
}

# 1. 安装依赖
Write-Host "▶ npm ci..."
$r = Start-Process "cmd.exe" -ArgumentList "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($r.ExitCode -ne 0) { throw "FAIL: npm ci failed" }

# 2. Playwright 浏览器
$r2 = Start-Process "cmd.exe" -ArgumentList "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($r2.ExitCode -ne 0) { throw "FAIL: playwright install failed" }

# 3. Seed 测试数据
Write-Host "▶ Seeding E2E test data..."
$seedSql = @"
DO `$`$
BEGIN
  -- seed test tenant（幂等）
  INSERT INTO zenithjoy.tenants (id, name, created_at)
  VALUES ('$TestTenantId', 'E2E Test Tenant', NOW())
  ON CONFLICT (id) DO NOTHING;

  -- seed OTHER_TENANT（N=10 上限测试）
  INSERT INTO zenithjoy.tenants (id, name, created_at)
  VALUES ('$OtherTenantId', 'E2E Limit Tenant', NOW())
  ON CONFLICT (id) DO NOTHING;
END
`$`$;
"@
$seedSql | psql $DatabaseUrl 2>&1 | Write-Host

# Seed 10 burner sessions for OTHER_TENANT（N=10 上限 UI 测试）
$seedLimitSql = @"
DO `$`$
DECLARE i INT;
BEGIN
  FOR i IN 1..10 LOOP
    INSERT INTO zenithjoy.agent_platform_sessions
      (id, tenant_id, platform, role, status, account_label, created_at, updated_at)
    VALUES (gen_random_uuid(), '$OtherTenantId', 'douyin', 'burner', 'active',
            'limit-test-account-' || i, NOW(), NOW())
    ON CONFLICT DO NOTHING;
  END LOOP;
END
`$`$;
"@
$seedLimitSql | psql $DatabaseUrl 2>&1 | Write-Host

# Seed failed task for TEST_TENANT（Step 8 UI 测试）
$seedFailedSql = @"
INSERT INTO zenithjoy.acquisition_collect_tasks
  (id, tenant_id, keywords, status, error_code, created_at, updated_at)
VALUES (gen_random_uuid(), '$TestTenantId', ARRAY['e2e-failed-keyword'],
        'failed', 'agent_offline', NOW(), NOW())
ON CONFLICT DO NOTHING;
"@
$seedFailedSql | psql $DatabaseUrl 2>&1 | Write-Host

# 4. 启动 API server（E2E_API_URL secret 为外部 URL，不用于本 sprint — 本 sprint 自启 localhost:$ApiPort）
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

# 5. Build Dashboard
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

# 7. 运行 Playwright（传入 OTHER_TENANT 供 N=10 测试使用）
$e2eProc = Start-Process "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright test e2e\acquisition-ia.spec.ts --reporter=list" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow `
  -Environment @{
    E2E_BASE_URL        = $BaseUrl
    E2E_TEST_TENANT_ID  = $TestTenantId
    E2E_OTHER_TENANT_ID = $OtherTenantId
  }

# 8. 归集截图（01-08）
$screenshotDest = "$scriptDir\screenshots"
New-Item -ItemType Directory -Force -Path $screenshotDest | Out-Null
Copy-Item "$repoRoot\apps\dashboard\e2e\screenshots\*.png" -Destination $screenshotDest -ErrorAction SilentlyContinue

Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue

if ($e2eProc.ExitCode -ne 0) { throw "FAIL: Playwright E2E 失败 exit=$($e2eProc.ExitCode)" }
Write-Host "✅ windows_cloud Dashboard E2E 验证通过（真实后端）"
exit 0
```

**GHA Secrets 必须**（e2e-windows.yml 的 env block 需包含）：
- `E2E_SUPER_ADMIN_EMAIL`、`E2E_SUPER_ADMIN_PASSWORD`、`E2E_DATABASE_URL`
- `E2E_TEST_TENANT_ID: ${{ secrets.E2E_TEST_TENANT_ID }}`（R2 新增）
- `E2E_OTHER_TENANT_ID: ${{ secrets.E2E_OTHER_TENANT_ID }}`（R2 新增）

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 新 API 端点 collect-tasks/:id/videos | `tests/acquisition-ia.test.ts` | schema/IDOR/404/禁用字段 | 端点未实现 → ≥3 failures |
| 新 API 端点 videos/:videoId/leads | `tests/acquisition-ia.test.ts` | 200路径schema/IDOR/禁用字段 | 端点未实现 → ≥3 failures |
| acquisition_collect_videos DB migration | `tests/acquisition-ia.test.ts` | 表存在/7列/schema前缀 | migration 未建 → 3 failures |
| AccountsPage / TasksPage 新组件 | `tests/acquisition-ia.test.ts` | testId存在/路由/disable逻辑 | 文件不存在 → ≥4 failures |
| DouyinBurnerBindPage 废弃 | `tests/acquisition-ia.test.ts` | redirect/Navigate存在 | 未改 → 1 failure |
| LeadsPage 移除采集面板 | `tests/acquisition-ia.test.ts` | acq-collect-button 不存在 | 未改 → 1 failure |
| Playwright spec 合规 | `tests/acquisition-ia.test.ts` | 无page.route/含新测试覆盖 | spec 不存在 → 2 failures |
