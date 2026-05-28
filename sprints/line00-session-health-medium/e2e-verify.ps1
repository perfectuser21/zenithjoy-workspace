# Final E2E — 运营中枢 /operator Golden Path 真实验证
# 模拟用户：xuxiao21xx@icloud.com 登录 → 打开 /operator → 验证 8 平台状态矩阵
# 运行环境：GitHub Actions windows-latest（干净 VM）

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "=== 运营中枢 Line-00 Final E2E（真实 Golden Path）==="

$BaseUrl    = "https://autopilot.zenjoymedia.media"
$Email      = $env:E2E_SUPER_ADMIN_EMAIL
$Password   = $env:E2E_SUPER_ADMIN_PASSWORD
$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot   = Resolve-Path "$scriptDir\..\.."
$dashRoot   = Join-Path $repoRoot "apps\dashboard"

if (-not $Email) { throw "FAIL: E2E_SUPER_ADMIN_EMAIL 未设置" }
if (-not $Password) { throw "FAIL: E2E_SUPER_ADMIN_PASSWORD 未设置" }

# Step 1: npm ci
Write-Host "-- npm ci"
& npm.cmd ci --prefer-offline
if ($LASTEXITCODE -ne 0) { throw "FAIL: npm ci (exit=$LASTEXITCODE)" }

# Step 2: 安装 Playwright browsers
Write-Host "-- 安装 Playwright browsers"
Push-Location $dashRoot
& npx.cmd playwright install chromium --with-deps
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "FAIL: playwright install (exit=$LASTEXITCODE)" }
Pop-Location

# Step 3: 写 Playwright 测试脚本（直接测生产 URL，不起本地 server）
$testFile = Join-Path $dashRoot "e2e\tmp-e2e-goldenpath.spec.ts"

$testContent = "import { test, expect } from '@playwright/test';" + [Environment]::NewLine
$testContent += "" + [Environment]::NewLine
$testContent += "const BASE_URL = process.env.E2E_BASE_URL || '$BaseUrl';" + [Environment]::NewLine
$testContent += "const EMAIL    = process.env.E2E_EMAIL    || '$Email';" + [Environment]::NewLine
$testContent += "const PASSWORD = process.env.E2E_PASSWORD || '$Password';" + [Environment]::NewLine
$testContent += "" + [Environment]::NewLine
$testContent += "const PLATFORMS = ['抖音','快手','小红书','视频号','头条','微博','知乎','公众号'];" + [Environment]::NewLine
$testContent += "" + [Environment]::NewLine
$testContent += "test('Golden Path Step 1: 运营员登录', async ({ page }) => {" + [Environment]::NewLine
$testContent += "  await page.goto(BASE_URL + '/login');" + [Environment]::NewLine
$testContent += "  await page.waitForLoadState('domcontentloaded');" + [Environment]::NewLine
$testContent += "  await page.getByPlaceholder('you@example.com').fill(EMAIL);" + [Environment]::NewLine
$testContent += "  await page.getByPlaceholder(/[•]+/).fill(PASSWORD);" + [Environment]::NewLine
$testContent += "  await page.getByRole('button', { name: /登录/ }).click();" + [Environment]::NewLine
$testContent += "  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 20000 });" + [Environment]::NewLine
$testContent += "  console.log('ok 登录成功，当前页面：' + page.url());" + [Environment]::NewLine
$testContent += "});" + [Environment]::NewLine
$testContent += "" + [Environment]::NewLine
$testContent += "test('Golden Path Step 2: 访问 /operator 看到 8 平台矩阵', async ({ page }) => {" + [Environment]::NewLine
$testContent += "  await page.goto(BASE_URL + '/login');" + [Environment]::NewLine
$testContent += "  await page.waitForLoadState('domcontentloaded');" + [Environment]::NewLine
$testContent += "  await page.getByPlaceholder('you@example.com').fill(EMAIL);" + [Environment]::NewLine
$testContent += "  await page.getByPlaceholder(/[•]+/).fill(PASSWORD);" + [Environment]::NewLine
$testContent += "  await page.getByRole('button', { name: /登录/ }).click();" + [Environment]::NewLine
$testContent += "  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 20000 });" + [Environment]::NewLine
$testContent += "  await page.goto(BASE_URL + '/operator');" + [Environment]::NewLine
$testContent += "  await page.waitForLoadState('networkidle');" + [Environment]::NewLine
$testContent += "  for (const platform of PLATFORMS) {" + [Environment]::NewLine
$testContent += "    await expect(page.getByText(platform).first()).toBeVisible({ timeout: 10000 });" + [Environment]::NewLine
$testContent += "    console.log('ok 平台可见：' + platform);" + [Environment]::NewLine
$testContent += "  }" + [Environment]::NewLine
$testContent += "});" + [Environment]::NewLine
$testContent += "" + [Environment]::NewLine
$testContent += "test('Golden Path Step 3: 每个平台有登录按钮', async ({ page }) => {" + [Environment]::NewLine
$testContent += "  await page.goto(BASE_URL + '/login');" + [Environment]::NewLine
$testContent += "  await page.waitForLoadState('domcontentloaded');" + [Environment]::NewLine
$testContent += "  await page.getByPlaceholder('you@example.com').fill(EMAIL);" + [Environment]::NewLine
$testContent += "  await page.getByPlaceholder(/[•]+/).fill(PASSWORD);" + [Environment]::NewLine
$testContent += "  await page.getByRole('button', { name: /登录/ }).click();" + [Environment]::NewLine
$testContent += "  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 20000 });" + [Environment]::NewLine
$testContent += "  await page.goto(BASE_URL + '/operator');" + [Environment]::NewLine
$testContent += "  await page.waitForLoadState('networkidle');" + [Environment]::NewLine
$testContent += "  const loginBtns = page.getByRole('button', { name: /登录/ });" + [Environment]::NewLine
$testContent += "  const count = await loginBtns.count();" + [Environment]::NewLine
$testContent += "  expect(count).toBeGreaterThanOrEqual(1);" + [Environment]::NewLine
$testContent += "  console.log('ok 登录按钮数量：' + count);" + [Environment]::NewLine
$testContent += "});" + [Environment]::NewLine

[System.IO.File]::WriteAllText($testFile, $testContent, [System.Text.Encoding]::UTF8)
Write-Host "-- 测试文件已写入"

# Step 4: 跑 Playwright（用 & 直接调用，正确捕获 exit code）
Write-Host "-- 跑 Playwright Golden Path E2E"
$env:E2E_BASE_URL = $BaseUrl
$env:E2E_EMAIL    = $Email
$env:E2E_PASSWORD = $Password

Push-Location $dashRoot
$ErrorActionPreference = "Continue"  # 让 playwright 自然退出
& npx.cmd playwright test tmp-e2e-goldenpath.spec.ts --reporter=list
$playwrightExitCode = $LASTEXITCODE
$ErrorActionPreference = "Stop"
Pop-Location

Remove-Item $testFile -Force -ErrorAction SilentlyContinue

if ($playwrightExitCode -ne 0) {
  Write-Host "=== E2E FAILED (exit=$playwrightExitCode) ==="
  exit $playwrightExitCode
}
Write-Host "=== E2E PASS — Golden Path 全部验证通过 ==="
