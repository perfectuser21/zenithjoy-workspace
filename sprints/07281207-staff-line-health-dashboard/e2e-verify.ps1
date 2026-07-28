# final-e2e 验证脚本 — Staff Hub 业务线健康看板（GP3 / line_health）（windows-latest + Playwright）
# 变体C：真实后端，禁 page.route()
# 前提：apps/api 无需外部 DB secret（本 sprint 三个新端点只读聚合 product-map.json + Brain + GitHub，
#       不查自身 Postgres），STAFF_EMAILS 白名单直接在脚本内注入，无需额外 secrets。
# CECELIA_BRAIN_URL 在 windows-latest 沙盒默认不可达（内网服务），line04 能力/总览卡片会自然走
# degraded 分支，符合 contract-draft.md「未覆盖真实链路清单」第2条登记的已知限制。

param(
  [string]$BaseUrl = "http://localhost:5175"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptStart = Get-Date
$VitePort = 5175
$ApiPort = 3000
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptDir\..\.."

Write-Host "▶ Sprint: Staff Hub 业务线健康看板 ScriptStart=$ScriptStart"

# ── Step 1: 安装依赖 ──
Write-Host "▶ npm ci..."
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) { throw "FAIL: npm ci exit=$($proc.ExitCode)" }

# ── Step 2: 安装 Playwright Chromium ──
Write-Host "▶ playwright install chromium..."
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory "$repoRoot\apps\staff-hub" -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) { throw "FAIL: playwright install exit=$($proc.ExitCode)" }

# ── Step 3: 构建 apps/api ──
Write-Host "▶ 构建 apps/api..."
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd run build --workspace=apps/api" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) { throw "FAIL: apps/api build exit=$($proc.ExitCode)" }

# ── Step 4: 启动 apps/api（真实后端，staffGuard 白名单含 staff@test.com）──
Write-Host "▶ 启动 apps/api on port $ApiPort..."
$apiProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c node dist/index.js" `
  -WorkingDirectory "$repoRoot\apps\api" `
  -PassThru -NoNewWindow `
  -Environment @{
    PORT           = "$ApiPort"
    NODE_ENV       = "test"
    STAFF_EMAILS   = "staff@test.com"
  }

$waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $ApiPort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt 30)
if (-not $conn.TcpTestSucceeded) { throw "FAIL: apps/api 未在 30s 内就绪 port=$ApiPort" }
Write-Host "✅ apps/api 就绪 port=$ApiPort"

# ── Step 5: 构建 + 启动 Staff Hub Vite preview（VITE_SKIP_AUTH=true 绕过登录）──
Write-Host "▶ 构建 Staff Hub..."
$buildEnv = @{ VITE_SKIP_AUTH = "true"; VITE_MOCK_USER_EMAIL = "staff@test.com" }
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd run build" `
  -WorkingDirectory "$repoRoot\apps\staff-hub" `
  -Wait -PassThru -NoNewWindow -Environment $buildEnv
if ($proc.ExitCode -ne 0) { throw "FAIL: Staff Hub build exit=$($proc.ExitCode)" }

Write-Host "▶ 启动 Vite preview port $VitePort..."
# STAFF_HUB_API_TARGET：vite preview 的 /api 反代目标（vite.config.ts preview.proxy 读取），
# 指向本脚本上面起的 apps/api，否则前端 fetch('/api/...') 会打到 preview 服务器自身 404。
$serverProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" `
  -WorkingDirectory "$repoRoot\apps\staff-hub" `
  -PassThru -NoNewWindow `
  -Environment @{ STAFF_HUB_API_TARGET = "http://localhost:$ApiPort" }

$waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt 30)
if (-not $conn.TcpTestSucceeded) { throw "FAIL: Vite 未在 30s 内就绪 port=$VitePort" }
Write-Host "✅ Vite 就绪 port=$VitePort"

# ── Step 6: Playwright E2E（打真实后端，spec 禁 page.route()）──
Write-Host "▶ 运行 Playwright E2E..."
$e2eProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright test e2e\line-health.spec.ts --reporter=list" `
  -WorkingDirectory "$repoRoot\apps\staff-hub" `
  -Wait -PassThru -NoNewWindow `
  -Environment @{
    E2E_BASE_URL = "http://localhost:$VitePort"
    E2E_API_URL  = "http://localhost:$ApiPort"
  }
$e2eExit = $e2eProc.ExitCode

# ── Step 7: 归集截图 ──
$screenshotDir = "$scriptDir\screenshots"
if (-not (Test-Path $screenshotDir)) { New-Item -ItemType Directory -Path $screenshotDir | Out-Null }
$srcShots = "$repoRoot\apps\staff-hub\test-results"
if (Test-Path $srcShots) {
  Get-ChildItem "$srcShots\*.png" -Recurse | Copy-Item -Destination $screenshotDir -ErrorAction SilentlyContinue
}
Get-ChildItem "$repoRoot\apps\staff-hub\screenshots\*.png" -ErrorAction SilentlyContinue | Copy-Item -Destination $screenshotDir -ErrorAction SilentlyContinue

# ── Step 8: 校验 spec 未使用 page.route()（变体C 死规则1，双重保险）──
$specContent = Get-Content "$repoRoot\apps\staff-hub\e2e\line-health.spec.ts" -Raw
if ($specContent -match "page\.route\(") {
  Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: line-health.spec.ts 含 page.route()，违反变体C 死规则（禁止 stub 真实后端）"
}

# ── 清理进程 ──
Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue

if ($e2eExit -ne 0) { throw "FAIL: Playwright E2E 失败 exit=$e2eExit" }
Write-Host "✅ Staff Hub 业务线健康看板 E2E 验证通过（真实后端，无 stub）"
exit 0
