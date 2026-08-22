# 路③ Sprint C —— windows_cloud 视图链 E2E：一个 step 一次自持全跑
#
# 用法（workflow 里两个 step 各调一次）：
#   pwsh -File e2e-views-run.ps1 -Grep "@views-kanban"
#   pwsh -File e2e-views-run.ps1 -Grep "@views-prefs"
#
# 变体C 死规则：起真实 apps/api + 真 Postgres（禁 stub），spec 禁请求拦截/改写。
# 每次自己 seed、自己起、跑完自己停。重活（npm ci / playwright / build / migration）由同一 windows job
# 里先前的 Sprint B prepare step 做过一次，本脚本不重复（Windows 二次 npm ci 会撞 EPERM）。
#
# 复用 Sprint B 的 e2e-rows-lib.ps1：Set-DbEnvFromUrl / New-TwoTenantSeed / Start-Api /
# Get-SessionCookie / Start-Hub / Stop-Procs 全部同源，避免种子/起服务行为分叉。
param(
  [Parameter(Mandatory = $true)][string]$Grep,
  [string]$Spec = "structured-workbench-views.spec.ts"
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path "$scriptDir\..\.."
$ShotDir   = Join-Path $scriptDir "screenshots"
$ScriptStart = Get-Date

$ApiPort = if ($env:PATH3_VIEWS_API_PORT) { [int]$env:PATH3_VIEWS_API_PORT } else { 5220 }
$HubPort = if ($env:PATH3_VIEWS_HUB_PORT) { [int]$env:PATH3_VIEWS_HUB_PORT } else { 5178 }

if (-not $env:E2E_DATABASE_URL) { throw "FAIL: 未注入 E2E_DATABASE_URL，拒绝跑成假绿" }
New-Item -ItemType Directory -Force -Path $ShotDir | Out-Null

. "$repoRoot\sprints\08201850-workbench-sprintB-rows\e2e-rows-lib.ps1"

Set-DbEnvFromUrl $env:E2E_DATABASE_URL
$seed = New-TwoTenantSeed $ApiPort

$api = $null
$hub = $null
try {
  $api = Start-Api $repoRoot $ApiPort
  # 甲与乙是同组织的两个真身份：409 冲突那一段要两份真 cookie，不是同一个人跟自己抢
  $env:E2E_VIEWS_COOKIE  = Get-SessionCookie $ApiPort $seed.Alice
  $env:E2E_VIEWS_COOKIE2 = Get-SessionCookie $ApiPort $seed.Bob
  $hub = Start-Hub $repoRoot $HubPort $ApiPort
  $env:E2E_BASE_URL = "http://localhost:$HubPort"

  # 只传文件名：Playwright 位置参数是正则，Windows 反斜杠会被当转义（testDir 已是 ./e2e）
  Invoke-Checked "npx.cmd" "playwright test $Spec --grep $Grep --reporter=list" `
    "$repoRoot\apps\staff-hub" "staff-hub 路③ S3 视图链 E2E ($Spec / $Grep)"
} finally {
  Stop-Procs @($api, $hub)
}

# 防历史产物冒充：本轮产出的截图必须晚于脚本启动
$shots = Get-ChildItem "$ShotDir\*.png" -ErrorAction SilentlyContinue
if ($null -eq $shots -or $shots.Count -lt 1) { throw "FAIL: $Grep 这一段没有产出任何截图" }
$fresh = @($shots | Where-Object { $_.LastWriteTime -ge $ScriptStart.AddMinutes(-1) })
if ($fresh.Count -lt 1) { throw "FAIL: $ShotDir 下全是历史遗留产物，本轮一张新图都没有" }

Write-Host "windows_cloud 路③ S3 视图链 E2E 通过（$Grep，本轮新截图 $($fresh.Count) 张）"
exit 0
