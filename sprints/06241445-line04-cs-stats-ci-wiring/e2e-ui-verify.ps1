# Line04 客服工作汇总(S3) + 客服日报(S4) — 前端 E2E（windows_cloud / GHA windows-latest 干净 VM）
# 跑两个 spec：cs-work-stats.spec.ts（每客服卡片 4 数 + 真发/演练 + 切昨天）+ cs-daily-report.spec.ts（选历史日期看 4 数 + 小结）。
# spec 用 page.route stub 后端响应（干净 VM 无后端），真实渲染 UI 并对每步断言 + 截图。
# 后端正确性（口径/幂等/隔离/时区）由 cs-work-stats-smoke.sh / cs-daily-report-smoke.sh 在真 API+真库验（ci-l4-e2e-smoke.yml）。
#
# 两页是 requireAuth:true → build 注入 VITE_SKIP_AUTH=true（MOCK_USER），绕开干净 VM 无登录链路，
# 否则 App 守卫会跳登录页致渲染不到目标页（对照 sprints/06220836-customer-admin-backend/e2e-verify.ps1）。

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "=== Line04 客服工作汇总(S3)+日报(S4) Final E2E（windows_cloud Playwright）==="

$VitePort  = 5174
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path "$scriptDir\..\.."
$dashRoot  = Join-Path $repoRoot "apps\dashboard"
$BaseUrl   = "http://localhost:$VitePort"

# Step 1: npm ci（仓库根）
Write-Host "-- npm ci"
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd ci --prefer-offline" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: npm ci exit=$($p.ExitCode)" }

# Step 2: 安装 Playwright chromium
Write-Host "-- playwright install chromium"
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright install chromium --with-deps" -WorkingDirectory $dashRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: playwright install exit=$($p.ExitCode)" }

# Step 3: build dashboard（VITE_SKIP_AUTH=true → MOCK_USER，干净 VM 无登录链路也能渲染 requireAuth:true 页）
Write-Host "-- npm run build (apps/dashboard, VITE_SKIP_AUTH=true)"
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd run build" -WorkingDirectory $dashRoot -Wait -PassThru -NoNewWindow `
  -Environment @{
    VITE_SKIP_AUTH          = "true"
    VITE_SUPER_ADMIN_EMAILS = "dev@zenjoymedia.media"
  }
if ($p.ExitCode -ne 0) { throw "FAIL: dashboard build exit=$($p.ExitCode)" }

# Step 4: 启动 vite preview
Write-Host "-- vite preview on :$VitePort"
$server = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" -WorkingDirectory $dashRoot -PassThru -NoNewWindow
try {
  $maxWait = 30; $waited = 0
  do {
    Start-Sleep -Seconds 1; $waited++
    $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
  } while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
  if (-not $conn.TcpTestSucceeded) { throw "FAIL: vite 未在 ${maxWait}s 内就绪 port=$VitePort" }
  Write-Host "✅ vite 就绪 :$VitePort"

  # Step 5: 跑 Playwright（两个 spec；config baseURL 读 E2E_BASE_URL，spec 用相对 goto）。
  # 关键：spec 路径用正斜杠 e2e/xxx.spec.ts —— windows 上反斜杠 e2e\xxx 会让 Playwright path-filter
  # 匹配不到 → "No tests found"（对照绿的 cs-config-permission.ps1 / agent-e2e-video.yml 都用正斜杠）。
  $e2e = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c npx.cmd playwright test e2e/cs-work-stats.spec.ts e2e/cs-daily-report.spec.ts --reporter=list" `
    -WorkingDirectory $dashRoot -Wait -PassThru -NoNewWindow `
    -Environment @{ E2E_BASE_URL = $BaseUrl }
  if ($e2e.ExitCode -ne 0) { throw "FAIL: Playwright 客服工作汇总/日报 UI exit=$($e2e.ExitCode)" }
}
finally {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}
Write-Host "✅ job2 前端 客服工作汇总(4数+真发/演练+切昨天) + 客服日报(选日期看4数+小结) UI 验证通过"
exit 0
