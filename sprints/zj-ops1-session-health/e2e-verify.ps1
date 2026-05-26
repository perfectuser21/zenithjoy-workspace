# e2e-verify.ps1 — Operator /operator 页面 E2E 验证
# 策略：build + 内联 Node.js SPA server（无需额外 npm 包，直接 node 启动）

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

# 内联 SPA HTTP server（纯 Node.js 内置，不依赖任何 npm 包）
$distPath = (Join-Path (Get-Location).Path "dist") -replace '\\', '\\\\'
$serverFile = Join-Path $env:TEMP "spa-server-$Port.js"
Set-Content -Path $serverFile -Encoding UTF8 -Value @"
const http = require('http'), fs = require('fs'), path = require('path');
const dist = '$distPath';
http.createServer((req, res) => {
  let f = path.join(dist, req.url.split('?')[0]);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, 'index.html');
  const mime = {'.html':'text/html','.js':'application/javascript','.css':'text/css',
    '.json':'application/json','.png':'image/png','.ico':'image/x-icon',
    '.woff2':'font/woff2','.svg':'image/svg+xml'};
  const ct = mime[path.extname(f)] || 'application/octet-stream';
  res.writeHead(200, {'Content-Type': ct});
  fs.createReadStream(f).pipe(res);
}).listen($Port, '127.0.0.1', () => console.log('SPA ready on $Port'));
"@

$server = Start-Process -FilePath "node" -ArgumentList $serverFile -PassThru
Write-Host "Server PID: $($server.Id)"

# 等端口就绪（最多 20 秒）
$ready = $false
for ($i = 0; $i -lt 10; $i++) {
  Start-Sleep 2
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $c.Connect("127.0.0.1", [int]$Port); $c.Close()
    Write-Host "Server ready after $($i*2)s"; $ready = $true; break
  } catch {}
}
if (-not $ready) {
  Stop-Process -Id $server.Id -Force -EA SilentlyContinue
  Remove-Item $serverFile -Force -EA SilentlyContinue
  Write-Error "SPA server 未就绪"; exit 1
}

# Playwright 测试（写到 apps/dashboard 保证 require 路径正确）
$base = "http://localhost:$Port"
$testFile = Join-Path (Get-Location).Path "tmp-e2e-operator.cjs"
Set-Content -Path $testFile -Encoding UTF8 -Value @"
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const resp = await page.goto('$base/operator', { waitUntil: 'networkidle' });
  if (!resp || resp.status() >= 400) {
    console.error('FAIL: /operator status', resp ? resp.status() : 'null'); process.exit(1);
  }
  console.log('ok /operator status:', resp.status());

  const content = await page.content();
  if (!content.includes('未授权') && !content.includes('operator') && !content.includes('Operator')) {
    console.error('FAIL: OperatorPage not rendered'); process.exit(1);
  }
  console.log('ok OperatorPage rendered');
  await browser.close();

  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join('src','pages','OperatorPage.tsx'), 'utf8');
  const platforms = ['抖音','快手','小红书','视频号','头条','微博','知乎','公众号'];
  const missing = platforms.filter(p => !src.includes(p));
  if (missing.length > 0) { console.error('FAIL: missing platforms:', missing.join(',')); process.exit(1); }
  console.log('ok 8 platforms in source');
  console.log('E2E PASS');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
"@

node $testFile
$exitCode = $LASTEXITCODE
Remove-Item $testFile,$serverFile -Force -EA SilentlyContinue
Stop-Process -Id $server.Id -Force -EA SilentlyContinue
Pop-Location

if ($exitCode -ne 0) { Write-Host "=== E2E FAILED ==="; exit $exitCode }
Write-Host "=== E2E PASS ==="
