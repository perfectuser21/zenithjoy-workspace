# final-e2e — ZenithJoy 获客页采集 Dashboard E2E（windows-latest）
param([string]$BaseUrl = "http://localhost:5174")
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VitePort = 5174
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path "$scriptDir\.."  # sprints/ 的上一层 = repo 根
$repoRoot  = Resolve-Path "$repoRoot\.."

# 1. 依赖（显式 WorkingDirectory + cmd.cmd shim）
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd ci --prefer-offline" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: npm ci" }
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright install chromium --with-deps" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: playwright install" }

# 2. build dashboard
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd run build" -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: dashboard build" }

# 3. vite preview（固定端口，与 baseURL 一致）
$server = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" -WorkingDirectory "$repoRoot\apps\dashboard" -PassThru -NoNewWindow

# 4. 等就绪（Test-NetConnection 兼容 IPv4/IPv6）
$waited = 0
do { Start-Sleep -Seconds 1; $waited++; $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue } while (-not $conn.TcpTestSucceeded -and $waited -lt 30)
if (-not $conn.TcpTestSucceeded) { Stop-Process -Id $server.Id -Force -EA SilentlyContinue; throw "FAIL: Vite 30s 未就绪" }

# 5. Playwright（stub /api/acquisition/*）
$e2e = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright test e2e\acquisition-collect.spec.ts --reporter=list" -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow -Environment @{ E2E_BASE_URL = $BaseUrl }
Stop-Process -Id $server.Id -Force -EA SilentlyContinue
if ($e2e.ExitCode -ne 0) { throw "FAIL: Playwright 获客页 E2E exit=$($e2e.ExitCode)" }

# 6. 把截图归集进 sprint（evaluator 视觉自验）
New-Item -ItemType Directory -Force -Path "$scriptDir\screenshots" | Out-Null
Copy-Item "$repoRoot\apps\dashboard\e2e\screenshots\*.png" "$scriptDir\screenshots\" -EA SilentlyContinue
Write-Host "✅ windows_cloud 获客页 E2E 通过"
exit 0
