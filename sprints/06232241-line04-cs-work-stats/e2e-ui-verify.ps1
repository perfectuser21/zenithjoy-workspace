# final-e2e（windows_cloud GHA windows-latest）— 客服工作汇总页 Playwright
# 纯前端渲染逻辑：spec 用 page.route 拦截 /api/wechat/cs/stats（live/yesterday 两套桩数据），
# 无需真实后端/DB（后端口径由 ci-l4 cs-work-stats-smoke.sh 在 ubuntu+postgres 上验）。
# Windows PS1 4 条铁律：Start-Process+WorkingDirectory / cmd.exe /c *.cmd / Test-NetConnection / 端口 5174。
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VitePort  = 5174
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path "$scriptDir\..\.."
$dashDir   = "$repoRoot\apps\dashboard"

Write-Host "▶ npm ci..."
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: npm ci exit=$($p.ExitCode)" }

Write-Host "▶ playwright install chromium..."
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory $dashDir -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: playwright install exit=$($p.ExitCode)" }

Write-Host "▶ build dashboard..."
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd run build" `
  -WorkingDirectory $dashDir -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: build exit=$($p.ExitCode)" }

Write-Host "▶ vite preview on $VitePort..."
$server = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" `
  -WorkingDirectory $dashDir -PassThru -NoNewWindow

try {
  $waited = 0
  do {
    Start-Sleep -Seconds 1; $waited++
    $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
  } while (-not $conn.TcpTestSucceeded -and $waited -lt 30)
  if (-not $conn.TcpTestSucceeded) { throw "FAIL: Vite 未在 30s 内就绪 port=$VitePort" }
  Write-Host "✅ Vite 就绪 port=$VitePort"

  $e2e = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c npx.cmd playwright test e2e\cs-work-summary.spec.ts --reporter=list" `
    -WorkingDirectory $dashDir -Wait -PassThru -NoNewWindow `
    -Environment @{ BASE_URL = "http://localhost:$VitePort" }
  if ($e2e.ExitCode -ne 0) { throw "FAIL: Playwright exit=$($e2e.ExitCode)" }
}
finally {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}

Write-Host "✅ windows_cloud 客服工作汇总页 E2E 验证通过"
exit 0
