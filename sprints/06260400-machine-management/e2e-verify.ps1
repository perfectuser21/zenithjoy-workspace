# final-e2e（windows_cloud / GHA windows-latest）— Line02 机器管理页 Dashboard Playwright
# 变体 C：npm ci → playwright install → build dashboard → vite preview:5174 → spec
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VitePort = 5174
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptDir\..\.."

Write-Host "▶ npm ci..."
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd ci --prefer-offline" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: npm ci exit=$($p.ExitCode)" }

Write-Host "▶ playwright install chromium..."
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright install chromium --with-deps" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: playwright install exit=$($p.ExitCode)" }

Write-Host "▶ build dashboard..."
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd run build" -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: build exit=$($p.ExitCode)" }

Write-Host "▶ vite preview on $VitePort..."
$server = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" -WorkingDirectory "$repoRoot\apps\dashboard" -PassThru -NoNewWindow
try {
  $maxWait = 30; $waited = 0
  do { Start-Sleep -Seconds 1; $waited++; $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue } while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
  if (-not $conn.TcpTestSucceeded) { throw "FAIL: Vite 未在 ${maxWait}s 就绪 port=$VitePort" }
  Write-Host "✅ Vite 就绪 port=$VitePort"

  $e2e = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c npx.cmd playwright test e2e\machine-management.spec.ts --reporter=list" `
    -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow `
    -Environment @{ BASE_URL = "http://localhost:$VitePort"; E2E_BASE_URL = "http://localhost:$VitePort"; VITE_SKIP_AUTH = "true" }
  if ($e2e.ExitCode -ne 0) { throw "FAIL: Playwright E2E exit=$($e2e.ExitCode)" }
}
finally {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}

# 截图归档到 sprint 目录（evaluator 视觉自验）
$shots = "$repoRoot\apps\dashboard\screenshots"
if (Test-Path $shots) {
  New-Item -ItemType Directory -Force -Path "$scriptDir\screenshots" | Out-Null
  Copy-Item "$shots\*.png" "$scriptDir\screenshots\" -ErrorAction SilentlyContinue
}
Write-Host "✅ windows_cloud 机器管理 E2E 验证通过"
exit 0
