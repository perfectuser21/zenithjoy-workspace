# Sprint Contract Draft (Round 1) — Line02 机器管理模块

**journey_type**: user_facing
**target_environment**: windows_cloud
**SPRINT_DIR**: sprints/06260400-machine-management

> 复用既有零件（`zenithjoy.agents` 机器表 / `zenithjoy.agent_platform_sessions` 抖音号表含 role / `/api/agent/burner/qr-bind` 派单链路），不重造实体。本 sprint = thin 组装成统一「机器管理」后台。

---

## 已知约束（来自回归测试）

- [agent-burner.ts] `GET /api/agent/burner/sessions?tenant_id=` 已按 `JOIN agents a ON a.id=s.agent_id WHERE a.tenant_id=$1 AND s.role='burner' AND s.platform='douyin'` 列号——机器管理列号沿用此 JOIN+tenant scope 写法。
- [agent-burner.ts] `POST /qr-bind` → 写 `publish_tasks(task_type='qr_bind/douyin_burner', status='queued')`；`POST /qr-bind-result(qr_login='success')` → upsert `agent_platform_sessions(role='burner',status='active')` + task `status='done'`。「添加抖音号」必须复用此协议，不另造。
- [cs-machines-tenant-scope.test.ts] 「乱列表」钉死教训：列表/详情**必须**按请求者 tenant scope，未传 tenant → 不得返回全平台机器。本 sprint machines 列表同样按 tenant 过滤，跨租户 GET 详情返 404（不泄漏存在性）。
- [agents 表] `status CHECK (status IN ('online','offline'))`；`agent_platform_sessions.status CHECK IN ('pending','active','connected','offline','expired','bound','needs_rebind')`，`role CHECK IN ('main','burner')`。新字段 `machine_role` 用独立枚举 `('main','sub')`（机器主副，≠ 号的 role）。
- [app.ts] 路由按顺序匹配：`/api/agent/tasks` 与 `/api/agent/burner` 都在 `/api/agent`(agentRouter) **之前**挂载。新 `/api/agent/machines` 路由**必须**在 `app.use('/api/agent', agentRouter)` 之前挂载，否则被 agentRouter 吞掉。

---

## 接缝清单（接缝 vs 逻辑断言；碰真实世界的点，按全局死规则强制列出）

| # | 接缝（碰真实世界的点） | 本 sprint 验证方式 | done 判定 |
|---|---|---|---|
| 1 | **真机扫码绑抖音号**（真实 Chrome qr-bind 拉浏览器 + cookie 存客户机本地） | thin 用 **fake-agent 模拟回写** `/qr-bind-result`，验证「派单→回写→号入库→列表可见」全链路逻辑；**不拉真浏览器** | 派单+回写逻辑真验=done；真机扫码 **logic-done-pending**（PRD 明确范围外，真机扫码另附证据） |
| 2 | **浏览器真 cookie/session → 真 :5200 better-auth 租户解析** | windows_cloud 干净 VM **无真后端** → Playwright 用 `page.route` stub + `VITE_SKIP_AUTH` 注入身份，**只验 UI 渲染/交互/文案**；租户隔离**逻辑**由 mode-A 真 API+真 psql 覆盖 | 隔离逻辑（真 API+psql）=done；浏览器真 cookie 接缝 **logic-done-pending**（与 crm-cookie-seam 同款，真后端 leg 另验） |
| 3 | **机器在线/离线来自真客户机心跳**（agents.status 由心跳写入） | mode-A 用 psql 直接 `UPDATE agents SET status='offline'` 模拟，验列表 status 字段 + UI 标红逻辑 | 状态渲染逻辑=done；真心跳驱动的状态变迁 **logic-done-pending** |

> **逻辑断言**（环境无关：tenant 过滤 / 号数聚合 / role 校验 / schema 纯度 / 派单回写）→ mode-A 真 API+真 psql 跑绿 = 真 done。
> **接缝断言**（上表 3 条）→ 真目标未验的标 logic-done-pending，**不得标 done**。禁止写死环境假设值（端口/坐标/假版本）——tenant 从请求解析、号数从 DB 聚合、status 从库读，均不写死。

---

## Response Schema（推导来源: PRD 字面 + api_registry 推导[Brain registry 本地不可达，回退 agent-burner.ts 现有 OK/ERR 约定]）

> 统一信封沿用 `apps/api/src/routes/agent-burner.ts` 的 `OK(data)` / `ERR(code,message)`：
> 成功 `{ "success": true, "data": <obj>, "timestamp": <ISO> }`；失败 `{ "success": false, "error": { "code": <str>, "message": <str> }, "timestamp": <ISO> }`。

### Endpoint 1: `GET /api/agent/machines`
按当前 tenant 列机器（tenant 来源：`req.tenantId`（session，生产权威）优先，否则 `?tenant_id=`（CI/test 显式））。无 tenant → 400。

**Success (HTTP 200)**:
```json
{ "success": true, "data": { "machines": [
  { "id": "<uuid>", "nickname": "<string|null>", "hostname": "<string|null>",
    "status": "online|offline", "version": "<string|null>",
    "machine_role": "main|sub", "douyin_account_count": 0 }
] }, "timestamp": "<ISO>" }
```
- `data.machines` (array, 必填): 来源——PRD Golden Path Step 1「机器列表」
- 行 `id` (string uuid): `zenithjoy.agents.id`
- 行 `nickname` (string|null): 新字段，PRD Step 1/2「名称」
- 行 `hostname` (string|null): 复用 agents.hostname
- 行 `status` ("online"|"offline"): 复用 agents.status，PRD Step 1「在线状态」
- 行 `version` (string|null): 复用 agents.version
- 行 `machine_role` ("main"|"sub"): 新字段，PRD Step 1/2「主机器/副机器」
- 行 `douyin_account_count` (number): 聚合 `agent_platform_sessions WHERE agent_id=行.id AND platform='douyin'` 计数，PRD Step 1「该机器上登的抖音号数量」

**禁用字段名**（drift 反向守卫，机器行不得出现）: `name`（应 `nickname`）、`role`（应 `machine_role`；`role` 仅属号行）、`account_count`/`session_count`（应 `douyin_account_count`）

**Error (HTTP 400)**: `{ "success": false, "error": { "code": "MISSING_TENANT", "message": "..." }, "timestamp": "<ISO>" }`

### Endpoint 2: `GET /api/agent/machines/:id`
机器详情 + 其抖音号列表。`:id` 不属当前 tenant → 404 `MACHINE_NOT_FOUND`（不泄漏存在性）。

**Success (HTTP 200)**:
```json
{ "success": true, "data": {
  "machine": { "id": "<uuid>", "nickname": "<string|null>", "hostname": "<string|null>",
    "status": "online|offline", "version": "<string|null>", "machine_role": "main|sub",
    "douyin_account_count": 0 },
  "sessions": [
    { "account_label": "<string>", "role": "main|burner", "status": "<string>",
      "valid": true, "account_nickname": "<string|null>", "bound_at": "<ISO|null>" }
  ]
}, "timestamp": "<ISO>" }
```
- `data.machine` (obj): 同 Endpoint 1 行
- `data.sessions` (array): 该机器抖音号，PRD Step 3「主号/小号 + session 有效性」
- 号 `role` ("main"|"burner"): 复用 agent_platform_sessions.role
- 号 `valid` (bool): 派生 `status IN ('active','connected','bound')`，PRD Step 3/5「有效性」
- 号 `account_nickname` (string|null): 沿用 burner GET /sessions 子查询取 publish_tasks.response→>'account_nickname'

**Error (HTTP 404)**: `{ "success": false, "error": { "code": "MACHINE_NOT_FOUND", "message": "..." }, ... }`

### Endpoint 3: `PUT /api/agent/machines/:id`
改名 / 改角色。Body `{ "nickname"?: string, "machine_role"?: "main"|"sub" }`（至少一项）。

**Success (HTTP 200)**:
```json
{ "success": true, "data": { "id": "<uuid>", "nickname": "<string|null>", "machine_role": "main|sub" }, "timestamp": "<ISO>" }
```
**Error**:
- 400 `INVALID_ROLE`: `machine_role` 不属 `{main,sub}`，DB 不更新
- 400 `EMPTY_UPDATE`: nickname 与 machine_role 都缺
- 404 `MACHINE_NOT_FOUND`: `:id` 不属当前 tenant，DB 不更新

### Endpoint 4: `POST /api/agent/machines/:id/add-douyin`
在该机器上「添加抖音号」→ 复用 qr-bind 派单链路，向该机器派 `publish_tasks(task_type='qr_bind/douyin_burner', status='queued')`。Body `{ "account_label": string }`。

**Success (HTTP 200)**: `{ "success": true, "data": { "task_id": "<uuid>" }, "timestamp": "<ISO>" }`
**Error**: 400 `MISSING_ACCOUNT_LABEL`；404 `MACHINE_NOT_FOUND`（`:id` 不属当前 tenant）

> 回写沿用既有 `POST /api/agent/burner/qr-bind-result`（不新造）：fake-agent 以 `{ task_id, agent_id, qr_login:'success', account_nickname }` 回写 → session `role='burner' status='active'` 入库 → 号在 Endpoint 2 出现。

---

## Golden Path

[运营进机器管理页] → [看机器列表(名称/在线/角色/号数)] → [命名+标主副+保存持久化] → [点进机器看抖音号列表] → [在机器上添加抖音号(派单→fake回写)] → [新号出现在该机器下，离线机器标红/失效号标失效]

### Step 1: 运营进「机器管理」页，看到本租户机器列表
**来源**: `[FROM_PRD]` — Golden Path Step 1（机器列表，每台显示 名称/hostname/在线/版本/角色/号数）

**可观测行为**: `GET /api/agent/machines` 返回当前 tenant 全部机器，每台含 nickname/hostname/status/version/machine_role/douyin_account_count；空租户返回空数组。

**验证命令**:
```bash
# 列表 schema + 号数聚合（mode-A 真 API+真 psql，见 contract-dod.md BEHAVIOR-1/2）
RESP=$(curl -sf "${API_BASE:-http://localhost:5200}/api/agent/machines?tenant_id=$TID")
echo "$RESP" | jq -e '.success==true and (.data.machines|type=="array")'
echo "$RESP" | jq -e '.data.machines[0] | has("nickname") and has("hostname") and has("status") and has("version") and has("machine_role") and has("douyin_account_count")'
```
**硬阈值**: HTTP 200，`douyin_account_count` 等于该机器 douyin session 实际行数（mode-A 用 psql 对账）。
**验证命令(对账)**: `[ "$(echo "$RESP"|jq '.data.machines[0].douyin_account_count')" = "$(psql ... -tAc "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AID' AND platform='douyin'")" ]`

---

### Step 2: 命名机器 + 标主/副 → 保存 → 刷新后持久化
**来源**: `[FROM_PRD]` — Golden Path Step 2（命名 + 标主副 + 保存持久化）

**可观测行为**: `PUT /api/agent/machines/:id { nickname, machine_role }` → 200，5 分钟内 `agents.nickname`/`agents.machine_role` 实际更新，再 `GET /machines` 反映新值。

**验证命令**:
```bash
curl -sf -X PUT "${API_BASE}/api/agent/machines/$AID" -H "Content-Type: application/json" \
  -d '{"nickname":"主力机A","machine_role":"main"}' | jq -e '.success==true and .data.nickname=="主力机A" and .data.machine_role=="main"'
N=$(psql ... -tAc "SELECT nickname FROM zenithjoy.agents WHERE id='$AID' AND machine_role='main' AND updated_at > NOW() - interval '5 minutes'")
[ "$N" = "主力机A" ]
```
**硬阈值**: 200 且 DB `nickname='主力机A' AND machine_role='main'`，`updated_at` 在 5 分钟时间窗内（防历史数据冒充）。

---

### Step 3: 点进一台机器，看到其抖音号列表（主号/小号 + 有效性）
**来源**: `[FROM_PRD]` — Golden Path Step 3（机器详情 + 号列表 + session 有效性）

**可观测行为**: `GET /api/agent/machines/:id` 返回 `{ machine, sessions[] }`，每号含 role(main/burner)/status/valid。

**验证命令**:
```bash
RESP=$(curl -sf "${API_BASE}/api/agent/machines/$AID?tenant_id=$TID")
echo "$RESP" | jq -e '.data.machine.id=="'"$AID"'" and (.data.sessions|type=="array")'
echo "$RESP" | jq -e '.data.sessions[0] | has("role") and has("status") and has("valid")'
```
**硬阈值**: 200，`sessions[].valid` == (`status` ∈ {active,connected,bound})。

---

### Step 4: 在该机器上「添加抖音号」→ 派单 → fake-agent 回写 → 新号出现
**来源**: `[FROM_PRD]` — Golden Path Step 4（添加抖音号派单 + fake-agent 回写 + 新号出现）

**可观测行为**: `POST /api/agent/machines/:id/add-douyin {account_label}` → 派 `publish_tasks` 一行 → fake-agent `POST /api/agent/burner/qr-bind-result {task_id,agent_id,qr_login:'success'}` 回写 → `GET /machines/:id` 该号以 `role='burner' status='active'` 出现。

**验证命令**:
```bash
TASK=$(curl -sf -X POST "${API_BASE}/api/agent/machines/$AID/add-douyin" -H "Content-Type: application/json" -d '{"account_label":"小号x"}' | jq -r '.data.task_id')
curl -sf -X POST "${API_BASE}/api/agent/burner/qr-bind-result" -H "Content-Type: application/json" -d '{"task_id":"'"$TASK"'","agent_id":"'"$AID"'","qr_login":"success","account_nickname":"小号x昵称"}' | jq -e '.success==true'
curl -sf "${API_BASE}/api/agent/machines/$AID?tenant_id=$TID" | jq -e '[.data.sessions[]|select(.account_label=="小号x")]|length>=1 and .[0].status=="active"'
```
**硬阈值**: task_id 为 uuid；回写后 5 分钟内 session `account_label='小号x' role='burner' status='active'` 入库且出现在详情。

---

### Step 5: 机器离线标红 / session 失效标失效 / 可重新扫码
**来源**: `[FROM_PRD]` — Golden Path Step 5 + 边界情况（离线标红仍可看历史；失效号标失效可重扫）

**可观测行为**: `agents.status='offline'` → 列表该机 `status=='offline'`（UI 标红，仍返回其历史号）；session `status='expired'` → 详情该号 `valid==false`，可对其再走 add-douyin 重扫。

**验证命令**:
```bash
psql ... -c "UPDATE zenithjoy.agents SET status='offline', updated_at=NOW() WHERE id='$AID'"
curl -sf "${API_BASE}/api/agent/machines?tenant_id=$TID" | jq -e '[.data.machines[]|select(.id=="'"$AID"'")][0].status=="offline"'
psql ... -c "UPDATE zenithjoy.agent_platform_sessions SET status='expired' WHERE agent_id='$AID' AND account_label='小号x'"
curl -sf "${API_BASE}/api/agent/machines/$AID?tenant_id=$TID" | jq -e '[.data.sessions[]|select(.account_label=="小号x")][0].valid==false'
```
**硬阈值**: 离线机仍返回（不消失）且 status='offline'；失效号 valid=false。

---

### Step 6: 租户隔离（AI_ADDED 防造假）
**来源**: `[AI_ADDED]` — 理由：NFR「machines 列表/详情必须按当前 tenant 过滤，不得跨租户泄露」+ cs-machines「乱列表」回归教训。防 generator 不写 tenant 过滤也假绿。

**可观测行为**: 租户 B 的 `GET /machines` 不含 A 的机器；`GET /machines/:A_id?tenant_id=B` → 404 MACHINE_NOT_FOUND；`PUT /machines/:A_id?tenant_id=B` → 404 且不改 A 的库。

**验证命令**:
```bash
curl -sf "${API_BASE}/api/agent/machines?tenant_id=$TID_B" | jq -e 'all(.data.machines[]; .id != "'"$AID"'")'
CODE=$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE}/api/agent/machines/$AID?tenant_id=$TID_B"); [ "$CODE" = "404" ]
```
**硬阈值**: 跨租户列表 0 泄漏；跨租户详情/改名 404。

---

### Step 7: schema 纯度 + 禁用字段反向 + error path（AI_ADDED 防 drift）
**来源**: `[AI_ADDED]` — 理由：钉死 generator response 字段漂移（Bug 8 教训）；非法 machine_role 必拒。

**可观测行为**: 机器行不得含 `name`/`role`/`account_count`；`PUT machine_role='boss'` → 400 INVALID_ROLE 且 DB 不变。

**验证命令**:
```bash
curl -sf "${API_BASE}/api/agent/machines?tenant_id=$TID" | jq -e '.data.machines[0] | (has("name") or has("role") or has("account_count")) | not'
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "${API_BASE}/api/agent/machines/$AID" -H "Content-Type: application/json" -d '{"machine_role":"boss"}'); [ "$CODE" = "400" ]
```
**硬阈值**: 禁用字段全部不存在；非法 role 返 400 且 `agents.machine_role` 不变为 'boss'。

---

## E2E 验收（最终 final-e2e 跑 — target_environment = windows_cloud 变体 C：Dashboard Playwright）

**journey_type**: user_facing
**target_environment**: windows_cloud（GHA windows-latest，干净 VM，**无真后端**）

> **windows_cloud 限界声明（诚实标注，对齐接缝清单 #2）**：干净 VM 无 postgres/无 :5200。下方 Playwright 用 `page.route` stub 所有 `/api/agent/machines*` + `VITE_SKIP_AUTH` 注入登录身份——它**只验 UI 渲染/交互/文案**（列表渲染、命名+标主副交互、点进详情、添加号后号出现、离线标红），**不验** cookie→:5200 租户接缝（接缝 #2，真后端 leg 另验）。后端**逻辑**（tenant 过滤/号数聚合/派单回写/role 校验）由 mode-A 真 API+真 psql 的 BEHAVIOR 覆盖（contract-dod.md）。

### e2e-verify.ps1（写入 sprints/06260400-machine-management/e2e-verify.ps1，由 .github/workflows/e2e-windows.yml dispatch）

```powershell
# final-e2e（windows_cloud / GHA windows-latest）— Line02 机器管理页 Dashboard Playwright
# 变体 C：npm ci → playwright install → build dashboard → vite preview:5174 → spec
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
  do { Start-Sleep -Seconds 1; $waited++; $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue } while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
  if (-not $conn.TcpTestSucceeded) { throw "FAIL: Vite 未在 ${maxWait}s 就绪 port=$VitePort" }
  Write-Host "✅ Vite 就绪 port=$VitePort"

  $e2e = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c npx.cmd playwright test e2e\machine-management.spec.ts --reporter=list" `
    -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow `
    -Environment @{ BASE_URL = "http://localhost:$VitePort"; VITE_SKIP_AUTH = "true" }
  if ($e2e.ExitCode -ne 0) { throw "FAIL: Playwright E2E exit=$($e2e.ExitCode)" }
}
finally {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}

# 截图归档到 sprint 目录（evaluator 视觉自验）
$shots = "$repoRoot\apps\dashboard\screenshots"
if (Test-Path $shots) {
  New-Item -ItemType Directory -Force -Path "$scriptDir\screenshots" | Out-Null
  Copy-Item "$shots\*.png" "$scriptDir\screenshots\" -ErrorAction SilentlyContinue
}
Write-Host "✅ windows_cloud 机器管理 E2E 验证通过"
exit 0
```

### machine-management.spec.ts（写入 apps/dashboard/e2e/machine-management.spec.ts — page.route stub，验 UI）

要点（generator 据此实现）：
- `stubAuth(page)`：route `**/api/auth/**` → 401，注入 `VITE_SKIP_AUTH` 已登录态。
- route `**/api/agent/machines?**`（列表）→ 返 2 台机器：一台 `status:online machine_role:main douyin_account_count:1`，一台 `status:offline machine_role:sub douyin_account_count:0`。
- route `**/api/agent/machines/*`（详情）→ 返 machine + sessions（1 主号 active、可变）。
- route `PUT **/api/agent/machines/*` → 回 `{success:true,data:{nickname,machine_role}}`（断言前端发的 body）。
- route `POST **/api/agent/machines/*/add-douyin` → 回 `{success:true,data:{task_id:'t1'}}`，之后详情 stub 多返回一个新号。
- 断言（必须显式，禁止只 navigate）：
  - `screenshots/01-initial.png` 后：列表 2 行可见，含「主力机/主机器」「副机器」文案、号数列；离线机器有标红样式（`toHaveClass`/`toHaveAttribute` 或红色文案 `离线`）。
  - 命名+选主副+保存：`fill nickname` + 选 main + click 保存 → `02-action.png` → `toHaveText` 成功提示 + 列表名称更新。
  - 点进详情：`03-result.png` → 号列表可见、主号 `有效`、点「添加抖音号」后新号出现。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| machines API（列表/详情/改名/加号） | `sprints/06260400-machine-management/tests/machine-management.test.ts` | GET 列表 schema+号数 / GET 详情+sessions / PUT 改名改角色+校验 / POST 加号派单 / tenant 隔离 / 禁用字段反向 | import `agent-machines`(未创建) → 模块解析失败 → 全 fail |
