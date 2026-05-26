# final-e2e 验证脚本 — Session 全平台健康管理 Dashboard E2E（windows-latest）
# 位置：sprints/zj-ops1-session-health/e2e-verify.ps1
param(
  [string]$DashboardPort = "5174"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# 1. 安装依赖
Set-Location "$PSScriptRoot\..\..\"
npm ci --prefer-offline 2>&1 | Select-Object -Last 5
npx playwright install chromium 2>&1 | Select-Object -Last 5

# 2. 构建并启动 Dashboard（后台）
$proc = Start-Process -FilePath "node" -ArgumentList "node_modules/.bin/vite", "--port", $DashboardPort -PassThru
Start-Sleep -Seconds 8
if ($proc.HasExited) { throw "FAIL: Dashboard 启动失败" }

# 3. 用 Playwright 模拟运营员访问 /operator
$output = npx playwright test `
  --config apps/dashboard/playwright.config.ts `
  --project chromium `
  --grep "operator" 2>&1
$exitCode = $LASTEXITCODE

# 4. 停止 Dashboard
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue

if ($exitCode -ne 0) {
  Write-Error "FAIL: /operator Playwright 测试失败 exit=$exitCode"
  exit 1
}

Write-Host "✅ windows_cloud E2E — /operator Dashboard 验证通过"
exit 0
