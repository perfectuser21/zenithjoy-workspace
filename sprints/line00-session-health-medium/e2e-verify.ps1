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

# Step 1: npm ci + 安装 Playwright
Write-Host "-- npm ci"
$proc = Start-Process cmd.exe -ArgumentList "/c npm.cmd ci --prefer-offline" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) { throw "FAIL: npm ci" }

Write-Host "-- 安装 Playwright browsers"
$proc = Start-Process cmd.exe -ArgumentList "/c npx.cmd playwright install chromium --with-deps" -WorkingDirectory $dashRoot -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) { throw "FAIL: playwright install" }

# Step 2: 写 Playwright 测试脚本（直接测生产 URL，不起本地 server）
$testFile = Join-Path $dashRoot "e2e\tmp-e2e-goldenpath.spec.ts"
$testContent = @"
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || '$BaseUrl';
const EMAIL    = process.env.E2E_EMAIL    || '$Email';
const PASSWORD = process.env.E2E_PASSWORD || '$Password';

const PLATFORMS = ['抖音','快手','小红书','视频号','头条','微博','知乎','公众号'];

test('Golden Path Step 1: 运营员登录', async ({ page }) => {
  await page.goto(BASE_URL + '/login');
  await page.getByPlaceholder(/邮箱|email/i).fill(EMAIL);
  await page.getByPlaceholder(/密码|password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /登录|sign in/i }).click();
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 15_000 });
  console.log('✅ 登录成功，当前页面：' + page.url());
});

test('Golden Path Step 2: 访问 /operator 看到 8 平台矩阵', async ({ page }) => {
  // 登录
  await page.goto(BASE_URL + '/login');
  await page.getByPlaceholder(/邮箱|email/i).fill(EMAIL);
  await page.getByPlaceholder(/密码|password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /登录|sign in/i }).click();
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 15_000 });

  // 访问 /operator
  await page.goto(BASE_URL + '/operator');
  await page.waitForLoadState('networkidle');

  // 验证 8 平台全部可见
  for (const platform of PLATFORMS) {
    await expect(page.getByText(platform).first()).toBeVisible({ timeout: 10_000 });
    console.log('✅ 平台可见：' + platform);
  }
});

test('Golden Path Step 3: 每个平台有登录按钮，点击后触发绑定请求', async ({ page }) => {
  // 登录
  await page.goto(BASE_URL + '/login');
  await page.getByPlaceholder(/邮箱|email/i).fill(EMAIL);
  await page.getByPlaceholder(/密码|password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /登录|sign in/i }).click();
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 15_000 });

  await page.goto(BASE_URL + '/operator');
  await page.waitForLoadState('networkidle');

  // 验证至少 8 个登录按钮
  const loginBtns = page.getByRole('button', { name: /登录/ });
  const count = await loginBtns.count();
  expect(count).toBeGreaterThanOrEqual(8);
  console.log('✅ 登录按钮数量：' + count);

  // 监听 trigger-bind 请求
  let bindCalled = false;
  page.on('request', req => {
    if (req.url().includes('trigger-bind')) bindCalled = true;
  });

  // 点第一个登录按钮
  await loginBtns.first().click();
  await page.waitForTimeout(3000);
  expect(bindCalled).toBe(true);
  console.log('✅ trigger-bind API 已被调用');
});
"@
Set-Content -Path $testFile -Encoding UTF8 -Value $testContent

# Step 3: 跑 Playwright
Write-Host "-- 跑 Playwright Golden Path E2E"
$env:E2E_BASE_URL = $BaseUrl
$env:E2E_EMAIL    = $Email
$env:E2E_PASSWORD = $Password

$proc = Start-Process cmd.exe `
  -ArgumentList "/c npx.cmd playwright test tmp-e2e-goldenpath.spec.ts --reporter=list" `
  -WorkingDirectory $dashRoot `
  -Wait -PassThru -NoNewWindow
$exitCode = $proc.ExitCode

Remove-Item $testFile -Force -ErrorAction SilentlyContinue

if ($exitCode -ne 0) {
  Write-Host "=== E2E FAILED (exit=$exitCode) ==="
  exit $exitCode
}
Write-Host "=== E2E PASS — Golden Path 全部验证通过 ==="
