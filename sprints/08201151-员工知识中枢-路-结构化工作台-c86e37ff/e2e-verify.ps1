# 路③ Sprint A —— windows_cloud 真浏览器 E2E 载体
#
# 变体C 死规则：起真实 apps/api（禁 stub），Playwright spec 禁请求拦截/改写，
# 全部请求打真后端 + 真 Postgres。
#
# 两条 spec：
#   1. apps/staff-hub/e2e/structured-workbench.spec.ts  路③ Golden Path 全链（五张截图）
#   2. apps/dashboard/e2e/fields-auth-regression.spec.ts A4④ 给 /api/fields 挂鉴权后 dashboard 不变
#
# 会话怎么来：本脚本先种双企业 + 员工目录，再调真 /api/staff/feishu-login 拿真 cookie 注给 spec。
# 不这么做的话 spec 只会拿到一片 401，看着像"实现没写"，实际是没人给它身份。
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# apps/api 起在 5200 而不是 3000：dashboard 的 vite proxy 把 /api/fields 硬编码指向 5200，
# 起在别的端口它就代理到一个没人监听的地方，A4④ 回归会红在"连不上"而不是业务上。
$ApiPort   = if ($env:PATH3_API_PORT)  { [int]$env:PATH3_API_PORT }  else { 5200 }
$HubPort   = if ($env:PATH3_HUB_PORT)  { [int]$env:PATH3_HUB_PORT }  else { 5175 }
$DashPort  = if ($env:PATH3_DASH_PORT) { [int]$env:PATH3_DASH_PORT } else { 5174 }
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path "$scriptDir\..\.."
$ScriptStart = Get-Date
$ShotDir   = Join-Path $scriptDir "screenshots"

if (-not $env:E2E_DATABASE_URL) { throw "FAIL: 未注入 E2E_DATABASE_URL，拒绝跑成假绿" }
New-Item -ItemType Directory -Force -Path $ShotDir | Out-Null

function Invoke-Checked($file, $argline, $cwd, $what) {
  $p = Start-Process cmd.exe -ArgumentList "/c $file $argline" -WorkingDirectory $cwd -Wait -PassThru -NoNewWindow
  if ($p.ExitCode -ne 0) { throw "FAIL: $what (exit=$($p.ExitCode))" }
}

# 1. 依赖 + 浏览器
Invoke-Checked "npm.cmd" "ci" $repoRoot "npm ci"
Invoke-Checked "npx.cmd" "playwright install chromium --with-deps" $repoRoot "playwright install"

# 2. 库连接：migration runner 认 DATABASE_URL，但 **apps/api 进程只认离散 DATABASE_* 五个变量**
#    （不读 DATABASE_URL）。只设连接串的话进程会拿内置默认值去连，报
#    "password authentication failed for user postgres" —— 看着像库没起来，其实是没告诉它去哪连。
#    从同一个连接串解析，零写死。
$env:DATABASE_URL = $env:E2E_DATABASE_URL
$dbUri = [uri]$env:E2E_DATABASE_URL
$dbUserInfo = $dbUri.UserInfo -split ':'
$env:DATABASE_HOST     = $dbUri.Host
$env:DATABASE_PORT     = if ($dbUri.Port -gt 0) { "$($dbUri.Port)" } else { "5432" }
$env:DATABASE_NAME     = $dbUri.AbsolutePath.TrimStart('/')
$env:DATABASE_USER     = [uri]::UnescapeDataString($dbUserInfo[0])
$env:DATABASE_PASSWORD = if ($dbUserInfo.Count -gt 1) { [uri]::UnescapeDataString($dbUserInfo[1]) } else { "" }
$env:PGPASSWORD        = $env:DATABASE_PASSWORD
Write-Host "DB: $($env:DATABASE_USER)@$($env:DATABASE_HOST):$($env:DATABASE_PORT)/$($env:DATABASE_NAME)"

# migration（真 PG，禁 mock）
Invoke-Checked "npm.cmd" "run migrate" "$repoRoot\apps\api" "migration"

# 3. 种双企业 + 员工目录 —— 三个身份：甲乙同属 A 企业，丙在 B 企业
$sfx    = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString() + (Get-Random -Maximum 9999)
$alice  = "ou_wb_alice_$sfx"
$bob    = "ou_wb_bob_$sfx"
$carol  = "ou_wb_carol_$sfx"
$psqlQ  = {
  param($sql)
  $out = & psql $env:E2E_DATABASE_URL -t -A -q -c $sql
  if ($LASTEXITCODE -ne 0) { throw "FAIL: psql 执行失败: $sql" }
  return ($out | Select-Object -First 1).Trim()
}
$orgA = & $psqlQ "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('WB-E2E-A-$sfx', 'wb-e2e-lk-a-$sfx', 'free') RETURNING id"
$orgB = & $psqlQ "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('WB-E2E-B-$sfx', 'wb-e2e-lk-b-$sfx', 'free') RETURNING id"
if (-not $orgA -or -not $orgB) { throw "FAIL: 两家企业种子未建成" }

# A30-1a：扁平白名单必须恰好等于主企业那一组（丙只出现在 ORGB 分组里）
$env:STAFF_FEISHU_OPENIDS       = "$alice,$bob"
$env:STAFF_FEISHU_OPENIDS__ORGA = "$alice,$bob"
$env:STAFF_FEISHU_OPENIDS__ORGB = "$carol"
$env:STAFF_ORG_MAP              = "ORGA:$orgA,ORGB:$orgB"
$env:FEISHU_API_BASE            = "http://localhost:$ApiPort/api/_smoke/fake-feishu"
$env:FEISHU_APP_ID              = "wb-e2e-app-id"
$env:FEISHU_APP_SECRET          = "wb-e2e-app-secret"
if (-not $env:BETTER_AUTH_SECRET) { $env:BETTER_AUTH_SECRET = "wb-e2e-secret-not-for-prod-32-characters" }
$env:NODE_ENV = "development"

# 4. 起真实 apps/api（禁 stub）
Invoke-Checked "npm.cmd" "run build" "$repoRoot\apps\api" "apps/api build"
$env:PORT = "$ApiPort"
$api = Start-Process cmd.exe -ArgumentList "/c npm.cmd start" -WorkingDirectory "$repoRoot\apps\api" -PassThru -NoNewWindow
$waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $c = Test-NetConnection -ComputerName localhost -Port $ApiPort -WarningAction SilentlyContinue
} while (-not $c.TcpTestSucceeded -and $waited -lt 60)
if (-not $c.TcpTestSucceeded) {
  throw "FAIL: apps/api 未在 60s 内就绪（A11 单组织自检可能把它拦在 listen 之前，看日志）"
}

# 5. 真登录拿真会话 cookie（走真 /api/staff/feishu-login，上游是本地假飞书——
#    这是端点重定向不是代码分支，被测的会话签发路径一行没变）
function Get-SessionCookie($openId) {
  $body = @{ code = "wb-code-$openId" } | ConvertTo-Json -Compress
  $res = Invoke-WebRequest -Uri "http://localhost:$ApiPort/api/staff/feishu-login" `
         -Method Post -ContentType "application/json" -Body $body -SessionVariable sv -UseBasicParsing
  if ($res.StatusCode -ne 200) { throw "FAIL: 会话签发失败 open_id=$openId status=$($res.StatusCode)" }
  $sc = $res.Headers['Set-Cookie']
  if (-not $sc) { throw "FAIL: 登录未返回 Set-Cookie open_id=$openId" }
  $pairs = @($sc) | ForEach-Object { ($_ -split ';')[0] }
  return ($pairs -join '; ')
}
$env:E2E_WORKBENCH_COOKIE  = Get-SessionCookie $alice
$env:E2E_FIELDS_MEMBER_ID  = $alice

# 6. 起前端：staff-hub（路③ 页面）+ dashboard（A4④ 回归对照）
$env:VITE_SKIP_AUTH = "true"
# staff-hub 走 vite proxy 打后端 —— 必须**同源**，否则会话 cookie 根本发不出去，
# 路③ 的闸只认 cookie，跨域直连一定是一片 401。
$env:STAFF_HUB_API_TARGET = "http://localhost:$ApiPort"
# dashboard 的 proxy 是硬编码的（本刀不碰 dashboard 配置），让它的 axios 直连 apps/api。
# 它携带身份靠的是请求头而不是 cookie，跨源没有影响；apps/api 的 CORS 已放行 credentials。
$env:VITE_API_BASE_URL = "http://localhost:$ApiPort/api"
$hub  = Start-Process cmd.exe -ArgumentList "/c npx.cmd vite --port $HubPort --strictPort" -WorkingDirectory "$repoRoot\apps\staff-hub" -PassThru -NoNewWindow
$dash = Start-Process cmd.exe -ArgumentList "/c npx.cmd vite --port $DashPort --strictPort" -WorkingDirectory "$repoRoot\apps\dashboard" -PassThru -NoNewWindow
foreach ($port in @($HubPort, $DashPort)) {
  $w = 0
  do {
    Start-Sleep -Seconds 1; $w++
    $cc = Test-NetConnection -ComputerName localhost -Port $port -WarningAction SilentlyContinue
  } while (-not $cc.TcpTestSucceeded -and $w -lt 90)
  if (-not $cc.TcpTestSucceeded) { throw "FAIL: 前端端口 $port 未在 90s 内就绪" }
}

$stopAll = {
  foreach ($p in @($api, $hub, $dash)) {
    if ($null -ne $p) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  }
}

try {
  # 7. staff-hub 路③ 真浏览器全链（建表→8类字段→列表→删表→回收站还原）
  $env:E2E_BASE_URL = "http://localhost:$HubPort"
  # 只传文件名：Playwright 的位置参数是**正则**，Windows 的 `e2e\xxx.spec.ts` 里的反斜杠
  # 会被当成转义符，于是 "No tests found"（testDir 已经是 ./e2e，不需要再给目录）
  Invoke-Checked "npx.cmd" "playwright test structured-workbench.spec.ts --reporter=list" `
    "$repoRoot\apps\staff-hub" "staff-hub 路③ E2E"

  # 8. A4④ dashboard 回归对照（挂鉴权后 dashboard 功能必须不变）
  $env:E2E_BASE_URL = "http://localhost:$DashPort"
  $env:BASE_URL = "http://localhost:$DashPort"
  Invoke-Checked "npx.cmd" "playwright test fields-auth-regression.spec.ts --reporter=list" `
    "$repoRoot\apps\dashboard" "A4④ dashboard 回归（重演 PR#1675 的形状）"
} finally {
  & $stopAll
}

# 9. 防历史产物冒充：本轮截图必须晚于脚本启动
$shots = Get-ChildItem "$ShotDir\*.png" -ErrorAction SilentlyContinue
if ($null -eq $shots -or $shots.Count -lt 5) {
  throw "FAIL: 截图不足 5 张（got=$(if ($null -eq $shots) { 0 } else { $shots.Count })）"
}
foreach ($s in $shots) {
  if ($s.LastWriteTime -lt $ScriptStart.AddMinutes(-1)) { throw "FAIL: $($s.Name) 是历史遗留产物" }
}

Write-Host "windows_cloud 路③ Sprint A E2E 通过（五张截图 + dashboard 回归）"
exit 0
