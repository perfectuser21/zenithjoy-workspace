# final-e2e — Line02 公司信息页 + 采集任务 Table（windows-latest Dashboard Playwright）
# target_environment: windows_cloud (GHA windows-latest)
#
# PASS 标准: Playwright spec exit 0 + 所有 expect() 通过
# FAIL 标准: exit ≠ 0 OR Playwright 失败 OR Vite 30s 内未就绪
#
# 所有 API 调用通过 page.route stub — 不依赖真后端/staging DB
param(
  [string]$BaseUrl = "http://localhost:5174"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VitePort = 5174
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
# sprints/06282255-.../e2e-verify.ps1 → 上两层 = repo 根
$repoRoot = Resolve-Path (Join-Path $scriptDir ".." "..")

Write-Host "▶ [Line02 E2E] repo root: $repoRoot"

# 1. 安装依赖（显式 WorkingDirectory + cmd shim 避免 Windows 路径问题）
Write-Host "▶ npm ci..."
$p = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory $repoRoot `
  -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: npm ci exit=$($p.ExitCode)" }

# 2. Windows rollup native binding（package-lock 由 macOS 生成，缺 win32 binding）
Write-Host "▶ npm install @rollup/rollup-win32-x64-msvc..."
$p = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd install @rollup/rollup-win32-x64-msvc --no-save" `
  -WorkingDirectory $repoRoot `
  -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: rollup win32 binding exit=$($p.ExitCode)" }

# 3. Playwright Chromium 安装
Write-Host "▶ Playwright install chromium..."
$p = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory $repoRoot `
  -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: playwright install exit=$($p.ExitCode)" }

# 4. Dashboard build
Write-Host "▶ npm run build (apps/dashboard)..."
$p = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd run build" `
  -WorkingDirectory (Join-Path $repoRoot "apps" "dashboard") `
  -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: dashboard build exit=$($p.ExitCode)" }

# 5. Vite preview（固定端口 5174，与 baseURL 一致）
Write-Host "▶ Starting Vite preview port=$VitePort..."
$server = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" `
  -WorkingDirectory (Join-Path $repoRoot "apps" "dashboard") `
  -PassThru -NoNewWindow

# 6. 等待就绪（Test-NetConnection 兼容 IPv4/IPv6）
$maxWait = 30; $waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
if (-not $conn.TcpTestSucceeded) {
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: Vite 未在 ${maxWait}s 内就绪 port=$VitePort"
}
Write-Host "✅ Vite 就绪 port=$VitePort after ${waited}s"

# 7. Playwright E2E
Write-Host "▶ Running Playwright spec: line02-company-profile-collect.spec.ts..."
$e2e = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright test e2e\line02-company-profile-collect.spec.ts --reporter=list" `
  -WorkingDirectory (Join-Path $repoRoot "apps" "dashboard") `
  -Wait -PassThru -NoNewWindow `
  -Environment @{ E2E_BASE_URL = $BaseUrl }

Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue

if ($e2e.ExitCode -ne 0) {
  throw "FAIL: Playwright E2E 失败 exit=$($e2e.ExitCode)"
}

# 8. 归集截图进 sprint（evaluator 视觉自验）
Write-Host "▶ 归集截图..."
$screenshotSrc = Join-Path $repoRoot "apps" "dashboard" "e2e" "screenshots"
$screenshotDst = Join-Path $scriptDir "screenshots"
New-Item -ItemType Directory -Force -Path $screenshotDst | Out-Null
if (Test-Path $screenshotSrc) {
  Copy-Item (Join-Path $screenshotSrc "*.png") $screenshotDst -ErrorAction SilentlyContinue
}

Write-Host "✅ windows_cloud Line02 E2E 验证通过"
exit 0
