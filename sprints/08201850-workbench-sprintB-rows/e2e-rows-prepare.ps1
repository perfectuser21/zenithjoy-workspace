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

# **不能无条件 npm ci**：本 step 与 A 刀那个 `e2e-verify.ps1` 同在一个 windows job 里，
# 那边已经装过一次。Windows 上第二次 `npm ci` 会先清空 node_modules，而
# `@rollup/rollup-win32-x64-msvc/rollup.win32-x64-msvc.node` 正被前面加载过它的进程锁着，
# unlink 直接 EPERM(-4048) —— 报出来是"npm ci 失败"，其实是同一 job 里装了两遍
# （2026-08-20 本刀首跑实测）。已装就跳过，没装（本 job 单独跑）才装。
if (Test-Path "$repoRoot\node_modules\.package-lock.json") {
  Write-Host "node_modules 已就位（同 job 内先前的 step 已装），跳过 npm ci —— 二次 npm ci 在 Windows 上必撞 EPERM"
} else {
  Invoke-Checked "npm.cmd" "ci" $repoRoot "npm ci"
}
# playwright install 自带"已装则跳过"，重复调用是幂等的，不像 npm ci 那样先删后装
Invoke-Checked "npx.cmd" "playwright install chromium --with-deps" $repoRoot "playwright install"

Set-DbEnvFromUrl $env:E2E_DATABASE_URL
Invoke-Checked "npm.cmd" "run migrate" "$repoRoot\apps\api" "migration"
Invoke-Checked "npm.cmd" "run build" "$repoRoot\apps\api" "apps/api build"

Write-Host "路③ S2 行链 E2E 准备完成（依赖 / chromium / migration / apps-api 构建）"
exit 0
