# 路③ Sprint B —— windows_cloud 行链 E2E：一次性重活（依赖 / 浏览器 / 构建 / migration）
#
# 拆成"准备"与"跑"两支的原因：三个真浏览器 step 各自 seed + 起服务 + 跑完就停
# （见 e2e-rows-run.ps1），谁都不依赖上一个 step 留下的后台进程 —— GitHub Actions 的
# step 之间进程能不能活下来是环境行为，不是合同承诺，押在它上面就是把 E2E 押在运气上。
# 重活（npm ci / playwright install / tsc / migration）只在这里做一次。
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path "$scriptDir\..\.."

if (-not $env:E2E_DATABASE_URL) { throw "FAIL: 未注入 E2E_DATABASE_URL，拒绝跑成假绿" }

. "$scriptDir\e2e-rows-lib.ps1"

Invoke-Checked "npm.cmd" "ci" $repoRoot "npm ci"
Invoke-Checked "npx.cmd" "playwright install chromium --with-deps" $repoRoot "playwright install"

Set-DbEnvFromUrl $env:E2E_DATABASE_URL
Invoke-Checked "npm.cmd" "run migrate" "$repoRoot\apps\api" "migration"
Invoke-Checked "npm.cmd" "run build" "$repoRoot\apps\api" "apps/api build"

Write-Host "路③ S2 行链 E2E 准备完成（依赖 / chromium / migration / apps-api 构建）"
exit 0
