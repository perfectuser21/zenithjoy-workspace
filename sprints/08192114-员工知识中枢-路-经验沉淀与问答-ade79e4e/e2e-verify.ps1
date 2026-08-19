# e2e-verify.ps1 — 员工知识中枢 路① 第一刀 UI E2E（windows-latest，真后端 + 真 Postgres）
#
# 由 .github/workflows/e2e-windows.yml（workflow_dispatch）执行。本 sprint **不改那个 workflow**：
# 它是跨 sprint 共用壳，且 GHA 的 services: 只支持 Linux runner，windows 上挂不了 postgres service —
# 所以前置一律在本脚本内自建，任一步不成立就 throw，绝不空跑一个"绿的"空壳。
#
# 两条踩坑已内建：
#   1. psql 不保证在 PATH 上（windows runner 装了 PostgreSQL 但不一定加 PATH）→ 用 PGBIN 绝对路径解析
#   2. apps/api 只认 DATABASE_HOST/PORT/NAME/USER/PASSWORD 五个离散变量，**不读 DATABASE_URL**
#      → 从连接串推导出这五个，否则服务连的是另一个库、写进去的东西回读不到

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VitePort = 5175
$ApiPort  = 3000
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path "$scriptDir\..\.."
$ScriptStart = Get-Date
$StartIso = $ScriptStart.ToUniversalTime().ToString("o")
# StrictMode 下 finally 里要能安全读这些变量，先声明
$OrgA = $null; $OrgB = $null; $PgUrl = $null; $apiProc = $null; $viteProc = $null; $Psql = $null

$OrgaOpenId = "ou_e2e_orga_member"
$OrgaEmail  = "e2e-orga@zenithjoy.local"
$OrgbOpenId = "ou_e2e_orgb_member"
$NoOrgOpenId = "ou_e2e_noorg"

# ── psql 定位（踩坑 1）──────────────────────────────────────────────────────
function Resolve-Psql {
  if ($env:PGBIN -and (Test-Path "$env:PGBIN\psql.exe")) { return "$env:PGBIN\psql.exe" }
  $onPath = Get-Command psql -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  $candidates = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue |
                Sort-Object FullName -Descending
  if ($candidates) { return $candidates[0].FullName }
  throw "FAIL: 找不到 psql.exe —— 设 PGBIN 或把 PostgreSQL bin 加进 PATH"
}
$script:LastPsqlOut = ''
function Invoke-Psql([string]$conn, [string[]]$psqlArgs) {
  $out = & $Psql $conn @psqlArgs 2>&1 | Out-String
  # 留一份原文：失败时不打出 psql 到底说了什么，排查就只剩"应用失败"四个字，
  # 得再跑一轮 CI 才能看见真正的错误行。
  $script:LastPsqlOut = $out.Trim()
  return $script:LastPsqlOut
}

$Psql = Resolve-Psql
Write-Host "KH-E2E psql=$Psql"

# ── 0. 数据库连接 → DATABASE_* 五变量（踩坑 2）──────────────────────────────
$PgUrl = $env:E2E_DATABASE_URL
if (-not $PgUrl) {
  # 退到 runner 预装的 PostgreSQL（镜像自带，服务默认停）；两条路都不成立即 throw
  $svc = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $svc) { throw "FAIL: 既无 E2E_DATABASE_URL，runner 也无预装 PostgreSQL 服务 — 前置不成立" }
  Set-Service -Name $svc.Name -StartupType Manual
  Start-Service -Name $svc.Name
  $u = if ($env:PGUSER) { $env:PGUSER } else { "postgres" }
  $w = if ($env:PGPASSWORD) { $env:PGPASSWORD } else { "root" }
  $root = "postgresql://${u}:${w}@localhost:5432/postgres"
  $has = Invoke-Psql $root @("-t", "-A", "-q", "-c", "SELECT 1 FROM pg_database WHERE datname='cecelia'")
  if ($LASTEXITCODE -ne 0) { throw "FAIL: runner 本地 PostgreSQL 起了但连不上" }
  if ($has -ne "1") { Invoke-Psql $root @("-q", "-c", "CREATE DATABASE cecelia") | Out-Null }
  $PgUrl = "postgresql://${u}:${w}@localhost:5432/cecelia"
}

$uri = [System.Uri]$PgUrl
if (-not $uri.UserInfo) { throw "FAIL: 连接串缺用户名，无法推导 DATABASE_USER host=$($uri.Host)" }
$ui = $uri.UserInfo.Split(':')
$env:DATABASE_HOST = $uri.Host
$env:DATABASE_PORT = if ($uri.Port -gt 0) { "$($uri.Port)" } else { "5432" }
$env:DATABASE_NAME = $uri.AbsolutePath.TrimStart('/')
$env:DATABASE_USER = [System.Uri]::UnescapeDataString($ui[0])
$env:DATABASE_PASSWORD = if ($ui.Count -gt 1) { [System.Uri]::UnescapeDataString($ui[1]) } else { "" }
Invoke-Psql $PgUrl @("-v", "ON_ERROR_STOP=1", "-q", "-c", "SELECT 1") | Out-Null
if ($LASTEXITCODE -ne 0) { throw "FAIL: DATABASE_* 推导后仍连不上 host=$($env:DATABASE_HOST) db=$($env:DATABASE_NAME)" }
Write-Host "KH-E2E db-ready host=$($env:DATABASE_HOST) db=$($env:DATABASE_NAME)"

try {
  # ── 1. 依赖 ──
  $p = Start-Process cmd.exe -ArgumentList "/c npm.cmd ci --prefer-offline --no-audit --no-fund" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
  if ($p.ExitCode -ne 0) { throw "FAIL: npm ci exit=$($p.ExitCode)" }
  $p = Start-Process cmd.exe -ArgumentList "/c npx.cmd playwright install chromium --with-deps" -WorkingDirectory "$repoRoot\apps\staff-hub" -Wait -PassThru -NoNewWindow
  if ($p.ExitCode -ne 0) { throw "FAIL: playwright install exit=$($p.ExitCode)" }

  # ── 2. migration（含本 sprint 投影表）+ 账本表前置 ──
  Invoke-Psql $PgUrl @("-q", "-c", "CREATE SCHEMA IF NOT EXISTS zenithjoy") | Out-Null
  Invoke-Psql $PgUrl @("-q", "-c", "CREATE EXTENSION IF NOT EXISTS pgcrypto") | Out-Null
  $p = Start-Process cmd.exe -ArgumentList "/c npm.cmd run migrate" -WorkingDirectory "$repoRoot\apps\api" -Wait -PassThru -NoNewWindow
  if ($p.ExitCode -ne 0) { throw "FAIL: migrate exit=$($p.ExitCode)" }
  $nullable = Invoke-Psql $PgUrl @("-t", "-A", "-q", "-c", "SELECT is_nullable FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='knowledge_entries_projection' AND column_name='org_id'")
  if ($nullable -ne "NO") { throw "FAIL: 投影表 org_id 未 NOT NULL got=$nullable" }

  # public.learnings 属 cecelia repo，不在本仓 migrations；缺表时用本 sprint committed fixture 建
  $ledger = Invoke-Psql $PgUrl @("-t", "-A", "-q", "-c", "SELECT to_regclass('public.learnings')")
  if (-not $ledger) {
    # 先把 fixture 拷到纯 ASCII 临时路径再喂给 psql：本 sprint 目录名含中文，
    # Windows 上 psql -f 的路径要经过控制台代码页转换，非 ASCII 路径会打不开文件。
    $fixtureSrc = Join-Path $scriptDir "fixtures\learnings-ledger.sql"
    if (-not (Test-Path $fixtureSrc)) { throw "FAIL: 账本 fixture 不存在 $fixtureSrc" }
    $fixtureTmp = Join-Path ([System.IO.Path]::GetTempPath()) "kh-learnings-ledger.sql"
    Copy-Item $fixtureSrc $fixtureTmp -Force
    Invoke-Psql $PgUrl @("-v", "ON_ERROR_STOP=1", "-q", "-f", $fixtureTmp) | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "FAIL: 账本 fixture DDL 应用失败 (exit=$LASTEXITCODE)`n$script:LastPsqlOut" }
    $ledger = Invoke-Psql $PgUrl @("-t", "-A", "-q", "-c", "SELECT to_regclass('public.learnings')")
  }
  if (-not $ledger) { throw "FAIL: public.learnings 不存在且 fixture 未建成 — 录入链路无处可写" }

  # ── 3. 两家 tenants 行 + 员工目录分组 env（A30 四项必须成立，否则下一步起不来）──
  $sfx = [guid]::NewGuid().ToString("N").Substring(0,8)
  $OrgA = Invoke-Psql $PgUrl @("-t", "-A", "-q", "-c", "INSERT INTO zenithjoy.tenants (name, plan) VALUES ('E2E-UI-A-$sfx','free') RETURNING id")
  $OrgB = Invoke-Psql $PgUrl @("-t", "-A", "-q", "-c", "INSERT INTO zenithjoy.tenants (name, plan) VALUES ('E2E-UI-B-$sfx','free') RETURNING id")
  if (-not $OrgA -or -not $OrgB) { throw "FAIL: tenants 行未建成 A=$OrgA B=$OrgB" }

  # 扁平名单恰好等于主企业那一组（A30-1a）；无归属账号单列 NOORG 分组、在 STAFF_ORG_MAP 里
  # 故意没有租户映射 —— 这样它被目录声明过（A30-1b 通过）但拿不到 org，登录即 NO_ORG_ASSIGNMENT。
  $env:STAFF_EMAILS = $OrgaEmail
  $env:STAFF_FEISHU_OPENIDS = $OrgaOpenId
  $env:STAFF_EMAILS__ORGA = $OrgaEmail
  $env:STAFF_FEISHU_OPENIDS__ORGA = $OrgaOpenId
  $env:STAFF_FEISHU_OPENIDS__ORGB = $OrgbOpenId
  $env:STAFF_FEISHU_OPENIDS__NOORG = $NoOrgOpenId
  $env:STAFF_ORG_MAP = "ORGA:$OrgA,ORGB:$OrgB"
  $env:FEISHU_API_BASE = "http://localhost:$ApiPort/api/_smoke/fake-feishu"
  $env:FEISHU_APP_ID = "e2e-app-id"
  $env:FEISHU_APP_SECRET = "e2e-app-secret"
  if (-not $env:BETTER_AUTH_SECRET) { $env:BETTER_AUTH_SECRET = "e2e-knowledge-hub-secret-not-for-prod-32ch" }
  $env:NODE_ENV = "development"
  $env:PORT = "$ApiPort"

  # ── 4. 起真实 apps/api，并证明 A30 自检真跑过（只验端口通是假绿）──
  $p = Start-Process cmd.exe -ArgumentList "/c npm.cmd run build --workspace=apps/api" -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
  if ($p.ExitCode -ne 0) { throw "FAIL: apps/api build exit=$($p.ExitCode)" }
  $apiOut = "$scriptDir\api-stdout.log"; $apiErr = "$scriptDir\api-stderr.log"
  # 子进程继承当前 $env:*，不用 Start-Process -Environment（那个参数要 PowerShell 7.4+，别赌 runner 版本）
  $apiProc = Start-Process cmd.exe -ArgumentList "/c node dist\index.js" -WorkingDirectory "$repoRoot\apps\api" `
    -PassThru -NoNewWindow -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr
  $waited = 0
  do {
    Start-Sleep -Seconds 1; $waited++
    $conn = Test-NetConnection -ComputerName localhost -Port $ApiPort -WarningAction SilentlyContinue
  } while (-not $conn.TcpTestSucceeded -and $waited -lt 40)
  if (-not $conn.TcpTestSucceeded) {
    Write-Host (Get-Content $apiOut,$apiErr -ErrorAction SilentlyContinue | Select-Object -Last 40 | Out-String)
    throw "FAIL: apps/api 未在 40s 内就绪（A30 自检拦住启动？见上方日志尾部）"
  }
  if (-not (Select-String -Path $apiOut,$apiErr -Pattern "A30 staff-directory selfcheck passed" -Quiet)) {
    throw "FAIL: 启动日志无 A30 自检通过标记 — 自检根本没跑"
  }
  Write-Host "KH-E2E api-ready A30-selfcheck-proven"

  # ── 5. build + vite preview（VITE_SKIP_AUTH 固定前端门禁，授权判定仍全在服务端）──
  $env:VITE_SKIP_AUTH = "true"
  $env:VITE_MOCK_USER_EMAIL = $OrgaEmail
  $p = Start-Process cmd.exe -ArgumentList "/c npm.cmd run build" -WorkingDirectory "$repoRoot\apps\staff-hub" -Wait -PassThru -NoNewWindow
  if ($p.ExitCode -ne 0) { throw "FAIL: staff-hub build exit=$($p.ExitCode)" }
  $env:STAFF_HUB_API_TARGET = "http://localhost:$ApiPort"
  $viteProc = Start-Process cmd.exe -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" `
    -WorkingDirectory "$repoRoot\apps\staff-hub" -PassThru -NoNewWindow
  $waited = 0
  do {
    Start-Sleep -Seconds 1; $waited++
    $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
  } while (-not $conn.TcpTestSucceeded -and $waited -lt 30)
  if (-not $conn.TcpTestSucceeded) { throw "FAIL: vite preview 未在 30s 内就绪" }

  # ── 6. Playwright（真浏览器、真后端、禁 page.route）──
  $env:E2E_BASE_URL = "http://localhost:$VitePort"
  $env:E2E_LOGIN_CODE = "e2e-code-orga"
  $e2e = Start-Process cmd.exe -ArgumentList "/c npx.cmd playwright test e2e\knowledge-hub-path1.spec.ts --reporter=list" `
    -WorkingDirectory "$repoRoot\apps\staff-hub" -Wait -PassThru -NoNewWindow
  if ($e2e.ExitCode -ne 0) { throw "FAIL: Playwright E2E exit=$($e2e.ExitCode)" }

  # ── 7. 截图防造假：三张都必须是本轮写的 ──
  $shotDir = "$repoRoot\apps\staff-hub\screenshots"
  $fresh = 0
  foreach ($n in @("01-initial.png","02-action.png","03-result.png")) {
    $f = Join-Path $shotDir $n
    if (-not (Test-Path $f)) { throw "FAIL: 缺截图 $n" }
    $mtime = (Get-Item $f).LastWriteTime
    if ($mtime -lt $ScriptStart) { throw "FAIL: $n LastWriteTime=$mtime 早于脚本启动 $ScriptStart — 疑似历史截图冒充" }
    $fresh++
  }
  New-Item -ItemType Directory -Path "$scriptDir\screenshots" -Force | Out-Null
  Get-ChildItem "$shotDir\*.png" | Copy-Item -Destination "$scriptDir\screenshots"
  Write-Host "KH-E2E screenshots-fresh: $fresh"

  # ── 8. 交叉回读：UI 上看到的那条，必须在账本里是同一 entry_id 且带本组织归属 ──
  $idFile = "$repoRoot\apps\staff-hub\kh-e2e-entry-id.txt"
  if (-not (Test-Path $idFile)) { throw "FAIL: spec 未落下 UI 可见条目的 entry_id" }
  $entryId = (Get-Content $idFile -Raw).Trim()
  if (-not $entryId) { throw "FAIL: entry_id 为空" }
  $ledgerRows = Invoke-Psql $PgUrl @("-t", "-A", "-q", "-c", "SELECT count(*) FROM public.learnings WHERE id='$entryId' AND metadata->>'org_id'='$OrgA' AND created_at > '$StartIso'")
  if ($ledgerRows -ne "1") { throw "FAIL: UI 可见的 entry_id=$entryId 在账本里查不到本轮带归属行 count=$ledgerRows" }
  Write-Host "KH-E2E ledger-verified entry_id=$entryId"
  Write-Host "✅ windows_cloud UI E2E 通过"
}
finally {
  if ($apiProc)  { Stop-Process -Id $apiProc.Id  -Force -ErrorAction SilentlyContinue }
  if ($viteProc) { Stop-Process -Id $viteProc.Id -Force -ErrorAction SilentlyContinue }
  if ($PgUrl -and $OrgA) {
    Invoke-Psql $PgUrl @("-q", "-c", "DELETE FROM public.learnings WHERE metadata->>'org_id' IN ('$OrgA','$OrgB')") | Out-Null
    Invoke-Psql $PgUrl @("-q", "-c", "DELETE FROM zenithjoy.session WHERE ""userId"" IN ('$OrgaOpenId','$OrgbOpenId','$NoOrgOpenId')") | Out-Null
    Invoke-Psql $PgUrl @("-q", "-c", "DELETE FROM zenithjoy.""user"" WHERE id IN ('$OrgaOpenId','$OrgbOpenId','$NoOrgOpenId')") | Out-Null
    Invoke-Psql $PgUrl @("-q", "-c", "DELETE FROM zenithjoy.tenant_members WHERE tenant_id IN ('$OrgA','$OrgB')") | Out-Null
    Invoke-Psql $PgUrl @("-q", "-c", "DELETE FROM zenithjoy.tenants WHERE id IN ('$OrgA','$OrgB')") | Out-Null
  }
}
exit 0
