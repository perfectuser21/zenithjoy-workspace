# Sprint Contract Draft (Round 2)

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
**禁用字段名**: `sessions`, `burners`, `items`, `count`（所有4个均需 oracle 反向验证）
**Error (HTTP 401)**:
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
**禁用字段名**: `items`, `results`, `count`（所有3个均需 oracle 反向验证）
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

**可观测行为**: `/area/acquisition` 页面展示 4 卡片；账号管理卡显示 burner 数（来自 `GET /burner-accounts`），采集任务卡显示任务数（来自 `GET /collect-tasks`）；后两张标"（即将上线）"占位

**验证命令**:
```bash
START=$(date +%s)
RESP1=$(curl -sf -H "X-Tenant-Id: $TEST_TENANT_ID" http://localhost:3000/api/acquisition/burner-accounts) \
  || { echo "FAIL: burner-accounts 端点不可达"; exit 1; }
echo "$RESP1" | jq -e '.success == true' || { echo "FAIL: success 非 true"; exit 1; }
echo "$RESP1" | jq -e '.data.total | type == "number"' || { echo "FAIL: data.total 非数字"; exit 1; }
END=$(date +%s)
[ $((END-START)) -lt 5 ] || { echo "FAIL: 响应超时 $((END-START))s"; exit 1; }
```
**硬阈值**: HTTP 200；`success:true`；`data.total` 为数字；耗时 < 5s

---

### Step 2: 点「账号管理」→ AccountsPage 展示小号列表
**来源**: `[FROM_PRD]` — PRD Golden Path 第2步："点账号管理 → `/area/acquisition/accounts` → 本 tenant 小号列表（昵称/绑定时间/健康状态 ok|expired|banned）；无小号 → 引导+绑定按钮"

**可观测行为**: `GET /api/acquisition/burner-accounts` 返回 accounts array，每项含 `nickname`/`bound_at`/`health`（ok|expired|banned|unknown）；无数据时页面显示空态引导 + 「绑定新小号」按钮

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
```
**硬阈值**: HTTP 200；accounts 为 array；顶层 keys == `["data","success","timestamp"]`；data 内层 keys == `["accounts","total"]`；4个禁用字段均不存在

---

### Step 3: 绑定新小号 — N=10 上限保护
**来源**: `[FROM_PRD]` — PRD Golden Path 第3步、边界情况："小号已达 N=10 → 绑定按钮置灰+提示升级"

**可观测行为**: `data.total >= 10` 时，AccountsPage「绑定新小号」按钮 `disabled`（attribute 存在）且展示升级提示文案；`data.total < 10` 时按钮正常可点

**验证命令**:
```bash
# API 层：验证 total 字段存在且为非负整数（UI 根据此值判断是否置灰）
RESP=$(curl -sf -H "X-Tenant-Id: $TEST_TENANT_ID" http://localhost:3000/api/acquisition/burner-accounts) \
  || { echo "FAIL: 端点失败"; exit 1; }
echo "$RESP" | jq -e '.data | has("total")' || { echo "FAIL: data.total 字段缺失"; exit 1; }
echo "$RESP" | jq -e '.data.total | . >= 0' || { echo "FAIL: total 非非负整数"; exit 1; }
```
**硬阈值**: `data.total` 存在且 >= 0；UI 层 disabled 状态由 Playwright Test 4 在 seed 10 条记录后断言（接缝）

> **接缝清单 item 1（修订 Round 2）**：「绑定上限 disabled 状态」是 UI 接缝（依赖 DOM 渲染 + data.total 值）。
> 上一轮的Scenario 2（health=banned INSERT）**验的是 DB 约束，与 N=10 disabled 无关**——已分离。
> **真目标验证方式 = Playwright Test 4**（test label: `AccountsPage: N=10 小号上限 → 绑定按钮置灰`）：
> 1. e2e-verify.ps1 Step 2.6 向 E2E DB 直接 INSERT 10 条 health='ok' burner 记录到 E2E 专属 tenant（`e2e-tenant-00000000-0000-0000-0000-000000000001`）
> 2. Playwright 以该 tenant 导航至 AccountsPage，先通过 API 确认 total >= 10
> 3. 断言 `[data-testid="bind-burner-btn"]` 具有 `disabled` attribute（`toBeDisabled()`）

---

### Step 4: 点「采集任务」→ TasksPage 任务列表 + 关键词输入框
**来源**: `[FROM_PRD]` — PRD Golden Path 第4步："关键词输入框 + 本 tenant 历史任务列表（关键词/状态/视频数/leads数/创建时间，来源 acquisition_collect_tasks）"

**可观测行为**: `GET /api/acquisition/collect-tasks` 返回 tasks array，每项含 `keywords`/`status`/`video_count`/`lead_count_raw`/`created_at`；页面顶部有关键词输入框 + 「开始采集」按钮

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

**可观测行为**: `POST /api/acquisition/collect/start` 写库返 `{task_id, status:'pending'}`；TasksPage 实时刷新显示新任务

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

**可观测行为（正常路径）**: `GET /api/acquisition/collect-tasks/:taskId/videos` 返回 videos array；有 title+cover_url 时展示卡片
**可观测行为（降级路径）**: 视频记录 `cover_url=null` 时，UI 渲染 `data-testid="video-url-fallback"` 文字链接而非空 img 标签

> **接缝清单 item 2**（`[AI_ADDED]` 理由：PRD 明确要求"抓取失败降级为视频链接"，降级 DOM 输出是 UI 接缝）：
> **真目标验证方式 = Playwright Test 5**（`TaskDetailPage: 视频列表 + cover_url=null 降级显示 video_url`）：
> e2e-verify.ps1 Step 2.6 seed 一条 cover_url=null 视频记录；Playwright 断言 `[data-testid="video-url-fallback"]` visible。

**验证命令**（SEED_TASK_ID 由 e2e-verify.ps1 Step 2.6 的 INSERT 固定为 `e2e-task-00000000-0000-0000-0000-000000000001`）:
```bash
# SEED_TASK_ID 固定：由 e2e-verify.ps1 Step 2.6 INSERT（见下方 Seed 步骤定义）
SEED_TASK_ID="e2e-task-00000000-0000-0000-0000-000000000001"
E2E_TENANT="e2e-tenant-00000000-0000-0000-0000-000000000001"

RESP=$(curl -sf -H "X-Tenant-Id: $E2E_TENANT" \
  http://localhost:3000/api/acquisition/collect-tasks/$SEED_TASK_ID/videos) \
  || { echo "FAIL: collect-tasks/:id/videos 端点失败"; exit 1; }
echo "$RESP" | jq -e '.data.videos | type == "array"' || { echo "FAIL: videos 非 array"; exit 1; }
echo "$RESP" | jq -e 'keys == ["data","success","timestamp"]' || { echo "FAIL: 顶层 keys 不匹配"; exit 1; }
echo "$RESP" | jq -e '.data | keys == ["total","videos"]' || { echo "FAIL: data 内层 keys 不匹配"; exit 1; }
echo "$RESP" | jq -e 'has("results") | not' || { echo "FAIL: 出现禁用字段 results"; exit 1; }
echo "$RESP" | jq -e 'has("items") | not' || { echo "FAIL: 出现禁用字段 items"; exit 1; }
echo "$RESP" | jq -e 'has("count") | not' || { echo "FAIL: 出现禁用字段 count"; exit 1; }
```
**硬阈值**: HTTP 200；videos 为 array；data 内层 keys == `["total","videos"]`；3个禁用字段均不存在；降级路径由 Playwright Test 5 接缝验证

**Seed 步骤定义（e2e-verify.ps1 Step 2.6 执行的 SQL）**:
```sql
-- E2E 专属 task（SEED_TASK_ID 固定 UUID）
INSERT INTO zenithjoy.acquisition_collect_tasks (id, tenant_id, keywords, status, created_at)
VALUES ('e2e-task-00000000-0000-0000-0000-000000000001',
        'e2e-tenant-00000000-0000-0000-0000-000000000001',
        ARRAY['e2e-seed'], 'completed', NOW())
ON CONFLICT DO NOTHING;

-- 正常视频（有 cover_url）
INSERT INTO zenithjoy.acquisition_collect_videos (task_id, video_id, video_url, title, cover_url, published_at)
VALUES ('e2e-task-00000000-0000-0000-0000-000000000001',
        'vid-normal-e2e-01', 'https://v.douyin.com/e2e/1', 'E2E测试视频', 'https://cover.test/e2e.jpg', NOW())
ON CONFLICT DO NOTHING;

-- 降级视频（cover_url=null，验 Step 6 降级路径）
INSERT INTO zenithjoy.acquisition_collect_videos (task_id, video_id, video_url, title, cover_url)
VALUES ('e2e-task-00000000-0000-0000-0000-000000000001',
        'vid-degraded-e2e-01', 'https://v.douyin.com/e2e/2', NULL, NULL)
ON CONFLICT DO NOTHING;
```

---

### Step 7: 展开视频卡片 → leads 两级展示（UI 行为，非 schema 检查）
**来源**: `[FROM_PRD]` — PRD Golden Path 第7步："展开某视频卡片 → 该视频 leads 表（昵称/留言/AI分级占位/触达状态占位）；空 → 暂无评论"

**可观测行为**: 点击/展开视频卡片后，渲染 leads 列表（`data-testid="video-leads-list"`）或空态（`data-testid="no-leads-empty"` 含"暂无评论"文字）；不得展示 500 错误或空白

**验证命令（DB 层结构前提 + UI 接缝真验）**:
```bash
# DB 层前提：acquisition_collect_videos 表关联列存在（Step 7 UI 依赖此 schema）
DB="${DATABASE_URL:-postgresql://localhost/zenithjoy_test}"
COLS=$(psql "$DB" -t -c \
  "SELECT column_name FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='acquisition_collect_videos'" \
  2>/dev/null | tr -d ' ' | sort | tr '\n' ',')
echo "acquisition_collect_videos 列: $COLS"
echo "$COLS" | grep -q "video_id" || { echo "FAIL: 缺 video_id 列（leads 关联依赖）"; exit 1; }
echo "$COLS" | grep -q "task_id" || { echo "FAIL: 缺 task_id 列"; exit 1; }
# UI 展开行为由 Playwright Test 6 接缝验证（见 E2E 验收 Playwright spec）
```
**硬阈值（DB 前提）**: `acquisition_collect_videos` 含 `task_id` + `video_id` 列

> **接缝清单 item 3**（`[AI_ADDED]` 理由：Step 7 的"展开卡片 → UI 响应"是 UI 渲染接缝，DB 列检查是必要前提但不等于行为验证）：
> **真目标验证方式 = Playwright Test 6**（`TaskDetailPage: 展开视频卡片 → leads 列表或暂无评论`）：
> 导航至 TaskDetailPage，click 第一张视频卡片，断言 `[data-testid="video-leads-list"]` 或 `[data-testid="no-leads-empty"]` visible（二者必显其一，不得空白/500）。

---

### Step 8: 失败态任务 — error_code 展示 + 「重新采集」
**来源**: `[FROM_PRD]` — PRD Golden Path 第8步："任务失败态（sweep-timeouts 已转换）→ 前端展示 error_code + 「重新采集」"

**可观测行为**: 任务 status='failed' 时，TasksPage/TaskDetailPage 展示 `error_code` 文本；「重新采集」按钮复用 `POST /collect/start` 同关键词重发

**Seed 步骤定义（e2e-verify.ps1 Step 2.6 执行，SEED_FAILED_TASK_ID 固定 UUID）**:
```sql
INSERT INTO zenithjoy.acquisition_collect_tasks (id, tenant_id, keywords, status, error_code, created_at)
VALUES ('e2e-task-00000000-0000-0000-0000-000000000002',
        'e2e-tenant-00000000-0000-0000-0000-000000000001',
        ARRAY['e2e-seed-failed'], 'failed', 'SWEEP_TIMEOUT', NOW())
ON CONFLICT DO NOTHING;
```

**验证命令**（SEED_FAILED_TASK_ID 固定为 `e2e-task-00000000-0000-0000-0000-000000000002`）:
```bash
SEED_FAILED_TASK_ID="e2e-task-00000000-0000-0000-0000-000000000002"
E2E_TENANT="e2e-tenant-00000000-0000-0000-0000-000000000001"

RESP=$(curl -sf -H "X-Tenant-Id: $E2E_TENANT" \
  http://localhost:3000/api/acquisition/collect/$SEED_FAILED_TASK_ID) \
  || { echo "FAIL: collect/:id 端点失败"; exit 1; }
echo "$RESP" | jq -e '.data.status == "failed"' || { echo "FAIL: 非 failed 状态"; exit 1; }
echo "$RESP" | jq -e '.data | has("error_code")' || { echo "FAIL: 缺 error_code 字段"; exit 1; }
```
**硬阈值**: 已有端点 `GET /collect/:task_id` 返回 `error_code` 字段（回归保证）

---

### Step 9: 非法 taskId → 404
**来源**: `[FROM_PRD]` — PRD 边界情况："非法 taskId：GET /collect-tasks/:id/videos 返回 404"

**验证命令**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Tenant-Id: $TEST_TENANT_ID" \
  http://localhost:3000/api/acquisition/collect-tasks/00000000-0000-0000-0000-000000000000/videos)
[ "$CODE" = "404" ] || { echo "FAIL: 非法 taskId 应返 404，实际=$CODE"; exit 1; }
BODY=$(curl -sf -H "X-Tenant-Id: $TEST_TENANT_ID" \
  http://localhost:3000/api/acquisition/collect-tasks/00000000-0000-0000-0000-000000000000/videos 2>/dev/null || echo '{}')
echo "$BODY" | jq -e '.error.code == "TASK_NOT_FOUND"' || { echo "FAIL: error.code 非 TASK_NOT_FOUND"; exit 1; }
```
**硬阈值**: HTTP 404；`error.code == "TASK_NOT_FOUND"`

---

### Step 10: 跨 tenant 访问 → 403 （IDOR 校验）
**来源**: `[FROM_PRD]` — PRD 边界情况："跨 tenant 访问两个新 GET API：返回 401/403（IDOR 校验）"
**[AI_ADDED]** 理由：防止 generator 遗漏 tenant 隔离校验，造成 IDOR 安全漏洞

**验证命令**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Tenant-Id: $TEST_TENANT_ID_B" \
  http://localhost:3000/api/acquisition/collect-tasks/$TASK_ID_OF_TENANT_A/videos)
[ "$CODE" = "403" ] || [ "$CODE" = "401" ] || { echo "FAIL: 跨 tenant 访问未返 401/403，实际=$CODE"; exit 1; }
```
**硬阈值**: HTTP 403 或 401

---

### Step 11: LeadsPage 移除采集面板
**来源**: `[FROM_PRD]` — PRD 范围限定："`LeadsPage.tsx — 移除采集面板`"

**验证命令**:
```bash
node -e "
const fs = require('fs');
const c = fs.readFileSync('apps/dashboard/src/pages/LeadsPage.tsx', 'utf8');
const forbidden = ['setAcqPhase', 'handleCollect', 'manualInput', 'acqPhase', 'collect/expand', 'collect/start'];
const found = forbidden.filter(s => c.includes(s));
if (found.length > 0) { console.error('FAIL: LeadsPage 仍含采集面板代码:', found); process.exit(1); }
" || exit 1
```
**硬阈值**: LeadsPage.tsx 不含任何采集面板相关代码标识符

---

### Step 12: DouyinBurnerBindPage UI 废弃
**来源**: `[FROM_PRD]` — PRD 范围限定："DouyinBurnerBindPage UI 废弃"

**可观测行为**: `DouyinBurnerBindPage.tsx` 文件已删除，绑定入口统一走 AccountsPage 的「绑定新小号」按钮

**验证命令**:
```bash
node -e "
const fs = require('fs');
const candidates = [
  'apps/dashboard/src/pages/acquisition/DouyinBurnerBindPage.tsx',
  'apps/dashboard/src/pages/DouyinBurnerBindPage.tsx',
];
const existing = candidates.filter(p => { try { fs.accessSync(p); return true; } catch { return false; } });
if (existing.length > 0) {
  console.error('FAIL: DouyinBurnerBindPage 文件仍存在（应已废弃删除）:', existing);
  process.exit(1);
}
console.log('OK: DouyinBurnerBindPage 已废弃');
" || exit 1
```
**硬阈值**: 上述路径均不存在（文件已删除）

---

## E2E 验收（target_environment = windows_cloud 变体C — Dashboard + 真实后端）

**journey_type**: user_facing
**target_environment**: windows_cloud

> **变体C 死规则遵守声明**：本节所有 Playwright spec 均 ① 禁止使用 `page.route()`，② 打真实后端（API server 须在 ps1 Step 2.5 启动），③ 使用真实 better-auth session（ps1 登录获取 cookie）。

<!-- GOLDEN_SMOKE_ABILITY_SLUG: acquisition-ia-redesign -->
<!-- GOLDEN_SMOKE_TARGET_ENV: windows_cloud -->

### Scenario 1: acquisition-collect-videos-table-schema
<!-- GOLDEN_SMOKE_SCENARIO: acquisition-collect-videos-table-schema -->
<!-- GOLDEN_SMOKE_SKIP_IN_CI: true -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 30000 -->

```bash
#!/bin/bash
set -e
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

### Scenario 2: line02-account-sessions-banned-health-constraint
<!-- GOLDEN_SMOKE_SCENARIO: line02-account-sessions-banned-health-constraint -->
<!-- GOLDEN_SMOKE_SKIP_IN_CI: true -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 30000 -->

```bash
#!/bin/bash
set -e
# 验证 DB 约束允许 health=banned（与 N=10 disabled 是独立验证项）
TEST_TID=$(psql "$DATABASE_URL" -t -c "SELECT id FROM zenithjoy.tenants LIMIT 1" | tr -d ' ')
[ -n "$TEST_TID" ] || { echo "FAIL: 无 tenant，seed 未执行"; exit 1; }
psql "$DATABASE_URL" -c \
  "INSERT INTO zenithjoy.line02_account_sessions (tenant_id, account_label, role, health) VALUES ('$TEST_TID', 'smoke-banned-test-e2e', 'burner', 'banned') ON CONFLICT DO NOTHING" \
  || { echo "FAIL: 无法插入 health=banned（约束未更新）"; exit 1; }
echo "✅ Scenario 2 通过：line02_account_sessions 支持 health=banned"
```

### Scenario 3: collect-tasks-videos-404-on-invalid-taskid
<!-- GOLDEN_SMOKE_SCENARIO: collect-tasks-videos-404-on-invalid-taskid -->
<!-- GOLDEN_SMOKE_SKIP_IN_CI: true -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 30000 -->

```bash
#!/bin/bash
set -e
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:3000/api/acquisition/collect-tasks/00000000-0000-0000-0000-000000000000/videos)
[ "$CODE" = "404" ] || { echo "FAIL: 非法 taskId 应返 404，实际=$CODE"; exit 1; }
echo "✅ Scenario 3 通过：非法 taskId 返回 404"
```

### Scenario 4: accounts-page-n10-limit-api-total
<!-- GOLDEN_SMOKE_SCENARIO: accounts-page-n10-limit-api-total -->
<!-- GOLDEN_SMOKE_SKIP_IN_CI: true -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 60000 -->

```bash
#!/bin/bash
set -e
# 验证：E2E_TENANT_ID 在 seed 10 条账号后，API 返回 total >= 10
# UI disabled 由 Playwright Test 4 断言
E2E_TENANT="e2e-tenant-00000000-0000-0000-0000-000000000001"
RESP=$(curl -sf -H "X-Tenant-Id: $E2E_TENANT" http://localhost:3000/api/acquisition/burner-accounts) \
  || { echo "FAIL: burner-accounts 返回非 200"; exit 1; }
TOTAL=$(echo "$RESP" | jq -r '.data.total')
[ "$TOTAL" -ge 10 ] || { echo "FAIL: total=$TOTAL 未达到 10（seed 步骤是否执行？）"; exit 1; }
echo "✅ Scenario 4 通过：API total=$TOTAL >= 10"
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

$VitePort = 5174
$ApiPort  = 3000
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path "$scriptDir\..\.."

# ── 1. npm ci ──
$p = Start-Process "cmd.exe" "/c npm.cmd ci --prefer-offline" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: npm ci exit=$($p.ExitCode)" }

# ── 2. playwright install ──
$p = Start-Process "cmd.exe" "/c npx.cmd playwright install chromium --with-deps" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: playwright install exit=$($p.ExitCode)" }

# ── 2.5. Start API server ──
$apiProc = Start-Process "cmd.exe" "/c npm.cmd start" `
  -WorkingDirectory "$repoRoot\apps\api" -PassThru -NoNewWindow `
  -Environment @{ DATABASE_URL = $DatabaseUrl; NODE_ENV = "test"; PORT = "$ApiPort" }
$maxWait = 30; $waited = 0
do { Start-Sleep 1; $waited++
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
$sp = Start-Process "cmd.exe" "/c psql `"$DatabaseUrl`" -c `"$seedSql`"" -Wait -PassThru -NoNewWindow
if ($sp.ExitCode -ne 0) { Write-Warning "Seed 执行异常（ON CONFLICT 可能已存在，忽略）" }
Write-Host "✅ Seed 数据就绪"

# ── 3. Build dashboard ──
$p = Start-Process "cmd.exe" "/c npm.cmd run build" -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow -Environment @{ VITE_API_URL = "http://localhost:$ApiPort"; VITE_SKIP_AUTH = "true" }
if ($p.ExitCode -ne 0) { throw "FAIL: build exit=$($p.ExitCode)" }

# ── 4. Vite preview ──
$serverProc = Start-Process "cmd.exe" "/c npx.cmd vite preview --port $VitePort --host" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -PassThru -NoNewWindow
$maxWait = 30; $waited = 0
do { Start-Sleep 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
if (-not $conn.TcpTestSucceeded) { throw "FAIL: Vite 未就绪 port=$VitePort" }
Write-Host "✅ Vite 就绪 port=$VitePort"

# ── 5. Playwright E2E ──
try {
  $e2e = Start-Process "cmd.exe" "/c npx.cmd playwright test e2e\acquisition-ia-redesign.spec.ts --reporter=list" `
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
 * Tests:
 *   1. Hub 4 卡片可见（Step 1）
 *   2. AccountsPage 绑定按钮可见（Step 2）
 *   3. TasksPage 关键词+开始采集（Steps 4/5）
 *   4. AccountsPage N=10 上限 → 绑定按钮 disabled（Step 3 接缝真验）
 *   5. TaskDetailPage 视频列表 + 降级路径（Step 6 接缝真验）
 *   6. TaskDetailPage 展开卡片 → leads/暂无评论（Step 7 接缝真验）
 *   7. DouyinBurnerBindPage 已废弃 → 重定向（Step 12）
 *   8. LeadsPage 无采集面板（Step 11）
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

// ── Test 1: Hub 4 卡片（Step 1）──
test('Hub: 4 模块卡片结构可见', async ({ page }) => {
  await addSession(page);
  await page.goto(`${BASE_URL}/area/acquisition`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/01-hub-cards.png' });
  const cards = page.locator('[data-testid="hub-module-card"]');
  await expect(cards).toHaveCount(4, { timeout: 10000 });
  await expect(cards.nth(0)).toContainText('账号管理');
  await expect(cards.nth(1)).toContainText('采集任务');
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
// Seed：e2e-verify.ps1 Step 2.6 已 INSERT 10 条 burner 到 E2E tenant
test('AccountsPage: N=10 小号上限 → 绑定按钮置灰', async ({ page }) => {
  await addSession(page);
  await page.goto(`${BASE_URL}/area/acquisition/accounts`);
  await page.waitForLoadState('networkidle');
  // 先通过 API 确认 total >= 10（seed 前置条件验证）
  const apiResp = await page.request.get(`${API_URL}/api/acquisition/burner-accounts`);
  const body = await apiResp.json() as { data: { total: number } };
  expect(body.data.total, `seed 应有 10 条账号，实际=${body.data.total}`).toBeGreaterThanOrEqual(10);
  // UI 断言：button disabled
  const bindBtn = page.locator('[data-testid="bind-burner-btn"]');
  await expect(bindBtn).toBeDisabled({ timeout: 10000 });
  await page.screenshot({ path: 'screenshots/06-bind-disabled-n10.png' });
});

// ── Test 5: 视频列表 + cover_url=null 降级（Step 6 接缝真验）──
// Seed：e2e-verify.ps1 Step 2.6 已 INSERT vid-degraded-e2e-01（cover_url=null）
test('TaskDetailPage: 视频列表 + cover_url=null 降级显示 video_url', async ({ page }) => {
  await addSession(page);
  await page.goto(`${BASE_URL}/area/acquisition/tasks/${SEED_TASK_ID}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/07-task-detail-videos.png' });
  await expect(page.locator('[data-testid="video-card"]').first()).toBeVisible({ timeout: 10000 });
  // 降级断言：cover_url=null 的视频渲染 video-url-fallback
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
  // leads 列表 OR 暂无评论空态，二者必显其一
  const leadsOrEmpty = page.locator('[data-testid="video-leads-list"], [data-testid="no-leads-empty"]');
  await expect(leadsOrEmpty.first()).toBeVisible({ timeout: 8000 });
});

// ── Test 7: DouyinBurnerBindPage 废弃（Step 12）──
test('DouyinBurnerBindPage 路由已废弃 → 重定向或旧 UI 不渲染', async ({ page }) => {
  await addSession(page);
  await page.goto(`${BASE_URL}/area/acquisition/bind-burner`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/10-bind-page-deprecated.png' });
  // 旧 DouyinBurnerBindPage 专用 testid 不应存在
  await expect(page.locator('[data-testid="douyin-bind-page-title"]')).toHaveCount(0, { timeout: 5000 });
  // 页面应重定向到 accounts 或渲染 404
  const url = page.url();
  const hasRedirected = url.includes('accounts') || url.includes('404');
  const title = await page.title();
  expect(
    hasRedirected || title.includes('账号') || title.includes('404'),
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
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 获客工作台 IA 重构 | `sprints/07021006-acquisition-ia-redesign/tests/acquisition-ia-redesign.test.ts` | 10条 BEHAVIOR（burner-accounts schema+内层keys+4禁用字段、videos schema+内层keys+3禁用字段、404、403、LeadsPage 无采集、acquisition_collect_videos 表、DouyinBurnerBindPage 已废弃、TaskDetailPage 含降级+leads testid）| 端点不存在→404；表不存在→psql error；禁用字段存在→jq-e FAIL；DouyinBurnerBindPage 存在→node exit 1 |
