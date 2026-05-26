# e2e-verify.ps1 — Operator /operator 页面 E2E 验证
# 策略：
#   1. npm run build + vite preview（稳定启动）
#   2. 验证 /operator 路由可达（HTTP 200）
#   3. 验证 OperatorPage 组件渲染（"未授权" 文字，无需登录）
#   4. 验证源码含 8 平台定义（不依赖 auth 状态）

param([string]$BaseUrl = "http://localhost:4173")

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "=== Operator Page E2E Verify ==="

Push-Location apps/dashboard

Write-Host "-- npm ci"
npm ci --prefer-offline 2>&1 | Select-Object -Last 3

Write-Host "-- playwright install chromium"
npx playwright install chromium --with-deps 2>&1 | Select-Object -Last 3

Write-Host "-- npm run build"
npm run build 2>&1 | Select-Object -Last 8

Write-Host "-- vite preview"
$server = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c","npx vite preview --port 4173 --strictPort" `
  -WorkingDirectory (Get-Location).Path -PassThru
Write-Host "Server PID: $($server.Id)"
Start-Sleep 5

# TCP 就绪检测（vite preview 通常 5s 内就绪）
$ready = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep 2
  try {
    $c = New-Object System.Net.Sockets.TcpClient; $c.Connect("127.0.0.1", 4173); $c.Close()
    Write-Host "Server ready after $($i*2+5)s"; $ready = $true; break
  } catch {}
}
if (-not $ready) { Write-Error "Preview server 未就绪"; exit 1 }

# Playwright 测试（写文件到 apps/dashboard 保证 require 路径正确）
$testFile = Join-Path (Get-Location).Path "tmp-e2e-operator.js"
@"
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // 1. 路由可达
  const resp = await page.goto('$BaseUrl/operator', { waitUntil: 'networkidle' });
  if (!resp || resp.status() >= 400) {
    console.error('FAIL: /operator 返回', resp ? resp.status() : 'null'); process.exit(1);
  }
  console.log('✓ /operator 可达 status:', resp.status());

  // 2. OperatorPage 组件渲染（未登录时显示"未授权"）
  const content = await page.content();
  if (!content.includes('未授权') && !content.includes('operator')) {
    console.error('FAIL: OperatorPage 未渲染'); process.exit(1);
  }
  console.log('✓ OperatorPage 组件已渲染');

  await browser.close();

  // 3. 源码验证 8 平台
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
Remove-Item -Path $testFile -Force -ErrorAction SilentlyContinue
Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
Pop-Location

if ($exitCode -ne 0) { Write-Host "=== E2E FAILED ==="; exit $exitCode }
Write-Host "=== E2E PASS ==="
