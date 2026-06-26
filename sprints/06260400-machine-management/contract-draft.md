# Sprint Contract Draft (Round 1) — 机器管理模块

**被测系统** = `apps/api`（:5200，env `API_BASE`）+ `zenithjoy.*` postgres + `apps/dashboard`（:5174）
**journey_type**: user_facing
**target_environment**: windows_cloud（Dashboard Playwright，GHA windows-latest 干净 VM）+ linux CI 真后端 leg（API/psql 接缝真验）

> 环境变量（smoke / evaluator 注入，默认见右）：`API_BASE`(http://localhost:5200) `PSQL_HOST`(localhost) `PSQL_USER`(cecelia) `PSQL_DB`(cecelia) `PSQL_PASS`(cecelia)；`COOKIE`=登录运营 better-auth cookie 文件；`TENANT`/`AGENT_ID`/`MACHINE_ID`/`COOKIE_B`(第二租户) 由 smoke bootstrap 真造（真插 `zenithjoy.agents` 行），不写死。

---

## 已知约束（来自回归测试）

- [cs-machines-tenant-scope.test.ts] 普通运营 → 列机器必须带请求者 tenantId（`listAllMachines(req.tenantId)`），**只列自己租户的机器**，不得裸调拉全部
- [cs-machines-tenant-scope.test.ts] 超管（X-Bypass-Tenant 通道，无 tenantId）→ 旁路列全部
- [cs-machines-tenant-scope.test.ts] 未登录 → 401，不查库
- [agent-burner.test.ts] qr-bind 派单：`account_label` 必填、不可为 `default`（保留主号）、同 (agent_id, account_label) 已 active burner → 400 `BURNER_ALREADY_BOUND`
- [create_agents.sql] `zenithjoy.agents.status` CHECK IN ('online','offline')；按 `(tenant_id, status)` 建索引
- [agent_platform_sessions_add_role.sql] `role` CHECK IN ('main','burner') DEFAULT 'main'
- [agent_platform_sessions_ilink.sql] `status` CHECK IN ('pending','active','connected','offline','expired','bound','needs_rebind')；`extra_json` jsonb 存 `{nickname}`

---

## Response Schema（推导来源: api_registry 推导 — 复用 `apps/api` 现有 cs-machines / crm-customers 列表端点的 unwrapped `{<plural>:[...]}` 约定 + agent-burner 写端点的 `{success,error}` 约定）

### Endpoint 1: `GET /api/agent/machines`
按当前租户列机器（每台含其抖音号数量）。沿用 `cs-machines` 的 unwrapped 列表约定。

**Success (HTTP 200)**:
```json
{"machines": [{"id":"<uuid>","agent_id":"<text>","hostname":"<text>","nickname":"<text>","machine_role":"main|sub","status":"online|offline","version":"<text>","douyin_account_count":0}]}
```
- `machines` (array, 必填): 来源——api_registry `GET /api/wechat/cs/machines` 返回 `.machines` 数组约定
- `machines[].id` (string uuid, 必填): `zenithjoy.agents.id`
- `machines[].nickname` (string, 必填): 来源——PRD [ASSUMPTION] agents 加 nickname（可空，默认 hostname）；空时后端回填 hostname
- `machines[].machine_role` (string 枚举 `main`/`sub`, 必填): 来源——PRD [ASSUMPTION] agents 加 machine_role 默认 sub
- `machines[].status` (string 枚举 `online`/`offline`, 必填): `zenithjoy.agents.status`（离线标红依据）
- `machines[].douyin_account_count` (number, 必填): 该机器 `agent_platform_sessions` 中 platform='douyin' 的号数

**禁用字段名**（drift 信号，正向断言里严禁出现）: `role`（机器角色字段名是 `machine_role`，不是 `role`，避免与 session.role 混淆）、`is_main`、`machineRole`（驼峰）、`accountCount`（驼峰）、`agents`（列表 key 是 `machines` 不是 `agents`）

**Error (HTTP 401)**: 未登录 → `{"success":false,"error":{"code":"UNAUTHORIZED","message":"<string>"}}`

---

### Endpoint 2: `GET /api/agent/machines/:id`
机器详情 + 其抖音号列表。`:id` = `zenithjoy.agents.id`（uuid）。

**Success (HTTP 200)**:
```json
{"machine":{"id":"<uuid>","nickname":"<text>","machine_role":"main|sub","status":"online|offline"},"accounts":[{"account_label":"<text>","role":"main|burner","status":"<text>","nickname":"<text>","valid":true}]}
```
- `machine` (object, 必填): 单台机器
- `accounts` (array, 必填): 该机器 `agent_platform_sessions`（platform='douyin'）；空机器返 `[]`（空状态）
- `accounts[].role` (string 枚举 `main`/`burner`, 必填): session 主号/小号（此处用 `role` 是对的——session 字段）
- `accounts[].valid` (boolean, 必填): session 有效性，`status IN ('active','connected','bound')` → true；`('expired','needs_rebind','offline')` → false（失效标记 + 可重新扫码依据）

**禁用字段名**: `sessions`（key 是 `accounts`）、`isValid`（驼峰）、`accountLabel`（驼峰）

**Error (HTTP 404)**: 机器不存在或不属于当前租户 → `{"success":false,"error":{"code":"MACHINE_NOT_FOUND","message":"<string>"}}`

---

### Endpoint 3: `PUT /api/agent/machines/:id`
改名 + 标主副，持久化。沿用 crm `manage` 写端点 `{success:true, ...}` 约定。

**Request body**: `{"nickname":"<text 非空>","machine_role":"main|sub"}`

**Success (HTTP 200)**:
```json
{"success":true,"machine":{"id":"<uuid>","nickname":"<text>","machine_role":"main|sub"}}
```
- `success` (boolean true, 必填)
- `machine.nickname` / `machine.machine_role` (必填): 回显已保存值

**Error (HTTP 400)**: nickname 为空 / machine_role 非 main|sub → `{"success":false,"error":{"code":"INVALID_INPUT","message":"<string>"}}`
**Error (HTTP 403)**: 跨租户改非本租户机器 → `{"success":false,"error":{"code":"CROSS_TENANT","message":"<string>"}}`

---

### Endpoint 4（复用，不新建）: `POST /api/agent/burner/qr-bind`
在机器上加号——派 qr-bind 任务到该机器。已存在于 `agent-burner.ts`，schema 不变：

**Success (HTTP 200)**: `{"success":true,"data":{"task_id":"<uuid>"}}`
**Error (HTTP 400)**: `MISSING_ACCOUNT_LABEL` / `RESERVED_ACCOUNT_LABEL` / `BURNER_ALREADY_BOUND`

回写链路（fake-agent 模拟）: `POST /api/agent/burner/qr-bind-result {task_id, agent_id, qr_login:"success", account_nickname}` → upsert `agent_platform_sessions role='burner' status='active'`。

---

## GAN 来源标注

| 类别 | 内容 | 理由 |
|---|---|---|
| `[FROM_PRD]` | Golden Path Step 1-5（列表/改名标主副/详情看号/加号/离线失效）全部 1:1 来自 PRD「Golden Path（核心场景）」5 步 + 「边界情况」 | PRD 原文可逐条对应 |
| `[AI_ADDED]` | ① 所有 count/写库断言加 `created_at/bound_at/updated_at > NOW() - interval '5 minutes'` 时间窗 | 防 generator 用历史残留行冒充本轮产出（反例清单 #8）|
| `[AI_ADDED]` | ② 禁用字段反向断言（machines 不得有 `role/is_main/machineRole/accountCount`；详情 key 是 `accounts` 不是 `sessions`；不得 `isValid`）| 防 schema drift——字段名与 session.role 混淆或驼峰漂移 |
| `[AI_ADDED]` | ③ 跨租户隔离 BEHAVIOR（租户 B 读不到 A + 跨写 403/404）| 回归约束 cs-machines-tenant-scope.test 钉死「别列一堆乱七八糟」，复用同一闸 |
| `[AI_ADDED]` | ④ 登录态闸 BEHAVIOR（无 cookie 401）+ cookie 接缝真目标 leg | PRD [ASSUMPTION] VITE_SKIP_AUTH 只够 UI 层；真登录态接缝须真后端验（接缝清单 #1）|

## Golden Path
[运营进「智能获客 → 机器管理」入口] → [看机器列表 → 命名/标主副 → 点进机器看抖音号 → 在该机器加号] → [新号出现在该机器下 + 离线/失效可见]

### Step 1: 运营进「机器管理」页，看到本租户所有机器列表
**来源**: `[FROM_PRD]` — Golden Path 第 1 步「看到本租户所有机器列表，每台显示：名称、hostname、在线状态、版本、角色（主/副）、其上抖音号数量」

**可观测行为**: `GET /api/agent/machines` 返回当前租户机器数组，每台含 nickname / hostname / status / version / machine_role / douyin_account_count

**验证命令**:
```bash
RESP=$(curl -sf -b "$COOKIE" "${API_BASE}/api/agent/machines")
echo "$RESP" | jq -e '.machines | type == "array"' || { echo FAIL; exit 1; }
echo "$RESP" | jq -e '.machines[0] | has("id") and has("hostname") and has("nickname") and has("status") and has("machine_role") and has("version") and has("douyin_account_count")' || { echo FAIL; exit 1; }
```
**硬阈值**: HTTP 200，machines 为数组，首行含 7 个 PRD 字段
**验证命令（硬阈值机检）**: 同上 jq -e（exit 0 = PASS）

---

### Step 2: 运营给某台机器改名 + 标主副，保存后持久化
**来源**: `[FROM_PRD]` — Golden Path 第 2 步「改名 + 标记主机器/副机器 → 保存 → 刷新后持久化」

**可观测行为**: `PUT /api/agent/machines/:id {nickname, machine_role}` 返回 success，DB `zenithjoy.agents` 真写入，重新 GET 列表该机器显示新名 + 新角色

**验证命令**:
```bash
curl -sf -b "$COOKIE" -X PUT "${API_BASE}/api/agent/machines/${MACHINE_ID}" \
  -H "Content-Type: application/json" -d '{"nickname":"主控机A","machine_role":"main"}' \
  | jq -e '.success==true and .machine.nickname=="主控机A" and .machine.machine_role=="main"' || { echo FAIL; exit 1; }
# DB 真写入（5 分钟时间窗防造假）
N=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -tAc \
  "SELECT count(*) FROM zenithjoy.agents WHERE id='${MACHINE_ID}' AND nickname='主控机A' AND machine_role='main' AND updated_at > NOW() - interval '5 minutes'")
[ "$N" = "1" ] || { echo FAIL; exit 1; }
# 刷新列表持久化
curl -sf -b "$COOKIE" "${API_BASE}/api/agent/machines" | jq -e --arg m "$MACHINE_ID" '.machines[] | select(.id==$m) | .nickname=="主控机A" and .machine_role=="main"' || { echo FAIL; exit 1; }
```
**硬阈值**: HTTP 200，DB 行 nickname/machine_role 更新且 updated_at 在 5 分钟内，刷新列表回显新值

---

### Step 3: 运营点进一台机器，看到该机器上绑定的抖音号列表
**来源**: `[FROM_PRD]` — Golden Path 第 3 步「看到该机器上绑定的抖音号列表（昵称 / role 主号·小号 / session 有效性）」

**可观测行为**: `GET /api/agent/machines/:id` 返回 `{machine, accounts}`，每个 account 含 account_label / role / status / nickname / valid

**验证命令**:
```bash
RESP=$(curl -sf -b "$COOKIE" "${API_BASE}/api/agent/machines/${MACHINE_ID}")
echo "$RESP" | jq -e '.machine.id != null' || { echo FAIL; exit 1; }
echo "$RESP" | jq -e '.accounts | type == "array"' || { echo FAIL; exit 1; }
echo "$RESP" | jq -e '.accounts[0] | has("account_label") and has("role") and has("status") and has("nickname") and (has("valid") and (.valid|type=="boolean"))' || { echo FAIL; exit 1; }
```
**硬阈值**: HTTP 200，accounts 为数组，号对象含 valid(boolean)；空机器返 `[]`（空状态，仍可加号）

---

### Step 4: 运营在该机器上「添加抖音号」→ 派 qr-bind → fake-agent 回写 → 新号出现
**来源**: `[FROM_PRD]` — Golden Path 第 4 步「点添加抖音号 → 中台派 qr-bind 任务到该机器 → fake-agent 模拟回写 → 新号出现在该机器下」

**可观测行为**: POST qr-bind 派单返回 task_id；fake-agent 经真路由 qr-bind-result 回写 → `agent_platform_sessions` 新增 role='burner' 行；GET machine detail 新号出现

**验证命令**:
```bash
LABEL="小号_$$"
TASK_ID=$(curl -sf -b "$COOKIE" -X POST "${API_BASE}/api/agent/burner/qr-bind" \
  -H "Content-Type: application/json" -d "{\"agent_id\":\"${AGENT_ID}\",\"tenant_id\":\"${TENANT}\",\"account_label\":\"${LABEL}\"}" \
  | jq -r '.data.task_id')
[ -n "$TASK_ID" ] && [ "$TASK_ID" != "null" ] || { echo "FAIL: 无 task_id"; exit 1; }
# fake-agent 经真路由回写成功
curl -sf -X POST "${API_BASE}/api/agent/burner/qr-bind-result" \
  -H "Content-Type: application/json" -d "{\"task_id\":\"${TASK_ID}\",\"agent_id\":\"${AGENT_ID}\",\"qr_login\":\"success\",\"account_nickname\":\"新小号\"}" \
  | jq -e '.success==true' || { echo FAIL; exit 1; }
# 新 session 真写入（5 分钟时间窗）
N=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -tAc \
  "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE agent_id='${AGENT_ID}' AND platform='douyin' AND account_label='${LABEL}' AND role='burner' AND status='active' AND bound_at > NOW() - interval '5 minutes'")
[ "$N" = "1" ] || { echo "FAIL: 新小号未写入"; exit 1; }
# 新号出现在该机器详情下
curl -sf -b "$COOKIE" "${API_BASE}/api/agent/machines/${MACHINE_ID}" \
  | jq -e --arg l "$LABEL" '.accounts[] | select(.account_label==$l) | .role=="burner"' || { echo "FAIL: 新号未出现在机器下"; exit 1; }
```
**硬阈值**: 派单返回 task_id；回写后 session 真写入 5 分钟内；机器详情可见新 burner 号

---

### Step 5: 机器离线标红 + session 失效标记 + 可重新扫码
**来源**: `[FROM_PRD]` — Golden Path 第 5 步「机器离线 → 列表中该机器标红；号 session 失效 → 标记失效，可在对应机器上重新扫码」

**可观测行为**: agents.status='offline' 的机器在列表 status 返 'offline'（前端标红）；session status='needs_rebind'/'expired' 的号 valid=false（前端标失效 + 重新扫码按钮）

**验证命令**:
```bash
# 离线机器 status 为 offline（前端据此标红）
curl -sf -b "$COOKIE" "${API_BASE}/api/agent/machines" \
  | jq -e --arg m "$OFFLINE_MACHINE_ID" '.machines[] | select(.id==$m) | .status=="offline"' || { echo FAIL; exit 1; }
# 失效 session valid=false
curl -sf -b "$COOKIE" "${API_BASE}/api/agent/machines/${MACHINE_ID}" \
  | jq -e '[.accounts[] | select(.status=="needs_rebind" or .status=="expired")] | all(.valid==false)' || { echo FAIL; exit 1; }
```
**硬阈值**: 离线机器 status='offline'；失效 session valid=false（接缝清单第 3 条，详见下）

---

## 边界 / error path（PRD「边界情况」逐条）

- **改名为空** → `PUT` 返 400 `INVALID_INPUT`：`CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIE" -X PUT "${API_BASE}/api/agent/machines/${MACHINE_ID}" -H "Content-Type: application/json" -d '{"nickname":"","machine_role":"main"}'); [ "$CODE" = "400" ]`
- **角色非法值** → `PUT` 返 400 `INVALID_INPUT`：body `{"nickname":"x","machine_role":"boss"}` → 400
- **离线机器加号置灰**：离线机器 `douyin_account_count` 仍可查（历史绑定可见），UI 据 status='offline' 置灰「添加抖音号」（E2E 验 UI 文案/disabled）
- **fake-agent 回写失败（错误码）** → `qr-bind-result {qr_login:"failed"}` → task status='failed'，页面提示可重试（E2E 验）
- **跨租户** → 租户 B 读不到 A 的机器；跨租户 PUT 返 403 `CROSS_TENANT`

---

## 接缝清单（接缝断言 — 必须在真目标验证，CI 绿 ≠ done）

| # | 碰真实世界的点 | 真目标验证方式 | done 判定 |
|---|---|---|---|
| 1 | 运营浏览器带 better-auth cookie → 真 `apps/api` 后端 GET/PUT 机器（登录态接缝）| linux CI 真后端 leg：真登录拿 cookie 注入浏览器 → goto 机器管理页 → 真 GET/PUT → 真 200 + psql 复核 nickname 真写入（5 分钟窗）| 真后端 leg PASS 才 done；windows_cloud stub 只验 UI 文案，未真验 → `logic-done-pending` |
| 2 | fake-agent 经**真** qr-bind-result 路由回写 → `agent_platform_sessions` 真写 burner 行 | Step 4 BEHAVIOR：真 POST 两路由 + psql 查新 session（bound_at 5 分钟窗）| Step 4 BEHAVIOR PASS = done（非 mock，走真路由真写真库）|
| 3 | 离线/失效真状态来自真 DB（agents.status / session.status），不是前端臆造 | Step 5 BEHAVIOR：真 DB seed offline/needs_rebind → GET 真返 status/valid | Step 5 BEHAVIOR PASS = done |

> 接缝 1 的 windows_cloud Playwright（page.route stub + VITE_SKIP_AUTH）**只验 UI 渲染/交互/文案**，**不验** cookie 真到达后端。cookie 接缝真验证在 `[BEHAVIOR:E2E:COOKIE-SEAM]`（linux CI 真后端 leg）。未跑真 leg → 接缝 1 标 `logic-done-pending`，**不得**用 stub 绿冒充 done。
> 逻辑断言（环境无关）：machine_role/valid 派生、租户 scope、字段映射 → CI/单测验绿 = done。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=windows_cloud 变体 C：Dashboard Playwright）

**写入 `sprints/06260400-machine-management/e2e-verify.ps1`**（GHA `.github/workflows/e2e-windows.yml` dispatch，windows-latest 干净 VM）：

```powershell
# final-e2e（windows_cloud / GHA windows-latest）— 机器管理 Dashboard Playwright
# 变体 C：build dashboard → vite preview:5174 → Playwright apps/dashboard/e2e/machine-management.spec.ts
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VitePort = 5174
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptDir\..\.."

Write-Host "▶ npm ci..."
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd ci --prefer-offline" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: npm ci exit=$($p.ExitCode)" }

Write-Host "▶ playwright install chromium..."
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright install chromium --with-deps" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: playwright install exit=$($p.ExitCode)" }

Write-Host "▶ build dashboard..."
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd run build" -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: build exit=$($p.ExitCode)" }

Write-Host "▶ vite preview on $VitePort..."
$server = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" -WorkingDirectory "$repoRoot\apps\dashboard" -PassThru -NoNewWindow
try {
  $maxWait = 30; $waited = 0
  do {
    Start-Sleep -Seconds 1; $waited++
    $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
  } while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
  if (-not $conn.TcpTestSucceeded) { throw "FAIL: Vite 未在 ${maxWait}s 就绪 port=$VitePort" }
  Write-Host "✅ Vite 就绪 port=$VitePort"

  $e2e = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c npx.cmd playwright test e2e\machine-management.spec.ts --reporter=list" `
    -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow `
    -Environment @{ BASE_URL = "http://localhost:$VitePort" }
  if ($e2e.ExitCode -ne 0) { throw "FAIL: Playwright E2E exit=$($e2e.ExitCode)" }
} finally {
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
}
Write-Host "✅ windows_cloud 机器管理 Dashboard E2E 验证通过"
exit 0
```

**Playwright 脚本**（`apps/dashboard/e2e/machine-management.spec.ts`，Mode B UI 层；page.route stub + VITE_SKIP_AUTH，验 UI 渲染/交互/文案，**含显式 toBeVisible/toHaveText 断言**）：截图 `01-initial.png`（机器列表 ≥1 行，含名称/在线状态/角色/号数）/ `02-action.png`（改名+标主副后「保存成功」）/ `03-result.png`（点进机器看抖音号列表 + 离线机器加号按钮置灰）。stub 端点：`GET /api/agent/machines`、`GET /api/agent/machines/:id`、`PUT /api/agent/machines/:id`、`POST /api/agent/burner/qr-bind`。

**PASS 标准**: `e2eProc.ExitCode -eq 0` + 所有 spec 通过
**FAIL 标准**: 任何 step exit≠0 OR Playwright 失败 OR Vite 30s 未就绪

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint（machines 列表/详情/改名 + migration + 加号链路）| `tests/machine-management.test.ts` | GET 列表 schema + 租户 scope / GET 详情 accounts schema / PUT 改名持久化 + error path / qr-bind 加号回写 / 离线·失效派生 | router 模块未实现 → import/路由 404 → N failures |
