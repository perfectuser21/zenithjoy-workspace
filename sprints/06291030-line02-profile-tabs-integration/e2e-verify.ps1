# final-e2e 验证脚本 — Line02 公司信息 Tab 布局 + 推荐关键词（windows-latest + Playwright）
# secrets: E2E_DATABASE_URL, E2E_SUPER_ADMIN_EMAIL, E2E_SUPER_ADMIN_PASSWORD
# 执行: 由 e2e-windows.yml 在 GHA windows-latest runner 上调用
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

Write-Host "▶ Sprint: Line02 公司信息 Tab 布局 + 推荐关键词 (ScriptStart=$ScriptStart)"

# ── Step 1: 安装依赖 ──
Write-Host "▶ [1/9] npm ci..."
$proc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) { throw "FAIL: npm ci exit=$($proc.ExitCode)" }

# ── Step 2: 安装 Playwright Chromium ──
Write-Host "▶ [2/9] playwright install chromium..."
$proc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) { throw "FAIL: playwright install exit=$($proc.ExitCode)" }

# ── Step 3: 构建 API ──
Write-Host "▶ [3/9] build API..."
$proc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd run build --workspace=apps/api" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) { throw "FAIL: API build exit=$($proc.ExitCode)" }

# ── Step 4: 注入 API .env ──
$dbUrl = $env:E2E_DATABASE_URL
if (-not $dbUrl) { throw "FAIL: E2E_DATABASE_URL secret 未配置" }
$apiEnvPath = "$repoRoot\apps\api\.env"
@"
DATABASE_URL=$dbUrl
PORT=$ApiPort
NODE_ENV=test
"@ | Out-File -FilePath $apiEnvPath -Encoding utf8
Write-Host "▶ [4/9] API .env 注入完成 (port=$ApiPort)"

# ── Step 5: 启动 API 服务 ──
Write-Host "▶ [5/9] 启动 API port=$ApiPort..."
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
if (-not $conn.TcpTestSucceeded) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: API 未在 30s 内就绪 port=$ApiPort"
}
Write-Host "✅ API 就绪 port=$ApiPort"

# ── Step 6: 构建 Dashboard ──
Write-Host "▶ [6/9] build Dashboard (VITE_API_BASE_URL=http://localhost:$ApiPort VITE_SKIP_AUTH=true)..."
$proc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd run build" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow `
  -Environment @{
    VITE_API_BASE_URL = "http://localhost:$ApiPort"
    VITE_SKIP_AUTH = "true"
  }
if ($proc.ExitCode -ne 0) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: Dashboard build exit=$($proc.ExitCode)"
}

# ── Step 7: 启动 Vite preview ──
Write-Host "▶ [7/9] Vite preview port=$VitePort..."
$serverProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -PassThru -NoNewWindow

$waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt 30)
if (-not $conn.TcpTestSucceeded) {
  Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: Vite preview 未在 30s 内就绪 port=$VitePort"
}
Write-Host "✅ Vite preview 就绪 port=$VitePort"

# ── Step 8: 运行 Playwright E2E ──
Write-Host "▶ [8/9] Playwright E2E..."
$e2eProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright test e2e\line02-company-profile-collect.spec.ts --reporter=list" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow `
  -Environment @{
    E2E_BASE_URL = "http://localhost:$VitePort"
    E2E_API_URL  = "http://localhost:$ApiPort"
  }
$e2eExit = $e2eProc.ExitCode

# ── Step 9: 归集截图 ──
Write-Host "▶ [9/9] 归集截图..."
$screenshotDir = "$scriptDir\screenshots"
if (-not (Test-Path $screenshotDir)) { New-Item -ItemType Directory -Path $screenshotDir | Out-Null }
$srcShots = "$repoRoot\apps\dashboard\test-results"
if (Test-Path $srcShots) {
  Get-ChildItem -Recurse "$srcShots\*.png" | Copy-Item -Destination $screenshotDir -Force
}

# ── 停止服务 ──
Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue

if ($e2eExit -ne 0) { throw "FAIL: Playwright E2E 失败 exit=$e2eExit" }
Write-Host "✅ Line02 公司信息 Tab E2E 验证通过"
exit 0
