# final-e2e 验证脚本 — 客服工作汇总页 Playwright（windows-latest 干净 VM，Mode B UI-level）
# 与仓库约定一致（navigation.config.ts:238「纯前端表单，page.route 拦后端验证；E2E 在 windows job 跑」）：
# UI E2E 用 page.route 拦 /api/wechat/cs/stats 验「每客服一张卡 4 数 + 今天/昨天切换 + 不串台 + 空卡 4 零」。
# 数据口径正确性由 Mode A 数据 oracle（cs-stats-verify.sh，真 API+DB）保证，两层互不替代。
param(
  [string]$BaseUrl = "http://localhost:5174"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VitePort = 5174
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptDir\..\..\.."

Write-Host "▶ Installing dependencies..."
$installProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($installProc.ExitCode -ne 0) { throw "FAIL: npm ci failed" }

$playwrightProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($playwrightProc.ExitCode -ne 0) { throw "FAIL: playwright install failed" }

Write-Host "▶ Building dashboard..."
$buildProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd run build" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow
if ($buildProc.ExitCode -ne 0) { throw "FAIL: build failed" }

Write-Host "▶ Starting Vite preview on port $VitePort..."
$serverProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -PassThru -NoNewWindow

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

# 跑客服工作汇总页 spec（page.route 拦后端，断言卡片 4 数 + 今天/昨天切换 + 不串台 + 空卡 4 零）
$e2eProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright test e2e\cs-work-stats.spec.ts --reporter=list" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow `
  -Environment @{ BASE_URL = $BaseUrl }

Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
if ($e2eProc.ExitCode -ne 0) { throw "FAIL: Playwright E2E 失败 exit=$($e2eProc.ExitCode)" }

# 截图归档到 sprint 目录（evaluator Read 自验）
$shotsSrc = "$repoRoot\apps\dashboard\test-results"
$shotsDst = "$scriptDir\..\screenshots"
New-Item -ItemType Directory -Force -Path $shotsDst | Out-Null
Get-ChildItem -Path $shotsSrc -Recurse -Filter "*.png" -ErrorAction SilentlyContinue | ForEach-Object {
  Copy-Item $_.FullName -Destination $shotsDst -Force -ErrorAction SilentlyContinue
}
Write-Host "✅ windows_cloud 客服工作汇总页 E2E 验证通过"
exit 0
