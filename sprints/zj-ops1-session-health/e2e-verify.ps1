# e2e-verify.ps1 — Operator /operator 页面 E2E 验证
# 运行环境：GitHub Actions windows-latest
# 策略：npm run build + vite preview（秒级启动，避免 dev server 初始化挂起）

param(
  [string]$BaseUrl = "http://localhost:4173"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "=== Operator Page E2E Verify ==="
Write-Host "BaseUrl: $BaseUrl"

Push-Location apps/dashboard

# 安装依赖
Write-Host "-- npm ci"
npm ci --prefer-offline 2>&1 | Select-Object -Last 3

# 安装 playwright
Write-Host "-- playwright install chromium"
npx playwright install chromium --with-deps 2>&1 | Select-Object -Last 3

# 构建（证明 TypeScript 无错误，产出 dist/）
Write-Host "-- npm run build"
npm run build 2>&1 | Select-Object -Last 5

# 启动 vite preview（serve dist/，秒级就绪）
Write-Host "-- vite preview"
$server = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c","npx vite preview --port 4173 --strictPort" `
  -WorkingDirectory (Get-Location).Path -PassThru
Write-Host "Server PID: $($server.Id)"
Start-Sleep 8

# 简单验证端口就绪
$ready = $false
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep 2
  try {
    $conn = New-Object System.Net.Sockets.TcpClient
    $conn.Connect("127.0.0.1", 4173)
    $conn.Close()
    Write-Host "Server ready after $($i * 2 + 8)s"
    $ready = $true
    break
  } catch {}
}
if (-not $ready) { Write-Error "Preview server 未就绪"; exit 1 }

# 写 playwright 测试文件到 apps/dashboard（保证 require 路径正确）
$testFile = Join-Path (Get-Location).Path "tmp-e2e-operator.js"
@"
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const resp = await page.goto('$BaseUrl/operator');
  if (!resp) { console.error('FAIL: /operator 无响应'); process.exit(1); }
  console.log('status:', resp.status(), resp.url());

  const content = await page.content();
  const platforms = ['抖音','快手','小红书','视频号','头条','微博','知乎','公众号'];
  const missing = platforms.filter(p => !content.includes(p));
  if (missing.length > 0) {
    console.error('FAIL: 缺平台标签:', missing.join(', '));
    process.exit(1);
  }
  console.log('✓ 8 平台标签全部存在');
  await browser.close();
  console.log('E2E PASS');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
"@ | Set-Content -Path $testFile -Encoding UTF8

node $testFile
$exitCode = $LASTEXITCODE
Remove-Item -Path $testFile -Force -ErrorAction SilentlyContinue
Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
Pop-Location

if ($exitCode -ne 0) { Write-Host "=== E2E FAILED ==="; exit $exitCode }
Write-Host "=== E2E PASS ==="
