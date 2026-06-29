# final-e2e 验证脚本 — Line02 公司信息 Tab + 推荐关键词（windows-latest + Playwright）
# 前提 secrets（由 e2e-windows.yml Run E2E verification step env: 段注入）:
#   E2E_DATABASE_URL — staging postgres 连接串（本 sprint 新增 secret，R1 mitigation）
#   E2E_SUPER_ADMIN_EMAIL, E2E_SUPER_ADMIN_PASSWORD
# 无直接 psql 调用 — DB 验证通过 API GET 读回值完成；psql 由 smoke job（ubuntu-latest）负责
param(
  [string]$BaseUrl = "http://localhost:5174"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptStart = Get-Date
$VitePort = 5174
$ApiPort = 3000
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptDir\..\.."

Write-Host "▶ Sprint: Line02 公司信息 Tab 布局 + 推荐关键词 ScriptStart=$ScriptStart"

# ── Step 1: 安装依赖 ──
Write-Host "▶ npm ci..."
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) { throw "FAIL: npm ci exit=$($proc.ExitCode)" }

# ── Step 2: 安装 Playwright Chromium ──
Write-Host "▶ playwright install chromium..."
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) { throw "FAIL: playwright install exit=$($proc.ExitCode)" }

# ── Step 3: 构建 API ──
Write-Host "▶ build API..."
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd run build --workspace=apps/api" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) { throw "FAIL: API build exit=$($proc.ExitCode)" }

# ── Step 4: 注入 DATABASE_URL（E2E_DATABASE_URL 由 e2e-windows.yml env 注入）──
# 如果此处报错，说明 e2e-windows.yml 的 Run E2E verification step 未加 E2E_DATABASE_URL
$dbUrl = $env:E2E_DATABASE_URL
if (-not $dbUrl) {
  throw "FAIL: E2E_DATABASE_URL 未设置。请在 e2e-windows.yml Run E2E verification step 的 env: 段加入 E2E_DATABASE_URL: `${{ secrets.E2E_DATABASE_URL }}"
}
$apiEnvPath = "$repoRoot\apps\api\.env"
@"
DATABASE_URL=$dbUrl
PORT=$ApiPort
NODE_ENV=test
"@ | Out-File -FilePath $apiEnvPath -Encoding utf8

# ── Step 5: 启动 API 服务（本地 Node.js，连 staging DB）──
Write-Host "▶ 启动 API on port $ApiPort..."
$apiProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c node -r dotenv/config dist/index.js" `
  -WorkingDirectory "$repoRoot\apps\api" `
  -PassThru -NoNewWindow `
  -Environment @{ DATABASE_URL = $dbUrl; PORT = "$ApiPort"; NODE_ENV = "test" }

$waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $ApiPort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt 30)
if (-not $conn.TcpTestSucceeded) { throw "FAIL: API 未在 30s 内就绪 port=$ApiPort" }
Write-Host "✅ API 就绪 port=$ApiPort"

# ── Step 6: 构建 Dashboard ──
Write-Host "▶ 构建 Dashboard..."
$buildEnv = @{ VITE_API_BASE_URL = "http://localhost:$ApiPort"; VITE_SKIP_AUTH = "true" }
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd run build" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow -Environment $buildEnv
if ($proc.ExitCode -ne 0) { throw "FAIL: Dashboard build exit=$($proc.ExitCode)" }

# ── Step 7: 启动 Vite preview（Test-NetConnection 兼容 IPv6/IPv4）──
Write-Host "▶ 启动 Vite preview port $VitePort..."
$serverProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -PassThru -NoNewWindow

$waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt 30)
if (-not $conn.TcpTestSucceeded) { throw "FAIL: Vite 未在 30s 内就绪 port=$VitePort" }
Write-Host "✅ Vite preview 就绪 port=$VitePort"

# ── Step 8: 运行 Playwright E2E ──
Write-Host "▶ 运行 Playwright E2E..."
$e2eProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright test e2e\line02-company-profile-collect.spec.ts --reporter=list" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow `
  -Environment @{ E2E_BASE_URL = "http://localhost:$VitePort" }
$e2eExit = $e2eProc.ExitCode

# ── Step 9: 归集截图 ──
$screenshotDir = "$scriptDir\screenshots"
if (-not (Test-Path $screenshotDir)) { New-Item -ItemType Directory -Path $screenshotDir | Out-Null }
$srcShots = "$repoRoot\apps\dashboard\test-results"
if (Test-Path $srcShots) {
  Get-ChildItem "$srcShots\*.png" -Recurse | Copy-Item -Destination $screenshotDir
}

# ── 停止服务 ──
Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue

if ($e2eExit -ne 0) { throw "FAIL: Playwright E2E 失败 exit=$e2eExit" }
Write-Host "✅ Line02 Profile Tabs E2E 验证通过"
exit 0
