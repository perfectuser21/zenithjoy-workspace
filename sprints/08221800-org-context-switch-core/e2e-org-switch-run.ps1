# 多组织切换第一刀 —— windows_cloud 组织切换链 E2E：一个 step 一次自持全跑
#
# 用法（workflow 里一个 step 调一次，标签 ASCII 防 Windows grep 解码歪成 "No tests found"）：
#   pwsh -File e2e-org-switch-run.ps1 -Grep "@org-"
#
# 变体C 死规则：起真实 apps/api + 真 Postgres（禁 stub），spec 禁 page.route()/请求拦截/改写。
# **不走 VITE_SKIP_AUTH**：本刀要验的正是 AuthContext 会话恢复 → 拉归属企业 → 切换器渲染真链路。
# 复用 Sprint B 的 e2e-rows-lib.ps1（Set-DbEnvFromUrl / New-TwoTenantSeed / Invoke-Psql / Start-Api /
# Get-SessionCookie / Clear-Port / Wait-Port / Stop-Procs），并在双租户种子上加一个跨两企业成员 dave。
param(
  [Parameter(Mandatory = $true)][string]$Grep,
  [string]$Spec = "org-context-switch.spec.ts"
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path "$scriptDir\..\.."
$ShotDir   = Join-Path $scriptDir "screenshots"
$ScriptStart = Get-Date

$ApiPort = if ($env:ORG_SWITCH_API_PORT) { [int]$env:ORG_SWITCH_API_PORT } else { 5231 }
$HubPort = if ($env:ORG_SWITCH_HUB_PORT) { [int]$env:ORG_SWITCH_HUB_PORT } else { 5188 }

if (-not $env:E2E_DATABASE_URL) { throw "FAIL: 未注入 E2E_DATABASE_URL，拒绝跑成假绿" }
New-Item -ItemType Directory -Force -Path $ShotDir | Out-Null

. "$repoRoot\sprints\08201850-workbench-sprintB-rows\e2e-rows-lib.ps1"

Set-DbEnvFromUrl $env:E2E_DATABASE_URL
$seed = New-TwoTenantSeed $ApiPort

# 在双租户种子上加「跨两企业成员 dave」：声明在 ORGA 分组（登录据此不 403），
# ORGB 行由 admin/手动直插供给；登录前就 ≥2 家 → 登录后 active_org=null 要求先选。
$dave = "ou_wb_dave_$($seed.Sfx)"
$env:STAFF_FEISHU_OPENIDS       = "$($seed.Alice),$($seed.Bob),$dave"
$env:STAFF_FEISHU_OPENIDS__ORGA = "$($seed.Alice),$($seed.Bob),$dave"
# 末尾接 SELECT 'seeded' 保证 psql 有输出：Invoke-Psql 末尾 (…|Select -First 1).Trim() 对空输出会
# 抛 "call method on null-valued expression"（ON CONFLICT DO NOTHING 无 RETURNING 时 psql 零输出）。
Invoke-Psql "INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role) VALUES ('$($seed.OrgA)', '$dave', 'member'), ('$($seed.OrgB)', '$dave', 'member') ON CONFLICT DO NOTHING; SELECT 'seeded'" | Out-Null

# 真登录拿真会话 cookie（走真 /api/staff/feishu-login，上游是本地假飞书 —— 端点重定向不是代码分支）。
# 起真 hub（真 auth）—— 不复用 lib 的 Start-Hub（它设 VITE_SKIP_AUTH=true 会把 org 切换器顶成单企业 mock）。
function Start-HubRealAuth($repoRoot, $hubPort, $apiPort) {
  Clear-Port $hubPort
  Remove-Item Env:\VITE_SKIP_AUTH -ErrorAction SilentlyContinue
  $env:STAFF_HUB_API_TARGET = "http://localhost:$apiPort"
  $p = Start-Process cmd.exe -ArgumentList "/c npx.cmd vite --port $hubPort --strictPort" `
       -WorkingDirectory "$repoRoot\apps\staff-hub" -PassThru -NoNewWindow
  if (-not (Wait-Port $hubPort 90)) { throw "FAIL: staff-hub 未在 90s 内就绪（端口 $hubPort）" }
  return $p
}

$api = $null
$hub = $null
try {
  $api = Start-Api $repoRoot $ApiPort
  $env:E2E_ORG_DAVE_COOKIE  = Get-SessionCookie $ApiPort $dave
  $env:E2E_ORG_ALICE_COOKIE = Get-SessionCookie $ApiPort $seed.Alice
  $hub = Start-HubRealAuth $repoRoot $HubPort $ApiPort
  $env:E2E_BASE_URL = "http://localhost:$HubPort"

  Invoke-Checked "npx.cmd" "playwright test $Spec --grep $Grep --reporter=list" `
    "$repoRoot\apps\staff-hub" "staff-hub 多组织切换链 E2E ($Spec / $Grep)"
} finally {
  Stop-Procs @($api, $hub)
}

# 防历史产物冒充：本轮产出的截图必须晚于脚本启动
$shots = @(Get-ChildItem "$ShotDir\*.png" -ErrorAction SilentlyContinue)
if ($shots.Count -lt 1) { throw "FAIL: $Grep 这一段没有产出任何截图" }
$fresh = @($shots | Where-Object { $_.LastWriteTime -ge $ScriptStart.AddMinutes(-1) })
if ($fresh.Count -lt 3) { throw "FAIL: $ShotDir 本轮新截图不足 3 张（org 切换链应产 01-04 四张）" }

Write-Host "windows_cloud 多组织切换链 E2E 通过（$Grep，本轮新截图 $($fresh.Count) 张）"
exit 0
