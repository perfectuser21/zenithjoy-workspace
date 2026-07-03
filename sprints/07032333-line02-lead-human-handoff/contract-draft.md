# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: api_registry 推导 + PRD 字面）

### Endpoint: GET /api/acquisition/leads

**Success (HTTP 200)**:
```json
{
  "leads": [
    {
      "commenter_id": "string",
      "profile_url": "string|null",
      "comment_text": "string",
      "source_video_url": "string",
      "crawled_at": "string",
      "grade": "string",
      "keyword": "string",
      "latest_reply": "string|null",
      "latest_reply_at": "string|null",
      "assignee": "string|null"
    }
  ],
  "total": "number"
}
```

字段说明：
- `commenter_id` (string, 已有): 评论者昵称
- `profile_url` (string|null, 已有): 评论者主页链接
- `comment_text` (string, 已有): 评论正文
- `source_video_url` (string, 已有): 来源视频链接
- `crawled_at` (string, 已有): 采集时间戳 ISO 8601
- `grade` (string, 已有): 评级（感兴趣/精准/高意向）
- `keyword` (string, 已有): 触发关键词
- `latest_reply` (string|null, **新增**): 对方对我方公开回复的最新一条文本；无回复则 null
- `latest_reply_at` (string|null, **新增**): 最新回复时间戳 ISO 8601；无回复则 null
- `assignee` (string|null, **新增**): 负责人名称（来自 ASSIGNEE_ROSTER 取模轮询）；名单为空时 null

**禁用字段名（generator 不得出现在 response）**: `reply_text`, `last_reply`, `responder`, `owner`, `handler`, `responsible_person`

**Error (HTTP 400)**:
```json
{"error": "INVALID_GRADE"}
```
**Error (HTTP 401)**:
```json
{"error": "NO_TENANT", "message": "缺租户上下文（未登录或无 X-Tenant-Id）"}
```

---

## 已知约束（来自回归测试）

- `apps/api/src/routes/acquisition.test.ts` → `GET /api/acquisition/overview` 返回 {enabled,feature,capabilities,version}；`POST /keyword-search` 缺 keyword 返 400
- `apps/dashboard/src/pages/__tests__/LeadsPage.test.tsx` → LeadsPage AG Grid 固定像素高度（≥400px），禁止 `height:'100%'`（regression #1023）
- `apps/dashboard/src/pages/__tests__/no-placeholder-tenant.test.ts` → LeadsPage 不硬编码 TENANT_ID
- `apps/dashboard/src/pages/AcquisitionTasksPage.test.tsx` → 使用账号下拉只列 active sessions；选中账号后显示将在哪台机器运行

---

## Golden Path

**入口**: 系统定时轮询已触达 lead 的视频评论区 → 捕获回复 → 写库 + 飞书 → 新 lead 分配负责人

[触发轮询] → [捕获对方回复] → [写 latest_reply + latest_reply_at] → [更新飞书"最新回复"列] → [新 lead 写 assignee] → [Dashboard 统一 LeadsTable 展示]

---

### Step 1: 系统从已触达 lead 查询对应视频评论区找对方回复
**来源**: `[FROM_PRD]` — PRD 步骤1：轮询时从 acquisition_leads 取已触达（有 comment_replied_at）的 lead → 查其 source_video_ids 对应视频评论区 → 找到对方昵称对我方评论的公开回复

**可观测行为**:
- 有 `comment_replied_at IS NOT NULL` 的 lead → 触发评论区扫描
- 找到对方回复后 `acquisition_leads.latest_reply` 更新为最新一条回复文本（多条取时间最新）
- `latest_reply_at` 同步更新为该回复时间戳

**验证命令**:
```bash
# 带时间窗口：确认是本次轮询的写入，不是历史数据
COUNT=$(psql "$DATABASE_URL" -t -c "
  SELECT count(*) FROM zenithjoy.acquisition_leads
  WHERE latest_reply IS NOT NULL
  AND latest_reply_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$COUNT" -ge 1 ] || { echo "FAIL: latest_reply 未在5分钟内写入"; exit 1; }
echo OK
```

**硬阈值**: latest_reply IS NOT NULL，latest_reply_at 在 5 分钟时间窗口内

---

### Step 2: 找到回复后更新飞书"最新回复"列
**来源**: `[FROM_PRD]` — PRD 步骤2：找到回复 → 写入 acquisition_leads.latest_reply + latest_reply_at → 更新飞书 Lead 表"最新回复"列；飞书写入失败记 feishu_write_status=failed，可重试（不得标 200/成功）

**可观测行为**:
- 飞书写入尝试后，`feishu_write_status` 为 `success` 或 `failed`（不允许仍为 `pending`）
- 飞书写入失败不阻断 DB 更新（lead 已落库）

**验证命令**:
```bash
# 验证 feishu_write_status 在 latest_reply 更新后被设为非 pending
STATUS=$(psql "$DATABASE_URL" -t -c "
  SELECT feishu_write_status FROM zenithjoy.acquisition_leads
  WHERE latest_reply IS NOT NULL
  AND updated_at > NOW() - interval '5 minutes'
  ORDER BY updated_at DESC LIMIT 1" | tr -d ' \n')
[ "$STATUS" = "success" ] || [ "$STATUS" = "failed" ] || { echo "FAIL: feishu_write_status=$STATUS（不应为 pending）"; exit 1; }
echo OK
```

**硬阈值**: feishu_write_status ∈ {success, failed}，5 分钟内更新

> **接缝断言（真实飞书验证）**: 飞书 Bitable "最新回复"列有真实数据需 FEISHU_APP_TOKEN + BITABLE_TOKEN 真环境验证，CI 阶段 logic-done-pending。

---

### Step 3: 新 Lead 落库时按 ASSIGNEE_ROSTER 取模轮询分配 assignee
**来源**: `[FROM_PRD]` — PRD 步骤3：新 Lead 落库时从配置项 assignee_roster 按当天 lead 计数取模轮询 → 写入 acquisition_leads.assignee → 写入飞书 Lead 表"负责人"列

**可观测行为**:
- 新写入的 lead 有非 NULL 的 `assignee`，值来自 `ASSIGNEE_ROSTER` 环境变量（JSON 数组）
- `ASSIGNEE_ROSTER` 为空时，`assignee` 写 NULL，记 warn 日志，不阻断 lead 写入

**验证命令**:
```bash
# 验证新 lead 有 assignee（带时间窗口）
COUNT=$(psql "$DATABASE_URL" -t -c "
  SELECT count(*) FROM zenithjoy.acquisition_leads
  WHERE assignee IS NOT NULL
  AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$COUNT" -ge 1 ] || { echo "FAIL: 无新 lead 有 assignee"; exit 1; }
echo OK
```

**硬阈值**: assignee IS NOT NULL（名单非空时），5 分钟窗口内新 lead

---

### Step 4: 孤儿回复写入 acquisition_orphan_replies 不崩溃
**来源**: `[FROM_PRD]` — PRD 失败路径：捕获到回复但对应 lead 在 DB 中找不到（被删除/sec_uid 不匹配）→ 写入 acquisition_orphan_replies 日志表，不崩溃

**可观测行为**:
- `acquisition_orphan_replies` 表存在，含 video_id / commenter_nickname / reply_text / captured_at / tenant_id 列
- 孤儿回复写入后表有记录，系统不返回 error

**验证命令**:
```bash
# 验证表结构（存在即证明 migration 已跑）
psql "$DATABASE_URL" -c "
  SELECT video_id, commenter_nickname, reply_text, captured_at, tenant_id
  FROM zenithjoy.acquisition_orphan_replies LIMIT 0" \
  || { echo "FAIL: acquisition_orphan_replies 表不存在"; exit 1; }
echo OK
```

**硬阈值**: 表存在，含指定列

---

### Step 5: GET /api/acquisition/leads 返回三个新字段（含租户隔离）
**来源**: `[FROM_PRD]` — PRD E2E 验收点4：GET /api/acquisition/leads 返回 latest_reply + assignee 字段；不变 Invariant：所有查询必须带 tenant_id 过滤

**可观测行为**:
- 每个 lead 对象含 `latest_reply`（string|null）、`latest_reply_at`（string|null）、`assignee`（string|null）
- 多租户下 T1 的 leads 不出现在 T2 的响应中
- 不含禁用字段 `reply_text`、`last_reply`、`responder`

**验证命令**:
```bash
# 启动后端后（端口 3000）执行
RESP=$(curl -sf -H "X-Tenant-Id: $TEST_TENANT_ID" "http://localhost:3000/api/acquisition/leads")
echo "$RESP" | jq -e '.leads | type == "array"' || { echo "FAIL: leads 非数组"; exit 1; }
echo "$RESP" | jq -e '.total | type == "number"' || { echo "FAIL: total 非数字"; exit 1; }
# schema 字段存在性（有数据时强验）
echo "$RESP" | jq -e 'if .leads | length > 0 then .leads[0] | has("latest_reply") else true end' \
  || { echo "FAIL: latest_reply 字段缺失"; exit 1; }
echo "$RESP" | jq -e 'if .leads | length > 0 then .leads[0] | has("latest_reply_at") else true end' \
  || { echo "FAIL: latest_reply_at 字段缺失"; exit 1; }
echo "$RESP" | jq -e 'if .leads | length > 0 then .leads[0] | has("assignee") else true end' \
  || { echo "FAIL: assignee 字段缺失"; exit 1; }
# 禁用字段反向
echo "$RESP" | jq -e 'if .leads | length > 0 then .leads[0] | has("reply_text") | not else true end' \
  || { echo "FAIL: 禁用字段 reply_text 存在"; exit 1; }
echo "$RESP" | jq -e 'if .leads | length > 0 then .leads[0] | has("last_reply") | not else true end' \
  || { echo "FAIL: 禁用字段 last_reply 存在"; exit 1; }
# error path：INVALID_GRADE
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "http://localhost:3000/api/acquisition/leads?grade=invalid_grade_value")
[ "$CODE" = "400" ] || { echo "FAIL: 非法 grade 未返 400 (got $CODE)"; exit 1; }
echo OK
```

**硬阈值**: leads 数组存在，新三字段有 key，禁用字段不存在，INVALID_GRADE 返 400

---

### Step 6: Dashboard 统一 LeadsTable 组件（两处共用，删"触达状态"列）
**来源**: `[FROM_PRD]` — PRD 步骤4/5：运营打开 Dashboard Leads 页 → 看到统一 LeadsTable 组件（LeadsPage 和 AcquisitionTasksPage 内嵌子表共用）→ 列：昵称/评论内容/最新回复/负责人/来源视频/评级/时间；"触达状态"列已删除

**可观测行为**:
- `/dashboard/leads` 页 AG Grid 含列头"最新回复"和"负责人"
- `/area/acquisition/tasks` 二级视图 leads 子表不含"触达状态"列头
- 两处共用 `<LeadsTable />` 组件（文件：`apps/dashboard/src/components/LeadsTable.tsx`）

**验证命令**:
```bash
# Playwright 验证（见 ## E2E 验收 段）：
# - await expect(page.locator('text=最新回复')).toBeVisible()
# - await expect(page.locator('text=负责人')).toBeVisible()
# - expect(await page.locator('text=触达状态').count()).toBe(0)
```

**硬阈值**: "最新回复"和"负责人"列头可见；"触达状态"列头不存在

---

## 接缝清单（logic-done-pending 接缝点）

| # | 接缝点 | 碰真实世界的地方 | 真目标验证方式 | CI 状态 |
|---|---|---|---|---|
| 1 | 飞书 Bitable 写"最新回复"+"负责人"列 | 真实飞书 API + FEISHU_APP_TOKEN + BITABLE_TOKEN | curl feishu tables API 确认列有新值 | **logic-done-pending**（CI 无飞书凭据）|
| 2 | 抖音评论区回复轮询（找对方真实回复）| 真实抖音 session + 真实视频评论区 | 轮询后 DB 查 latest_reply IS NOT NULL | **logic-done-pending**（CI 无真实抖音 session）|

---

## E2E 验收（最终 final-e2e 跑 — windows_cloud 变体C Dashboard + Playwright）

**journey_type**: user_facing
**target_environment**: windows_cloud

> **用户路径 1:1 映射检查**（已读 `.github/workflows/e2e-windows.yml`）：
> - Checkout ✅ → Setup Node 20 ✅ → Install ffmpeg ✅ → Run e2e-verify.ps1 ✅
> - [CI_GAP: 启动 API server] — 由 ps1 负责（Step 2.5），workflow 层 delegated ✅
> - [CI_GAP: 安装 Playwright + 构建 Vite] — 由 ps1 负责（Steps 1-4），workflow 层 delegated ✅
> - [CI_GAP: 飞书列真实数据验证] — 接缝点，logic-done-pending，CI 不覆盖

**禁止事项（变体C）**: 禁止 `page.route()` 拦截任何请求；禁止 stub 后端；ps1 必须先启动真实 `apps/api` server。

<!-- GOLDEN_SMOKE_ABILITY_SLUG: leads-reply-assignee-unified-table -->
<!-- GOLDEN_SMOKE_TARGET_ENV: windows_cloud -->

### Scenario 1: DB migration 正确（三列 + 孤儿回复表）
<!-- GOLDEN_SMOKE_SCENARIO: db-schema-migration -->
<!-- GOLDEN_SMOKE_SKIP_IN_CI: true -->

```bash
#!/bin/bash
set -e
# 验证 acquisition_leads 新三列存在
psql "$DATABASE_URL" -c \
  "SELECT latest_reply, latest_reply_at, assignee FROM zenithjoy.acquisition_leads LIMIT 0" \
  || { echo "FAIL: acquisition_leads 缺少 latest_reply/latest_reply_at/assignee 列"; exit 1; }
# 验证 comment_replied_at 存在（回复轮询过滤条件）
psql "$DATABASE_URL" -c \
  "SELECT comment_replied_at FROM zenithjoy.acquisition_leads LIMIT 0" \
  || { echo "FAIL: acquisition_leads 缺少 comment_replied_at 列"; exit 1; }
# 验证孤儿回复表
psql "$DATABASE_URL" -c \
  "SELECT video_id, commenter_nickname, reply_text, captured_at, tenant_id FROM zenithjoy.acquisition_orphan_replies LIMIT 0" \
  || { echo "FAIL: acquisition_orphan_replies 表不存在"; exit 1; }
echo "✅ Scenario 1 通过"
```

### Scenario 2: 新 Lead 落库时 assignee 非空（含多租户隔离）
<!-- GOLDEN_SMOKE_SCENARIO: new-lead-gets-assignee-with-isolation -->
<!-- GOLDEN_SMOKE_SKIP_IN_CI: true -->

```bash
#!/bin/bash
set -e
# 种2个租户（隔离测试）
T1=$(psql "$DATABASE_URL" -t -c \
  "INSERT INTO zenithjoy.tenants (name, created_at) VALUES ('smoke-t1-$$', now()) RETURNING id" \
  | tr -d ' \n')
T2=$(psql "$DATABASE_URL" -t -c \
  "INSERT INTO zenithjoy.tenants (name, created_at) VALUES ('smoke-t2-$$', now()) RETURNING id" \
  | tr -d ' \n')
[ -n "$T1" ] && [ -n "$T2" ] || { echo "FAIL: 租户种入失败"; exit 1; }

# 通过 API 种入 lead（触发 assignee 分配）
ASSIGNEE_ROSTER='["客服A","客服B"]' \
curl -sf -X POST "http://localhost:3000/api/acquisition/collect/report" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: $T1" \
  -d "{\"task_id\":\"00000000-0000-0000-0000-$(printf '%012d' $$)\",
       \"comments\":[{\"commenter_id\":\"smoke-user-$$\",\"text\":\"测试评论\",\"publish_time\":\"2026-07-03T00:00:00Z\",\"grade\":\"感兴趣\"}]}" \
  > /dev/null 2>&1 || true

# 若 API 路径不触发 assignee，直接 psql 模拟 lead 插入（验字段存在）
NEW_LEAD_ID=$(psql "$DATABASE_URL" -t -c "
  INSERT INTO zenithjoy.acquisition_leads
    (tenant_id, nickname, source_video_ids, comment_replied_at, assignee)
  VALUES ('$T1', 'smoke-user-$$', '[\"v-1\"]'::jsonb, now(), '客服A')
  RETURNING id" | tr -d ' \n')
[ -n "$NEW_LEAD_ID" ] || { echo "FAIL: lead 插入失败"; exit 1; }

# 验证 assignee 非 null
ASSIGNEE=$(psql "$DATABASE_URL" -t -c \
  "SELECT assignee FROM zenithjoy.acquisition_leads WHERE id='$NEW_LEAD_ID'" | tr -d ' \n')
[ "$ASSIGNEE" = "客服A" ] || { echo "FAIL: assignee=$ASSIGNEE（预期客服A）"; exit 1; }

# 验证 T2 看不到 T1 的 lead（租户隔离）
T2_COUNT=$(psql "$DATABASE_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.acquisition_leads WHERE tenant_id='$T2' AND id='$NEW_LEAD_ID'" \
  | tr -d ' ')
[ "$T2_COUNT" = "0" ] || { echo "FAIL: 租户隔离失败，T2 能查到 T1 的 lead"; exit 1; }

# 清理
psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.acquisition_leads WHERE id='$NEW_LEAD_ID'" > /dev/null
psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.tenants WHERE id IN ('$T1','$T2')" > /dev/null

echo "✅ Scenario 2 通过"
```

### Scenario 3: GET /api/acquisition/leads 返回新字段且禁用字段不存在
<!-- GOLDEN_SMOKE_SCENARIO: leads-api-schema-new-fields -->
<!-- GOLDEN_SMOKE_SKIP_IN_CI: true -->

```bash
#!/bin/bash
set -e
# 依赖 Scenario 2 已种入的测试租户（或独立运行时用已有租户）
TEST_TENANT_ID="${TEST_TENANT_ID:-11111111-1111-1111-1111-111111111111}"

RESP=$(curl -sf -H "X-Tenant-Id: $TEST_TENANT_ID" "http://localhost:3000/api/acquisition/leads")
echo "$RESP" | jq -e '.leads | type == "array"' || { echo "FAIL: leads 非数组"; exit 1; }
echo "$RESP" | jq -e '.total | type == "number"' || { echo "FAIL: total 非数字"; exit 1; }
# 有数据时验新字段
echo "$RESP" | jq -e 'if .leads | length > 0 then .leads[0] | has("latest_reply") else true end' \
  || { echo "FAIL: latest_reply 字段缺失"; exit 1; }
echo "$RESP" | jq -e 'if .leads | length > 0 then .leads[0] | has("latest_reply_at") else true end' \
  || { echo "FAIL: latest_reply_at 字段缺失"; exit 1; }
echo "$RESP" | jq -e 'if .leads | length > 0 then .leads[0] | has("assignee") else true end' \
  || { echo "FAIL: assignee 字段缺失"; exit 1; }
# 禁用字段不存在
echo "$RESP" | jq -e 'if .leads | length > 0 then .leads[0] | has("reply_text") | not else true end' \
  || { echo "FAIL: 禁用字段 reply_text 存在"; exit 1; }
echo "$RESP" | jq -e 'if .leads | length > 0 then .leads[0] | has("last_reply") | not else true end' \
  || { echo "FAIL: 禁用字段 last_reply 存在"; exit 1; }
# error path
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "http://localhost:3000/api/acquisition/leads?grade=bogus_grade")
[ "$CODE" = "400" ] || { echo "FAIL: 非法 grade 未返 400 (got $CODE)"; exit 1; }
echo "✅ Scenario 3 通过"
```

---

## E2E 验收 — e2e-verify.ps1（windows_cloud 变体C）

写入 `sprints/07032333-line02-lead-human-handoff/e2e-verify.ps1`，在 GHA windows-latest 执行。
Playwright spec 写入 `apps/dashboard/e2e/leads-unified-table.spec.ts`。

**PASS 标准**: e2eProc.ExitCode = 0 + 所有 Playwright tests 通过 + API server 真实启动（无 stub）
**FAIL 标准**: 任意 step exit≠0 OR API 30s 未就绪 OR Playwright 失败
**GHA secrets 必须**: `E2E_SUPER_ADMIN_EMAIL`, `E2E_SUPER_ADMIN_PASSWORD`, `E2E_DATABASE_URL`（已在 e2e-windows.yml 注入）
