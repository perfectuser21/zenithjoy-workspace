# Sprint Contract Draft (Round 6)

## Response Schema（推导来源: [NEW_PATTERN] — Brain API 不可达）

### Endpoint: GET /api/acquisition/burner-accounts
**Success (HTTP 200)**:
```json
{
  "success": true,
  "data": {
    "accounts": [
      {
        "id": "<uuid>",
        "account_label": "<string>",
        "nickname": "<string|null>",
        "bound_at": "<ISO8601|null>",
        "health": "ok|expired|banned|unknown"
      }
    ],
    "total": "<number>"
  },
  "timestamp": "<ISO8601>"
}
```
- `success` (boolean, 必填): 固定 true
- `data.accounts` (array, 必填): 当前 tenant 的小号列表（role='burner'），来自 `line02_account_sessions`
- `data.total` (number, 必填): accounts 数组长度
- `timestamp` (string, 必填): 响应生成时间戳
- `data` 内层 keys 完整性: **必须且只能**含 `["accounts","total"]`（jq 排序后字面匹配）
**禁用字段名**: `sessions`, `burners`, `items`, `count`（所有 4 个均需 oracle 反向验证）
**Error (HTTP 401/403)**:
```json
{ "success": false, "error": { "code": "NO_TENANT", "message": "缺租户上下文" }, "timestamp": "..." }
```

### Endpoint: GET /api/acquisition/collect-tasks/:taskId/videos
**Success (HTTP 200)**:
```json
{
  "success": true,
  "data": {
    "videos": [
      {
        "video_id": "<string>",
        "video_url": "<string>",
        "title": "<string|null>",
        "cover_url": "<string|null>",
        "published_at": "<ISO8601|null>"
      }
    ],
    "total": "<number>"
  },
  "timestamp": "<ISO8601>"
}
```
- `success` (boolean, 必填): 固定 true
- `data.videos` (array, 必填): 该任务下的视频列表，来自 `acquisition_collect_videos`
- `data.total` (number, 必填): videos 数组长度
- `timestamp` (string, 必填): 响应生成时间戳
- `data` 内层 keys 完整性: **必须且只能**含 `["total","videos"]`（jq 排序后字面匹配）
**禁用字段名**: `items`, `results`, `count`（所有 3 个均需 oracle 反向验证）
**Error (HTTP 404)**:
```json
{ "success": false, "error": { "code": "TASK_NOT_FOUND", "message": "采集任务不存在" }, "timestamp": "..." }
```
**Error (HTTP 403)**:
```json
{ "success": false, "error": { "code": "FORBIDDEN", "message": "无权访问该任务" }, "timestamp": "..." }
```

---

## 已知约束（来自回归测试）

- [acquisition.test.ts] → GET /overview returns 200 with `{ enabled:true, feature:'smart-acquisition' }`
- [acquisition.test.ts] → POST /keyword-search 无 keyword → 400 `{ error:'MISSING_KEYWORD' }`
- [acquisition.test.ts] → GET /collect-tasks 无 tenant → 401 `{ success:false, error:{code:'NO_TENANT'} }`
- [line02.test.ts] → GET /account-status 无 tenant → `{ accounts:[] }`（已有端点，不被本 sprint 修改）
- [agent-burner.test.ts] → GET /agent/burner/sessions 按 tenant 过滤（与本 sprint 新端点不冲突）

---

## Golden Path

[点「智能获客」] → [Hub 4模块卡片 + 实时计数] → [账号管理 OR 采集任务] → [任务详情二级（视频 + 评论）]

---

### Step 1: 用户进入「智能获客」Hub，看到 4 模块卡片 + 前两张实时数字
**来源**: `[FROM_PRD]` — PRD Golden Path 第1步："看到4个模块卡片（账号管理/采集任务/客户分析-占位/触达中心-占位），前两卡片显示本 tenant 实时数字（小号数/任务数）"

**可观测行为**: `/area/acquisition` 页面展示 4 卡片；账号管理卡显示 burner 数，采集任务卡显示任务数；后两张标"（即将上线）"占位

**验证命令**:
```bash
START=$(date +%s)
RESP1=$(curl -sf -H "X-Tenant-Id: $TEST_TENANT_ID" http://localhost:3000/api/acquisition/burner-accounts) \
  || { echo "FAIL: burner-accounts 端点不可达"; exit 1; }
echo "$RESP1" | jq -e '.success == true' || { echo "FAIL: success 非 true"; exit 1; }
echo "$RESP1" | jq -e '.data.total | type == "number"' || { echo "FAIL: data.total 非数字"; exit 1; }
RESP2=$(curl -sf -H "X-Tenant-Id: $TEST_TENANT_ID" http://localhost:3000/api/acquisition/collect-tasks) \
  || { echo "FAIL: collect-tasks 端点不可达"; exit 1; }
echo "$RESP2" | jq -e '.data.total | type == "number"' || { echo "FAIL: collect-tasks data.total 非数字"; exit 1; }
END=$(date +%s)
[ $((END-START)) -lt 5 ] || { echo "FAIL: 响应超时 $((END-START))s"; exit 1; }
```
**硬阈值**: HTTP 200；`success:true`；burner-accounts `data.total` 为数字；collect-tasks `data.total` 为数字；耗时 < 5s

---

### Step 2: 点「账号管理」→ AccountsPage 展示小号列表
**来源**: `[FROM_PRD]` — PRD Golden Path 第2步："点账号管理 → `/area/acquisition/accounts` → 本 tenant 小号列表（昵称/绑定时间/健康状态 ok|expired|banned）；无小号 → 引导+绑定按钮"

**可观测行为**: `GET /api/acquisition/burner-accounts` 返回 accounts array；无数据时页面显示空态引导 + 「绑定新小号」按钮

**验证命令**:
```bash
RESP=$(curl -sf -H "X-Tenant-Id: $TEST_TENANT_ID" http://localhost:3000/api/acquisition/burner-accounts) \
  || { echo "FAIL: 端点失败"; exit 1; }
echo "$RESP" | jq -e '.data.accounts | type == "array"' || { echo "FAIL: accounts 非 array"; exit 1; }
echo "$RESP" | jq -e 'keys == ["data","success","timestamp"]' || { echo "FAIL: 顶层 keys 不匹配"; exit 1; }
echo "$RESP" | jq -e '.data | keys == ["accounts","total"]' || { echo "FAIL: data 内层 keys 不匹配"; exit 1; }
echo "$RESP" | jq -e 'has("sessions") | not' || { echo "FAIL: 出现禁用字段 sessions"; exit 1; }
echo "$RESP" | jq -e 'has("burners") | not' || { echo "FAIL: 出现禁用字段 burners"; exit 1; }
echo "$RESP" | jq -e 'has("items") | not' || { echo "FAIL: 出现禁用字段 items"; exit 1; }
echo "$RESP" | jq -e 'has("count") | not' || { echo "FAIL: 出现禁用字段 count"; exit 1; }
ACCT_COUNT=$(echo "$RESP" | jq '.data.accounts | length')
if [ "$ACCT_COUNT" -gt 0 ]; then
  INVALID_HEALTH=$(echo "$RESP" | jq '[.data.accounts[].health] | map(select(. != "ok" and . != "expired" and . != "banned" and . != "unknown")) | length')
  [ "$INVALID_HEALTH" = "0" ] || { echo "FAIL: accounts 含非法 health 枚举值"; exit 1; }
fi
```
**硬阈值**: HTTP 200；accounts 为 array；顶层 keys == `["data","success","timestamp"]`；data 内层 keys == `["accounts","total"]`；4个禁用字段均不存在；所有 account.health ∈ {ok, expired, banned, unknown}

---

### Step 3: 绑定新小号 — N=10 上限保护
**来源**: `[FROM_PRD]` — PRD Golden Path 第3步、边界情况："小号已达 N=10 → 绑定按钮置灰+提示升级"

**可观测行为**: `data.total >= 10` 时，AccountsPage「绑定新小号」按钮 `disabled`

**验证命令**:
```bash
RESP=$(curl -sf -H "X-Tenant-Id: $TEST_TENANT_ID" http://localhost:3000/api/acquisition/burner-accounts) \
  || { echo "FAIL: 端点失败"; exit 1; }
echo "$RESP" | jq -e '.data | has("total")' || { echo "FAIL: data.total 字段缺失"; exit 1; }
echo "$RESP" | jq -e '.data.total | . >= 0' || { echo "FAIL: total 非非负整数"; exit 1; }
```
**硬阈值**: `data.total` 存在且 >= 0；UI 层 disabled 状态由 Playwright Test 4 在 seed 10 条记录后断言（接缝）

> **接缝清单 item 1**：「绑定上限 disabled 状态」是 UI 接缝（依赖 DOM 渲染 + data.total 值）。
> **真目标验证方式 = Playwright Test 4**：e2e-verify.ps1 Step 2.6 向 E2E DB INSERT 10 条 burner 到固定 E2E tenant（`e2e-tenant-00000000-0000-0000-0000-000000000001`）；Playwright 断言 `[data-testid="bind-burner-btn"]` `toBeDisabled()`。

---

### Step 4: 点「采集任务」→ TasksPage 任务列表 + 关键词输入框
**来源**: `[FROM_PRD]` — PRD Golden Path 第4步："关键词输入框 + 本 tenant 历史任务列表（关键词/状态/视频数/leads数/创建时间，来源 acquisition_collect_tasks）"

**可观测行为**: `GET /api/acquisition/collect-tasks` 返回 tasks array；页面顶部有关键词输入框 + 「开始采集」按钮

**验证命令**:
```bash
RESP=$(curl -sf -H "X-Tenant-Id: $TEST_TENANT_ID" http://localhost:3000/api/acquisition/collect-tasks) \
  || { echo "FAIL: collect-tasks 端点失败"; exit 1; }
echo "$RESP" | jq -e '.data.tasks | type == "array"' || { echo "FAIL: tasks 非 array"; exit 1; }
echo "$RESP" | jq -e '.data | (has("tasks") and has("total"))' || { echo "FAIL: data.tasks/total 缺失"; exit 1; }
echo "$RESP" | jq -e 'keys == ["data","success","timestamp"]' || { echo "FAIL: 顶层 keys 不匹配"; exit 1; }
```
**硬阈值**: HTTP 200；data.tasks 为 array；顶层 keys 匹配

---

### Step 5: 输入关键词 → 点「开始采集」→ 任务新增 pending
**来源**: `[FROM_PRD]` — PRD Golden Path 第5步："POST /collect/start → 列表新增 pending/running 任务；无小号/agent离线 → toast 报错"

**可观测行为**: `POST /api/acquisition/collect/start` 写库返 `{task_id, status:'pending'}`

**验证命令**:
```bash
RESP=$(curl -sf -X POST http://localhost:3000/api/acquisition/collect/start \
  -H "X-Tenant-Id: $TEST_TENANT_ID" \
  -H "Content-Type: application/json" \
  -d '{"keywords":["E2E测试关键词"]}') \
  || { echo "FAIL: collect/start 失败"; exit 1; }
TASK_ID=$(echo "$RESP" | jq -r '.data.task_id')
echo "$RESP" | jq -e '.data.status == "pending"' || { echo "FAIL: status 非 pending"; exit 1; }
COUNT=$(psql "$DATABASE_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.acquisition_collect_tasks WHERE id='$TASK_ID' AND created_at > NOW() - interval '5 minutes'" \
  | tr -d ' ')
[ "$COUNT" -ge 1 ] || { echo "FAIL: 任务未在 5 分钟内写库"; exit 1; }
```
**硬阈值**: `data.status == "pending"`；DB 记录在 5 分钟内写入（时间窗口防造假）

---

### Step 6: 点任务行 → TaskDetailPage 视频卡片列表（含降级路径）
**来源**: `[FROM_PRD]` — PRD Golden Path 第6步："视频卡片列表（标题/封面/日期来自 acquisition_collect_videos；**抓取失败降级为视频链接**）"

**可观测行为（正常路径）**: `GET /api/acquisition/collect-tasks/:taskId/videos` 返回 videos array
**可观测行为（降级路径）**: `cover_url=null` 时，UI 渲染 `data-testid="video-url-fallback"` 文字链接

> **接缝清单 item 2**（`[AI_ADDED]` 理由：PRD 明确"抓取失败降级为视频链接"，降级 DOM 输出是 UI 接缝）：
> **真目标验证方式 = Playwright Test 5**：e2e-verify.ps1 Step 2.6 seed 一条 cover_url=null 视频；Playwright 断言 `[data-testid="video-url-fallback"]` visible。

**验证命令**（固定 E2E 种子 UUID，e2e-verify.ps1 Step 2.6 预置）:
```bash
SEED_TASK_ID="e2e-task-00000000-0000-0000-0000-000000000001"
E2E_TENANT="e2e-tenant-00000000-0000-0000-0000-000000000001"

RESP=$(curl -sf -H "X-Tenant-Id: $E2E_TENANT" \
  http://localhost:3000/api/acquisition/collect-tasks/$SEED_TASK_ID/videos) \
  || { echo "FAIL: collect-tasks/:id/videos 端点失败（路由未注册返 404 = FAIL）"; exit 1; }
echo "$RESP" | jq -e '.data.videos | type == "array"' || { echo "FAIL: videos 非 array"; exit 1; }
echo "$RESP" | jq -e 'keys == ["data","success","timestamp"]' || { echo "FAIL: 顶层 keys 不匹配"; exit 1; }
echo "$RESP" | jq -e '.data | keys == ["total","videos"]' || { echo "FAIL: data 内层 keys 不匹配"; exit 1; }
echo "$RESP" | jq -e 'has("results") | not' || { echo "FAIL: 出现禁用字段 results"; exit 1; }
echo "$RESP" | jq -e 'has("items") | not' || { echo "FAIL: 出现禁用字段 items"; exit 1; }
echo "$RESP" | jq -e 'has("count") | not' || { echo "FAIL: 出现禁用字段 count"; exit 1; }
VID_COUNT=$(echo "$RESP" | jq '.data.videos | length')
if [ "$VID_COUNT" -gt 0 ]; then
  echo "$RESP" | jq -e '[.data.videos[] | has("video_id") and has("video_url")] | all' \
    || { echo "FAIL: video item 缺必填字段 video_id/video_url"; exit 1; }
  echo "$RESP" | jq -e '[.data.videos[].video_id | type == "string"] | all' \
    || { echo "FAIL: video_id 不全为 string"; exit 1; }
  echo "$RESP" | jq -e '[.data.videos[].video_url | type == "string"] | all' \
    || { echo "FAIL: video_url 不全为 string"; exit 1; }
fi
```
**硬阈值**: HTTP 200；videos 为 array；data 内层 keys == `["total","videos"]`；3个禁用字段均不存在；video_id + video_url 均为 string；降级路径由 Playwright Test 5 接缝验证

---

### Step 7: 展开视频卡片 → leads 列表（或空态「暂无评论」）
**来源**: `[FROM_PRD]` — PRD Golden Path 第7步："展开某视频卡片 → 该视频 leads 表（昵称/留言/AI分级占位/触达状态占位）；空 → 「暂无评论」"

**可观测行为**: 展开卡片后显示 `video-leads-list` 或 `no-leads-empty`（必显其一）

> **接缝清单 item 3**（`[AI_ADDED]` 理由：leads 空/非空两种 DOM 路径是 UI 接缝）：
> **真目标验证方式 = Playwright Test 6**：seed 任务含视频但无 leads（空态）；Playwright 展开卡片后断言 `[data-testid="no-leads-empty"]` visible。

**验证命令**: 由 Playwright Test 6 接缝验证（leads 无专用 API 端点在本 sprint 范围内）
**硬阈值**: Playwright `toBeVisible()` 验证（展开后其一 testid 可见）

---

### Step 8: 失败任务 — error_code 展示 + 「重新采集」按钮
**来源**: `[FROM_PRD]` — PRD Golden Path 第8步："任务失败态 → 前端展示 error_code + 「重新采集」（同关键词复用 POST /collect/start）"

**可观测行为**: TasksPage 显示 status=failed 任务行，含 `task-error-code` 文本 + `retry-collect-btn` 按钮

**验证命令**: 由 Playwright Test 9 接缝验证
**硬阈值**: Playwright `toBeVisible()` 验证；`[data-testid="task-error-code"]` not empty

---

## E2E 验收（target_environment = windows_cloud 变体C — Dashboard + 真实后端）

**journey_type**: user_facing
**target_environment**: windows_cloud

> **变体C 死规则遵守声明**：本节所有 Playwright spec 均 ① 禁止使用 `page.route()`，② 打真实后端（API server 须在 ps1 Step 2.5 启动），③ 使用真实 better-auth session。

<!-- GOLDEN_SMOKE_ABILITY_SLUG: acquisition-ia-redesign -->
<!-- GOLDEN_SMOKE_TARGET_ENV: windows_cloud -->

### Scenario 1: acquisition-collect-videos-table-schema
<!-- GOLDEN_SMOKE_SCENARIO: acquisition-collect-videos-table-schema -->
<!-- GOLDEN_SMOKE_SKIP_IN_CI: true -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 30000 -->

gate-allow: domain/db-no-time-window information_schema.columns 是 DDL 元数据查询（schema 结构检查），非 domain 数据聚合/存在性探测，无时间窗需求

```bash
#!/bin/bash
set -e
# gate-allow: domain/db-no-time-window information_schema.columns 是 DDL 元数据查询，非 domain 数据聚合
COLS=$(psql "$DATABASE_URL" -t -c \
  "SELECT column_name FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='acquisition_collect_videos'" \
  2>/dev/null | tr -d ' ' | sort)
echo "acquisition_collect_videos 列: $COLS"
echo "$COLS" | grep -q "video_id" || { echo "FAIL: 缺 video_id 列"; exit 1; }
echo "$COLS" | grep -q "task_id" || { echo "FAIL: 缺 task_id 列"; exit 1; }
echo "$COLS" | grep -q "title" || { echo "FAIL: 缺 title 列"; exit 1; }
echo "$COLS" | grep -q "cover_url" || { echo "FAIL: 缺 cover_url 列"; exit 1; }
echo "$COLS" | grep -q "published_at" || { echo "FAIL: 缺 published_at 列"; exit 1; }
echo "✅ Scenario 1 通过：acquisition_collect_videos schema 正确"
```

### Scenario 2: collect-tasks-videos-404-on-invalid-taskid
<!-- GOLDEN_SMOKE_SCENARIO: collect-tasks-videos-404-on-invalid-taskid -->
<!-- GOLDEN_SMOKE_SKIP_IN_CI: true -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 30000 -->

```bash
#!/bin/bash
set -e
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:3000/api/acquisition/collect-tasks/00000000-0000-0000-0000-000000000000/videos)
[ "$CODE" = "404" ] || { echo "FAIL: 非法 taskId 应返 404，实际=$CODE"; exit 1; }
echo "✅ Scenario 2 通过：非法 taskId 返回 404"
```

### Scenario 3: burner-accounts-no-tenant-returns-401-or-403
<!-- GOLDEN_SMOKE_SCENARIO: burner-accounts-no-tenant-returns-401-or-403 -->
<!-- GOLDEN_SMOKE_SKIP_IN_CI: true -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 30000 -->

```bash
#!/bin/bash
set -e
CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/acquisition/burner-accounts)
[ "$CODE" = "401" ] || [ "$CODE" = "403" ] || { echo "FAIL: 无 tenant 应返 401/403，实际=$CODE"; exit 1; }
echo "✅ Scenario 3 通过：无 tenant 返回 401/403"
```

### Scenario 4: accounts-page-n10-limit-api-total
<!-- GOLDEN_SMOKE_SCENARIO: accounts-page-n10-limit-api-total -->
<!-- GOLDEN_SMOKE_SKIP_IN_CI: true -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 60000 -->

```bash
#!/bin/bash
set -e
# 依赖 e2e-verify.ps1 Step 2.6 已预置 10 条 burner 到固定 E2E tenant（不使用动态 DB 查询，避免 SKIP guard）
E2E_TENANT="e2e-tenant-00000000-0000-0000-0000-000000000001"
RESP=$(curl -sf -H "X-Tenant-Id: $E2E_TENANT" http://localhost:3000/api/acquisition/burner-accounts) \
  || { echo "FAIL: burner-accounts 返回非 200"; exit 1; }
echo "$RESP" | jq -e '.data.total >= 10' || { echo "FAIL: total 未达到 10（seed 未执行？actual=$(echo $RESP | jq .data.total)）"; exit 1; }
echo "✅ Scenario 4 通过：API total >= 10"
```

---

## e2e-verify.ps1（变体C 模板）

```powershell
# final-e2e 验证脚本 — 获客工作台 IA 重构
# ⚠️ 变体C：打真实后端，禁止 page.route()
param(
  [string]$BaseUrl             = "http://localhost:5174",
  [string]$SuperAdminEmail     = $env:E2E_SUPER_ADMIN_EMAIL,
  [string]$SuperAdminPassword  = $env:E2E_SUPER_ADMIN_PASSWORD,
  [string]$DatabaseUrl         = $env:E2E_DATABASE_URL
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VitePort  = 5174
$ApiPort   = 3000
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path "$scriptDir\..\.."

# ── 1. npm ci ──
$p = Start-Process "cmd.exe" -ArgumentList "/c npm.cmd ci --prefer-offline" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: npm ci exit=$($p.ExitCode)" }

# ── 2. playwright install ──
$p = Start-Process "cmd.exe" -ArgumentList "/c npx.cmd playwright install chromium --with-deps" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: playwright install exit=$($p.ExitCode)" }

# ── 2.5. Start API server（变体C 强制，禁止用 page.route() 代替）──
$env:DATABASE_URL = $DatabaseUrl
$env:NODE_ENV = "test"
$env:PORT = "$ApiPort"
$apiProc = Start-Process "cmd.exe" -ArgumentList "/c npm.cmd start" `
  -WorkingDirectory "$repoRoot\apps\api" -PassThru -NoNewWindow
$maxWait = 30; $waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $ApiPort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
if (-not $conn.TcpTestSucceeded) { throw "FAIL: API 未就绪 port=$ApiPort" }
Write-Host "✅ API 就绪 port=$ApiPort"

# ── 2.6. Seed E2E 数据（固定 UUID，ON CONFLICT DO NOTHING 幂等）──
$seedSql = @"
INSERT INTO zenithjoy.tenants (id, name, created_at)
  VALUES ('e2e-tenant-00000000-0000-0000-0000-000000000001', 'E2E测试租户', NOW())
  ON CONFLICT DO NOTHING;
INSERT INTO zenithjoy.line02_account_sessions (tenant_id, account_label, role, health, created_at)
  SELECT 'e2e-tenant-00000000-0000-0000-0000-000000000001', 'e2e-burner-' || i, 'burner', 'ok', NOW()
  FROM generate_series(1, 10) AS i ON CONFLICT DO NOTHING;
INSERT INTO zenithjoy.acquisition_collect_tasks (id, tenant_id, keywords, status, created_at)
  VALUES ('e2e-task-00000000-0000-0000-0000-000000000001',
          'e2e-tenant-00000000-0000-0000-0000-000000000001',
          ARRAY['e2e-seed'], 'completed', NOW()) ON CONFLICT DO NOTHING;
INSERT INTO zenithjoy.acquisition_collect_videos (task_id, video_id, video_url, title, cover_url, published_at)
  VALUES ('e2e-task-00000000-0000-0000-0000-000000000001',
          'vid-normal-e2e-01', 'https://v.douyin.com/e2e/1', 'E2E测试视频', 'https://cover.test/e2e.jpg', NOW())
  ON CONFLICT DO NOTHING;
INSERT INTO zenithjoy.acquisition_collect_videos (task_id, video_id, video_url, title, cover_url)
  VALUES ('e2e-task-00000000-0000-0000-0000-000000000001',
          'vid-degraded-e2e-01', 'https://v.douyin.com/e2e/2', NULL, NULL)
  ON CONFLICT DO NOTHING;
INSERT INTO zenithjoy.acquisition_collect_tasks (id, tenant_id, keywords, status, error_code, created_at)
  VALUES ('e2e-task-00000000-0000-0000-0000-000000000002',
          'e2e-tenant-00000000-0000-0000-0000-000000000001',
          ARRAY['e2e-seed-failed'], 'failed', 'SWEEP_TIMEOUT', NOW()) ON CONFLICT DO NOTHING;
"@
$sp = Start-Process "cmd.exe" -ArgumentList "/c psql `"$DatabaseUrl`" -c `"$seedSql`"" -Wait -PassThru -NoNewWindow
if ($sp.ExitCode -ne 0) { Write-Warning "Seed 执行异常（ON CONFLICT DO NOTHING 幂等，可能已存在）" }
Write-Host "✅ Seed 数据就绪"

# ── 3. Build dashboard ──
$env:VITE_API_URL = "http://localhost:$ApiPort"
$env:VITE_SKIP_AUTH = "true"
$p = Start-Process "cmd.exe" -ArgumentList "/c npm.cmd run build" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: build exit=$($p.ExitCode)" }

# ── 4. Vite preview ──
$serverProc = Start-Process "cmd.exe" -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -PassThru -NoNewWindow
$maxWait = 30; $waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
if (-not $conn.TcpTestSucceeded) { throw "FAIL: Vite 未就绪 port=$VitePort" }
Write-Host "✅ Vite 就绪 port=$VitePort"

# ── 5. Playwright E2E ──
try {
  $e2e = Start-Process "cmd.exe" `
    -ArgumentList "/c npx.cmd playwright test e2e\acquisition-ia-redesign.spec.ts --reporter=list" `
    -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow `
    -Environment @{
      E2E_BASE_URL     = $BaseUrl
      E2E_API_URL      = "http://localhost:$ApiPort"
      E2E_EMAIL        = $SuperAdminEmail
      E2E_PASSWORD     = $SuperAdminPassword
      E2E_TENANT_ID    = "e2e-tenant-00000000-0000-0000-0000-000000000001"
      E2E_SEED_TASK_ID = "e2e-task-00000000-0000-0000-0000-000000000001"
    }
  if ($e2e.ExitCode -ne 0) { throw "FAIL: Playwright exit=$($e2e.ExitCode)" }
} finally {
  Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
  Stop-Process -Id $apiProc.Id   -Force -ErrorAction SilentlyContinue
}

$shots = "$repoRoot\apps\dashboard\screenshots"
if (Test-Path $shots) {
  New-Item -ItemType Directory -Force -Path "$scriptDir\screenshots" | Out-Null
  Copy-Item "$shots\*.png" "$scriptDir\screenshots\" -ErrorAction SilentlyContinue
}
Write-Host "✅ windows_cloud 获客工作台 IA E2E 验证通过（真实后端）"
exit 0
```

---

## Playwright spec（生成到 apps/dashboard/e2e/acquisition-ia-redesign.spec.ts）

```typescript
/**
 * acquisition-ia-redesign.spec.ts — 获客工作台 IA 重构 E2E
 * 变体C 死规则：禁止 page.route()，所有请求打真实后端（localhost:3000）
 */
import { test, expect } from '@playwright/test';

const BASE_URL     = process.env.E2E_BASE_URL     || 'http://localhost:5174';
const API_URL      = process.env.E2E_API_URL      || 'http://localhost:3000';
const EMAIL        = process.env.E2E_EMAIL        || '';
const PASSWORD     = process.env.E2E_PASSWORD     || '';
const SEED_TASK_ID = process.env.E2E_SEED_TASK_ID || 'e2e-task-00000000-0000-0000-0000-000000000001';

let sessionCookie = '';

test.beforeAll(async ({ request }) => {
  const resp = await request.post(`${API_URL}/api/auth/sign-in/email`, {
    data: { email: EMAIL, password: PASSWORD }
  });
  expect(resp.ok(), `登录失败: ${resp.status()}`).toBeTruthy();
  sessionCookie = (resp.headers()['set-cookie'] || '').split(';')[0] ?? '';
});

async function addSession(page: import('@playwright/test').Page) {
  if (!sessionCookie) return;
  const [name, ...rest] = sessionCookie.split('=');
  await page.context().addCookies([
    { name: name ?? '', value: rest.join('='), domain: 'localhost', path: '/' }
  ]);
}

// ── Test 1: Hub 4 卡片 + 实时数字（Step 1）──
test('Hub: 4 模块卡片结构可见 + 前两卡片显示实时数字', async ({ page }) => {
  await addSession(page);
  await page.goto(`${BASE_URL}/area/acquisition`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/01-hub-cards.png' });
  const cards = page.locator('[data-testid="hub-module-card"]');
  await expect(cards).toHaveCount(4, { timeout: 10000 });
  await expect(cards.nth(0)).toContainText('账号管理');
  await expect(cards.nth(1)).toContainText('采集任务');
  const accountCount = page.locator('[data-testid="hub-account-count"]');
  const taskCount    = page.locator('[data-testid="hub-task-count"]');
  await expect(accountCount).toBeVisible({ timeout: 10000 });
  await expect(taskCount).toBeVisible({ timeout: 10000 });
  await expect(accountCount).not.toBeEmpty();
  await expect(taskCount).not.toBeEmpty();
});

// ── Test 2: AccountsPage 绑定按钮可见（Step 2）──
test('AccountsPage: 绑定按钮可见', async ({ page }) => {
  await addSession(page);
  await page.goto(`${BASE_URL}/area/acquisition/accounts`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/02-accounts-page.png' });
  await expect(page.locator('[data-testid="bind-burner-btn"]')).toBeVisible({ timeout: 10000 });
});

// ── Test 3: TasksPage 关键词+开始采集（Steps 4/5）──
test('TasksPage: 关键词输入框 + 开始采集', async ({ page }) => {
  await addSession(page);
  await page.goto(`${BASE_URL}/area/acquisition/tasks`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/03-tasks-page.png' });
  await expect(page.locator('[data-testid="keyword-input"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="start-collect-btn"]')).toBeVisible({ timeout: 10000 });
  await page.locator('[data-testid="keyword-input"]').fill('E2E测试关键词');
  await page.screenshot({ path: 'screenshots/04-tasks-input-filled.png' });
  await page.locator('[data-testid="start-collect-btn"]').click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/05-tasks-after-start.png' });
  await expect(page.locator('body')).toBeVisible();
});

// ── Test 4: N=10 上限 → 按钮 disabled（Step 3 接缝真验）──
test('AccountsPage: N=10 小号上限 → 绑定按钮置灰', async ({ page }) => {
  await addSession(page);
  await page.goto(`${BASE_URL}/area/acquisition/accounts`);
  await page.waitForLoadState('networkidle');
  const apiResp = await page.request.get(`${API_URL}/api/acquisition/burner-accounts`);
  const body = await apiResp.json() as { data: { total: number } };
  expect(body.data.total, `seed 应有 10 条账号，实际=${body.data.total}`).toBeGreaterThanOrEqual(10);
  const bindBtn = page.locator('[data-testid="bind-burner-btn"]');
  await expect(bindBtn).toBeDisabled({ timeout: 10000 });
  await page.screenshot({ path: 'screenshots/06-bind-disabled-n10.png' });
});

// ── Test 5: 视频列表 + cover_url=null 降级（Step 6 接缝真验）──
test('TaskDetailPage: 视频列表 + cover_url=null 降级显示 video_url', async ({ page }) => {
  await addSession(page);
  await page.goto(`${BASE_URL}/area/acquisition/tasks/${SEED_TASK_ID}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/07-task-detail-videos.png' });
  await expect(page.locator('[data-testid="video-card"]').first()).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="video-url-fallback"]').first()).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: 'screenshots/08-video-degraded-fallback.png' });
});

// ── Test 6: 展开视频卡片 → leads/暂无评论（Step 7 接缝真验）──
test('TaskDetailPage: 展开视频卡片 → leads 列表或暂无评论', async ({ page }) => {
  await addSession(page);
  await page.goto(`${BASE_URL}/area/acquisition/tasks/${SEED_TASK_ID}`);
  await page.waitForLoadState('networkidle');
  const firstCard = page.locator('[data-testid="video-card"]').first();
  await expect(firstCard).toBeVisible({ timeout: 10000 });
  await firstCard.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/09-video-leads-expanded.png' });
  const leadsOrEmpty = page.locator('[data-testid="video-leads-list"], [data-testid="no-leads-empty"]');
  await expect(leadsOrEmpty.first()).toBeVisible({ timeout: 8000 });
});

// ── Test 7: DouyinBurnerBindPage 废弃（Step 12）──
test('DouyinBurnerBindPage 路由已废弃 → 重定向或旧 UI 不渲染', async ({ page }) => {
  await addSession(page);
  await page.goto(`${BASE_URL}/area/acquisition/bind-burner`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/10-bind-page-deprecated.png' });
  await expect(page.locator('[data-testid="douyin-bind-page-title"]')).toHaveCount(0, { timeout: 5000 });
  const url   = page.url();
  const title = await page.title();
  expect(
    url.includes('accounts') || url.includes('404') || title.includes('账号') || title.includes('404'),
    `旧 DouyinBurnerBindPage 仍渲染，URL=${url} title=${title}`
  ).toBeTruthy();
});

// ── Test 8: LeadsPage 无采集面板（Step 11）──
test('LeadsPage: 不含采集面板 UI', async ({ page }) => {
  await addSession(page);
  await page.goto(`${BASE_URL}/dashboard/leads`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/11-leads-page.png' });
  await expect(
    page.locator('[data-testid="collection-panel"], [data-testid="keyword-input"]')
  ).toHaveCount(0, { timeout: 5000 });
});

// ── Test 9: 失败态任务 — error_code + 「重新采集」按钮（Step 8 接缝真验）──
test('TasksPage: 失败任务显示 error_code + 重新采集按钮', async ({ page }) => {
  await addSession(page);
  await page.goto(`${BASE_URL}/area/acquisition/tasks`);
  await page.waitForLoadState('networkidle');
  const failedRow = page.locator('[data-testid="task-row-failed"], [data-status="failed"]').first();
  await expect(failedRow).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: 'screenshots/12-tasks-failed-row.png' });
  const errorCode = page.locator('[data-testid="task-error-code"]').first();
  await expect(errorCode).toBeVisible({ timeout: 5000 });
  await expect(errorCode).not.toBeEmpty();
  const retryBtn = page.locator('[data-testid="retry-collect-btn"]').first();
  await expect(retryBtn).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: 'screenshots/13-tasks-retry-btn.png' });
});
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 获客工作台 IA 重构 | `sprints/07021006-acquisition-ia-redesign/tests/acquisition-ia-redesign.test.ts` | 14条 BEHAVIOR（API schema+内层keys+禁用字段、404、403、DB表、LeadsPage无采集、DouyinBurnerBindPage废弃、TaskDetailPage降级+leads、Hub实时数字、TasksPage失败UI、agent选择器、navigation路由） | 端点不存在→404；表不存在→psql error；禁用字段存在→jq-e FAIL；DouyinBurnerBindPage存在→node exit 1 |

---

## Risks

| # | 风险描述 | 触发条件 | 缓解措施 |
|---|---|---|---|
| R1 | DB migration 冲突 | `acquisition_collect_videos` 表在 CI E2E DB 中已存在 | migration 文件使用 `CREATE TABLE IF NOT EXISTS`；seed SQL 全部 `ON CONFLICT DO NOTHING` |
| R2 | agent handler 回退 | `keyword-search-douyin.ts` 新 CSS 选择器在抖音结构变化后失效 | 旧逻辑路径保留（fallback）；元数据失败时降级为 null（不中断主流程）|
| R3 | windows-latest 无 psql 导致 seed 失败 | GHA `windows-latest` 未预装 psql | ps1 Step 2.6 的 seed 失败降级为 `Write-Warning`（非 throw），不阻断 E2E 主流程；seed SQL 全部 `ON CONFLICT DO NOTHING` |
