$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Write-Host "=== ZJ10 Customer Management E2E Verification (windows_cloud) ==="
Write-Host "sprint_dir: sprints/zj10-customer-mgmt"
Write-Host "task_id: 9b8199e0-eb6b-453c-b98f-e6bd385ecd7f"

# Step 1: Check all required implementation files exist
$specFile = "apps/dashboard/e2e/customer-management.spec.ts"
$navConfig = "apps/dashboard/src/config/navigation.config.ts"
$adminCustomersPage = $null
$adminCustomersRoute = "apps/api/src/routes/admin-customers.ts"

Write-Host ""
Write-Host "--- Checking implementation files ---"

# Check API route (ws1)
if (-not (Test-Path $adminCustomersRoute)) {
    Write-Error "FAIL [ws1]: API route not found: $adminCustomersRoute"
    exit 1
}
Write-Host "OK [ws1] API route: $adminCustomersRoute"

# Check navigation config (ws2)
if (-not (Test-Path $navConfig)) {
    Write-Error "FAIL [ws2]: navigation.config.ts not found"
    exit 1
}
$navContent = Get-Content $navConfig -Raw
if ($navContent -notmatch "/admin/customers") {
    Write-Error "FAIL [ws2]: navigation.config.ts missing /admin/customers entry"
    exit 1
}
if ($navContent -notmatch "requireSuperAdmin") {
    Write-Error "FAIL [ws2]: navigation.config.ts missing requireSuperAdmin"
    exit 1
}
Write-Host "OK [ws2] navigation.config.ts has /admin/customers + requireSuperAdmin"

# Check AdminCustomersPage (ws2)
$adminPageGlob = Get-ChildItem -Path "apps/dashboard/src" -Recurse -Filter "AdminCustomersPage*" 2>$null
if (-not $adminPageGlob) {
    Write-Error "FAIL [ws2]: AdminCustomersPage component not found under apps/dashboard/src/"
    exit 1
}
Write-Host "OK [ws2] AdminCustomersPage found: $($adminPageGlob[0].FullName)"

# Check platform-sessions and publish-logs pages (ws3)
$sessionsPage = Get-ChildItem -Path "apps/dashboard/src" -Recurse -Filter "AdminPlatformSessionsPage*" 2>$null
if (-not $sessionsPage) {
    Write-Error "FAIL [ws3]: AdminPlatformSessionsPage component not found"
    exit 1
}
Write-Host "OK [ws3] AdminPlatformSessionsPage found"

$logsPage = Get-ChildItem -Path "apps/dashboard/src" -Recurse -Filter "AdminPublishLogsPage*" 2>$null
if (-not $logsPage) {
    Write-Error "FAIL [ws3]: AdminPublishLogsPage component not found"
    exit 1
}
Write-Host "OK [ws3] AdminPublishLogsPage found"

# Check E2E spec file (ws4)
if (-not (Test-Path $specFile)) {
    Write-Error "FAIL [ws4]: E2E spec file not found: $specFile"
    Write-Host "  Expected: apps/dashboard/e2e/customer-management.spec.ts"
    Write-Host "  This file should be created by WS4 generator."
    exit 1
}
Write-Host "OK [ws4] E2E spec file: $specFile"

Write-Host ""
Write-Host "--- All implementation files present, running Playwright E2E ---"

# Step 2: Install dependencies
Write-Host "Installing dashboard dependencies..."
Push-Location apps/dashboard
npm ci --prefer-offline 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "npm ci failed in apps/dashboard"
    Pop-Location
    exit 1
}

# Step 3: Install Playwright browsers
Write-Host "Installing Playwright browsers (chromium)..."
npx playwright install chromium --with-deps 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Playwright browser install failed"
    Pop-Location
    exit 1
}

# Step 4: Create screenshots directory
New-Item -ItemType Directory -Force -Path "screenshots" | Out-Null

# Step 5: Start vite dev server in background
Write-Host "Starting dashboard dev server (VITE_SKIP_AUTH=true)..."
$env:VITE_SKIP_AUTH = "true"
$dashboardPath = (Get-Location).Path
$devProcess = Start-Process -FilePath "npx" -ArgumentList "vite", "--port", "5173" -PassThru -WindowStyle Hidden -WorkingDirectory $dashboardPath
Start-Sleep -Seconds 20
Write-Host "Dev server PID: $($devProcess.Id)"

Pop-Location

# Step 6: Run Playwright tests
Write-Host "Running E2E: customer-management.spec.ts"
Push-Location apps/dashboard
npx playwright test e2e/customer-management.spec.ts --reporter=list 2>&1
$e2eExitCode = $LASTEXITCODE
Pop-Location

# Step 7: Cleanup dev server
if ($devProcess -and -not $devProcess.HasExited) {
    Stop-Process -Id $devProcess.Id -Force 2>$null
}

if ($e2eExitCode -ne 0) {
    Write-Error "FAIL: Playwright E2E tests failed (exit=$e2eExitCode)"
    exit $e2eExitCode
}

Write-Host ""
Write-Host "=== All E2E tests PASSED ==="
exit 0
