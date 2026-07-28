# final-e2e 验证脚本 — Ability Acceptance Playwright（windows-latest 干净 VM，Mode B UI-level）
# Phase C 合同验收：C1-C5 断言，page.route mock 拦后端，不依赖真实 DB。
param(
  [string]$BaseUrl = "http://localhost:5175"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VitePort = 5175
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
# 本脚本在 sprint 根目录（e2e-windows.yml 跑 $sprintDir/e2e-verify.ps1）：sprint → sprints → repo root = 上 2 级。
$repoRoot = Resolve-Path "$scriptDir\..\.."

Write-Host "▶ Installing dependencies..."
$installProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($installProc.ExitCode -ne 0) { throw "FAIL: npm ci failed" }

$playwrightProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory "$repoRoot\apps\staff-hub" -Wait -PassThru -NoNewWindow
if ($playwrightProc.ExitCode -ne 0) { throw "FAIL: playwright install failed" }

Write-Host "▶ Building staff-hub (VITE_SKIP_AUTH=true 让 E2E 跳过登录)..."
$env:VITE_SKIP_AUTH = "true"
$buildProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd run build" `
  -WorkingDirectory "$repoRoot\apps\staff-hub" -Wait -PassThru -NoNewWindow
if ($buildProc.ExitCode -ne 0) { throw "FAIL: build failed" }

Write-Host "▶ Starting Vite preview on port $VitePort..."
$serverProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" `
  -WorkingDirectory "$repoRoot\apps\staff-hub" -PassThru -NoNewWindow

$maxWait = 30; $waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
if (-not $conn.TcpTestSucceeded) {
  if ($serverProc -and -not $serverProc.HasExited) { Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue }
  throw "FAIL: Vite 未在 ${maxWait}s 内就绪 port=$VitePort"
}
Write-Host "✅ Vite 就绪 port=$VitePort"

# 跑 ability-acceptance spec（page.route 拦后端，Phase C C1-C5 断言）
$e2eProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright test e2e\ability-acceptance.spec.ts --reporter=list" `
  -WorkingDirectory "$repoRoot\apps\staff-hub" -Wait -PassThru -NoNewWindow `
  -Environment @{ E2E_BASE_URL = $BaseUrl }

Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
if ($e2eProc.ExitCode -ne 0) { throw "FAIL: Playwright E2E 失败 exit=$($e2eProc.ExitCode)" }

# 截图归档到 sprint 目录（evaluator Read 自验）
$shotsSrc = "$repoRoot\apps\staff-hub\test-results"
$shotsDst = "$scriptDir\..\screenshots"
New-Item -ItemType Directory -Force -Path $shotsDst | Out-Null
Get-ChildItem -Path $shotsSrc -Recurse -Filter "*.png" -ErrorAction SilentlyContinue | ForEach-Object {
  Copy-Item $_.FullName -Destination $shotsDst -Force -ErrorAction SilentlyContinue
}
Write-Host "✅ windows_cloud Ability Acceptance E2E 验证通过"
exit 0
