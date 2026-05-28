# Sprint Contract Draft (Round 2)

## Golden Path
入口 → Dashboard 运营中枢页 → 一键登录触发 → Agent 扫码 → Cookie 写入 Secret + DB → 状态矩阵绿色 → GHA 巡检真实验证 → 过期飞书告警 → 出口

---

### Step 1: Dashboard /operator 页加载 8 平台主号状态矩阵
**来源**: `[FROM_PRD]` — PRD "入口：运营员打开 Dashboard 运营中枢页，看到 8 平台主号状态矩阵"

**可观测行为**: 用户访问 `http://localhost:5174/operator`，页面渲染含 8 行状态矩阵（抖音/快手/小红书/视频号/头条/微博/知乎/公众号），每行含「登录」按钮和 status badge（active/expired/missing），非 `xuxiao21xx@icloud.com` 账户 redirect 到首页

**验证命令**:
```bash
ZJ_API=${ZJ_API_URL:-http://localhost:5200}

# 验证 GET sessions 返回 8 条、status 枚举合规（dashboard 数据源）
RESP=$(curl -sf "$ZJ_API/api/operator/sessions") || { echo "FAIL: GET /api/operator/sessions 未返回 200"; exit 1; }
echo "$RESP" | jq -e 'type == "array"' || { echo "FAIL: 返回非 array"; exit 1; }
echo "$RESP" | jq -e 'length == 8' || { echo "FAIL: 期望 8 条，实际 $(echo "$RESP" | jq 'length')"; exit 1; }
echo "$RESP" | jq -e '.[0].status | IN("active","expired","missing")' || { echo "FAIL: status 非法值"; exit 1; }
echo "✅ Step 1 数据层验证通过"
```

**硬阈值**: 返回 8 条，每条 status ∈ {active, expired, missing}

---

### Step 2: 运营员点击「登录」→ POST trigger-bind → 202 + taskId
**来源**: `[FROM_PRD]` — PRD "首次绑定 Step 1：点「抖音主号→登录」→ Dashboard POST /api/operator/sessions/trigger-bind {platform:'douyin'} → 202 + taskId"

**可观测行为**: POST /api/operator/sessions/trigger-bind body={platform:"douyin"} → HTTP 202，response keys 完全等于 ["ok","platform","taskId"]，ok=true，taskId 为 string

**验证命令**:
```bash
ZJ_API=${ZJ_API_URL:-http://localhost:5200}

RESP=$(curl -sf -w '\n%{http_code}' -X POST "$ZJ_API/api/operator/sessions/trigger-bind" \
  -H "Content-Type: application/json" \
  -d '{"platform":"douyin"}')
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -1)

[ "$HTTP_CODE" = "202" ] || { echo "FAIL: 期望 202 got $HTTP_CODE"; exit 1; }
echo "$BODY" | jq -e '.ok == true' || { echo "FAIL: ok≠true"; exit 1; }
echo "$BODY" | jq -e '.taskId | type == "string"' || { echo "FAIL: taskId 非 string"; exit 1; }
echo "$BODY" | jq -e '.platform == "douyin"' || { echo "FAIL: platform 字段错误"; exit 1; }
echo "$BODY" | jq -e 'keys == ["ok","platform","taskId"]' || { echo "FAIL: keys 不完全等于 [ok,platform,taskId]"; exit 1; }
echo "✅ Step 2 trigger-bind schema 验证通过"
```

**硬阈值**: HTTP 202，keys 完全匹配，taskId 为 string

---

### Step 3: Agent 接收 qr_bind/douyin task → CDP 19222 → 导航 creator.douyin.com
**来源**: `[FROM_PRD]` — PRD "首次绑定 Step 2–3：中台推 task qr_bind/douyin 给 xian-pc Agent → Agent CDP 连本地 Chrome(19222) → 导航 creator.douyin.com → 等待扫码"

**可观测行为**: Agent dispatcher 已注册 `qr_bind/douyin`（及 8 个平台），handler 文件含 8 平台 creator URL 映射，存在 CDP 19222 连接逻辑

**验证命令**:
```bash
# 验证 handler 源码包含 8 平台 creator URL 映射
F="services/agent/src/handlers/qr-bind-operator.ts"
[ -f "$F" ] || { echo "FAIL: handler 文件不存在"; exit 1; }
for platform in douyin kuaishou xiaohongshu shipinhao toutiao weibo zhihu gongzhonghao; do
  grep -q "$platform" "$F" || { echo "FAIL: handler 缺平台 $platform"; exit 1; }
done

# 验证 dispatcher 已注册 qr_bind/douyin
grep -q "qr_bind" services/agent/src/index.ts || { echo "FAIL: dispatcher 未注册 qr_bind"; exit 1; }
grep -q "qr-bind-operator\|qrBindOperator\|handleQrBindOperator" services/agent/src/index.ts || { echo "FAIL: dispatcher 未导入 qr-bind-operator handler"; exit 1; }
echo "✅ Step 3 Agent handler 注册验证通过"
```

**硬阈值**: 8 平台均在 handler 映射内，dispatcher 已注册

---

### Step 4: Agent 检测扫码成功 → 抓 storageState → POST upload-cookies → Octokit 写 {PLATFORM_UPPER}_COOKIES Secret → DB status=active
**来源**: `[FROM_PRD]` — PRD "首次绑定 Step 5–6：Agent 抓 storageState → POST /api/operator/sessions/upload-cookies {platform, cookies} → 后端调 GitHub Octokit 写 DOUYIN_COOKIES Secret → DB 写 active"

**可观测行为**: POST /api/operator/sessions/upload-cookies → HTTP 200，secretName = "DOUYIN_COOKIES"（{PLATFORM_UPPER}_COOKIES 格式，禁止 *_MAIN），operator_sessions 表 status 变 active

**验证命令**:
```bash
ZJ_API=${ZJ_API_URL:-http://localhost:5200}
DB=${DB_URL:-postgresql://postgres:postgres@localhost/cecelia}

# 源码验证：secretName 格式化逻辑含 _COOKIES（而非 _MAIN）
grep -E "COOKIES|toUpperCase" apps/api/src/routes/operator-sessions.ts | \
  grep -v "_MAIN\|_SESSION\|_TOKEN" | grep -q "COOKIES" || \
  { echo "FAIL: upload-cookies 未使用 _COOKIES 格式"; exit 1; }

# upload-cookies API schema 验证（无真实 GitHub PAT，用 dry-run 验证到 DB 写入层）
RESP=$(curl -sf -w '\n%{http_code}' -X POST "$ZJ_API/api/operator/sessions/upload-cookies" \
  -H "Content-Type: application/json" \
  -d '{"platform":"douyin","cookies":{"sessionid":"test-sess-001"}}')
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -1)

# 期望：无真实 PAT 时 upload-cookies 返回 403（PAT scope insufficient）
[ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "403" ] || \
  { echo "FAIL: upload-cookies 期望 200 或 403，got $HTTP_CODE body=$BODY"; exit 1; }
if [ "$HTTP_CODE" = "403" ]; then
  echo "$BODY" | jq -e '.error | type == "string"' || { echo "FAIL: 403 缺 error 字段"; exit 1; }
fi
if [ "$HTTP_CODE" = "200" ]; then
  echo "$BODY" | jq -e '.secretName | endswith("_COOKIES")' || { echo "FAIL: secretName 未以 _COOKIES 结尾"; exit 1; }
  echo "$BODY" | jq -e '.secretName | test("_MAIN|_SESSION|_TOKEN") | not' || \
    { echo "FAIL: secretName 含禁用格式"; exit 1; }
  echo "$BODY" | jq -e 'keys == ["ok","platform","secretName"]' || { echo "FAIL: keys 不符"; exit 1; }
fi
echo "✅ Step 4 upload-cookies 验证通过"
```

**硬阈值**: secretName = `{PLATFORM_UPPER}_COOKIES`，200 or 403 with error 字段，DB upsert status=active

---

### Step 5: Dashboard 轮询 GET /api/operator/sessions → 抖音主号 status=active 展示 ✅
**来源**: `[FROM_PRD]` — PRD "首次绑定 Step 7：Dashboard 状态轮询 GET /api/operator/sessions → 展示 ✅ 绿色"

**可观测行为**: GET /api/operator/sessions 返回 array，每项 keys 完全等于 ["lastCheckedAt","lastValidAt","platform","secretName","status"]，固定 8 条，secretName 格式 {PLATFORM_UPPER}_COOKIES，status 仅含 active/expired/missing（禁止 ok/healthy/valid）

**验证命令**:
```bash
ZJ_API=${ZJ_API_URL:-http://localhost:5200}

RESP=$(curl -sf "$ZJ_API/api/operator/sessions") || { echo "FAIL: GET sessions 失败"; exit 1; }

# keys 完整性
echo "$RESP" | jq -e '.[0] | keys == ["lastCheckedAt","lastValidAt","platform","secretName","status"]' || \
  { echo "FAIL: 每项 keys 不完全等于期望集合"; exit 1; }

# 8 条固定返回
echo "$RESP" | jq -e 'length == 8' || { echo "FAIL: 不是 8 条"; exit 1; }

# status 禁用字段反向检查
echo "$RESP" | jq -e '[.[].status | IN("ok","healthy","valid","inactive","error")] | any | not' || \
  { echo "FAIL: status 含禁用值"; exit 1; }

# secretName 格式 {PLATFORM_UPPER}_COOKIES（非 _MAIN）
echo "$RESP" | jq -e '.[0].secretName | endswith("_COOKIES")' || \
  { echo "FAIL: secretName 不以 _COOKIES 结尾"; exit 1; }
echo "$RESP" | jq -e '[.[].secretName | test("_MAIN")] | any | not' || \
  { echo "FAIL: secretName 含 _MAIN 字样"; exit 1; }

echo "✅ Step 5 GET sessions 全量 schema 验证通过"
```

**硬阈值**: 8 条，keys 完全匹配，status 枚举合规，secretName 格式合规

---

### Step 6: GHA cron 读 *_COOKIES Secrets → 真实 HTTP 验证 → missing 状态不再当 ok（修复 bug）
**来源**: `[FROM_PRD]` — PRD "背景：GHA 的 check-health.js 把 missing 状态当 ok 处理（掉线无告警）；Secret 命名混用 *_MAIN 而非标准 {PLATFORM}_COOKIES"

**可观测行为**: `check-health.js` 对 missing 的 session 输出 status:"missing"（而非 ok），GHA workflow env 段使用 `DOUYIN_COOKIES`/`KUAISHOU_COOKIES` 等 8 个 *_COOKIES 变量（无 *_MAIN）

**验证命令**:
```bash
# check-health.js 修复验证：missing 不被当 ok
grep -n "missing" scripts/sessions/check-health.js | grep -qE 'missing.*ok|ok.*missing' && \
  { echo "FAIL: missing 仍被当 ok"; exit 1; } || true

# 验证 missing 输出的是 status:'missing'（或类似判断逻辑）
node -e "
const src = require('fs').readFileSync('scripts/sessions/check-health.js','utf8');
if (src.includes(\"missing\") && !src.includes(\"status === 'missing'\" ) && !src.includes('status:\"missing\"') && !src.includes(\"status: 'missing'\" )) {
  // 可能用了不同写法，继续 grep
}
const missingBug = src.match(/missing.*[=:=].*ok|ok.*[=:=].*missing/i);
if (missingBug) { console.error('FAIL: missing=ok bug 仍存在'); process.exit(1); }
console.log('OK: missing bug 已修复');
" || { echo "FAIL: check-health.js missing bug 检测失败"; exit 1; }

# GHA workflow 无 *_MAIN Secret 引用
grep -c "_MAIN:" .github/workflows/session-health-check.yml 2>/dev/null | \
  { read n; [ "$n" = "0" ] && echo "OK: 无 _MAIN 引用" || { echo "FAIL: workflow 仍含 _MAIN secret 引用 ($n 处)"; exit 1; }; }

# GHA workflow 含 DOUYIN_COOKIES 引用
grep -q "DOUYIN_COOKIES" .github/workflows/session-health-check.yml || \
  { echo "FAIL: workflow 缺 DOUYIN_COOKIES"; exit 1; }
echo "✅ Step 6 GHA 巡检修复验证通过"
```

**硬阈值**: missing≠ok，workflow 无 _MAIN，含 8 个 *_COOKIES

---

### Step 7: GHA expired 条目触发飞书 Bot webhook 告警（Promise.race 3s）
**来源**: `[FROM_PRD]` — PRD "GHA 日常巡检 Step 4：expired 条目 → 飞书 Bot webhook 推送告警"；"飞书 webhook 超时（>3s）→ Promise.race catch，log + continue，不阻塞 GHA 主流程"

**可观测行为**: check-health.js 包含飞书 webhook 调用逻辑，超时 3000ms（`Promise.race`），catch 后 log+continue，expired 状态才触发

**验证命令**:
```bash
# 验证飞书告警逻辑：Promise.race 3s timeout 存在
grep -q "Promise.race" scripts/sessions/check-health.js || \
  { echo "FAIL: check-health.js 缺 Promise.race 飞书超时保护"; exit 1; }
grep -qE "3000|3s|3 \* 1000" scripts/sessions/check-health.js || \
  { echo "FAIL: 缺 3s timeout 常量"; exit 1; }

# 验证 expired → webhook 触发（not all-always 触发）
node -e "
const src = require('fs').readFileSync('scripts/sessions/check-health.js','utf8');
const hasExpiredCheck = src.includes('expired') && (src.includes('FEISHU_BOT_WEBHOOK') || src.includes('feishu'));
if (!hasExpiredCheck) { console.error('FAIL: 飞书告警逻辑未关联 expired 判断'); process.exit(1); }
const hasPromiseRace = src.includes('Promise.race');
if (!hasPromiseRace) { console.error('FAIL: 缺 Promise.race'); process.exit(1); }
console.log('OK');
" || { echo "FAIL: 飞书告警逻辑验证失败"; exit 1; }
echo "✅ Step 7 飞书告警逻辑验证通过"
```

**硬阈值**: Promise.race + 3000ms timeout，expired 条件触发

---

### Step 8: GHA 巡检完成后 POST /api/operator/sessions/status 批量回写 DB
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入；理由：PRD "GHA 日常巡检 Step 3：POST /api/operator/sessions/status 批量回写 DB" 需要闭环，防止 generator 只实现单向 HTTP 检查而不回写 DB，导致 Dashboard 状态永远不更新

**可观测行为**: check-health.js 包含调用 `/api/operator/sessions/status` 的 fetch/http 请求逻辑，POST /api/operator/sessions/status 返回 `{"ok": true, "updated": <number>}`，keys 完全等于 ["ok","updated"]

**验证命令**:
```bash
ZJ_API=${ZJ_API_URL:-http://localhost:5200}

# 验证 check-health.js 包含回写 API 调用
grep -qE "sessions/status|operator/sessions/status" scripts/sessions/check-health.js || \
  { echo "FAIL: check-health.js 缺 /api/operator/sessions/status 回写调用"; exit 1; }

# POST status API schema 验证（internal-auth，dev 模式 ZENITHJOY_INTERNAL_TOKEN 未设置时 bypass）
RESP=$(curl -sf -X POST "$ZJ_API/api/operator/sessions/status" \
  -H "Content-Type: application/json" \
  -d '{"updates":[{"platform":"douyin","status":"active","checkedAt":"2026-05-27T10:00:00Z"}]}') || \
  { echo "FAIL: POST /api/operator/sessions/status 返回非 200"; exit 1; }
echo "$RESP" | jq -e '.ok == true' || { echo "FAIL: ok≠true"; exit 1; }
echo "$RESP" | jq -e '.updated | type == "number"' || { echo "FAIL: updated 非 number"; exit 1; }
echo "$RESP" | jq -e 'keys == ["ok","updated"]' || { echo "FAIL: keys 不完全等于 [ok,updated]"; exit 1; }
echo "✅ Step 8 status 回写 API 验证通过"
```

**硬阈值**: check-health.js 含回写调用，POST status 返回 {"ok":true,"updated":N}，keys 完全匹配

---

## E2E 验收（windows_cloud — GitHub Actions windows-latest）

**journey_type**: user_facing
**target_environment**: windows_cloud

> Dashboard + Playwright + Vite preview，ZenithJoy E2E 规则走 windows_cloud。

```powershell
# final-e2e 验证脚本 — 运营中枢 Session 状态矩阵（windows-latest）
param(
  [string]$BaseUrl = "http://localhost:5174",
  [string]$SuperAdminEmail = $env:E2E_SUPER_ADMIN_EMAIL,
  [string]$SuperAdminPassword = $env:E2E_SUPER_ADMIN_PASSWORD
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VitePort = 5174
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptDir\..\.."

Write-Host "▶ Installing dependencies..."
$installProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory $repoRoot `
  -Wait -PassThru -NoNewWindow
if ($installProc.ExitCode -ne 0) { throw "FAIL: npm ci failed" }

$playwrightProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory $repoRoot `
  -Wait -PassThru -NoNewWindow
if ($playwrightProc.ExitCode -ne 0) { throw "FAIL: playwright install failed" }

Write-Host "▶ Building dashboard..."
$buildProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd run build" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow
if ($buildProc.ExitCode -ne 0) { throw "FAIL: build failed" }

Write-Host "▶ Starting Vite preview on port $VitePort..."
$serverProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -PassThru -NoNewWindow

$maxWait = 30; $waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
if (-not $conn.TcpTestSucceeded) { throw "FAIL: Vite 未在 ${maxWait}s 内就绪" }

$e2eProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright test e2e\operator-sessions.spec.ts --reporter=list" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow `
  -Environment @{
    BASE_URL = $BaseUrl
    E2E_EMAIL = $SuperAdminEmail
    E2E_PASSWORD = $SuperAdminPassword
  }

Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
if ($e2eProc.ExitCode -ne 0) { throw "FAIL: Playwright E2E 失败 exit=$($e2eProc.ExitCode)" }
Write-Host "✅ 运营中枢 Session 矩阵 E2E 验证通过"
exit 0
```

**PASS 标准**: e2eProc.ExitCode = 0，所有 Playwright spec 通过
**FAIL 标准**: 任何 step exit≠0 或 Playwright 失败或 Vite 30s 未就绪
**GHA workflow**: `.github/workflows/e2e-windows.yml`（workflow_dispatch + windows-latest）
**secrets 必须**: `E2E_SUPER_ADMIN_EMAIL`、`E2E_SUPER_ADMIN_PASSWORD`

---

## Workstreams

workstream_count: 6

### Workstream 1: DB Migration — operator_sessions 表

**范围**: 新建 `db/migrations/20260527_operator_sessions.sql`，创建 `operator_sessions` 表（platform/secret_name/status/last_checked_at/last_valid_at/created_at/updated_at），含 status CHECK 约束（active/expired/missing）
**大小**: S（~55 行净增，1 文件）
**依赖**: 无（串行链起点）

---

### Workstream 2: API 4 端点 + app.ts 注册

**范围**: 新建 `apps/api/src/routes/operator-sessions.ts`（4 端点：trigger-bind/upload-cookies/GET sessions/POST status）；superAdminGuard 守卫 trigger-bind + upload-cookies；POST status 用 internal-auth；注册路由到 `apps/api/src/app.ts`
**大小**: M（~175 行净增，2 文件）
**依赖**: Workstream 1 完成后

---

### Workstream 3: Dashboard OperatorPage 重构（thin → medium）

**范围**: 重写 `apps/dashboard/src/pages/OperatorPage.tsx`：8 平台主号（非 4×4 矩阵，改为 8 行 × 主号列表）；status 枚举从 `ok` 改为 `active`；每行含「登录」按钮触发 POST trigger-bind；GET sessions 轮询 30s；lastCheckedAt/lastValidAt 显示
**大小**: M（~190 行净变化，1 文件）
**依赖**: Workstream 2 完成后

---

### Workstream 4: Dashboard E2E Playwright spec

**范围**: 新建 `apps/dashboard/e2e/operator-sessions.spec.ts`：8 平台行存在 + status badge + 登录按钮；API 全部 stub（page.route）；非运营员 redirect 验证
**大小**: S（~130 行净增，1 文件）
**依赖**: Workstream 3 完成后

---

### Workstream 5: Agent qr-bind-operator handler

**范围**: 新建 `services/agent/src/handlers/qr-bind-operator.ts`（8 平台统一 handler，CDP 19222，5min 超时，storageState → upload-cookies POST）；注册 qr_bind/{platform} × 8 到 `services/agent/src/index.ts` dispatcher
**大小**: M（~165 行净增，2 文件）
**依赖**: Workstream 4 完成后

---

### Workstream 6: GHA workflow + check-health.js 修复 + smoke.sh

**范围**: 修正 `.github/workflows/session-health-check.yml`（*_MAIN → *_COOKIES，8 平台主号）；修正 `scripts/sessions/check-health.js`（missing≠ok bug，expired → 飞书告警 Promise.race 3s，POST status 回写）；新建 `.github/workflows/scripts/smoke/session-health-medium-smoke.sh`
**大小**: M（~180 行净变化，3 文件）
**依赖**: Workstream 5 完成后

---

## Workstreams 切分自查

| WS | 预期净增 LoC | 文件数 | ≤200 行? | ≤3 文件? |
|---|---|---|---|---|
| WS1 | ~55 | 1 | ✅ | ✅ |
| WS2 | ~175 | 2 | ✅ | ✅ |
| WS3 | ~190 | 1 | ✅ | ✅ |
| WS4 | ~130 | 1 | ✅ | ✅ |
| WS5 | ~165 | 2 | ✅ | ✅ |
| WS6 | ~180 | 3 | ✅ | ✅ |

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/operator-sessions-migration.test.ts` | DB 表结构 / status CHECK 约束 / 字段完整性 | WS1 前 psql 查不到表 → FAIL |
| WS2 | `tests/ws2/operator-sessions-api.test.ts` | 4 端点 schema / keys 完整性 / 禁用字段反向 / error path | WS2 前 404 → FAIL |
| WS3 | `tests/ws3/operator-page.test.tsx` | 8 平台行渲染 / 登录按钮 / active badge / 30s 轮询 | WS3 前渲染缺 active 枚举 → FAIL |
| WS4 | `tests/ws4/operator-e2e.test.ts` | Playwright spec 结构 / page.route stub / 8 平台断言 | WS4 前 spec 不存在 → FAIL |
| WS5 | `tests/ws5/qr-bind-operator.test.ts` | 8 平台 URL 映射 / 5min timeout / upload-cookies POST | WS5 前 handler 不存在 → FAIL |
| WS6 | `tests/ws6/session-health-check.test.ts` | missing≠ok / 飞书告警 Promise.race / status 回写 / _COOKIES 命名 | WS6 前 missing bug 仍存在 → FAIL |

---

## Risks

| ID | 风险描述 | 概率 | 影响 | Mitigation |
|---|---|---|---|---|
| R1 | `GH_SECRETS_WRITE_PAT` scope 不足 → `upload-cookies` 返 HTTP 403，Agent 上传 cookie 失败，绑定流程中断 | 中 | 高 | **前置验证**：`upload-cookies` 端点在调用 Octokit 前先用 `GET /repos/{owner}/{repo}` 验证 PAT 是否有 `secrets` write scope；scope 不足立即返 403 `{"error":"PAT scope insufficient"}`，运营员可在 GitHub Settings 手动补 scope 后重试 |
| R2 | Octokit 写 Secret 成功，但 DB `upsert operator_sessions` 失败（cascade failure）→ GitHub Secret 更新但 Dashboard 状态仍显示 missing/expired，双写不一致 | 低 | 高 | **事务包裹**：`upload-cookies` 处理器内先调 Octokit 写 Secret，成功后在同一 async 块执行 DB upsert；DB 写失败则返 HTTP 500 `{"error":"DB write failed"}`（不掩盖错误），运营员重试触发幂等 upsert，Octokit 同 secret 覆盖写无副作用 |
| R3 | xian-pc Agent 扫码超时 >5min（用户未及时扫码或网络阻断）→ task 标 failed，Dashboard 状态卡住不变，运营员无感知 | 中 | 中 | **超时硬限制**：`qr-bind-operator.ts` 设 `300000ms`（5min）超时，超时后 handler 返回 `{ok:false, reason:"timeout"}`；中台将 task 标 failed；Dashboard 轮询检测到 taskId 无 202 后续时保持原 status 不变（不清除已有 active）；日志写 `[QR_BIND_TIMEOUT]`，运营员点「重新登录」可重试 |
| R4 | 飞书 Bot webhook 超时 >3s（飞书服务波动）→ 告警未送达，运营员不知 cookie 已过期 | 中 | 中 | **Promise.race 3s**：`check-health.js` 内飞书发送用 `Promise.race([fetch(webhookUrl,...), new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),3000))])`，catch 后 `console.error('[FEISHU_ALERT_FAIL]', err)` + continue，不阻塞 GHA 主流程；Dashboard 始终可见 expired badge（独立于飞书告警），运营员进入 /operator 页可直接发现 |
| R5 | DB migration（ws1）未在 CI 里执行，ws2 API 启动时 `operator_sessions` 表不存在 → GET sessions 报 500，整条链路崩溃 | 低 | 高 | **ws1 是所有 ws 的串行先决**：`task-plan.json` `depends_on` 已强制 ws2→ws1；`db/migrations/` 在 API 启动脚本 `npm run dev` 前自动跑 `psql -f migrations/*.sql`（现有 CI 惯例）；ws1 DoD BEHAVIOR 含 psql 验证表存在，ws1 未通过则 ws2 不派发 |
