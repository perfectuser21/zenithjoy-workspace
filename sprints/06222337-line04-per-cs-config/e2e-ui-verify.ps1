# Line04 每客服设置区 — 前端 E2E（windows-latest，无 postgres/psql，page.route 拦后端）
# 验前台「每客服设置区」编辑该客服那一行并保存（user_facing 用户可见验证），纯前端行为，不碰 DB。
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$VitePort = 5174
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path "$scriptDir\..\.."

& cmd.exe /c "npm.cmd ci --prefer-offline" ; if ($LASTEXITCODE -ne 0) { throw "FAIL: npm ci" }
& cmd.exe /c "npx.cmd playwright install chromium" | Out-Null

Push-Location "$repoRoot\apps\dashboard"
& cmd.exe /c "npm.cmd run build" ; if ($LASTEXITCODE -ne 0) { throw "FAIL: dashboard build" }
Pop-Location

$vite = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" -WorkingDirectory "$repoRoot\apps\dashboard" -PassThru -NoNewWindow
$vok = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep 1
  if ((Test-NetConnection localhost -Port $VitePort -WarningAction SilentlyContinue).TcpTestSucceeded) { $vok = $true; break }
}
if (-not $vok) { throw "FAIL: Vite 30s 未就绪" }

$env:BASE_URL = "http://localhost:$VitePort"
$e2e = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright test e2e/per-cs-config.spec.ts --reporter=list" -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow
Stop-Process -Id $vite.Id -Force -ErrorAction SilentlyContinue
if ($e2e.ExitCode -ne 0) { throw "FAIL: Playwright 每客服设置区 UI exit=$($e2e.ExitCode)" }
Write-Host "✅ job2 前端每客服设置区编辑 UI 验证通过"
exit 0
