# Line04 CRM 重做（客户好友表 + 三层下钻 + 黑名单接管）— 前端 E2E（windows-latest）
# windows_cloud runner（ZenithJoy UI 死规则）：build dashboard → vite preview:5174 →
# Playwright e2e/crm-customer-list.spec.ts（page.route 拦后端，纯前端 user_facing 验证，不碰 DB）。
# 验：层1 好友表+黑名单开关「接管中/已排除」+onboarding 状态条 → 层2 状态/画像页 → 层3 聊天记录气泡。
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
$e2e = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright test e2e/crm-customer-list.spec.ts --reporter=list" -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow
Stop-Process -Id $vite.Id -Force -ErrorAction SilentlyContinue
if ($e2e.ExitCode -ne 0) { throw "FAIL: Playwright CRM 客户好友表三层下钻 UI exit=$($e2e.ExitCode)" }

# 截图归档到 sprint 目录（evaluator 视觉自验）
$shots = "$repoRoot\apps\dashboard\screenshots"
if (Test-Path $shots) {
  New-Item -ItemType Directory -Force -Path "$scriptDir\screenshots" | Out-Null
  Copy-Item "$shots\*.png" "$scriptDir\screenshots\" -ErrorAction SilentlyContinue
}
Write-Host "✅ windows_cloud CRM 客户好友表三层下钻 UI 验证通过"
exit 0
