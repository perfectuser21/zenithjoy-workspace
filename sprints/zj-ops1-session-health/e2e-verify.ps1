# e2e-verify.ps1 — Operator /operator 页面 E2E 验证
# 策略：build + npx serve（轻量静态服务器，秒级就绪，避免 vite preview 端口绑定问题）

param([string]$Port = "4173")

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "=== Operator Page E2E Verify ==="

Push-Location apps/dashboard

Write-Host "-- npm ci"
npm ci --prefer-offline 2>&1 | Select-Object -Last 3

Write-Host "-- playwright install chromium"
npx playwright install chromium --with-deps 2>&1 | Select-Object -Last 3

Write-Host "-- npm run build"
npm run build
if ($LASTEXITCODE -ne 0) { Write-Error "build failed"; exit 1 }
Write-Host "Build OK"

# serve dist/ — SPA 模式（--single 把 404 路由到 index.html）
Write-Host "-- starting serve"
$server = Start-Process -FilePath "node" `
  -ArgumentList (Get-ChildItem "node_modules\serve\build\main.js").FullName,"dist","--listen",$Port,"--single","--no-clipboard" `
  -WorkingDirectory (Get-Location).Path -PassThru
Write-Host "serve PID: $($server.Id)"

# 等端口就绪（最多 30 秒）
$ready = $false
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep 2
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $c.Connect("127.0.0.1", [int]$Port)
    $c.Close()
    Write-Host "serve ready after $($i*2)s"
    $ready = $true; break
  } catch {}
}
if (-not $ready) { Stop-Process -Id $server.Id -Force -EA SilentlyContinue; Write-Error "serve 未就绪"; exit 1 }

# Playwright 测试
$base = "http://localhost:$Port"
$testFile = Join-Path (Get-Location).Path "tmp-e2e-operator.js"
@"
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const resp = await page.goto('$base/operator', { waitUntil: 'networkidle' });
  if (!resp || resp.status() >= 400) {
    console.error('FAIL: /operator status', resp ? resp.status() : 'null'); process.exit(1);
  }
  console.log('✓ /operator 可达 status:', resp.status());

  const content = await page.content();
  if (!content.includes('未授权') && !content.includes('Operator') && !content.includes('operator')) {
    console.error('FAIL: OperatorPage 未渲染'); process.exit(1);
  }
  console.log('✓ OperatorPage 组件已渲染');
  await browser.close();

  // 源码验证 8 平台
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join('src','pages','OperatorPage.tsx'), 'utf8');
  const platforms = ['抖音','快手','小红书','视频号','头条','微博','知乎','公众号'];
  const missing = platforms.filter(p => !src.includes(p));
  if (missing.length > 0) { console.error('FAIL: 源码缺平台:', missing.join(',')); process.exit(1); }
  console.log('✓ 源码含 8 平台定义');
  console.log('E2E PASS');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
"@ | Set-Content -Path $testFile -Encoding UTF8

node $testFile
$exitCode = $LASTEXITCODE
Remove-Item -Path $testFile -Force -EA SilentlyContinue
Stop-Process -Id $server.Id -Force -EA SilentlyContinue
Pop-Location

if ($exitCode -ne 0) { Write-Host "=== E2E FAILED ==="; exit $exitCode }
Write-Host "=== E2E PASS ==="
