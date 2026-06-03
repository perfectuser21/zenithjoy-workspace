# Sprint Contract Draft (Round 2)

## 本轮修订说明（B52 漂移锁死）

| Reviewer Feedback | 本轮改动 |
|---|---|
| (1) 零 jq -e runtime oracle | Step 2/3/4/6a 验证命令全部替换为 `bash tests/behavior-api-check.sh <scenario>`（curl+jq -e 运行时验证含字段类型 + 禁用字段反向检查）；Step 7 改为 curl HTTP 400 实际验证 |
| (2) 无 Risks 段 | 新增 `## Risks` 段，4 条边界情况各含可执行 BEHAVIOR 验证命令 |
| (3) 缺 OAuth Step + suggestion 字段 | 新增 Step 1.5（飞书/Notion OAuth 绑定）；Step 6a Response Schema + 验证命令补 `customers[0].suggestion` jq -e 字段类型检查 |
| (4) Step 7 error path 假绿 | Step 7 验证命令改为 curl HTTP status 断言（实际 400 返回，不是 grep 源码） |

---

## Response Schema（推导来源: PRD字面）

### Endpoint: POST /api/crm/init（mode=create）
**Success (HTTP 200)**:
```json
{"success": true, "table_id": "<string>"}
```
- `success` (boolean, 必填): PRD E2E `jq -e '.success == true'`
- `table_id` (string, 必填): PRD E2E `jq -e '.table_id != null'`
**禁用字段名**: `result`, `data`, `id`, `tableId`

**Success (HTTP 200) — mode=connect（有表接入，含字段映射预览）**:
```json
{"success": true, "table_id": "<string>", "field_mapping": [...], "record_count": 0}
```
- `field_mapping` (array): PRD 边界情况「有表 → 读取字段映射，展示预览，用户确认后才导入」`[NEW_PATTERN]`

**Error (HTTP 4xx)**:
```json
{"error": "<string>"}
```

---

### Endpoint: GET /api/crm/wechat-contacts?tenant_id=
**Success (HTTP 200)**:
```json
{"contacts": [{"wechat_id": "<string>", "nickname": "<string>"}]}
```
- `contacts` (array, 必填): PRD E2E `jq -e '(.contacts | length) >= 1'`；mock 场景固定 5 条
**禁用字段名**: `list`, `items`, `data`, `users`

**Error (HTTP 4xx)**:
```json
{"error": "<string>"}
```

---

### Endpoint: GET /api/crm/match-preview?tenant_id=
**Success (HTTP 200)**:
```json
{"matched": [], "pending": [], "unmatched": []}
```
- `matched` (array, 必填): PRD E2E `jq -e '.matched | length >= 0'`
- `pending` (array, 必填): PRD Golden Path Step 6 `[NEW_PATTERN]`
- `unmatched` (array, 必填): PRD Golden Path Step 6 `[NEW_PATTERN]`
**禁用字段名**: `results`, `data`, `contacts`

**Error (HTTP 4xx)**:
```json
{"error": "<string>"}
```

---

### Endpoint: POST /api/crm/daily-analysis
**Request body**: `{"tenant_id": "<string>", "dry_run": boolean}`
**Success (HTTP 200)**:
```json
{"customers": [{"name": "<string>", "rating": "<string>", "suggestion": "<string>"}], "webhook_sent": false}
```
- `customers` (array, 必填): PRD E2E `jq -e '.customers | length >= 0'`
- `customers[i].suggestion` (string, 必填): PRD「为每个客户生成一句沟通策略建议」`[NEW_PATTERN]`
- `webhook_sent` (boolean, 必填): PRD E2E `jq -e '.webhook_sent == false'`（dry_run 时）
**禁用字段名**: `result`, `data`, `contacts`, `users`, `webhookSent`

**Error (HTTP 4xx)**:
```json
{"error": "<string>"}
```

---

## Golden Path

### 首次接入路径
[Dashboard CrmConfigPage] → [选平台 → OAuth/Token 绑定] → [建/检测客户明细表] → [拉联系人 → AI 匹配] → [用户确认 → 写映射 DB]

### 日常路径
[Brain tick 8:30] → [读 CRM 表 → AI 分析 → 推送飞书群]

---

### Step 1: 用户打开 Dashboard CRM 配置页，选择 CRM 平台
**来源**: `[FROM_PRD]` — PRD 首次接入 Step 1「用户在 Dashboard 点配置客户管理 → 选择 CRM 平台：飞书 or Notion」

**可观测行为**: Dashboard 路由 `/crm/config` 渲染 CrmConfigPage，含飞书/Notion 平台选择器，无 crash

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/dashboard/src/pages/CrmConfigPage.tsx','utf8');
if (!c.includes('feishu') && !c.includes('飞书')) { console.error('FAIL: 缺飞书选项'); process.exit(1); }
if (!c.includes('notion') && !c.includes('Notion')) { console.error('FAIL: 缺 Notion 选项'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: CrmConfigPage 存在 + 含平台选择器逻辑

---

### Step 1.5: 系统完成 OAuth / Token 绑定（飞书 → FeishuBindTenant；Notion → internal integration token）
**来源**: `[FROM_PRD]` — PRD 首次接入 Step 2「系统引导完成 OAuth（飞书复用 FeishuBindTenant 流程；Notion 用 internal integration token）」

**可观测行为**: CrmConfigPage 含飞书 OAuth 触发入口（复用 `FeishuBindTenant`）；Notion 服务读取 `NOTION_INTEGRATION_TOKEN` env var；选择平台后 UI 展示绑定引导状态

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/dashboard/src/pages/CrmConfigPage.tsx','utf8');
if (!c.includes('FeishuBindTenant') && !c.includes('feishu-bind') && !c.includes('feishuOAuth')) {
  console.error('FAIL: 缺飞书 OAuth 绑定入口');
  process.exit(1);
}
console.log('OK feishu OAuth entry found');
" && \
node -e "
const c = require('fs').readFileSync('apps/api/src/services/notion-crm.ts','utf8');
if (!c.includes('NOTION_INTEGRATION_TOKEN')) {
  console.error('FAIL: notion-crm.ts 未读取 NOTION_INTEGRATION_TOKEN');
  process.exit(1);
}
console.log('OK Notion token env var');
"
```

**硬阈值**: CrmConfigPage 含飞书 OAuth 入口；notion-crm.ts 含 `NOTION_INTEGRATION_TOKEN` 读取

---

### Step 2: 系统建/检测客户明细表（POST /api/crm/init）
**来源**: `[FROM_PRD]` — PRD 首次接入 Step 3「无表 → 调 CRM 平台 API 自动建表；有表 → 读取字段映射」；PRD E2E Step 1

**可观测行为**: POST /api/crm/init（mode=create）返回 HTTP 200 + `{ success: true, table_id: "<非空字符串>" }`；keys 完整性 `["success","table_id"]`；无禁用字段

**验证命令**:
```bash
bash sprints/06030910-path4-crm-wechat-sync/tests/behavior-api-check.sh init
```
> **前提**: ZenithJoy API 运行在 `localhost:3000`（evaluator 启动 `cd apps/api && npm run dev`）

**硬阈值**: `success == true`；`table_id | type == "string"`；`keys | sort == ["success","table_id"]`；`has("tableId") | not`；耗时 < 5s

---

### Step 3: 系统拉取微信联系人列表（GET /api/crm/wechat-contacts，mock 5 条）
**来源**: `[FROM_PRD]` — PRD 首次接入 Step 4「mock 返回固定 5 条」；PRD ASSUMPTION 明确

**可观测行为**: GET /api/crm/wechat-contacts?tenant_id=X 返回 `{ contacts: [5条] }`，每条含 `wechat_id` + `nickname`

**验证命令**:
```bash
bash sprints/06030910-path4-crm-wechat-sync/tests/behavior-api-check.sh contacts
```
> **前提**: ZenithJoy API 运行在 `localhost:3000`

**硬阈值**: `contacts | type == "array"`；`contacts | length >= 1`；每条含 `wechat_id` + `nickname`；无禁用字段 `list`

---

### Step 4: AI 模糊匹配 → 中台展示匹配结果（GET /api/crm/match-preview）
**来源**: `[FROM_PRD]` — PRD 首次接入 Step 5-6「AI 按微信号/昵称模糊匹配；展示已匹配/待确认/未匹配」；PRD E2E Step 3

**可观测行为**: GET /api/crm/match-preview?tenant_id=X 返回 `{ matched: [...], pending: [...], unmatched: [...] }`；三字段均为数组

**验证命令**:
```bash
bash sprints/06030910-path4-crm-wechat-sync/tests/behavior-api-check.sh match
```
> **前提**: ZenithJoy API 运行在 `localhost:3000`

**硬阈值**: `matched/pending/unmatched` 均为 array；`keys | sort == ["matched","pending","unmatched"]`；无禁用字段 `results`

---

### Step 5: 用户确认 → crm_wechat_mapping 写入 DB
**来源**: `[FROM_PRD]` — PRD 首次接入 Step 7「确认后写入 crm_wechat_mapping（wechat_contact_id ↔ crm_row_id ↔ platform ↔ tenant_id）」；PRD 边界情况 contact_lost 需 contact_status 字段

**可观测行为**: DB migration 文件存在，定义 `crm_wechat_mapping` 表含 4 核心字段 + `contact_status`（支持 contact_lost 标记）

**验证命令**:
```bash
node -e "
const fs = require('fs'), path = require('path');
const mDir = 'packages/db/migrations';
const migFile = fs.readdirSync(mDir).find(f => f.includes('crm_wechat_mapping'));
if (!migFile) { console.error('FAIL: migration 不存在'); process.exit(1); }
const c = fs.readFileSync(path.join(mDir, migFile), 'utf8');
['wechat_contact_id','crm_row_id','platform','tenant_id','contact_status'].forEach(col => {
  if (!c.includes(col)) { console.error('FAIL: 缺 ' + col); process.exit(1); }
});
console.log('OK migration:', migFile);
"
```

**硬阈值**: migration 文件存在 + 5 个字段均在

---

### Step 6a: Brain tick 8:30 → 每日 AI 分析 + 飞书群推送（POST /api/crm/daily-analysis）
**来源**: `[FROM_PRD]` — PRD 日常使用 Step 1-5「Brain tick 8:30 → 读表 → AI 分析 → 排优先级 → 推飞书群（今日跟进 N 人：1. 张三 [A3] 建议：...）」；PRD E2E Step 4

**可观测行为**: POST /api/crm/daily-analysis（dry_run:true）返回 `{ customers: [...], webhook_sent: false }`；customers 非空时每个 item 含 `suggestion` 字符串字段

**验证命令**:
```bash
bash sprints/06030910-path4-crm-wechat-sync/tests/behavior-api-check.sh analysis
```
> **前提**: ZenithJoy API 运行在 `localhost:3000`

**硬阈值**: `customers | type == "array"`；`webhook_sent == false`（dry_run 时）；`customers[0].suggestion | type == "string"`（非空时）；无禁用字段 `webhookSent`；`keys | sort == ["customers","webhook_sent"]`

---

### Step 6b: AI 建议列写回 CRM 表
**来源**: `[FROM_PRD]` — PRD 日常使用 Step 6「更新 CRM 表「AI 建议」列」

**可观测行为**: `daily-crm-analysis.ts` 含飞书 Bitable 或 Notion page update API 调用，将 suggestion 写回 CRM 表行

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/api/src/services/daily-crm-analysis.ts','utf8');
if (!c.includes('AI建议') && !c.includes('ai_suggestion') && !c.includes('suggestion')) {
  console.error('FAIL: 缺 AI 建议列写回逻辑'); process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: `daily-crm-analysis.ts` 含 AI 建议写回调用

---

### Step 7: error path — 缺必填参数返回 HTTP 400（实际 curl 验证）
**来源**: `[AI_ADDED]` — 防止 generator 不做参数校验；v7.12 规则：error path BEHAVIOR 必须验证实际 HTTP status，不能 grep 源码

**可观测行为**: POST /api/crm/init（无 tenant_id body）→ HTTP 400；GET /api/crm/wechat-contacts（无 tenant_id query）→ HTTP 400

**验证命令**:
```bash
bash sprints/06030910-path4-crm-wechat-sync/tests/behavior-api-check.sh error
```
> **前提**: ZenithJoy API 运行在 `localhost:3000`

**硬阈值**: 两个端点缺必填参数均返 HTTP 400；不允许 200/404/500

---

## Risks

### Risk 1: wechat_rpa 联系人拉取失败 → 飞书群告警 + 日志，不阻塞已有映射
**来源**: `[FROM_PRD]` — PRD 边界情况「wechat_rpa 联系人拉取失败 → 飞书群告警 + 日志，不阻塞已有映射」

**Mitigation**: `/api/crm/wechat-contacts` 在 wechat_rpa 失败时返回 `{ contacts: [], warning: "rpa_unavailable" }` + HTTP 200（不返 500），并异步触发飞书告警

**验证命令**:
```bash
bash sprints/06030910-path4-crm-wechat-sync/tests/behavior-api-check.sh risk-rpa-fail
```

**硬阈值**: `simulate_fail=true` 时 HTTP code != 500；response 含 `warning: "rpa_unavailable"`

---

### Risk 2: CRM 表字段映射不匹配（有表接入）→ 中台显示字段映射预览，用户确认后才导入
**来源**: `[FROM_PRD]` — PRD 边界情况「CRM 表字段映射不匹配（有表接入）→ 中台显示字段映射预览，用户确认后才导入」

**Mitigation**: POST /api/crm/init（mode=connect）返回 `field_mapping` 数组供前端预览；不自动导入

**验证命令**:
```bash
bash sprints/06030910-path4-crm-wechat-sync/tests/behavior-api-check.sh risk-field-mapping
```

**硬阈值**: `mode=connect` 响应 `has("field_mapping") == true`

---

### Risk 3: Notion token 过期 → 飞书群推送告警，状态标记 `token_expired`
**来源**: `[FROM_PRD]` — PRD 边界情况「Notion token 过期 → 飞书群推告警，状态标记 token_expired」

**Mitigation**: `notion-crm.ts` 捕获 401/403 → 调 `FEISHU_NOTIFY_WEBHOOK` 推送告警 + 状态改为 `token_expired`

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/api/src/services/notion-crm.ts','utf8');
if (!c.includes('token_expired')) { console.error('FAIL: 缺 token_expired 处理'); process.exit(1); }
if (!c.includes('FEISHU_NOTIFY_WEBHOOK')) { console.error('FAIL: 缺飞书告警推送'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: `notion-crm.ts` 含 `token_expired` 标记 + `FEISHU_NOTIFY_WEBHOOK` 推送调用

---

### Risk 4: 联系人改名/删好友 → 下次同步标记 `contact_lost`，不删已有映射
**来源**: `[FROM_PRD]` — PRD 边界情况「联系人改名/删好友 → 下次同步标记 contact_lost，不删已有映射」

**Mitigation**: `crm-wechat-sync.ts` 同步时联系人消失 → `crm_wechat_mapping.contact_status = 'contact_lost'`，不执行 DELETE

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/api/src/services/crm-wechat-sync.ts','utf8');
if (!c.includes('contact_lost')) { console.error('FAIL: 缺 contact_lost 标记逻辑'); process.exit(1); }
if (c.includes('DELETE FROM crm_wechat_mapping')) { console.error('FAIL: 含硬删除，应改为标记'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: `crm-wechat-sync.ts` 含 `contact_lost`；不含 `DELETE FROM crm_wechat_mapping`

---

## E2E 验收（final-e2e — windows_cloud 变体 C：Dashboard + Playwright）

> **windows_cloud workflow 内容审查**（v8.1 规则）：
> 已读取 `.github/workflows/e2e-windows.yml`：
> - `workflow_dispatch` trigger，inputs: `task_id`, `sprint_dir`, `pr_branch`
> - 唯一执行 step：`& $sprintDir/e2e-verify.ps1`
>
> **用户路径 1:1 映射检查（R2 — 加入 OAuth + suggestion）**：
>
> | 用户步骤 | spec/ps1 对应 | 状态 |
> |---|---|---|
> | 打开 CRM 配置页，选飞书/Notion | `page.goto('/crm/config')` + click | ✅ |
> | 飞书 OAuth 绑定入口可见 | `expect(locator['feishu-bind']).toBeVisible()` | ✅ R2 新增 |
> | POST /init mode=create（建表）| `page.route()` stub + 请求 body 断言 | ✅ |
> | GET /wechat-contacts（mock 5条）| stub 返回 5条含 wechat_id/nickname | ✅ |
> | 展示匹配结果三栏 | `expect().toBeVisible()` 三栏 | ✅ |
> | 用户确认写映射 | stub assertion + success toast | ✅ |
> | POST /daily-analysis dry_run suggestion 字段 | stub 验证 customers[0].suggestion 字符串 | ✅ R2 新增 |
> | [CI_GAP: 真实 DB crm_wechat_mapping 写入] | windows_cloud 无 DB | ⚠️ mock 可接受 |
> | [CI_GAP: Brain tick 8:30 真实 cron] | 直接 POST API dry_run | ⚠️ dry_run 可接受 |

**journey_type**: user_facing / **target_environment**: windows_cloud

E2E 脚本见 `sprints/06030910-path4-crm-wechat-sync/e2e-verify.ps1`（结构同 R1，spec 文件 `apps/dashboard/e2e/crm-config.spec.ts` 更新含 OAuth + suggestion 断言）

**PASS 标准**: Playwright 所有 spec 通过
**FAIL 标准**: 任何 step exit≠0 OR Playwright 失败 OR Vite 30s 未就绪
**GHA workflow**: `.github/workflows/e2e-windows.yml`（`workflow_dispatch` + `windows-latest`）
**secrets 必须**: `E2E_SUPER_ADMIN_EMAIL`、`E2E_SUPER_ADMIN_PASSWORD`

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| CRM API runtime（4 端点 + 2 risk curl） | `tests/behavior-api-check.sh` | curl+jq -e 运行时 schema oracle | → 服务未启动时全部 FAIL |
| CRM routes TDD + suggestion 字段 | `tests/crm-routes.test.ts` | 路由结构 + suggestion 字段 | → failures（文件不存在） |
| crm_wechat_mapping 迁移 + contact_status | `tests/crm-migration.test.ts` | migration 文件 + contact_status 字段 | → failures（文件不存在） |
| Playwright E2E（含 OAuth + suggestion） | `apps/dashboard/e2e/crm-config.spec.ts` | UI Golden Path 全程 | → failures（页面不存在） |
