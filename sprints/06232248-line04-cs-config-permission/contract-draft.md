# Sprint Contract Draft (Round 2)

Sprint: 客服配置写接口安全闸（管理员 + 租户隔离）+ 管理员前台补全
journey_type: user_facing ｜ target_environment: windows_cloud（2-job：ubuntu curl+psql 后端隔离 + windows Playwright UI）
journey_id: bfeed805 ｜ step_id: L04 — 客服层多租户隔离（feature ca26491c）

---

## 已知约束（来自回归测试 + 既有实现）

- `apps/api/src/middleware/tenant-context.ts` → `tenantContext` 已能从 better-auth session（或向后兼容 `X-Feishu-User-Id` 头）解出 `req.tenantId` + `req.tenantRole`（owner/admin/member）；无身份 → 401 `UNAUTHORIZED`；用户无租户关联 → 403 `NO_TENANT`。**本 sprint 直接复用，不改其行为。**
- `apps/api/tests/regression/line04-cs-tenant-isolation.test.ts` → 客服读写路径缺租户上下文一律 4xx 拒绝、绝不回退全量（本 sprint 把同一纪律扩到写接口的角色闸 + 跨租户）。
- `apps/api/src/routes/customer-admin.ts` → `tenant_members` 角色校验模式（`VALID_ROLES = owner/admin/member`）+ 越权 403 `{success:false, error:{code,message}, timestamp}` 响应形状（本 sprint 权限拒绝沿用此形状）。
- 当前缺口（Issue 96db53be P1）：`PUT /cs/config/:wechatId`、`PUT /cs/setup/:machineId` **完全无 guard**；`PUT /cs/auto-agent` 仅挂 `superAdminGuard`（只认飞书白名单/internal token，**不认 dashboard better-auth session**）。三者均无「管理员 + 租户隔离」闸 → 任何登录用户可改任意客服配置。
- 目标租户解析链：`/cs/config/:wechatId` → `zenithjoy.service_agents WHERE wechat_id=$1 AND deleted_at IS NULL` 的 `tenant_id`；`/cs/setup/:machineId` → `license_machines lm JOIN licenses l ON l.id=lm.license_id WHERE lm.machine_id=$1` 的 `l.tenant_id`（与 `setupCSByMachine` 同源）。
- 前台缺口（Issue d2987606 P2）：`PerCsConfigPage`（路由 `/wechat/per-cs-config`）与 `CsOneClickSetupPage`（路由 `/wechat/setup`）后端支持 8 项配置，前台只暴露人设/开关/白名单/关键人 —— **缺营业时间 start/end + daily_limit 输入**。

---

## Response Schema（推导来源: api_registry 不可达 → 既有路由实现字面值 + tenant-context/customer-admin 既定形状）

> **死规则**：权限拒绝（401/403/404）一律用嵌套 `error.code` 形状（与 `tenantContext`/`superAdminGuard` 字面一致）；既有的 400 body 校验 `{error:"INVALID_BODY", ...}` 扁平形状**保持不变**（本 sprint 不动）。

### Endpoint: PUT /api/wechat/cs/config/:wechatId（写接口①）
**Success (HTTP 200)**:
```json
{"success": true, "config": {"wechat_id": "<string>", "persona": {}, "daily_limit": 0, "business_hours_start": "06:00", "business_hours_end": "24:00"}}
```
- `success` (boolean, 必填) == `true`：来源——既有实现字面值（wechat-config.ts:317）
- `config` (object, 必填)：写后回读该客服那一行；含新增暴露的 `business_hours_start/end`、`daily_limit`
**权限拒绝**:
```json
{"success": false, "data": null, "error": {"code": "<CODE>", "message": "<string>"}, "timestamp": "<iso>"}
```
- HTTP 401 → `error.code == "UNAUTHORIZED"`（无 session 无身份；来源 tenantContext）
- HTTP 403 → `error.code == "NO_TENANT"`（当前用户未关联租户；来源 tenantContext）
- HTTP 403 → `error.code == "NOT_ADMIN"`（member/无 role 非管理员；message 含「仅管理员可配置」）`[AI_ADDED]`
- HTTP 403 → `error.code == "CROSS_TENANT"`（目标客服属别家租户）`[AI_ADDED]`
- HTTP 404 → `error.code == "TARGET_NOT_FOUND"`（目标客服解析不到所属租户 → deny by default，不写库）`[AI_ADDED]`
- HTTP 400 → `{"error": "INVALID_BODY", ...}`（既有 zod 校验，**保持不变**）

**禁用字段名**（权限拒绝响应顶层严禁出现）: `negation`, `result`, `ok`, `forbidden`（拒绝用嵌套 `error.code`，不自创扁平字段）

### Endpoint: PUT /api/wechat/cs/setup/:machineId（写接口②）
**Success (HTTP 200)**: `{"success": true, "wechat_id": "<string>", "config": {}, "setup_notice": null}`（既有字面值）
**权限拒绝**: 同上 5 类（401 UNAUTHORIZED / 403 NO_TENANT / 403 NOT_ADMIN / 403 CROSS_TENANT / 404 TARGET_NOT_FOUND）；既有 400 `{error:"INVALID_BODY"}` 与 `{error:"SETUP_FAILED"}` 保持不变。

### Endpoint: PUT /api/wechat/cs/auto-agent（写接口③，全局单行配置，无 per-tenant 目标）
**Success (HTTP 200)**: `{"success": true, "config": {}, "broadcast": {}}`（既有字面值）
**权限拒绝**: 至少角色闸 —— member/非管理员 → 403 `error.code == "NOT_ADMIN"`；无身份 → 401 `UNAUTHORIZED`。全局配置无跨租户目标，故不做 CROSS_TENANT 检查。

### Endpoint: GET /api/wechat/cs/my-role（新增，供前台渲染只读态）`[AI_ADDED]`
**Success (HTTP 200)**: `{"role": "owner"|"admin"|"member", "can_config": <boolean>}`
- `can_config` == `(role == "owner" || role == "admin")`
- 401 `UNAUTHORIZED`（无 session）；403 `NO_TENANT`（无租户）—— 走 tenantContext。

---

## Golden Path

[管理员登录 dashboard 进客服机配置页] → [设某客服机人设/白名单/真发开关/营业时间/每日上限并保存] → [系统校验「该客服所属租户的 admin/owner」] → [仅本租户本客服那一行写入生效；越权一律拒绝且 0 写库]

### Step 1: 管理员打开客服机配置页，看到完整 8 项配置入口（含新增营业时间 + 每日上限）
**来源**: `[FROM_PRD]` — Golden Path 步骤 1 + 范围内「管理员前台补营业时间(start/end)、daily_limit 输入入口」+ Issue d2987606 P2

**可观测行为**: 管理员（admin/owner）打开 `/wechat/per-cs-config` 或 `/wechat/setup`，营业时间 start/end、每日上限输入框可见且可编辑。

**验证命令**（windows Playwright，见 ## E2E 验收）:
```javascript
await expect(page.getByTestId('cs-business-hours-start')).toBeVisible();
await expect(page.getByTestId('cs-business-hours-end')).toBeVisible();
await expect(page.getByTestId('cs-daily-limit')).toBeVisible();
await expect(page.getByTestId('cs-daily-limit')).toBeEnabled();
```
**硬阈值**: 3 个新输入框全部 `toBeVisible` 且管理员态 `toBeEnabled`。

---

### Step 2: 本租户管理员设某客服配置并保存 → 200 + 仅该行写库
**来源**: `[FROM_PRD]` — Golden Path 步骤 2/3 + E2E 验收点 3

**可观测行为**: admin（属 tenant-A）对属 tenant-A 的客服 `PUT /cs/config/:wechatId`（含营业时间/每日上限）→ 200 `{success:true}`，仅该 `wechat_id` 那一行 `updated_at` 在 5 分钟内更新，别的行不动。

**验证命令**（regression，真红→真绿）:
```bash
cd apps/api && npx vitest run tests/regression/line04-cs-config-permission.test.ts \
  -t "admin 同租户 PUT /cs/config/:wechatId → 200 且调 saveCSConfig 写该行"
# gate-allow: weak-oracle 命令 oracle = vitest 退出码（测试断言 200 + saveCSConfig 被调）
```
**硬阈值**: 测试退出码 0；`saveCSConfig` 恰好被调 1 次且首参 == 目标 wechatId。
后端 E2E（含时间窗防伪）见 ## E2E 验收 e2e-backend-verify.sh 第 2 步。

---

### Step 3: member（非管理员）调写接口 → 403 NOT_ADMIN 且 DB 未变
**来源**: `[FROM_PRD]` — Golden Path 步骤 4 + 边界「member 视为非管理员」+ E2E 验收点 1（核心安全断言，钉死 Issue 96db53be）

**可观测行为**: member 对 `PUT /cs/config/:wechatId` → 403 `error.code=="NOT_ADMIN"`；`saveCSConfig` 0 调用；DB 该行 `updated_at` 不变。前台显示「仅管理员可配置」。

**验证命令**:
```bash
cd apps/api && npx vitest run tests/regression/line04-cs-config-permission.test.ts \
  -t "member PUT /cs/config/:wechatId → 403 NOT_ADMIN 且绝不调 saveCSConfig"
# gate-allow: weak-oracle 命令 oracle = vitest 退出码
```
**硬阈值**: 403 + `error.code=="NOT_ADMIN"` + `saveCSConfig` 0 调用。

---

### Step 4: 别家公司管理员改本公司客服配置 → 403 CROSS_TENANT 且 DB 未变（租户隔离）
**来源**: `[FROM_PRD]` — Golden Path 步骤 5 + 边界「跨租户拒绝」+ E2E 验收点 2

**可观测行为**: tenant-A 的 admin 对属 tenant-B 的客服 `PUT /cs/config/:wechatId` → 403（或 404）；`saveCSConfig` 0 调用；DB 未变。

**验证命令**:
```bash
cd apps/api && npx vitest run tests/regression/line04-cs-config-permission.test.ts \
  -t "跨租户 admin PUT /cs/config/:wechatId（A 改 B 的客服）→ 403 CROSS_TENANT 且绝不写库"
# gate-allow: weak-oracle 命令 oracle = vitest 退出码
```
**硬阈值**: 状态码 ∈ {403,404} + `saveCSConfig` 0 调用。

---

### Step 5: 无 session 调写接口 → 401 UNAUTHORIZED 且 DB 未变
**来源**: `[FROM_PRD]` — Golden Path 步骤 6 + E2E 验收点 4

**可观测行为**: 无 better-auth session 且无 `X-Feishu-User-Id` 头 → 401 `error.code=="UNAUTHORIZED"`；0 写库。

**验证命令**:
```bash
cd apps/api && npx vitest run tests/regression/line04-cs-config-permission.test.ts \
  -t "无身份 PUT /cs/config/:wechatId → 401 且绝不写库"
# gate-allow: weak-oracle 命令 oracle = vitest 退出码
```
**硬阈值**: 401 + `saveCSConfig` 0 调用。

---

### Step 6: deny by default — 解析不出目标租户 / 当前用户租户角色 → 拒绝，不放行写库
**来源**: `[FROM_PRD]` — Golden Path 步骤 7 + 边界「解析不出 → deny by default」+ NFR「安全默认 deny by default」+ E2E 验收点 5

**可观测行为**:
- 目标客服（wechatId/machineId）解析不到所属租户 → 404 `error.code=="TARGET_NOT_FOUND"`，不默认放行到任一租户，0 写库。
- 当前用户解析不到租户/角色 → 403 `error.code=="NO_TENANT"`（tenantContext），0 写库。

**验证命令**:
```bash
cd apps/api && npx vitest run tests/regression/line04-cs-config-permission.test.ts \
  -t "目标客服解析不到所属租户" -t "当前用户无租户关联"
# gate-allow: weak-oracle 命令 oracle = vitest 退出码（两条 deny-by-default 用例）
```
**硬阈值**: 解析不到目标 → 404 TARGET_NOT_FOUND；用户无租户 → 403 NO_TENANT；两者 `saveCSConfig` 均 0 调用。

---

### Step 7: 三个写接口全部挂闸（覆盖 setup + auto-agent）
**来源**: `[FROM_PRD]` — 范围内「/cs/config /cs/setup /cs/auto-agent 三个写接口挂租户上下文 + 角色闸」

**可观测行为**: member 调 `PUT /cs/setup/:machineId` 与 `PUT /cs/auto-agent` 均 403，`setupCSByMachine`/`saveAutoAgentConfig` 0 调用。

**验证命令**:
```bash
cd apps/api && npx vitest run tests/regression/line04-cs-config-permission.test.ts \
  -t "member PUT /cs/setup/:machineId" -t "member PUT /cs/auto-agent"
# gate-allow: weak-oracle 命令 oracle = vitest 退出码
```
**硬阈值**: 两接口 member → 403，对应写库 store 0 调用。

---

## 接缝清单（接缝 vs 逻辑断言；真环境炸的根因防御）

> 本 sprint 安全闸逻辑**几乎全是逻辑断言**（环境无关：角色查 tenant_members、目标租户 JOIN、deny-by-default 分支），CI postgres + supertest 即可真验 = 真 done。接缝只有 1 条：

| # | 接缝点（碰真实世界处） | 真目标验证方式 | done 判定 |
|---|---|---|---|
| 1 | 生产 dashboard 真实 better-auth **登录 cookie → session → user_id** 解析下，管理员/非管理员页面实际渲染（可编辑 / 只读 + 「仅管理员可配置」）| windows Playwright job 用 `page.route` 注入 `GET /cs/my-role` 响应（admin / member 两态）验 UI 逻辑分支；真 cookie→session 解码是 `tenantContext` 既有基础设施（本 sprint **不改**，已被既有测试覆盖）| UI 逻辑分支 CI 可验 = **done**；真生产登录态渲染 = **logic-done-pending**（lead 自验一次即可，非本 sprint 阻塞项）|

逻辑断言（角色闸 / 跨租户 / deny-by-default / 0 写库 / 时间窗）= CI 绿即真 done。**禁止写死环境假设值**：目标租户必须从 `service_agents`/`license_machines` 真表推导，角色必须从 `tenant_members` 真查 —— 不许 hardcode tenantId/role 兜过。

---

## 领域验证 oracle（DB 写入类 + UI 交互类，硬条款）

- **DB 写入类**：后端 E2E 越权断言必须验「403 且 DB 未变」—— 用 psql 在越权请求前后比对目标行 `updated_at`，并对 happy-path 写入用 `updated_at > NOW() - interval '5 minutes'` 时间窗（防历史数据冒充本轮）。
- **UI 交互类**：Playwright 必须含 `toBeVisible` / `toBeEnabled` / `toBeDisabled` / `toHaveValue` 可见断言 + 关键步骤截图，禁止只 `goto` 不断言。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=windows_cloud，2-job 镜像 e2e-line04-per-cs-config.yml）

> **CI workflow**：新增/复用 `.github/workflows/e2e-line04-cs-config-permission.yml`，2 个 job（已读 `e2e-line04-per-cs-config.yml` 确认此模式）：
> - **job1 backend-isolation**（`ubuntu-latest` + `postgres:15` service）→ 跑 `e2e-backend-verify.sh`（curl 真 apps/api + psql 验 DB 未变 / 时间窗）
> - **job2 dashboard-ui**（`windows-latest`，无 DB）→ 跑 `e2e-ui-verify.ps1`（Playwright `page.route` 拦后端，验管理员可编辑 / 非管理员只读）
> 用户路径 1:1 映射检查：① 管理员打开页看到 8 项入口（job2 Step1）② 设置保存读回（job2）③ member 调写接口 403 不写库（job1 Step3）④ 跨租户 403 不写库（job1 Step4）⑤ 无 session 401（job1）⑥ deny-by-default（job1）—— 每条用户路径都有对应 job step 验证，无 `[CI_GAP]`。

### job1 — sprints/06232248-line04-cs-config-permission/e2e-backend-verify.sh（ubuntu + postgres）

```bash
#!/bin/bash
# Line04 客服配置写接口安全闸 — 后端 E2E（ubuntu-latest + postgres:15 service）
# 核心：越权（member / 跨租户 / 无 session / 解析不出目标）一律拒绝且 DB 未变（钉死 Issue 96db53be）。
set -euo pipefail
API=${API_BASE:-http://localhost:3000}
DB=${DATABASE_URL:?FAIL: DATABASE_URL 未注入（应由 ubuntu postgres service 提供）}
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"

echo "── 0. 装依赖 + 构建 + 迁移 + 启服务 ──"
npm ci --workspace=apps/api
( cd apps/api && npm run build && npm run migrate )
( cd apps/api && node dist/index.js >/tmp/api.log 2>&1 & echo $! >/tmp/api.pid )
for i in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API/health" 2>/dev/null || echo 000)
  [ "$CODE" = "200" ] && { echo "ready after ${i}s"; break; }
  [ "$i" = 30 ] && { echo "FAIL: 中台 30s 未就绪 code=$CODE"; cat /tmp/api.log; exit 1; }
  sleep 1
done

echo "── 0b. 种入 tenant-A 的 admin 用户 + tenant-A 的客服（service_agents.tenant_id=A, wechat_id=wxid_csa）──"
# 由 migrate/seed 或下方直接 INSERT 准备：tenants A/B、user admin-A、tenant_members(admin-A, A, admin)、
# service_agents(tenant_id=A, wechat_id=wxid_csa) —— 具体 seed SQL 由 generator 按真实表结构补全。
psql "$DB" -f sprints/06232248-line04-cs-config-permission/seed-e2e.sql

PERSONA='{"self_name":"小齐","address_style":"x","tone":"x","sentence_style":"x","use_emoji":"x","banned_phrases":[],"few_shot":[]}'
BODY=$(jq -n --argjson p "$PERSONA" '{persona:$p, business_hours_start:"09:00", business_hours_end:"21:00", daily_limit:50, whitelist:["客户甲"]}')

echo "── 1. 管理员正常路径：tenant-A admin 改 tenant-A 客服 → 200 + DB 写入（时间窗防伪）──"
curl -sf -X PUT "$API/api/wechat/cs/config/wxid_csa" -H 'Content-Type: application/json' \
  -H 'X-Feishu-User-Id: user-admin-A' -d "$BODY" | jq -e '.success == true'
C=$(psql "$DB" -t -c "SELECT count(*) FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='wxid_csa' AND business_hours_start='09:00' AND daily_limit=50 AND updated_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$C" = "1" ] || { echo "FAIL: 管理员写入未生效/无时间窗内记录 cnt=$C"; exit 1; }

echo "── 2. 越权核心：member 改 → 403 NOT_ADMIN 且 DB 未变（钉死 96db53be）──"
BEFORE=$(psql "$DB" -t -c "SELECT updated_at FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='wxid_csa'" | tr -d ' ')
CODE=$(curl -s -o /tmp/m.json -w '%{http_code}' -X PUT "$API/api/wechat/cs/config/wxid_csa" -H 'Content-Type: application/json' -H 'X-Feishu-User-Id: user-member-A' -d "$BODY")
[ "$CODE" = "403" ] || { echo "FAIL: member 未被拒 code=$CODE"; exit 1; }
jq -e '.error.code == "NOT_ADMIN"' /tmp/m.json
AFTER=$(psql "$DB" -t -c "SELECT updated_at FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='wxid_csa'" | tr -d ' ')
[ "$BEFORE" = "$AFTER" ] || { echo "FAIL: member 越权后 DB 被改 before=$BEFORE after=$AFTER"; exit 1; }

echo "── 3. 租户隔离：tenant-A admin 改 tenant-B 客服 wxid_csb → 403/404 且 DB 未变 ──"
CODE=$(curl -s -o /tmp/x.json -w '%{http_code}' -X PUT "$API/api/wechat/cs/config/wxid_csb" -H 'Content-Type: application/json' -H 'X-Feishu-User-Id: user-admin-A' -d "$BODY")
case "$CODE" in 403|404) : ;; *) echo "FAIL: 跨租户未被拒 code=$CODE"; exit 1;; esac
XC=$(psql "$DB" -t -c "SELECT count(*) FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='wxid_csb' AND updated_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$XC" = "0" ] || { echo "FAIL: 跨租户越权写入了 B 的行 cnt=$XC"; exit 1; }

echo "── 4. 无 session → 401 ──"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$API/api/wechat/cs/config/wxid_csa" -H 'Content-Type: application/json' -d "$BODY")
[ "$CODE" = "401" ] || { echo "FAIL: 无 session 未 401 code=$CODE"; exit 1; }

echo "── 5. deny by default：目标客服解析不到租户 → 404 TARGET_NOT_FOUND 且不写库 ──"
CODE=$(curl -s -o /tmp/d.json -w '%{http_code}' -X PUT "$API/api/wechat/cs/config/wxid_never_zzz" -H 'Content-Type: application/json' -H 'X-Feishu-User-Id: user-admin-A' -d "$BODY")
[ "$CODE" = "404" ] || { echo "FAIL: 解析不出目标未 404 code=$CODE"; exit 1; }
jq -e '.error.code == "TARGET_NOT_FOUND"' /tmp/d.json
# gate-allow: domain/db-no-time-window wxid_never_zzz 是从不存在的目标，deny-by-default 断言要求全时段 count==0（任何时间都不许有该行）；加 5 分钟时间窗反而会漏过历史泄漏行，全时段计数才是更强且正确的 oracle
DC=$(psql "$DB" -t -c "SELECT count(*) FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='wxid_never_zzz'" | tr -d ' ')
[ "$DC" = "0" ] || { echo "FAIL: deny-by-default 仍写了库 cnt=$DC"; exit 1; }

# gate-allow: cheat/or-true 这是 teardown — 清理后台 API 进程，非断言；进程已退时 kill 失败必须忽略（不影响越权/隔离/deny 等真实验收结论）
kill "$(cat /tmp/api.pid)" 2>/dev/null || true
echo "✅ job1 后端全过：管理员写入(时间窗) + member 403 不写库 + 跨租户 403 不写库 + 无 session 401 + deny-by-default 404 不写库"
```

### job2 — sprints/06232248-line04-cs-config-permission/e2e-ui-verify.ps1（windows-latest）

```powershell
# Line04 客服配置安全闸 — 前端 E2E（windows-latest，无 postgres，page.route 拦后端）
# 验：管理员看到营业时间+每日上限输入并保存读回；非管理员只读/禁用 + 「仅管理员可配置」。
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$VitePort = 5174
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path "$scriptDir\..\.."

& cmd.exe /c "npm.cmd ci --prefer-offline" ; if ($LASTEXITCODE -ne 0) { throw "FAIL: npm ci" }
& cmd.exe /c "npx.cmd playwright install chromium" | Out-Null
Push-Location "$repoRoot\apps\dashboard"
& cmd.exe /c "npm.cmd run build" ; if ($LASTEXITCODE -ne 0) { throw "FAIL: dashboard build" }
Pop-Location

$vite = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" -WorkingDirectory "$repoRoot\apps\dashboard" -PassThru -NoNewWindow
$vok = $false
for ($i = 0; $i -lt 30; $i++) { Start-Sleep 1; if ((Test-NetConnection localhost -Port $VitePort -WarningAction SilentlyContinue).TcpTestSucceeded) { $vok = $true; break } }
if (-not $vok) { throw "FAIL: Vite 30s 未就绪" }

$env:BASE_URL = "http://localhost:$VitePort"
$e2e = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright test e2e/cs-config-permission.spec.ts --reporter=list" -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow
Stop-Process -Id $vite.Id -Force -ErrorAction SilentlyContinue
if ($e2e.ExitCode -ne 0) { throw "FAIL: Playwright 客服配置权限 UI exit=$($e2e.ExitCode)" }
Write-Host "✅ job2 前端管理员可编辑/非管理员只读 + 营业时间+每日上限输入 UI 验证通过"
exit 0
```

### Playwright spec — apps/dashboard/e2e/cs-config-permission.spec.ts（截图存 SPRINT_DIR/screenshots/）

```javascript
import { test, expect } from '@playwright/test'
const BASE_URL = process.env.BASE_URL || 'http://localhost:5174'
const SHOT = '../../sprints/06232248-line04-cs-config-permission/screenshots'

// 注入 my-role 响应（admin / member 两态），auth 走未登录免跳转（requireAuth:false 路由）
function stub(page, role) {
  page.route('**/api/auth/**', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }))
  page.route('**/api/wechat/cs/my-role', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ role, can_config: role === 'admin' || role === 'owner' }) }))
}

test('管理员：营业时间+每日上限输入可见可编辑，填写保存读回', async ({ page }) => {
  stub(page, 'admin')
  let putBody = {}
  await page.route('**/api/wechat/cs/config/**', async route => {
    putBody = route.request().method() === 'PUT' ? JSON.parse(route.request().postData() || '{}') : putBody
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, config: { wechat_id: 'wxid_csa', persona: { self_name: '小齐' }, business_hours_start: '09:00', daily_limit: 50 } }) })
  })
  await page.goto(`${BASE_URL}/wechat/per-cs-config`)
  await expect(page.getByTestId('cs-business-hours-start')).toBeVisible()
  await expect(page.getByTestId('cs-business-hours-end')).toBeVisible()
  await expect(page.getByTestId('cs-daily-limit')).toBeEnabled()
  await page.screenshot({ path: `${SHOT}/01-admin-initial.png`, fullPage: true })
  await page.getByTestId('cs-wechat-id-input').fill('wxid_csa')
  await page.getByTestId('cs-business-hours-start').fill('09:00')
  await page.getByTestId('cs-daily-limit').fill('50')
  await page.getByTestId('cs-save-btn').click()
  await page.screenshot({ path: `${SHOT}/02-admin-saved.png`, fullPage: true })
  await expect(page.getByTestId('cs-save-success')).toBeVisible()
  expect(putBody.business_hours_start).toBe('09:00')
  expect(putBody.daily_limit).toBe(50)
})

test('非管理员（member）：配置项只读/禁用 + 显示「仅管理员可配置」', async ({ page }) => {
  stub(page, 'member')
  await page.goto(`${BASE_URL}/wechat/per-cs-config`)
  await expect(page.getByTestId('cs-readonly-notice')).toContainText('仅管理员可配置')
  await expect(page.getByTestId('cs-save-btn')).toBeDisabled()
  await expect(page.getByTestId('cs-daily-limit')).toBeDisabled()
  await page.screenshot({ path: `${SHOT}/03-member-readonly.png`, fullPage: true })
})
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 写接口安全闸（整 Sprint）| `apps/api/tests/regression/line04-cs-config-permission.test.ts` | admin 放行 / member 403 / 跨租户 403 / 无身份 401 / deny-by-default 404+NO_TENANT / setup+auto-agent 覆盖 | 已实测 → 8 用例中 6 failed（缺闸放行）2 passed → 真红 |
| 前台只读/输入补全 | `apps/dashboard/e2e/cs-config-permission.spec.ts` | 管理员可编辑+保存读回 / 非管理员只读+提示 | 新 testid 不存在 → Playwright FAIL |
