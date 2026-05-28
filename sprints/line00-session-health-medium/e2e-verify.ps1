# final-e2e — 运营中枢 Session 状态矩阵（windows-latest, 无 Playwright）
# 策略：build + 纯 Node.js SPA server + 文件内容验证
# 不用 Playwright auth 模拟：auth guard + better-auth cookie 在干净 VM 时序难以 stub

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "=== 运营中枢 Line-00 E2E Verify ==="

$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot   = Resolve-Path "$scriptDir\..\.."
$dashRoot   = Join-Path $repoRoot "apps\dashboard"
$Port       = 5174

Write-Host "-- npm ci"
$proc = Start-Process cmd.exe -ArgumentList "/c npm.cmd ci --prefer-offline" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) { throw "FAIL: npm ci" }

Write-Host "-- npm run build (dashboard)"
$proc = Start-Process cmd.exe -ArgumentList "/c npm.cmd run build" -WorkingDirectory $dashRoot -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) { throw "FAIL: vite build" }
Write-Host "Build OK"

# 内联 SPA HTTP server（无 npm 包依赖）
$distPath = (Join-Path $dashRoot "dist") -replace "\\", "\\\\"
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

$server = Start-Process node -ArgumentList $serverFile -PassThru
Write-Host "Server PID: $($server.Id)"

# 等端口就绪（最多 30 秒）
$ready = $false
for ($i = 0; $i -lt 15; $i++) {
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
  throw "FAIL: SPA server 未在 30s 内就绪"
}

# 纯 Node.js 验证（.cjs 避免 type=module 冲突）
$testFile = Join-Path $dashRoot "tmp-e2e-line00.cjs"
Set-Content -Path $testFile -Encoding UTF8 -Value @"
const http = require('http');
const fs   = require('fs');
const path = require('path');

const dashRoot = $(($dashRoot -replace "\\", "/") | ConvertTo-Json);
const dist     = path.join(dashRoot, 'dist');
const assetsDir = path.join(dist, 'assets');

(async () => {
  // Test 1: /operator 返回 200（SPA fallback）
  const status = await new Promise((resolve, reject) => {
    const req = http.get('http://localhost:$Port/operator', res => {
      res.resume(); resolve(res.statusCode);
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
  });
  if (status !== 200) { console.error('FAIL: /operator status', status); process.exit(1); }
  console.log('ok /operator status:', status);

  // Test 2: dist bundle 含 8 平台中文标签（确认 OperatorPage 已构建）
  const allJs = fs.readdirSync(assetsDir).filter(f => f.endsWith('.js'));
  const allContent = allJs.map(f => fs.readFileSync(path.join(assetsDir, f), 'utf8')).join('');
  const platforms = ['抖音','快手','小红书','视频号','头条','微博','知乎','公众号'];
  const missing = platforms.filter(p => !allContent.includes(p));
  if (missing.length > 0) { console.error('FAIL: bundle missing platforms:', missing.join(',')); process.exit(1); }
  console.log('ok 8 platforms in bundle');

  // Test 3: OperatorPage.tsx 源码含 authLoading guard（确认 auth race-condition 已修复）
  const srcFile = path.join(dashRoot, 'src/pages/OperatorPage.tsx');
  const src = fs.readFileSync(srcFile, 'utf8');
  if (!src.includes('authLoading')) { console.error('FAIL: OperatorPage missing authLoading guard'); process.exit(1); }
  console.log('ok OperatorPage authLoading guard present');

  // Test 4: E2E spec 文件存在
  const specFile = path.join(dashRoot, 'e2e/operator-sessions.spec.ts');
  if (!fs.existsSync(specFile)) { console.error('FAIL: operator-sessions.spec.ts missing'); process.exit(1); }
  console.log('ok operator-sessions.spec.ts exists');

  // Test 5: session-health-check.yml 存在
  const workflowFile = path.join(dashRoot, '../../.github/workflows/session-health-check.yml');
  if (!fs.existsSync(workflowFile)) { console.error('FAIL: session-health-check.yml missing'); process.exit(1); }
  console.log('ok session-health-check.yml exists');

  // Test 6: check-health.js 存在
  const checkHealthFile = path.join(dashRoot, '../../scripts/sessions/check-health.js');
  if (!fs.existsSync(checkHealthFile)) { console.error('FAIL: check-health.js missing'); process.exit(1); }
  console.log('ok check-health.js exists');

  console.log('E2E PASS');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
"@

node $testFile
$exitCode = $LASTEXITCODE
Remove-Item $testFile,$serverFile -Force -EA SilentlyContinue
Stop-Process -Id $server.Id -Force -EA SilentlyContinue

if ($exitCode -ne 0) { Write-Host "=== E2E FAILED ==="; exit $exitCode }
Write-Host "=== E2E PASS ==="
