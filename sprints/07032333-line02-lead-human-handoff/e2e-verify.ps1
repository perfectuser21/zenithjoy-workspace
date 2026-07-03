# final-e2e 验证脚本 — Line02 LeadsTable 统一组件（windows-latest）
# Sprint: 07032333-line02-lead-human-handoff
# ⚠️ 必须打真实后端（apps/api），禁止 page.route() stub
# 合同要求: contract-draft.md ## E2E 验收（windows_cloud 变体C）
param(
  [string]$BaseUrl = "http://localhost:5174",
  [string]$SuperAdminEmail = $env:E2E_SUPER_ADMIN_EMAIL,
  [string]$SuperAdminPassword = $env:E2E_SUPER_ADMIN_PASSWORD
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VitePort = 5174
$ApiPort = 3000
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptDir\..\.."

Write-Host "sprint_dir=$scriptDir repoRoot=$repoRoot"

# 1. 安装依赖（WorkingDirectory 显式指定 repoRoot）
Write-Host "▶ Installing dependencies..."
$installProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory $repoRoot `
  -Wait -PassThru -NoNewWindow
if ($installProc.ExitCode -ne 0) { throw "FAIL: npm ci failed exit=$($installProc.ExitCode)" }

# 2. 安装 Playwright 浏览器
Write-Host "▶ Installing Playwright chromium..."
$pwProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory $repoRoot `
  -Wait -PassThru -NoNewWindow
if ($pwProc.ExitCode -ne 0) { throw "FAIL: playwright install failed" }

# 2.5. 启动后端 API server（必须，禁止用 page.route() 代替）
Write-Host "▶ Starting API server on port $ApiPort..."
$env:DATABASE_URL = $env:E2E_DATABASE_URL
$env:NODE_ENV = "test"
$env:ASSIGNEE_ROSTER = '["客服A","客服B"]'
$apiProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd start" `
  -WorkingDirectory "$repoRoot\apps\api" `
  -PassThru -NoNewWindow
$maxWait = 30; $waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $ApiPort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
if (-not $conn.TcpTestSucceeded) {
  throw "FAIL: API server 未在 ${maxWait}s 内就绪 port=$ApiPort"
}
Write-Host "✅ API server 就绪 port=$ApiPort"

# 3. 运行 DB smoke（验 migration 已跑）
Write-Host "▶ Verifying DB schema..."
$psqlCheck = & psql $env:E2E_DATABASE_URL -c `
  "SELECT latest_reply, latest_reply_at, assignee, comment_replied_at FROM zenithjoy.acquisition_leads LIMIT 0" `
  2>&1
if ($LASTEXITCODE -ne 0) {
  throw "FAIL: acquisition_leads 缺少新列（migration 未跑？） output=$psqlCheck"
}
$orphanCheck = & psql $env:E2E_DATABASE_URL -c `
  "SELECT video_id, commenter_nickname, reply_text, captured_at, tenant_id FROM zenithjoy.acquisition_orphan_replies LIMIT 0" `
  2>&1
if ($LASTEXITCODE -ne 0) {
  throw "FAIL: acquisition_orphan_replies 表不存在 output=$orphanCheck"
}
Write-Host "✅ DB schema 验证通过"

# 4. Build Dashboard
Write-Host "▶ Building dashboard..."
$buildProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd run build" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow `
  -Environment @{ VITE_SKIP_AUTH = "true" }
if ($buildProc.ExitCode -ne 0) { throw "FAIL: dashboard build failed" }

# 5. 启动 Vite preview
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
if (-not $conn.TcpTestSucceeded) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: Vite 未在 ${maxWait}s 内就绪 port=$VitePort"
}
Write-Host "✅ Vite 就绪 port=$VitePort"

# 6. 跑 Playwright E2E spec（禁止 page.route()，所有请求打真实 API localhost:$ApiPort）
Write-Host "▶ Running Playwright E2E..."
$e2eProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright test e2e\leads-unified-table.spec.ts --reporter=list" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow `
  -Environment @{
    E2E_BASE_URL    = $BaseUrl
    E2E_EMAIL       = $SuperAdminEmail
    E2E_PASSWORD    = $SuperAdminPassword
    VITE_SKIP_AUTH  = "true"
  }

Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue

if ($e2eProc.ExitCode -ne 0) {
  throw "FAIL: Playwright E2E 失败 exit=$($e2eProc.ExitCode)"
}
Write-Host "✅ windows_cloud Dashboard E2E 验证通过（真实后端）"
exit 0
