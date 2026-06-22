# Final E2E — 客户管理后台 Golden Path（windows_cloud / GHA windows-latest 干净 VM）
# 用户路径：管理员打开客户管理页 → 设公司名 → 建 3 子账号(1 service_agent) → 绑 1 客服到 1 PC → 看该机诊断
# 跑法：build apps/dashboard → vite preview :5173 → playwright test customer-admin-backend.spec.ts
# spec 用 page.route stub 新端点响应（干净 VM 无后端），真实渲染 4 区 UI 并对每步 toBeVisible/toHaveText 断言 + 截图
# 后端正确性（配额/双唯一/软删/隔离）由 customer-admin-backend-smoke.sh 在真 API+真库环境验（见 contract-dod.md BEHAVIOR）

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "=== 客户管理后台 Line10-S1 Final E2E（windows_cloud Playwright）==="

$VitePort   = 5173
$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot   = Resolve-Path "$scriptDir\..\.."
$dashRoot   = Join-Path $repoRoot "apps\dashboard"
$BaseUrl    = "http://localhost:$VitePort"

# Step 1: npm ci（仓库根）
Write-Host "-- npm ci"
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd ci --prefer-offline" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: npm ci exit=$($p.ExitCode)" }

# Step 2: 安装 Playwright chromium
Write-Host "-- playwright install chromium"
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright install chromium --with-deps" -WorkingDirectory $dashRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: playwright install exit=$($p.ExitCode)" }

# Step 3: build dashboard
Write-Host "-- npm run build (apps/dashboard)"
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd run build" -WorkingDirectory $dashRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: build exit=$($p.ExitCode)" }

# Step 4: 启动 vite preview :5173
Write-Host "-- vite preview on :$VitePort"
$server = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" -WorkingDirectory $dashRoot -PassThru -NoNewWindow

try {
  # Step 5: 等端口就绪（Test-NetConnection 兼容 IPv4/IPv6）
  $maxWait = 30; $waited = 0
  do {
    Start-Sleep -Seconds 1; $waited++
    $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
  } while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
  if (-not $conn.TcpTestSucceeded) { throw "FAIL: vite 未在 ${maxWait}s 内就绪 port=$VitePort" }
  Write-Host "✅ vite 就绪 :$VitePort"

  # Step 6: 跑 Playwright E2E（4 区用户路径 + 5 张截图）
  $e2e = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c npx.cmd playwright test e2e\customer-admin-backend.spec.ts --reporter=list" `
    -WorkingDirectory $dashRoot -Wait -PassThru -NoNewWindow `
    -Environment @{
      E2E_BASE_URL          = $BaseUrl
      E2E_SUPER_ADMIN_EMAIL = $env:E2E_SUPER_ADMIN_EMAIL
    }
  if ($e2e.ExitCode -ne 0) { throw "FAIL: Playwright E2E exit=$($e2e.ExitCode)" }
}
finally {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}

# Step 7: 截图归档到 sprint 目录
$shotSrc = Join-Path $dashRoot "e2e\screenshots"
$shotDst = Join-Path $scriptDir "screenshots"
New-Item -ItemType Directory -Force -Path $shotDst | Out-Null
if (Test-Path $shotSrc) { Copy-Item "$shotSrc\*.png" $shotDst -Force -ErrorAction SilentlyContinue }

Write-Host "✅ windows_cloud 客户管理后台 E2E 验证通过"
exit 0
