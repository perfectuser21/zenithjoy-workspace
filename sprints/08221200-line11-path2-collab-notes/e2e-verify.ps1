# 路② 协同笔记 —— windows_cloud 真浏览器 E2E 载体（变体C 死规则：起真 apps/api + 真 collab-ws + 真 staff-hub，禁 stub/page.route）
#
# 双 browser context 模拟甲乙两人同编同一文档，四组硬 DOM 断言：
#   ① 字符级合并双方改动均在（非 409）② 对方光标可见 ③ 断连 resync 零丢字 α/β ④ 设「仅自己」后第三 context 404
#
# 会话怎么来：spec 在各自 context 内调真 /api/staff/feishu-login（同源经 vite 反代到 apps/api），
# cookie 自然落 jar，随后导航即已鉴权。本脚本只负责：种双企业 + 员工目录、起真后端、起 staff-hub、跑 spec。
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ApiPort   = if ($env:PATH2_API_PORT) { [int]$env:PATH2_API_PORT } else { 3000 }
$HubPort   = if ($env:PATH2_HUB_PORT) { [int]$env:PATH2_HUB_PORT } else { 5174 }
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

# 2. 库连接：apps/api 只认离散 DATABASE_* 五变量（不读 DATABASE_URL），从连接串推导，零写死
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

Invoke-Checked "npm.cmd" "run migrate" "$repoRoot\apps\api" "migration（建 documents / document_members）"

# 测试库前置：better-auth 会话表对齐 zenithjoy schema（本刀 sessionAlive/合同 killSession 都查
# zenithjoy.session，生产/本地即在此）+ 路① learnings 账本（不在本仓 migrations）。清库 windows runner 必需。
& psql $env:E2E_DATABASE_URL -v ON_ERROR_STOP=0 -q -c 'ALTER TABLE IF EXISTS public.session SET SCHEMA zenithjoy;' 2>$null
& psql $env:E2E_DATABASE_URL -v ON_ERROR_STOP=0 -q -c 'ALTER TABLE IF EXISTS public."user" SET SCHEMA zenithjoy;' 2>$null
$learnings = (& psql $env:E2E_DATABASE_URL -t -A -q -c "SELECT to_regclass('public.learnings')")
if (-not $learnings) {
  & psql $env:E2E_DATABASE_URL -q -f "$repoRoot\sprints\08192114-员工知识中枢-路-经验沉淀与问答-ade79e4e\fixtures\learnings-ledger.sql" 2>$null
}
Write-Host "测试库前置完成（zenithjoy.session 对齐 + learnings 账本）"

# 3. 种双企业 + 员工目录：甲乙同属 A 企业，丙在 B 企业
$sfx   = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString() + (Get-Random -Maximum 9999)
$alice = "ou_wb_alice_$sfx"
$bob   = "ou_wb_bob_$sfx"
$carol = "ou_wb_carol_$sfx"
$psqlQ = {
  param($sql)
  $out = & psql $env:E2E_DATABASE_URL -t -A -q -c $sql
  if ($LASTEXITCODE -ne 0) { throw "FAIL: psql 执行失败: $sql" }
  return ($out | Select-Object -First 1).Trim()
}
$orgA = & $psqlQ "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('P2-E2E-A-$sfx', 'p2-e2e-lk-a-$sfx', 'free') RETURNING id"
$orgB = & $psqlQ "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('P2-E2E-B-$sfx', 'p2-e2e-lk-b-$sfx', 'free') RETURNING id"
if (-not $orgA -or -not $orgB) { throw "FAIL: 两家企业种子未建成" }

$env:STAFF_FEISHU_OPENIDS       = "$alice,$bob"
$env:STAFF_FEISHU_OPENIDS__ORGA = "$alice,$bob"
$env:STAFF_FEISHU_OPENIDS__ORGB = "$carol"
$env:STAFF_ORG_MAP              = "ORGA:$orgA,ORGB:$orgB"
$env:FEISHU_API_BASE            = "http://localhost:$ApiPort/api/_smoke/fake-feishu"
$env:FEISHU_APP_ID              = "p2-e2e-app-id"
$env:FEISHU_APP_SECRET          = "p2-e2e-app-secret"
if (-not $env:BETTER_AUTH_SECRET) { $env:BETTER_AUTH_SECRET = "p2-e2e-secret-not-for-prod-32-characters" }
$env:NODE_ENV = "development"

# 4. 起真实 apps/api（含 attachCollabWS 的 http server）
Invoke-Checked "npm.cmd" "run build" "$repoRoot\apps\api" "apps/api build"
$env:PORT = "$ApiPort"
$api = Start-Process cmd.exe -ArgumentList "/c npm.cmd start" -WorkingDirectory "$repoRoot\apps\api" -PassThru -NoNewWindow
$waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $c = Test-NetConnection -ComputerName localhost -Port $ApiPort -WarningAction SilentlyContinue
} while (-not $c.TcpTestSucceeded -and $waited -lt 60)
if (-not $c.TcpTestSucceeded) { throw "FAIL: apps/api 未在 60s 内就绪（A11 单组织自检可能拦在 listen 之前）" }

# 5. 起 staff-hub（vite dev）：同源反代 /api + /collab-ws 到 apps/api（跨源 WS 不捎 cookie，必须同源）
$env:VITE_SKIP_AUTH = "true"
$env:STAFF_HUB_API_TARGET = "http://localhost:$ApiPort"
$hub = Start-Process cmd.exe -ArgumentList "/c npx.cmd vite --port $HubPort --strictPort" -WorkingDirectory "$repoRoot\apps\staff-hub" -PassThru -NoNewWindow
$w = 0
do {
  Start-Sleep -Seconds 1; $w++
  $cc = Test-NetConnection -ComputerName localhost -Port $HubPort -WarningAction SilentlyContinue
} while (-not $cc.TcpTestSucceeded -and $w -lt 90)
if (-not $cc.TcpTestSucceeded) { throw "FAIL: staff-hub 端口 $HubPort 未在 90s 内就绪" }

$stopAll = {
  foreach ($p in @($api, $hub)) {
    if ($null -ne $p) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  }
}

try {
  # 6. 双 context CRDT spec（禁 page.route）——字符级合并 / 多人光标 / 断连 resync 零丢字 / 仅自己 404
  $env:E2E_BASE_URL     = "http://localhost:$HubPort"
  $env:E2E_ALICE_OPENID = $alice
  $env:E2E_BOB_OPENID   = $bob
  $env:E2E_SHOT_DIR     = $ShotDir
  Invoke-Checked "npx.cmd" "playwright test collab-notes-crdt.spec.ts --reporter=list" `
    "$repoRoot\apps\staff-hub" "路② 协同笔记 CRDT 双人同编 E2E"
} finally {
  & $stopAll
}

# 7. 防历史产物冒充：本轮四张截图必须晚于脚本启动
$shots = Get-ChildItem "$ShotDir\*.png" -ErrorAction SilentlyContinue
if ($null -eq $shots -or $shots.Count -lt 4) {
  throw "FAIL: 截图不足 4 张（got=$(if ($null -eq $shots) { 0 } else { $shots.Count })）"
}
foreach ($s in $shots) {
  if ($s.LastWriteTime -lt $ScriptStart.AddMinutes(-1)) { throw "FAIL: $($s.Name) 是历史遗留产物" }
}

Write-Host "✅ windows_cloud 协同笔记 CRDT E2E 通过（真后端 + 真 collab-ws + 四张截图）"
exit 0
