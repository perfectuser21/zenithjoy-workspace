# Sprint Contract Draft (Round 3)

## Golden Path

[用户输入关键词] → [中台扩词 + 派任务] → [Agent 搜视频] → [中台派评论任务] → [Agent 抓评论 + 中台 DeepSeek 打分 → 写飞书] → [Dashboard Leads 查看]

---

### Step 1: 用户 POST /api/acquisition/keyword-search

**来源**: `[FROM_PRD]` — PRD § Golden Path 第 1 条：「用户在 Dashboard 输入行业关键词 → POST /api/acquisition/keyword-search，body: {"keyword": "装修"}」

**可观测行为**:
- 返回 HTTP 200，body 字段完全等于 `["keywords","task_id"]`（字母排序）
- `task_id` 为 UUID 字符串，`keywords` 为长度 5 的字符串数组（含原词）

**验证命令**:
```bash
RESP=$(curl -sf -X POST http://localhost:3001/api/acquisition/keyword-search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -d '{"keyword":"装修"}')

# 字段值验证
echo "$RESP" | jq -e '.task_id | test("^[0-9a-f-]{36}$")' || { echo "FAIL: task_id 非 UUID"; exit 1; }
echo "$RESP" | jq -e '.keywords | length == 5' || { echo "FAIL: keywords 长度非5"; exit 1; }

# Schema 完整性（精确等于，不多不少）
echo "$RESP" | jq -e 'keys == ["keywords","task_id"]' || { echo "FAIL: schema keys 不匹配"; exit 1; }

# 禁用字段反向检查
echo "$RESP" | jq -e 'has("result") | not' || { echo "FAIL: 禁用字段 result 漏网"; exit 1; }
echo "$RESP" | jq -e 'has("data") | not' || { echo "FAIL: 禁用字段 data 漏网"; exit 1; }
echo "$RESP" | jq -e 'has("expanded") | not' || { echo "FAIL: 禁用字段 expanded 漏网"; exit 1; }
echo "$RESP" | jq -e 'has("variants") | not' || { echo "FAIL: 禁用字段 variants 漏网"; exit 1; }

echo "✅ Step 1 POST keyword-search 验证通过"
```

**硬阈值**: HTTP 200，`task_id` 为 UUID，`keywords` 长度 = 5，顶层 keys = `["keywords","task_id"]`，耗时 < 5s

---

### Step 2: 中台调 DeepSeek 扩展变体词并写 DB

**来源**: `[FROM_PRD]` — PRD § Golden Path 第 2 条：「中台调 OpenRouter DeepSeek 扩展5个变体词」

**可观测行为**:
- `acquisition_keyword_tasks` 表有一条记录，`keyword='装修'`，`expanded_keywords` 包含 5 个词

**验证命令**:
```bash
TASK_ID=$(curl -sf -X POST http://localhost:3001/api/acquisition/keyword-search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -d '{"keyword":"装修"}' | jq -r '.task_id')

COUNT=$(psql $DB -t -c "SELECT count(*) FROM zenithjoy.acquisition_keyword_tasks \
  WHERE id='$TASK_ID' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$COUNT" -ge 1 ] || { echo "FAIL: DB 未写入 acquisition_keyword_tasks"; exit 1; }

KCOUNT=$(psql $DB -t -c "SELECT jsonb_array_length(expanded_keywords) FROM \
  zenithjoy.acquisition_keyword_tasks WHERE id='$TASK_ID'" | tr -d ' ')
[ "$KCOUNT" -eq 5 ] || { echo "FAIL: expanded_keywords 长度非5，实际=$KCOUNT"; exit 1; }

echo "✅ Step 2 扩词写 DB 验证通过"
```

**硬阈值**: DB 记录写入，`expanded_keywords` 长度 = 5，5 分钟内写入

---

### Step 3: 中台向 Agent 下发搜索任务，写入 acquisition_keyword_tasks

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入；理由：PRD 只说"派搜索任务给主号 Agent"但未定义任务追踪机制，不写 DB 则 Agent 离线后无法重试/追踪，evaluation 无法验证任务是否真的下发。Round 2 修正：状态统一为 `dispatched`，移除 `pending` 双态（二义性导致 generator 可以不真实派发任务）

**可观测行为**:
- `acquisition_keyword_tasks.status` 更新为 `'dispatched'`（任务已下发 Agent）

**验证命令**:
```bash
STATUS=$(psql $DB -t -c "SELECT status FROM zenithjoy.acquisition_keyword_tasks \
  WHERE id='$TASK_ID'" | tr -d ' ')
[ "$STATUS" = "dispatched" ] || { echo "FAIL: status 不是 dispatched，实际=$STATUS"; exit 1; }
echo "✅ Step 3 任务状态验证通过"
```

**硬阈值**: `status` = `dispatched`（唯一合法终态，Agent 未连接时返回 503 而不是写 pending）

---

### Step 4: Agent POST /api/acquisition/video-search-result

**来源**: `[FROM_PRD]` — PRD § Golden Path 第 4 条：「Agent 主号 Chrome CDP 逐词搜索，每词取最多5条热门视频，POST 回 /api/acquisition/video-search-result」

**可观测行为**:
- 返回 HTTP 200 `{"received": true, "video_count": N}`
- `acquisition_videos` 表有记录（带时间窗口）

**验证命令**:
```bash
RESP=$(curl -sf -X POST http://localhost:3001/api/acquisition/video-search-result \
  -H "Content-Type: application/json" \
  -d "{\"keyword_task_id\":\"$TASK_ID\",\"keyword\":\"装修\",\"videos\":[
    {\"video_url\":\"https://www.douyin.com/video/test001\"},
    {\"video_url\":\"https://www.douyin.com/video/test002\"}
  ]}")

echo "$RESP" | jq -e '.received == true' || { echo "FAIL: received 非 true"; exit 1; }
echo "$RESP" | jq -e '.video_count >= 1' || { echo "FAIL: video_count < 1"; exit 1; }

DB_COUNT=$(psql $DB -t -c "SELECT count(*) FROM zenithjoy.acquisition_videos \
  WHERE keyword_task_id='$TASK_ID' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$DB_COUNT" -ge 1 ] || { echo "FAIL: acquisition_videos 无记录"; exit 1; }

echo "✅ Step 4 video-search-result 验证通过"
```

**硬阈值**: HTTP 200，`received=true`，DB 记录写入（5 分钟内），耗时 < 3s

---

### Step 5: 中台派评论抓取任务

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入；理由：PRD § Golden Path 第 4 条末提到「中台派评论抓取任务」但未说明触发机制，需在 video-search-result endpoint 内自动派发评论任务，否则评论抓取永远不会发生

**可观测行为**:
- `acquisition_videos.comment_task_status` 设置为 `'dispatched'`（评论任务已下发）

**验证命令**:
```bash
DISPATCHED=$(psql $DB -t -c "SELECT count(*) FROM zenithjoy.acquisition_videos \
  WHERE keyword_task_id='$TASK_ID' AND comment_task_status='dispatched' \
  AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$DISPATCHED" -ge 1 ] || { echo "FAIL: 评论任务未下发"; exit 1; }
echo "✅ Step 5 评论任务下发验证通过"
```

**硬阈值**: `comment_task_status = 'dispatched'`，5 分钟内写入

---

### Step 6: Agent POST /api/acquisition/comment-score-result → DeepSeek 打分 → 写飞书

**来源**: `[FROM_PRD]` — PRD § Golden Path 第 5-6 条：「Agent 进每个视频留言区抓 top 50 条评论，POST 回 /api/acquisition/comment-score-result；中台收评论，逐条调 OpenRouter DeepSeek 打分 → 写飞书 table_id_leads」

**可观测行为**:
- 返回 HTTP 200 `{"received": true, "comment_count": N, "written_count": M}`
- `written_count >= 1`（有评论写入飞书，grade 字段含三级分类）

**验证命令**:
```bash
RESP=$(curl -sf -X POST http://localhost:3001/api/acquisition/comment-score-result \
  -H "Content-Type: application/json" \
  -d "{\"keyword_task_id\":\"$TASK_ID\",\"video_url\":\"https://www.douyin.com/video/test001\",
       \"comments\":[
         {\"commenter_id\":\"@test_user\",\"text\":\"怎么联系你\",\"publish_time\":\"2026-05-24T10:00:00Z\"}
       ]}")

echo "$RESP" | jq -e '.received == true' || { echo "FAIL: received 非 true"; exit 1; }
echo "$RESP" | jq -e '.written_count >= 1' || { echo "FAIL: written_count < 1"; exit 1; }
echo "✅ Step 6 comment-score-result 验证通过"
```

**硬阈值**: HTTP 200，`written_count >= 1`，耗时 < 10s（含 DeepSeek 调用）

---

### Step 7: GET /api/acquisition/leads 返回带等级标签的 Leads

**来源**: `[FROM_PRD]` — PRD § Response Schema GET /api/acquisition/leads 及 Golden Path 第 6 条：「用户访问 /dashboard/leads，看到带等级标签 Leads 表格」

**可观测行为**:
- HTTP 200，顶层 keys 精确等于 `["leads","total"]`
- `leads` 为数组，每条含且仅含 6 个必填字段：`commenter_id`, `comment_text`, `source_video_url`, `crawled_at`, `grade`, `keyword`
- `grade` 枚举值为 `"感兴趣"` | `"精准"` | `"高意向"`

**验证命令**:
```bash
RESP=$(curl -sf http://localhost:3001/api/acquisition/leads \
  -H "Authorization: Bearer $TEST_TOKEN")

# 顶层 Schema 完整性
echo "$RESP" | jq -e 'keys == ["leads","total"]' || { echo "FAIL: 顶层 keys 不匹配"; exit 1; }
echo "$RESP" | jq -e '.leads | type == "array"' || { echo "FAIL: leads 非数组"; exit 1; }
echo "$RESP" | jq -e '.total | type == "number"' || { echo "FAIL: total 非数字"; exit 1; }

# lead item 6 字段完整性（若有记录）
LEAD_COUNT=$(echo "$RESP" | jq '.leads | length')
if [ "$LEAD_COUNT" -gt 0 ]; then
  for FIELD in commenter_id comment_text source_video_url crawled_at grade keyword; do
    echo "$RESP" | jq -e ".leads[0] | has(\"$FIELD\")" || { echo "FAIL: lead item 缺字段 $FIELD"; exit 1; }
  done
  echo "$RESP" | jq -e '.leads[0].grade | test("^(感兴趣|精准|高意向)$")' \
    || { echo "FAIL: grade 枚举值非法"; exit 1; }
  echo "$RESP" | jq -e '.leads[0].commenter_id | type == "string"' \
    || { echo "FAIL: commenter_id 非 string"; exit 1; }
  echo "$RESP" | jq -e '.leads[0].comment_text | type == "string"' \
    || { echo "FAIL: comment_text 非 string"; exit 1; }
fi

# grade 枚举合法性（若有记录）
GRADE_OK=$(echo "$RESP" | jq -e '.leads | map(.grade) | all(. == "感兴趣" or . == "精准" or . == "高意向")' \
  2>/dev/null && echo "1" || echo "0")
[ "$GRADE_OK" = "1" ] || { echo "FAIL: grade 含非法值"; exit 1; }

# 禁用字段反向检查
echo "$RESP" | jq -e 'has("data") | not' || { echo "FAIL: 禁用字段 data"; exit 1; }
echo "$RESP" | jq -e 'has("items") | not' || { echo "FAIL: 禁用字段 items"; exit 1; }
echo "$RESP" | jq -e 'has("result") | not' || { echo "FAIL: 禁用字段 result"; exit 1; }

# grade 筛选参数名校验
FILTERED=$(curl -sf "http://localhost:3001/api/acquisition/leads?grade=高意向" \
  -H "Authorization: Bearer $TEST_TOKEN")
echo "$FILTERED" | jq -e '.leads | map(.grade) | all(. == "高意向")' \
  || { echo "FAIL: grade 筛选不正确"; exit 1; }

# grade 非法值 → 400
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "http://localhost:3001/api/acquisition/leads?grade=invalid" \
  -H "Authorization: Bearer $TEST_TOKEN")
[ "$STATUS" = "400" ] || { echo "FAIL: 非法 grade 未返回 400，实际=$STATUS"; exit 1; }

echo "✅ Step 7 GET /api/acquisition/leads 验证通过"
```

**硬阈值**: HTTP 200，keys = `["leads","total"]`，lead item 含 6 必填字段，grade 合法，grade=invalid → 400，耗时 < 5s

---

### Step 8: /dashboard/leads 页面展示等级标签表格（Playwright，windows_cloud）

**来源**: `[FROM_PRD]` — PRD § Golden Path 第 6 条：「用户访问 /dashboard/leads，看到带等级标签（🟡感兴趣 🟠精准 🔴高意向）的 Leads 表格」及 PRD § 在范围内 `apps/dashboard/src/pages/LeadsPage.tsx`

**可观测行为**:
- `/dashboard/leads` 页面加载 200，`[data-testid="leads-table"]` 可见
- 等级标签（感兴趣/精准/高意向）在 `[data-testid="grade-badge"]` 元素中可见
- grade 筛选下拉可用，选择后表格内容过滤

**验证命令**:
```powershell
# 参见下方 E2E 验收脚本（windows_cloud PowerShell + Playwright）
# Mode A API assertions 在 WS4 DoD BEHAVIOR 条目中
# Mode B Playwright browser E2E 在 ## E2E 验收 区块
# Playwright spec 路径：tests/ws4/leads.test.ts
npx playwright test --project=chromium tests/ws4/leads.test.ts
```

**硬阈值**: Playwright exit 0，`leads-table` 可见，等级标签 DOM 存在

---

## 鉴权策略声明（v7.8 Round 2 统一）

**规则**：凡用户调用的 endpoint（非 Agent→API 的服务间调用），BEHAVIOR curl 命令**必须**携带 `Authorization: Bearer $TEST_TOKEN`。

| Endpoint | 调用方 | 是否需要 AUTH header |
|---|---|---|
| POST /api/acquisition/keyword-search | 用户 Dashboard | ✅ 必须带 Bearer $TEST_TOKEN |
| POST /api/acquisition/video-search-result | Agent（服务间） | 不需要用户 token，Agent 自身鉴权 |
| POST /api/acquisition/comment-score-result | Agent（服务间） | 不需要用户 token，Agent 自身鉴权 |
| GET /api/acquisition/leads | 用户 Dashboard | ✅ 必须带 Bearer $TEST_TOKEN |

WS1 BEHAVIOR 命令测表结构（psql），无 HTTP 调用，不涉及鉴权。

---

## 注册表防冲突检查

**已注册 API Endpoints**（本 sprint 新 endpoint 命名不得与之重复）:
- 现有：`GET /api/acquisition/overview`
- 本 sprint 新增：
  - `POST /api/acquisition/keyword-search`（新）
  - `POST /api/acquisition/video-search-result`（新）
  - `POST /api/acquisition/comment-score-result`（新）
  - `GET /api/acquisition/leads`（新）

**已注册 DB Schema**（新建表不得冲突）:
- 现有：`zenithjoy.user_clip_settings`, `zenithjoy.publish_tasks`, etc.
- 本 sprint 新增：`zenithjoy.acquisition_keyword_tasks`（新），`zenithjoy.acquisition_videos`（新）

---

## Risks（风险登记）

| # | 风险 | 概率 | 影响 | 缓解方案 |
|---|---|---|---|---|
| R1 | **AGENT_OFFLINE**：调 keyword-search 时主号 Agent 未连接（`agent_platform_sessions` 无 active main session） | 中 | 高（获客链路完全不可用） | API 即时返回 503 + `{"error":"AGENT_OFFLINE"}`；Dashboard 展示「Agent 离线，请联系运营绑定主号」；WS2 BEHAVIOR 有 503 路径验证 |
| R2 | **FEISHU_TOKEN_EXPIRED**：`tenant_access_token` 过期，comment-score-result 写飞书失败、GET leads 读飞书失败 | 中 | 中（评论数据丢失，Leads 页空白） | API 返回 503 + `{"error":"FEISHU_TOKEN_EXPIRED"}`；后台触发告警（运营手动 renew token）；WS4 BEHAVIOR 有 503 路径验证 |
| R3 | **WS1 Migration cascade**：`acquisition_keyword_tasks`/`acquisition_videos` 表未建好，WS2/WS3 写 DB 失败，全链路不通 | 低 | 高（阻塞后续所有 WS） | `depends_on` 串行强制 ws1→ws2→ws3→ws4；WS1 有独立 BEHAVIOR 验证两表结构、字段类型；任何 WS 开始前 evaluator 先跑前置 WS DoD |

---

## E2E 验收

**journey_type**: user_facing
**target_environment**: windows_cloud

### target_environment = windows_cloud（GitHub Actions windows-latest runner）

```powershell
# final-e2e PowerShell 脚本（在 GitHub Actions windows-latest runner 上执行）
# 用途：ZenithJoy Dashboard + API 全链路 E2E 验收
param(
  [string]$ApiBase = "http://localhost:3001",
  [string]$DashboardBase = "http://localhost:5173",
  [string]$TestToken = $env:TEST_TOKEN
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# 1. 健康检查
$health = Invoke-RestMethod -Uri "$ApiBase/api/acquisition/overview" -Method GET -TimeoutSec 10
if ($health.enabled -ne $true) { throw "FAIL: API 不健康 enabled=$($health.enabled)" }
Write-Host "✅ API 健康"

# 2. POST keyword-search → 验证 schema（含 Authorization header）
$body = '{"keyword":"装修"}'
$headers = @{ "Authorization" = "Bearer $TestToken"; "Content-Type" = "application/json" }
$kwResp = Invoke-RestMethod -Uri "$ApiBase/api/acquisition/keyword-search" `
  -Method POST -Body $body -Headers $headers -TimeoutSec 10
if (-not $kwResp.task_id) { throw "FAIL: task_id 缺失" }
if ($kwResp.keywords.Count -ne 5) { throw "FAIL: keywords 长度非5，实际=$($kwResp.keywords.Count)" }
$keys = ($kwResp | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name | Sort-Object) -join ","
if ($keys -ne "keywords,task_id") { throw "FAIL: schema keys 不匹配，实际=$keys" }
Write-Host "✅ POST keyword-search schema 正确"

$taskId = $kwResp.task_id

# 3. POST video-search-result（Agent 调用，无用户 token）
$videoBody = "{`"keyword_task_id`":`"$taskId`",`"keyword`":`"装修`",`"videos`":[{`"video_url`":`"https://www.douyin.com/video/e2e001`"}]}"
$vidResp = Invoke-RestMethod -Uri "$ApiBase/api/acquisition/video-search-result" `
  -Method POST -Body $videoBody -ContentType "application/json" -TimeoutSec 10
if ($vidResp.received -ne $true) { throw "FAIL: video-search-result received 非 true" }
Write-Host "✅ POST video-search-result 收到"

# 4. POST comment-score-result（Agent 调用，无用户 token）
$commentBody = "{`"keyword_task_id`":`"$taskId`",`"video_url`":`"https://www.douyin.com/video/e2e001`",`"comments`":[{`"commenter_id`":`"@e2e_user`",`"text`":`"怎么联系你`",`"publish_time`":`"2026-05-24T10:00:00Z`"}]}"
$cmtResp = Invoke-RestMethod -Uri "$ApiBase/api/acquisition/comment-score-result" `
  -Method POST -Body $commentBody -ContentType "application/json" -TimeoutSec 30
if ($cmtResp.received -ne $true) { throw "FAIL: comment-score-result received 非 true" }
Write-Host "✅ POST comment-score-result 处理完成"

# 5. GET /api/acquisition/leads → schema 验证（含 Authorization header）
$leads = Invoke-RestMethod -Uri "$ApiBase/api/acquisition/leads" -Method GET -Headers $headers -TimeoutSec 10
$topKeys = ($leads | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name | Sort-Object) -join ","
if ($topKeys -ne "leads,total") { throw "FAIL: leads schema keys 不匹配，实际=$topKeys" }

# lead item 6 字段完整性
if ($leads.leads.Count -gt 0) {
  $lead = $leads.leads[0]
  foreach ($f in @("commenter_id","comment_text","source_video_url","crawled_at","grade","keyword")) {
    if (-not ($lead | Get-Member -MemberType NoteProperty -Name $f)) {
      throw "FAIL: lead item 缺字段 $f"
    }
  }
  $validGrades = @("感兴趣","精准","高意向")
  if ($lead.grade -notin $validGrades) { throw "FAIL: grade 非法值=$($lead.grade)" }
  Write-Host "✅ lead item 6 字段完整"
}
Write-Host "✅ GET /api/acquisition/leads schema 正确"

# 6. grade 筛选
$filtered = Invoke-RestMethod -Uri "$ApiBase/api/acquisition/leads?grade=高意向" -Method GET -Headers $headers -TimeoutSec 10
foreach ($lead in $filtered.leads) {
  if ($lead.grade -ne "高意向") { throw "FAIL: grade 筛选不正确，含 grade=$($lead.grade)" }
}
Write-Host "✅ grade 筛选正确"

# 7. grade 非法值 → 400
try {
  Invoke-RestMethod -Uri "$ApiBase/api/acquisition/leads?grade=invalid" -Method GET -Headers $headers -TimeoutSec 10
  throw "FAIL: 非法 grade 未返回 4xx"
} catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 400) { throw "FAIL: 非法 grade 返回了 $($_.Exception.Response.StatusCode.value__)，期望 400" }
  Write-Host "✅ 非法 grade → 400"
}

# 8. Playwright — /dashboard/leads 页面 UI 验证（tests/ws4/leads.test.ts）
$playwrightScript = @"
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('$DashboardBase/dashboard/leads');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/01-initial.png' });
  const table = page.locator('[data-testid="leads-table"]');
  const visible = await table.isVisible({ timeout: 10000 });
  if (!visible) { console.error('FAIL: leads-table 不可见'); process.exit(1); }
  await page.screenshot({ path: 'screenshots/02-action.png' });
  await browser.close();
  console.log('✅ /dashboard/leads UI 验证通过');
})();
"@
$playwrightScript | node - 2>&1 | Write-Host

Write-Host ""
Write-Host "✅ windows_cloud E2E Golden Path 全部通过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 4

---

### Workstream 1: DB Migration — acquisition_keyword_tasks + acquisition_videos 表

**范围**: 创建 `zenithjoy.acquisition_keyword_tasks` 和 `zenithjoy.acquisition_videos` 两张表
**大小**: S（< 100 行，1 文件）
**依赖**: 无

**预期净增**: ~60 行
**文件**: `apps/api/db/migrations/20260524_100000_acquisition_tables.sql`

**BEHAVIOR 覆盖测试文件**: `tests/ws1/migration.test.ts`

---

### Workstream 2: POST /api/acquisition/keyword-search + keyword-expander 服务

**范围**:
- `apps/api/src/routes/acquisition.ts`：新增 `POST /keyword-search` endpoint（调 keyword-expander 服务，写 DB）
- `apps/api/src/services/keyword-expander.ts`：新建，调 OpenRouter DeepSeek 扩展关键词，返回 5 个变体词

**大小**: M（100-200 行，2 文件）
**依赖**: Workstream 1 完成后（需要 DB 表存在）

**预期净增**: ~160 行

**BEHAVIOR 覆盖测试文件**: `tests/ws2/keyword-search.test.ts`

---

### Workstream 3: POST video-search-result + comment-score-result + lead-writer 扩展

**范围**:
- `apps/api/src/routes/acquisition.ts`：新增 `POST /video-search-result` 和 `POST /comment-score-result` endpoints
- `apps/api/src/services/lead-writer.ts`：扩展 `grade`/`keyword` 两字段写入飞书

**大小**: M（100-200 行，2 文件）
**依赖**: Workstream 2 完成后（endpoint 在同一路由文件，服务依赖 DB 表）

**预期净增**: ~130 行

**BEHAVIOR 覆盖测试文件**: `tests/ws3/video-comment-result.test.ts`

---

### Workstream 4: GET /api/acquisition/leads + LeadsPage.tsx + navigation

**范围**:
- `apps/api/src/routes/acquisition.ts`：新增 `GET /leads` endpoint（读飞书 Leads 表，支持 grade 筛选）
- `apps/dashboard/src/pages/LeadsPage.tsx`：新建 Leads 列表页（等级标签表格）
- `apps/dashboard/src/config/navigation.config.ts`：注册 `/dashboard/leads` 路由入口

**大小**: M（100-200 行，3 文件）
**依赖**: Workstream 3 完成后（GET leads 读飞书写入的数据）

**预期净增**: ~175 行

**BEHAVIOR 覆盖测试文件**: `tests/ws4/leads.test.ts`

---

## Workstreams 切分自查（v7.7）

| WS | 预期 LoC | 文件数 | 规则合规 |
|---|---|---|---|
| ws1 | ~60 | 1 | ✅ |
| ws2 | ~160 | 2 | ✅ |
| ws3 | ~130 | 2 | ✅ |
| ws4 | ~175 | 3 | ✅ |

总净增 ~525 行，4 ws，每 ws ≤ 200 行 ✅，每 ws ≤ 3 文件 ✅

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/migration.test.ts` | 表结构验证 | migration 未跑时 psql 查表失败 |
| WS2 | `tests/ws2/keyword-search.test.ts` | POST keyword-search schema/DB/503 | endpoint 不存在 → 404 |
| WS3 | `tests/ws3/video-comment-result.test.ts` | video-result/comment-result schema | endpoint 不存在 → 404 |
| WS4 | `tests/ws4/leads.test.ts` | GET leads schema / grade 筛选 / lead item 6字段 / 503 | endpoint 不存在 → 404 |

---

## PRD Response Schema → jq -e 自查（v7.5 checklist）

1. **PRD 字段名**: `task_id`, `keywords`（keyword-search）；`leads`, `total`（leads API）；lead item: `commenter_id`, `comment_text`, `source_video_url`, `crawled_at`, `grade`, `keyword`
2. **Contract jq -e 字段名**: 全部字面匹配 PRD ✅
3. **禁用字段反向检查**: `result`, `data`, `expanded`, `variants`, `id`, `job_id`, `items`, `records`, `rows` — 均以 `has("X") | not` 形式写入 ✅
4. **BEHAVIOR 数量**: 每个 ws DoD ≥ 4 条 [BEHAVIOR]（含 schema 字段 + keys 完整性 + 禁用字段反向 + error path + 503 错误路径）✅
5. **鉴权一致性**: 所有用户侧 curl 命令含 `Authorization: Bearer $TEST_TOKEN` ✅
6. **Step 3 唯一状态**: `dispatched` only（无 pending 双态歧义）✅
7. **Playwright 路径**: 统一为 `tests/ws4/leads.test.ts` ✅

---

## Round 3 修订说明（Reviewer 反馈处理）

| # | 问题 | 严重程度 | 修复 |
|---|---|---|---|
| 1 | WS3 DoD BEHAVIOR #1-#4 中 keyword-search 前置 curl 缺 `Authorization: Bearer $TEST_TOKEN`，导致 401 → TASK_ID 为空 → 后续所有 DB 断言 undefined，正确实现被误判 FAIL | 阻塞 | WS3 DoD BEHAVIOR #1-#4 所有 keyword-search 前置调用补加 `-H "Authorization: Bearer $TEST_TOKEN"` |
| 2 | WS1 DoD BEHAVIOR #5 INSERT 使用 `status='pending'`，但合同声明唯一合法终态为 `dispatched`，产生语义矛盾（generator 可能误以为 pending 是合法状态） | 次要 | 改为业务无关占位值 `'test_roundtrip'`，并注明"仅验证 DB 读写通路，不代表业务合法状态" |

---

## GAN 对抗焦点

- Step 1 验证命令加 `-sf` flag + `Authorization: Bearer $TEST_TOKEN`（鉴权策略统一）
- Step 2/4/5 DB 查询加 `AND created_at > NOW() - interval '5 minutes'` 防历史数据绕过
- Step 3 唯一终态 `dispatched`，防 generator 伪造 pending 绕过真实派发
- Step 7 lead item 6 字段完整性 jq-e 逐字段检查，防 schema drift
- Grade 筛选合法值用中文枚举字面量，防英文/数字别名绕过
- WS2/WS4 各增 1 条 503 错误路径 BEHAVIOR，覆盖 PRD 边界情况
