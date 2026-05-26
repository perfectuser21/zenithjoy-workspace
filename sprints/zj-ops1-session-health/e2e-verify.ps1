# e2e-verify.ps1 — Operator /operator 页面 E2E 验证
# 运行环境：GitHub Actions windows-latest
# 触发：e2e-windows.yml workflow_dispatch

param(
  [string]$BaseUrl = "http://localhost:5173"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "=== Operator Page E2E Verify ==="
Write-Host "BaseUrl: $BaseUrl"

# 安装依赖
Push-Location apps/dashboard
npm ci --prefer-offline 2>&1 | Select-Object -Last 5
npx playwright install chromium --with-deps 2>&1 | Select-Object -Last 3

# 启动 vite dev server
$vite = Start-Process -FilePath "npx" -ArgumentList "vite","--port","5173" `
  -WorkingDirectory (Get-Location) -PassThru -RedirectStandardOutput "$env:TEMP\vite.log"
Write-Host "Vite PID: $($vite.Id)"

# 等 vite 就绪
$maxWait = 30
for ($i = 0; $i -lt $maxWait; $i++) {
  Start-Sleep 1
  try {
    $r = Invoke-WebRequest -Uri "$BaseUrl" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    if ($r.StatusCode -eq 200) { Write-Host "Vite ready (${i}s)"; break }
  } catch {}
  if ($i -eq ($maxWait - 1)) { Write-Error "Vite 未在 ${maxWait}s 内就绪"; exit 1 }
}

# Playwright 测试
$testScript = @"
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // /operator 路由存在
  const resp = await page.goto('$BaseUrl/operator');
  if (!resp) { console.error('FAIL: /operator 无响应'); process.exit(1); }
  console.log('✓ /operator 路由可访问，status:', resp.status());

  // 页面含 8 平台标签
  const platforms = ['抖音','快手','小红书','视频号','头条','微博','知乎','公众号'];
  const content = await page.content();
  const missing = platforms.filter(p => !content.includes(p));
  if (missing.length > 0) {
    console.error('FAIL: 缺平台标签:', missing.join(', ')); process.exit(1);
  }
  console.log('✓ 8 平台标签全部存在');

  await browser.close();
  console.log('E2E PASS');
})();
"@

$testScript | node
$exitCode = $LASTEXITCODE

# 清理
Stop-Process -Id $vite.Id -Force -ErrorAction SilentlyContinue
Pop-Location

exit $exitCode
