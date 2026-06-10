# final-e2e 验证脚本 — ZenithJoy Dashboard Playwright（windows-latest）
# Sprint: Line 07 AI爆款视频翻拍 9节点可视化流水线（thin）
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

# 1. 安装依赖
Write-Host "▶ Installing dependencies..."
$installProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory $repoRoot `
  -Wait -PassThru -NoNewWindow
if ($installProc.ExitCode -ne 0) { throw "FAIL: npm ci failed exitCode=$($installProc.ExitCode)" }
Write-Host "✅ 依赖安装完成"

# 2. 安装 Playwright 浏览器
Write-Host "▶ Installing Playwright Chromium..."
$playwrightProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory $repoRoot `
  -Wait -PassThru -NoNewWindow
if ($playwrightProc.ExitCode -ne 0) { throw "FAIL: playwright install failed exitCode=$($playwrightProc.ExitCode)" }
Write-Host "✅ Playwright 安装完成"

# 3. Build Dashboard
Write-Host "▶ Building dashboard..."
$buildProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd run build" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow
if ($buildProc.ExitCode -ne 0) { throw "FAIL: dashboard build failed exitCode=$($buildProc.ExitCode)" }
Write-Host "✅ Dashboard 构建完成"

# 4. 启动 Vite preview（--port $VitePort 固定端口，避免随机端口）
Write-Host "▶ Starting Vite preview on port $VitePort..."
$serverProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -PassThru -NoNewWindow

# 5. 等待 Vite 就绪（Test-NetConnection 兼容 IPv4/IPv6，避免 curl localhost 解析失败）
$maxWait = 30
$waited = 0
do {
  Start-Sleep -Seconds 1
  $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)

if (-not $conn.TcpTestSucceeded) {
  Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: Vite 未在 ${maxWait}s 内就绪 port=$VitePort"
}
Write-Host "✅ Vite 就绪 port=$VitePort（等待 ${waited}s）"

# 6. 跑 Playwright E2E（apps/dashboard/e2e/video-remake.spec.ts）
Write-Host "▶ Running Playwright E2E: video-remake.spec.ts..."
$e2eEnv = @{
  BASE_URL    = $BaseUrl
  CI          = "true"
  E2E_EMAIL   = $SuperAdminEmail
  E2E_PASSWORD = $SuperAdminPassword
}

$e2eProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright test e2e\video-remake.spec.ts --reporter=list" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow `
  -Environment $e2eEnv

Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue

if ($e2eProc.ExitCode -ne 0) {
  throw "FAIL: Playwright E2E 失败 exitCode=$($e2eProc.ExitCode)"
}

Write-Host "✅ video-remake 9节点流水线 E2E 验证通过"
exit 0
