# 路③ Sprint B —— windows_cloud 行链 E2E：一个 step 一次自持全跑
#
# 用法（workflow 里三个 step 各调一次）：
#   pwsh -File e2e-rows-run.ps1 -Grep "@rows-offline"
#   pwsh -File e2e-rows-run.ps1 -Grep "@rows-detail"
#   pwsh -File e2e-rows-run.ps1 -Grep "@rows-limit" -RowLimit 3
#
# 变体C 死规则：起真实 apps/api + 真 Postgres（禁 stub），spec 禁请求拦截/改写。
# 每次自己 seed、自己起、跑完自己停 —— 端口用完即还，三个 step 复用同一组端口不打架。
#
# -RowLimit：把 WORKBENCH_ROW_LIMIT 压到小值起服务，用来证明"上限闸真的在"。
# 真插 5000 行会把 windows job 的预算烧光（合同「未覆盖真实链路清单」已登记），
# 默认值 5000 由服务端纯逻辑单测与 --fixture-up 那条 DoD 另行钉死。
param(
  [Parameter(Mandatory = $true)][string]$Grep,
  [string]$Spec = "structured-workbench-rows.spec.ts",
  [int]$RowLimit = 0
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path "$scriptDir\..\.."
$ShotDir   = Join-Path $scriptDir "screenshots"
$ScriptStart = Get-Date

$ApiPort = if ($env:PATH3_ROWS_API_PORT) { [int]$env:PATH3_ROWS_API_PORT } else { 5210 }
$HubPort = if ($env:PATH3_ROWS_HUB_PORT) { [int]$env:PATH3_ROWS_HUB_PORT } else { 5177 }

if (-not $env:E2E_DATABASE_URL) { throw "FAIL: 未注入 E2E_DATABASE_URL，拒绝跑成假绿" }
New-Item -ItemType Directory -Force -Path $ShotDir | Out-Null

. "$scriptDir\e2e-rows-lib.ps1"

Set-DbEnvFromUrl $env:E2E_DATABASE_URL
$seed = New-TwoTenantSeed $ApiPort

if ($RowLimit -gt 0) {
  # 服务端每请求读这个 env，但进程是下面起的 —— 起完再改就进不到那个进程里了
  $env:WORKBENCH_ROW_LIMIT = "$RowLimit"
  Write-Host "以 WORKBENCH_ROW_LIMIT=$RowLimit 起 apps/api（上限闸证明用）"
} else {
  Remove-Item Env:\WORKBENCH_ROW_LIMIT -ErrorAction SilentlyContinue
}

$api = $null
$hub = $null
try {
  $api = Start-Api $repoRoot $ApiPort
  # 甲与乙是同组织的两个真身份：冲突那一段要两份真 cookie，不是同一个人自己跟自己抢
  $env:E2E_ROWS_COOKIE  = Get-SessionCookie $ApiPort $seed.Alice
  $env:E2E_ROWS_COOKIE2 = Get-SessionCookie $ApiPort $seed.Bob
  $hub = Start-Hub $repoRoot $HubPort $ApiPort
  $env:E2E_BASE_URL = "http://localhost:$HubPort"

  # 只传文件名：Playwright 的位置参数是**正则**，Windows 的 `e2e\xxx.spec.ts` 里的反斜杠
  # 会被当成转义符，于是 "No tests found"（testDir 已经是 ./e2e，不需要再给目录）
  Invoke-Checked "npx.cmd" "playwright test $Spec --grep $Grep --reporter=list" `
    "$repoRoot\apps\staff-hub" "staff-hub 路③ S2 行链 E2E ($Spec / $Grep)"
} finally {
  Stop-Procs @($api, $hub)
}

# 防历史产物冒充：本轮产出的截图必须晚于脚本启动
$shots = Get-ChildItem "$ShotDir\*.png" -ErrorAction SilentlyContinue
if ($null -eq $shots -or $shots.Count -lt 1) { throw "FAIL: $Grep 这一段没有产出任何截图" }
$fresh = @($shots | Where-Object { $_.LastWriteTime -ge $ScriptStart.AddMinutes(-1) })
if ($fresh.Count -lt 1) { throw "FAIL: $ShotDir 下全是历史遗留产物，本轮一张新图都没有" }

Write-Host "windows_cloud 路③ S2 行链 E2E 通过（$Grep，本轮新截图 $($fresh.Count) 张）"
exit 0
