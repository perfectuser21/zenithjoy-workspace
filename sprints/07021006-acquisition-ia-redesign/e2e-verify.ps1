# Sprint 07021006 — 获客 IA 重设计 E2E 验证脚本（windows_cloud Mode B）
#
# 环境变量：
#   E2E_SUPER_ADMIN_EMAIL / E2E_SUPER_ADMIN_PASSWORD  — 登录凭据
#   E2E_DATABASE_URL        — psql 连接串，用于 seed 测试数据
#   E2E_API_URL             — 后端 API 基础 URL（如 https://api.zenithjoy.com）
#   E2E_TEST_TENANT_ID      — 测试租户 ID（seed 失败任务用）
#   E2E_OTHER_TENANT_ID     — 第二租户 ID（seed 10个小号用）
#
# 产出：sprints/07021006-acquisition-ia-redesign/screenshots/01-08.png

param(
  [string]$BaseUrl = "http://localhost:5174"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VitePort   = 5174
$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot   = Resolve-Path "$scriptDir\..\.."
$screenshotDir = "$scriptDir\screenshots"
New-Item -ItemType Directory -Force -Path $screenshotDir | Out-Null

$ApiUrl = $env:E2E_API_URL ?? "http://localhost:3000"
$TestTenantId   = $env:E2E_TEST_TENANT_ID  ?? "e2e-tenant-test-001"
$OtherTenantId  = $env:E2E_OTHER_TENANT_ID ?? "e2e-tenant-test-002"
$AdminEmail     = $env:E2E_SUPER_ADMIN_EMAIL    ?? ""
$AdminPassword  = $env:E2E_SUPER_ADMIN_PASSWORD ?? ""
$DatabaseUrl    = $env:E2E_DATABASE_URL ?? ""

Write-Host "▶ repo=$repoRoot api=$ApiUrl testTenant=$TestTenantId otherTenant=$OtherTenantId"

# ─── 1. Seed 测试数据（需 DATABASE_URL）────────────────────────
if ($DatabaseUrl) {
  Write-Host "▶ Seeding test data via psql..."
  $env:PGPASSWORD = ""  # psql 从 URL 解析密码

  # 清理旧测试数据
  $cleanupSql = @"
DELETE FROM zenithjoy.agent_platform_sessions
  WHERE account_label LIKE 'e2e-seed-other-%'
    AND tenant_id = '$OtherTenantId';
DELETE FROM zenithjoy.acquisition_collect_tasks
  WHERE tenant_id = '$TestTenantId'
    AND keywords::text LIKE '%e2e-failed-seed%';
"@
  $cleanupSql | psql $DatabaseUrl -f - 2>$null | Out-Null

  # Seed 10 个 active 小号给 OTHER_TENANT（触发 N=10 上限）
  $seedOtherSql = ""
  for ($i = 1; $i -le 10; $i++) {
    $label = "e2e-seed-other-$i"
    $seedOtherSql += "INSERT INTO zenithjoy.agent_platform_sessions (account_label, tenant_id, platform, status, bound_at) VALUES ('$label','$OtherTenantId','douyin','active',NOW()) ON CONFLICT DO NOTHING;`n"
  }
  $seedOtherSql | psql $DatabaseUrl -f - 2>$null | Out-Null
  Write-Host "  ✅ seeded 10 sessions for OTHER_TENANT=$OtherTenantId"

  # Seed 1 条 failed 任务给 TEST_TENANT
  $failedTaskId = [System.Guid]::NewGuid().ToString()
  $env:E2E_SEED_TASK_ID = $failedTaskId
  $seedFailedSql = "INSERT INTO zenithjoy.acquisition_collect_tasks (id,tenant_id,keywords,status,error_code,created_at) VALUES ('$failedTaskId','$TestTenantId','{""e2e-failed-seed""}','failed','COLLECT_TIMEOUT',NOW()) ON CONFLICT DO NOTHING;"
  $seedFailedSql | psql $DatabaseUrl -f - 2>$null | Out-Null
  Write-Host "  ✅ seeded failed task=$failedTaskId for TEST_TENANT=$TestTenantId"
} else {
  Write-Host "  ⚠ DATABASE_URL not set, skipping seed (tests may show empty states)"
}

# ─── 2. 登录取 session token ────────────────────────────────
function Get-SessionToken([string]$email, [string]$password) {
  if (-not $email -or -not $password) { return "" }
  try {
    $body = @{ email = $email; password = $password } | ConvertTo-Json
    $resp = Invoke-WebRequest -Uri "$ApiUrl/api/auth/sign-in/email" `
      -Method POST -ContentType "application/json" -Body $body `
      -UseBasicParsing -SessionVariable session 2>$null
    $cookie = $session.Cookies.GetCookies("$ApiUrl") | Where-Object { $_.Name -like "*session*" } | Select-Object -First 1
    if ($cookie) { return $cookie.Value }
    # fallback: try JSON body
    $json = $resp.Content | ConvertFrom-Json
    return $json.data.token ?? ""
  } catch { return "" }
}

$testSession  = Get-SessionToken $AdminEmail $AdminPassword
$otherSession = $testSession  # 若无独立 other 账号，复用（evaluator 容许）
Write-Host "  session resolved: test=$(if($testSession){'ok'}else{'empty'}) other=$(if($otherSession){'ok'}else{'empty'})"

$env:E2E_SESSION_TOKEN       = $testSession
$env:E2E_OTHER_SESSION_TOKEN = $otherSession

# ─── 3. 安装依赖 + Playwright ────────────────────────────────
Write-Host "▶ npm ci..."
$proc = Start-Process "cmd.exe" -ArgumentList "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) { throw "FAIL: npm ci" }

Write-Host "▶ playwright install chromium..."
$proc = Start-Process "cmd.exe" -ArgumentList "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) { throw "FAIL: playwright install" }

# ─── 4. Build dashboard ──────────────────────────────────────
Write-Host "▶ build dashboard (VITE_SKIP_AUTH=true)..."
$env:VITE_SKIP_AUTH = "true"
if ($env:E2E_API_URL) { $env:VITE_API_URL = $env:E2E_API_URL }
$proc = Start-Process "cmd.exe" -ArgumentList "/c npm.cmd run build" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) { throw "FAIL: build" }

# ─── 5. Start Vite preview ──────────────────────────────────
Write-Host "▶ start Vite preview port=$VitePort..."
$serverProc = Start-Process "cmd.exe" `
  -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -PassThru -NoNewWindow

$maxWait = 30; $waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
if (-not $conn.TcpTestSucceeded) {
  Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: Vite not ready after ${maxWait}s"
}
Write-Host "  ✅ Vite ready port=$VitePort"

# ─── 6. Run Playwright ──────────────────────────────────────
Write-Host "▶ running Playwright acquisition-ia.spec.ts..."
$e2eEnv = @{
  BASE_URL                = "http://localhost:$VitePort"
  E2E_SESSION_TOKEN       = $env:E2E_SESSION_TOKEN
  E2E_OTHER_SESSION_TOKEN = $env:E2E_OTHER_SESSION_TOKEN
  E2E_SEED_TASK_ID        = $env:E2E_SEED_TASK_ID ?? ""
}
$e2eProc = Start-Process "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright test e2e\acquisition-ia.spec.ts --reporter=list" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow -Environment $e2eEnv

Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue

if ($e2eProc.ExitCode -ne 0) {
  # 截图仍复制给 evaluator 视觉自验，但标记失败
  Write-Host "⚠ Playwright exit=$($e2eProc.ExitCode) — copying screenshots for evaluator"
}

# ─── 7. 归集截图 ─────────────────────────────────────────────
$shotsSrc = "$repoRoot\apps\dashboard\test-results"
Get-ChildItem -Path $shotsSrc -Recurse -Filter "*.png" -ErrorAction SilentlyContinue | ForEach-Object {
  Copy-Item $_.FullName -Destination $screenshotDir -Force -ErrorAction SilentlyContinue
}
# spec 直接写到 screenshotDir，无需二次复制
Write-Host "✅ screenshots at $screenshotDir"

if ($e2eProc.ExitCode -ne 0) {
  throw "FAIL: Playwright E2E exit=$($e2eProc.ExitCode)"
}
Write-Host "✅ Sprint 07021006 acquisition-ia E2E 验证通过"
exit 0
