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

Push-Location apps/dashboard

# 安装依赖
npm ci --prefer-offline 2>&1 | Select-Object -Last 5
npx playwright install chromium --with-deps 2>&1 | Select-Object -Last 3

# 启动 vite dev server（cmd.exe /c 避免 PowerShell 进程树问题）
$vite = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c","npx vite --port 5173" `
  -WorkingDirectory (Get-Location).Path -PassThru
Write-Host "Vite PID: $($vite.Id)"

# 等 vite 就绪（TCP 轮询，最多 5 分钟）
$ready = $false
for ($i = 0; $i -lt 150; $i++) {
  Start-Sleep 2
  try {
    $conn = New-Object System.Net.Sockets.TcpClient
    $conn.Connect("127.0.0.1", 5173)
    $conn.Close()
    Write-Host "Vite ready after $($i * 2)s"
    $ready = $true
    break
  } catch {}
}
if (-not $ready) {
  Write-Error "Vite 未在 300s 内就绪"; exit 1
}

# 把 JS 测试写成文件（避免 pipe 导致 require 路径丢失）
$testFile = Join-Path (Get-Location).Path "tmp-e2e-operator.js"
@"
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const resp = await page.goto('$BaseUrl/operator');
  if (!resp) { console.error('FAIL: /operator 无响应'); process.exit(1); }
  console.log('operator route status:', resp.status());

  const platforms = ['抖音','快手','小红书','视频号','头条','微博','知乎','公众号'];
  const content = await page.content();
  const missing = platforms.filter(p => !content.includes(p));
  if (missing.length > 0) {
    console.error('FAIL: 缺平台标签:', missing.join(', ')); process.exit(1);
  }
  console.log('✓ 8 平台标签全部存在');

  await browser.close();
  console.log('E2E PASS');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
"@ | Set-Content -Path $testFile -Encoding UTF8

node $testFile
$exitCode = $LASTEXITCODE
Remove-Item -Path $testFile -Force -ErrorAction SilentlyContinue

Stop-Process -Id $vite.Id -Force -ErrorAction SilentlyContinue
Pop-Location

if ($exitCode -ne 0) {
  Write-Host "=== E2E FAILED ==="
  exit $exitCode
}
Write-Host "=== E2E PASS ==="
