# final-e2e 验证脚本 — Line02 角色数据统一 & 账号管理页绑定机器列（windows-latest + Playwright）
# 变体C：真实后端，禁 page.route()
# 前提 secrets（e2e-windows.yml Run E2E step env: 段注入）:
#   E2E_DATABASE_URL — staging postgres 连接串
#   E2E_SUPER_ADMIN_EMAIL, E2E_SUPER_ADMIN_PASSWORD

param(
  [string]$BaseUrl = "http://localhost:5174"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptStart = Get-Date
$VitePort = 5174
$ApiPort = 3000
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptDir\..\.."

Write-Host "▶ Sprint: Line02 角色统一 & 绑定机器列 ScriptStart=$ScriptStart"

# ── Step 1: 安装依赖 ──
Write-Host "▶ npm ci..."
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) { throw "FAIL: npm ci exit=$($proc.ExitCode)" }

# ── Step 2: 安装 Playwright Chromium ──
Write-Host "▶ playwright install chromium..."
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) { throw "FAIL: playwright install exit=$($proc.ExitCode)" }

# ── Step 3: 构建 API ──
Write-Host "▶ 构建 API..."
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd run build --workspace=apps/api" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) { throw "FAIL: API build exit=$($proc.ExitCode)" }

# ── Step 4: 注入 DATABASE_URL ──
$dbUrl = $env:E2E_DATABASE_URL
if (-not $dbUrl) {
  throw "FAIL: E2E_DATABASE_URL 未设置。请在 e2e-windows.yml Run E2E verification step 的 env: 段加入 E2E_DATABASE_URL: `${{ secrets.E2E_DATABASE_URL }}"
}
$apiEnvPath = "$repoRoot\apps\api\.env"
@"
DATABASE_URL=$dbUrl
PORT=$ApiPort
NODE_ENV=test
"@ | Out-File -FilePath $apiEnvPath -Encoding utf8

# ── Step 5: 启动 API（真实后端，连 staging DB）──
Write-Host "▶ 启动 API on port $ApiPort..."
$apiProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c node -r dotenv/config dist/index.js" `
  -WorkingDirectory "$repoRoot\apps\api" `
  -PassThru -NoNewWindow

$waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $ApiPort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt 30)
if (-not $conn.TcpTestSucceeded) { throw "FAIL: API 未在 30s 内就绪 port=$ApiPort" }
Write-Host "✅ API 就绪 port=$ApiPort"

# ── Step 6: 构建 Dashboard（VITE_API_BASE_URL 指向真实后端，禁 stub）──
Write-Host "▶ 构建 Dashboard..."
$buildEnv = @{ VITE_API_BASE_URL = "http://localhost:$ApiPort"; VITE_SKIP_AUTH = "true" }
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd run build" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow -Environment $buildEnv
if ($proc.ExitCode -ne 0) { throw "FAIL: Dashboard build exit=$($proc.ExitCode)" }

# ── Step 7: 启动 Vite preview ──
Write-Host "▶ 启动 Vite preview port $VitePort..."
$serverProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -PassThru -NoNewWindow

$waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt 30)
if (-not $conn.TcpTestSucceeded) { throw "FAIL: Vite 未在 30s 内就绪 port=$VitePort" }
Write-Host "✅ Vite 就绪 port=$VitePort"

# ── Step 8: Playwright E2E（打真实后端，spec 禁 page.route()）──
Write-Host "▶ 运行 Playwright E2E..."
$e2eProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright test e2e\line02-account-role-unify.spec.ts --reporter=list" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow `
  -Environment @{
    E2E_BASE_URL   = "http://localhost:$VitePort"
    E2E_API_URL    = "http://localhost:$ApiPort"
    E2E_EMAIL      = $env:E2E_SUPER_ADMIN_EMAIL
    E2E_PASSWORD   = $env:E2E_SUPER_ADMIN_PASSWORD
  }
$e2eExit = $e2eProc.ExitCode

# ── Step 9: 归集截图 ──
$screenshotDir = "$scriptDir\screenshots"
if (-not (Test-Path $screenshotDir)) { New-Item -ItemType Directory -Path $screenshotDir | Out-Null }
$srcShots = "$repoRoot\apps\dashboard\test-results"
if (Test-Path $srcShots) {
  Get-ChildItem "$srcShots\*.png" -Recurse | Copy-Item -Destination $screenshotDir -ErrorAction SilentlyContinue
}
# 同时复制 spec 内 page.screenshot() 输出的截图
Get-ChildItem "$repoRoot\apps\dashboard\screenshots\*.png" -ErrorAction SilentlyContinue | Copy-Item -Destination $screenshotDir -ErrorAction SilentlyContinue

# ── Step 10: 验证 artifact（旧页面已删除）──
Write-Host "▶ 验证 DouyinBurnerBindPage 已删除..."
$deletedPath = "$repoRoot\apps\dashboard\src\pages\DouyinBurnerBindPage.tsx"
if (Test-Path $deletedPath) {
  Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: DouyinBurnerBindPage.tsx 仍存在，未执行物理删除"
}

$navConfig = Get-Content "$repoRoot\apps\dashboard\src\config\navigation.config.ts" -Raw
if ($navConfig -match "DouyinBurnerBind") {
  Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: navigation.config.ts 仍有 DouyinBurnerBind 引用"
}

# ── 清理进程 ──
Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue

if ($e2eExit -ne 0) { throw "FAIL: Playwright E2E 失败 exit=$e2eExit" }
Write-Host "✅ Line02 角色统一 E2E 验证通过（真实后端，无 stub）"
exit 0
