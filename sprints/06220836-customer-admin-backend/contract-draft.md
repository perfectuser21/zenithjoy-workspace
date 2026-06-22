# Sprint Contract Draft (Round 1) — 客户管理后台

> journey_id e6270293-7ca3-4261-b01d-4de4c66e0352 · step_id L10-S1
> journey_type **user_facing** · target_environment **windows_cloud**

---

## Response Schema（推导来源: code-derived，api_registry 不可达，fallback 现有 `apps/api/src/routes/admin-customers.ts` 约定）

> PRD 未给 `## Response Schema` 段。Brain registry 不可达（localhost:5221 down），故按本仓库既有 admin 路由约定推导：
> 列表 `{ success:true, data:[...], total:number }`；单体 `{ success:true, data:{...} }`；错误 `{ success:false, data:null, error:{ code:string, message:string }, timestamp }`（见 admin-customers.ts:66-72）。
> **禁用字段名**（admin-customers-smoke.sh 既有反向断言沿用）: `users` / `clients` / `members` / `result` / `id`（实体主键一律用 `<entity>_id`：`tenant_id` / `account_id` / `binding_id`，对齐 admin-customers.ts 的 `tenant_id` / `session_id`）。

### Endpoint: `PUT /api/tenant/:id`（改公司名）
**Success (HTTP 200)**:
```json
{"success": true, "data": {"tenant_id": "<uuid>", "name": "<string>"}}
```
- `success` (bool, 必填): code-derived
- `data.tenant_id` (uuid, 必填): code-derived（实体主键用 `<entity>_id`）
- `data.name` (string, 必填): PRD「填公司名 → 写 tenants.name」

**Error**: `404` 租户不存在 `{"success":false,"error":{"code":"TENANT_NOT_FOUND","message":"<string>"}}`；`400` 空名 `{"code":"INVALID_NAME"}`

### Endpoint: `GET /api/tenant/:id/accounts`（子账号列表，含配额）
**Success (HTTP 200)**:
```json
{"success": true, "data": [{"account_id":"<uuid>","email":"<string>","display_name":"<string>","role":"admin|operator|service_agent","created_at":"<iso>"}], "total": 0, "quota": {"used": 0, "limit": 0}}
```
- `quota.used` / `quota.limit` (number, 必填): PRD 边界「配额已满，当前 N/M」→ N=used M=limit

### Endpoint: `POST /api/tenant/:id/accounts`（建子账号）
**Success (HTTP 201)**:
```json
{"success": true, "data": {"account_id":"<uuid>","email":"<string>","display_name":"<string>","role":"<string>"}}
```
- `role` (string, 必填): 枚举 `admin` | `operator` | `service_agent`（PRD 第 2 步字面）
**Error**: `409` 配额满 `{"code":"SUBACCOUNT_QUOTA_EXCEEDED","message":"配额已满，当前 N/M"}`（message 必须含 `配额` 与 `N/M` 形态）；`409` 邮箱重复 `{"code":"EMAIL_EXISTS"}`；`400` 非法角色 `{"code":"INVALID_ROLE"}`

### Endpoint: `DELETE /api/tenant/:id/accounts/:aid`（软删账号）
**Success (HTTP 200)**: `{"success":true,"data":{"account_id":"<uuid>","deleted":true}}`

### Endpoint: `GET /api/tenant/:id/service-agents`（客服-PC 绑定列表）
**Success (HTTP 200)**:
```json
{"success": true, "data": [{"binding_id":"<uuid>","account_id":"<uuid>","account_email":"<string>","machine_id":"<string>","hostname":"<string|null>","online":false,"bound_at":"<iso>"}], "total": 0}
```
- `online` (bool, 必填): PRD 第 3 步「客服 X @ PC Y ● 在线」→ 由 license_machines.last_seen 60s 新鲜度推导

### Endpoint: `POST /api/tenant/:id/service-agents/:aid/bind-device`（绑客服到 PC）
**Success (HTTP 201)**:
```json
{"success": true, "data": {"binding_id":"<uuid>","account_id":"<uuid>","machine_id":"<string>"}}
```
**Error**: `409` 客服或 PC 已被绑 `{"code":"ALREADY_BOUND"}`；`409` 占满机器配额 `{"code":"MACHINE_QUOTA_EXCEEDED"}`；`400` 账号非 service_agent 角色 `{"code":"INVALID_BIND_ROLE"}`

### Endpoint: `DELETE /api/tenant/:id/service-agents/:bid`（软删绑定）
**Success (HTTP 200)**: `{"success":true,"data":{"binding_id":"<uuid>","deleted":true}}`

### Endpoint: `GET /api/agent/module-health`（**复用既有**，walking-skeleton.ts:135）
**Success (HTTP 200)**:
```json
{"ok": true, "data": [{"agent_id":"<string>","hostname":"<string>","module_status":{"<line-key>":{"ok":true,"reason":"<string?>"}},"updated_at":"<iso>"}]}
```
> 本 sprint **不改** module-health 端点（PRD ASSUMPTION），仅诊断页消费它。其 schema 为 `{ok, data}`（与新端点 `{success, data}` 不同，因复用既有契约，**不许改**它去对齐）。

### 子账号配额映射（`[AI_ADDED]` 决策 — PRD 未给数值，只给「3~5 个」+「跟随 license plan」）
```
SUB_ACCOUNT_LIMITS = { free: 0, basic: 3, matrix: 5, studio: 10, enterprise: 30 }
```
映射键 = `zenithjoy.licenses.tier`（既有 CHECK 枚举）。**验收对配额数值不可知**：测试创建到 `limit` 后断言第 `limit+1` 个返 4xx + DB 无新行，`limit` 从 API `quota.limit` 读，不硬编码（防 generator 改映射后测试假绿）。

---

## 已知约束（来自回归测试）

- [apps/dashboard/e2e/module-health.spec.ts] → test1 机器行渲染(hostname+agent_id)+四条 Line 表头；test2 单元格三态(在线/失败reason/无数据)；test3 API 失败显示错误提示 —— 诊断页 UI 必须保留三态渲染，新页不得回归
- [.github/workflows/scripts/smoke/admin-customers-smoke.sh] → 顶层 keys 精确 `["data","success","total"]`；禁用字段 `users/clients/members/result` 不出现；非超管 `X-Feishu-User-Id: not-an-admin` → 403 —— 新端点沿用同款 schema 纯度 + 403 守卫
- [apps/api/src/routes/admin-customers.ts] → `{success,data,total}` + 错误 `{success:false,data:null,error:{code,message},timestamp}`；schema 前缀 `zenithjoy.`；实体主键 `<entity>_id` 命名 —— 新路由必须同款

---

## Golden Path

[管理员进客户管理页] → [设公司名 → 建 3 子账号(含1 service_agent) → 绑 1 客服到 1 PC → 看该机诊断] → [一家公司被完整配好且每台机器体检可见]

### Step 1: 设公司名（不再 Personal-邮箱）
**来源**: `[FROM_PRD]` — Golden Path 第 1 步「新建/编辑公司 → 填公司名 → 系统写 tenants.name → 列表显示新公司名」

**可观测行为**: 管理员 PUT 公司名后，`tenants.name` 被更新，列表/详情显示新名（不再 `Personal-邮箱`）。

**验证命令**:
```bash
API_BASE="${API_BASE:-http://localhost:5200}"
# 用真实租户（psql 建夹具），PUT 改名，回读 DB 确认落库
TID=$(PGPASSWORD="${PGPASSWORD:-cecelia}" psql -h "${PGHOST:-localhost}" -U "${PGUSER:-cecelia}" -d "${PGDATABASE:-cecelia}" -tAc \
  "INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES('Personal-old@x.com','lk-cab-'||substr(md5(random()::text),1,12),'matrix') RETURNING id")
RESP=$(curl -sf -X PUT "$API_BASE/api/tenant/$TID" -H 'Content-Type: application/json' -d '{"name":"晨悦传媒"}') || { echo "FAIL: PUT 未 200"; exit 1; }
echo "$RESP" | jq -e '.success==true and .data.name=="晨悦传媒"' >/dev/null || { echo "FAIL: 响应未含新名"; exit 1; }
N=$(PGPASSWORD="${PGPASSWORD:-cecelia}" psql -h "${PGHOST:-localhost}" -U "${PGUSER:-cecelia}" -d "${PGDATABASE:-cecelia}" -tAc \
  "SELECT name FROM zenithjoy.tenants WHERE id='$TID'")
[ "$N" = "晨悦传媒" ] || { echo "FAIL: DB name 未更新=$N"; exit 1; }
echo OK
```
**硬阈值**: HTTP 200 且 `data.name` == 入参；DB `tenants.name` 实际更新。空名 → 400 `INVALID_NAME`。

---

### Step 2: 建子账号（含 role，受 license plan 配额约束）
**来源**: `[FROM_PRD]` — Golden Path 第 2 步「新增账号 → 填邮箱/显示名/角色(admin|operator|service_agent) → 建 tenant_sub_accounts 行 → 列表出现」

**可观测行为**: POST 后 `zenithjoy.tenant_sub_accounts` 新增一行（带 role + tenant_id），列表出现该账号；一公司可建 3~5 个。

**验证命令**:
```bash
API_BASE="${API_BASE:-http://localhost:5200}"
RESP=$(curl -sf -X POST "$API_BASE/api/tenant/$TID/accounts" -H 'Content-Type: application/json' \
  -d '{"email":"svc1@cab.test","display_name":"客服一","role":"service_agent"}') || { echo "FAIL: POST 未 2xx"; exit 1; }
AID=$(echo "$RESP" | jq -r '.data.account_id')
echo "$RESP" | jq -e '.success==true and .data.role=="service_agent"' >/dev/null || { echo FAIL; exit 1; }
# DB 带时间窗，防历史数据冒充
C=$(PGPASSWORD="${PGPASSWORD:-cecelia}" psql -h "${PGHOST:-localhost}" -U "${PGUSER:-cecelia}" -d "${PGDATABASE:-cecelia}" -tAc \
  "SELECT count(*) FROM zenithjoy.tenant_sub_accounts WHERE id='$AID' AND tenant_id='$TID' AND role='service_agent' AND deleted_at IS NULL AND created_at > NOW() - interval '5 minutes'")
[ "$C" = "1" ] || { echo "FAIL: DB 无新行 c=$C"; exit 1; }
echo OK
```
**硬阈值**: HTTP 201；`tenant_sub_accounts` 5 分钟内新增 1 行带正确 role/tenant_id。非法 role（如 `boss`）→ 400 `INVALID_ROLE`。

---

### Step 3: 绑客服到 PC（1:1 双唯一 + 占机器配额）
**来源**: `[FROM_PRD]` — Golden Path 第 3 步「选 service_agent + 选已注册机器 → 绑定 → 写 service_agents → 列表显示『客服 X @ PC Y ● 在线』」

**可观测行为**: POST 后 `zenithjoy.service_agents` 新增 account↔machine 行；列表显示绑定（含 online 态）。1 客服已绑再绑 / 1 PC 已绑再被绑 → DB 双唯一约束拒绝。

**验证命令**:
```bash
API_BASE="${API_BASE:-http://localhost:5200}"
MID="pc-cab-$(date +%s)"
RESP=$(curl -sf -X POST "$API_BASE/api/tenant/$TID/service-agents/$AID/bind-device" -H 'Content-Type: application/json' \
  -d "{\"machine_id\":\"$MID\"}") || { echo "FAIL: bind 未 2xx"; exit 1; }
echo "$RESP" | jq -e '.success==true and .data.machine_id=="'"$MID"'"' >/dev/null || { echo FAIL; exit 1; }
C=$(PGPASSWORD="${PGPASSWORD:-cecelia}" psql -h "${PGHOST:-localhost}" -U "${PGUSER:-cecelia}" -d "${PGDATABASE:-cecelia}" -tAc \
  "SELECT count(*) FROM zenithjoy.service_agents WHERE account_id='$AID' AND machine_id='$MID' AND deleted_at IS NULL AND created_at > NOW() - interval '5 minutes'")
[ "$C" = "1" ] || { echo "FAIL: 绑定未落库 c=$C"; exit 1; }
# 双唯一：同 PC 再绑（换个 account）应 4xx 且不新增行
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_BASE/api/tenant/$TID/service-agents/$AID/bind-device" -H 'Content-Type: application/json' -d "{\"machine_id\":\"$MID\"}")
[ "$CODE" = "409" ] || { echo "FAIL: 重复绑定应 409 实际=$CODE"; exit 1; }
echo OK
```
**硬阈值**: HTTP 201 首次绑定落库；重复绑同客服或同 PC → 409 `ALREADY_BOUND` 且 DB 无新增行。

---

### Step 4: 看该机诊断（复用 module-health）
**来源**: `[FROM_PRD]` — Golden Path 第 4 步「选客户机 → GET /api/agent/module-health → 表格显示各模块 ✅/❌+原因+上报时间」

**可观测行为**: 诊断页拉 `GET /api/agent/module-health`，按机器渲染模块矩阵；无上报机器显示「该机暂无上报，请确认 Agent 已连中台」。

**验证命令**:
```bash
API_BASE="${API_BASE:-http://localhost:5200}"
# 复用既有端点（licenseAuth）；断言 schema 形态，不改它
RESP=$(curl -s "$API_BASE/api/agent/module-health" -H "Authorization: Bearer ${E2E_LICENSE_TOKEN:-test-lic}")
echo "$RESP" | jq -e 'has("ok") and (.data | type=="array")' >/dev/null || { echo "FAIL: module-health schema 异常"; exit 1; }
echo OK
```
**硬阈值**: 端点返回 `{ok, data:array}`；诊断页对空 data 显示「暂无上报」文案（UI 断言见 ## E2E 验收）。

---

### Step 5: 配额超限硬拒（边界 — 不写库）
**来源**: `[AI_ADDED]` — 防造假/健壮性：PRD 边界「子账号数超 plan 上限 → 报错『配额已满，当前 N/M』，不写库」。加此步确保 generator 不能用「永不拒绝」蒙混。

**可观测行为**: 建账号到 `quota.limit` 后，下一个返 4xx + message 含「配额」与「N/M」，且 DB 行数停在 limit（无第 limit+1 行）。

**验证命令**:
```bash
API_BASE="${API_BASE:-http://localhost:5200}"
LIMIT=$(curl -sf "$API_BASE/api/tenant/$TID/accounts" | jq -r '.quota.limit')
[ -n "$LIMIT" ] && [ "$LIMIT" -ge 1 ] || { echo "FAIL: quota.limit 缺失=$LIMIT"; exit 1; }
# 补建到 limit（Step2 已建 1 个 service_agent）
USED=$(curl -sf "$API_BASE/api/tenant/$TID/accounts" | jq -r '.quota.used')
i=$USED
while [ "$i" -lt "$LIMIT" ]; do
  curl -sf -X POST "$API_BASE/api/tenant/$TID/accounts" -H 'Content-Type: application/json' \
    -d "{\"email\":\"fill$i@cab.test\",\"display_name\":\"填$i\",\"role\":\"operator\"}" >/dev/null || { echo "FAIL: 配额内建账号失败 i=$i"; exit 1; }
  i=$((i+1))
done
# 第 limit+1 个应 4xx
CODE=$(curl -s -o /tmp/q.json -w '%{http_code}' -X POST "$API_BASE/api/tenant/$TID/accounts" -H 'Content-Type: application/json' \
  -d '{"email":"over@cab.test","display_name":"超额","role":"operator"}')
case "$CODE" in 409|400|403) : ;; *) echo "FAIL: 超额应 4xx 实际=$CODE"; exit 1;; esac
jq -e '.error.message | test("配额") and test("/")' /tmp/q.json >/dev/null || { echo "FAIL: 错误文案缺『配额 N/M』"; exit 1; }
# DB 行数 == LIMIT（无超额行）
C=$(PGPASSWORD="${PGPASSWORD:-cecelia}" psql -h "${PGHOST:-localhost}" -U "${PGUSER:-cecelia}" -d "${PGDATABASE:-cecelia}" -tAc \
  "SELECT count(*) FROM zenithjoy.tenant_sub_accounts WHERE tenant_id='$TID' AND deleted_at IS NULL AND created_at > NOW() - interval '5 minutes'")
[ "$C" = "$LIMIT" ] || { echo "FAIL: 超额写库了 c=$C limit=$LIMIT"; exit 1; }
echo OK
```
**硬阈值**: 超额请求 4xx + 文案含「配额」+「N/M」斜杠形态；DB 账号行数恰等于 `limit`。

---

### Step 6: 租户隔离 + 软删（边界）
**来源**: `[AI_ADDED]` — PRD 范围/NFR「租户隔离：子账号绝不跨公司可见」+「账号/绑定软删，列表不再显示，记录保留」。加此步防 generator 漏 tenant 过滤或物理删。

**可观测行为**: A 公司账号不出现在 B 公司列表；软删账号后 `deleted_at` 置位、列表不再含它、DB 行仍在。

**验证命令**:
```bash
API_BASE="${API_BASE:-http://localhost:5200}"
# 隔离：建第二租户 B，A 的账号不应出现在 B 列表
TID2=$(PGPASSWORD="${PGPASSWORD:-cecelia}" psql -h "${PGHOST:-localhost}" -U "${PGUSER:-cecelia}" -d "${PGDATABASE:-cecelia}" -tAc \
  "INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES('B公司','lk-cab-'||substr(md5(random()::text),1,12),'matrix') RETURNING id")
CROSS=$(curl -sf "$API_BASE/api/tenant/$TID2/accounts" | jq -r '[.data[].email] | map(select(test("cab.test"))) | length')
[ "$CROSS" = "0" ] || { echo "FAIL: 跨租户泄漏 $CROSS 条"; exit 1; }
# 软删：删 AID，列表不再含，DB 行仍在且 deleted_at 非空
curl -sf -X DELETE "$API_BASE/api/tenant/$TID/accounts/$AID" >/dev/null || { echo "FAIL: 删除未 2xx"; exit 1; }
INLIST=$(curl -sf "$API_BASE/api/tenant/$TID/accounts" | jq -r "[.data[].account_id] | index(\"$AID\") // \"gone\"")
[ "$INLIST" = "gone" ] || { echo "FAIL: 软删后仍在列表"; exit 1; }
DEL=$(PGPASSWORD="${PGPASSWORD:-cecelia}" psql -h "${PGHOST:-localhost}" -U "${PGUSER:-cecelia}" -d "${PGDATABASE:-cecelia}" -tAc \
  "SELECT count(*) FROM zenithjoy.tenant_sub_accounts WHERE id='$AID' AND deleted_at IS NOT NULL")
[ "$DEL" = "1" ] || { echo "FAIL: 非软删（行已物理删或 deleted_at 空）"; exit 1; }
echo OK
```
**硬阈值**: 跨租户列表 0 泄漏；软删后列表不含、`deleted_at` 置位、物理行保留。

---

## 接缝清单（seam list — 碰真实世界的点，未真验标 logic-done-pending）

| # | 接缝点 | 类型 | 真目标验证方式 | 本轮状态 |
|---|---|---|---|---|
| 1 | `service_agents` 双唯一约束（account_id / machine_id partial unique）在**真 Postgres** enforce | 接缝(真库) | smoke 用真 psql 触发重复绑定，断言 409 + 无新行；CI 真库跑绿 = done | done（CI 真库可验） |
| 2 | 子账号配额 `M` 从 `licenses.tier` 推导的真实数值 | 接缝(真数据) | 测试从 API `quota.limit` 读真实值驱动，不硬编码；真 license 数据驱动 | done（quota-relative 验证） |
| 3 | Dashboard 4 区页面 → **真实 API 布线**（windows_cloud E2E 在干净 VM 用 page.route stub 验 UI 渲染，真实前后端布线在部署后才跑通） | 接缝(生产布线) | UI 层 Playwright 验可见状态变化（本轮）；前端→真 API→真库 端到端布线需部署环境真验 | **logic-done-pending**（部署后真验） |

> 说明：后端正确性（配额/双唯一/软删/隔离）由 ## E2E 验收 之外的 smoke 链路（真 curl+真 psql，见 contract-dod.md BEHAVIOR）在真 API+真库环境验证 = 真 done；windows_cloud Playwright 仅验 UI 可见行为（领域规则 UI 类 → toBeVisible 断言），其 stub 仅限被测 UI 之外的后端边界，不 mock Golden Path 的 UI 渲染本身。

---

## E2E 验收（final-e2e — target_environment = windows_cloud，GHA windows-latest 跑 Playwright）

> evaluator 调 `gh workflow run e2e-windows.yml -f sprint_dir=sprints/06220836-customer-admin-backend -f task_id=<id> -f pr_branch=<branch>`。
> 已 `cat .github/workflows/e2e-windows.yml` 核对：该 workflow checkout → setup-node@20 → 运行 `$sprintDir/e2e-verify.ps1`，exit≠0 即 FAIL。**无 CI_GAP**：e2e-verify.ps1 由本 sprint 提供，跑全 4 步用户路径。
>
> **用户路径 1:1 映射**（管理员真实操作 ↔ Playwright spec 断言）：
> 1. 管理员打开「客户管理」页 ↔ goto `/admin/customers` 见公司列表
> 2. 设公司名 ↔ 填公司名 input + 提交，断言列表显示新名（`02-company-named.png`）
> 3. 建 3 子账号(1 service_agent) ↔ 新增账号表单 ×3，断言列表出现 3 行 + role 标签（`03-accounts.png`）
> 4. 绑 1 客服到 1 PC ↔ 绑定区选 service_agent+机器提交，断言「客服 @ PC ● 在线/离线」行（`04-bound.png`）
> 5. 看诊断 ↔ 诊断区选机器，断言模块矩阵表格可见（或空态文案）（`05-diagnosis.png`）

`e2e-verify.ps1`（写入 `sprints/06220836-customer-admin-backend/e2e-verify.ps1`，evaluator 在 windows-latest 执行）：
- npm ci → `npx playwright install chromium --with-deps`
- `npm run build`（apps/dashboard）→ `npx vite preview --port 5173 --host`
- 等端口就绪（Test-NetConnection localhost:5173）
- `npx playwright test e2e/customer-admin-backend.spec.ts`（env `E2E_BASE_URL=http://localhost:5173`、`E2E_SUPER_ADMIN_EMAIL`）
- spec 用 `page.route` stub 新端点响应（干净 VM 无后端），**真实渲染** 4 区 UI 并对每步 `toBeVisible`/`toHaveText` 断言 + `page.screenshot`
- 任何 step exit≠0 或 spec 失败 → throw → workflow FAIL

PASS 标准：`e2e-verify.ps1` exit 0 + Playwright 全 spec 通过 + 5 张截图产出。
FAIL 标准：vite 30s 未就绪 / spec 任一断言失败 / 截图缺失。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint | `tests/customer-admin-backend.test.ts` | PUT 改名落库 / POST 子账号+role / 配额超限拒绝 / bind 双唯一 / 软删 / 租户隔离 / module-health schema 复用 | 模块/路由未实现 → import 失败 / 断言 FAIL → N failures |
| 后端真链路 | `.github/workflows/scripts/smoke/customer-admin-backend-smoke.sh` | Step1-6 全链 curl+psql（真 API+真库）| 端点 404/无表 → FAIL |
| UI 可见行为 | `apps/dashboard/e2e/customer-admin-backend.spec.ts` | 4 区用户路径 + 截图 | 页面/元素缺失 → toBeVisible 超时 FAIL |
