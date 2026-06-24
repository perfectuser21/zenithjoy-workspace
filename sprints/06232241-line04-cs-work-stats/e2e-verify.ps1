# final-e2e — 客服工作汇总页（windows_cloud 变体 C：Vite + Playwright，windows-latest）
# 接缝 2：真实 Chromium 渲染 dashboard 卡片 + 今天/昨天切换。
#
# ⚠️ [CI_GAP: .github/workflows/e2e-windows.yml 缺 postgres + migration + apps/api 启动]
#   现 e2e-windows.yml 仅 checkout + setup-node + ffmpeg + 跑本脚本，未提供数据后端。
#   generator 必须二选一补齐（见 contract-draft.md ## E2E 验收）：
#     (a) workflow 加 postgres service + `npm run migrate` + 起 apps/api(:3000)，本脚本下方 seed；
#     (b) Playwright page.route 注入确定性 fixture（仅 UI 渲染/切换，不替代 mode-A 真 DB 口径验证）。
#   未补齐前 UI 数据驱动断言标 logic-done-pending。

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VitePort = 5174
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptDir\..\.."

# 0. 记录脚本启动时间（产物时间戳防造假基线）
$ScriptStart = Get-Date

# 1. 安装依赖（必须指定 WorkingDirectory + .cmd shim）
Write-Host "▶ npm ci..."
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: npm ci exit=$($p.ExitCode)" }

# 2. Playwright 浏览器
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: playwright install exit=$($p.ExitCode)" }

# 2b. [CI_GAP] 数据后端 —— generator 在此补 (a) postgres+migrate+apps/api 启动 + seed，
#     或在 spec 内用 page.route 注入 fixture(方案 b)。占位提示，未补齐时 UI 断言 logic-done-pending。
Write-Host "▶ [CI_GAP] 若走方案(a)：此处应 npm run migrate + 起 apps/api(:3000) + seed 一张含 today/yesterday 不同 received 的客服卡数据"

# 3. Build dashboard
Write-Host "▶ build dashboard..."
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd run build" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: build exit=$($p.ExitCode)" }

# 4. Vite preview
Write-Host "▶ vite preview :$VitePort..."
$server = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -PassThru -NoNewWindow

# 5. 等服务就绪（Test-NetConnection 兼容 IPv4/IPv6）
$maxWait = 30; $waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
if (-not $conn.TcpTestSucceeded) { throw "FAIL: Vite 未在 ${maxWait}s 就绪" }
Write-Host "✅ Vite 就绪 :$VitePort"

# 6. Playwright E2E（apps/dashboard/e2e/cs-work-stats.spec.ts）
$e2e = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright test e2e\cs-work-stats.spec.ts --reporter=list" `
  -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow `
  -Environment @{ BASE_URL = "http://localhost:$VitePort" }

Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
if ($e2e.ExitCode -ne 0) { throw "FAIL: Playwright exit=$($e2e.ExitCode)" }

# 7. 截图产物时间戳防造假（必须本轮新生成）
$shots = Get-ChildItem "$repoRoot\apps\dashboard\screenshots\*.png" -ErrorAction SilentlyContinue
foreach ($s in $shots) {
  if ($s.LastWriteTime -lt $ScriptStart.AddMinutes(-1)) {
    throw "FAIL: 截图 $($s.Name) LastWriteTime=$($s.LastWriteTime) 早于脚本启动 — 疑似历史产物"
  }
}
# 复制截图到 sprint 目录供 Claude 视觉自验
New-Item -ItemType Directory -Force -Path "$scriptDir\screenshots" | Out-Null
Copy-Item "$repoRoot\apps\dashboard\screenshots\*.png" "$scriptDir\screenshots\" -ErrorAction SilentlyContinue

Write-Host "✅ windows_cloud 客服工作汇总 E2E 验证通过"
exit 0
