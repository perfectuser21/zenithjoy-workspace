# 路③ Sprint B 行链 E2E 的公共件 —— 起真环境，零 stub
#
# 谁 dot-source 它：e2e-rows-prepare.ps1（重活）与 e2e-rows-run.ps1（三个真浏览器 step）。
# 这里一条 pass/fail 业务判定都没有：判定住在 spec 与 contract-dod.md 里。

function Invoke-Checked($file, $argline, $cwd, $what) {
  $p = Start-Process cmd.exe -ArgumentList "/c $file $argline" -WorkingDirectory $cwd -Wait -PassThru -NoNewWindow
  if ($p.ExitCode -ne 0) { throw "FAIL: $what (exit=$($p.ExitCode))" }
}

# migration runner 认 DATABASE_URL，但 **apps/api 进程只认离散 DATABASE_* 五个变量**
# （不读 DATABASE_URL）。只设连接串的话进程会拿内置默认值去连，报
# "password authentication failed for user postgres" —— 看着像库没起来，其实是没告诉它去哪连。
function Set-DbEnvFromUrl($url) {
  $env:DATABASE_URL = $url
  $u = [uri]$url
  $userInfo = $u.UserInfo -split ':'
  $env:DATABASE_HOST     = $u.Host
  $env:DATABASE_PORT     = if ($u.Port -gt 0) { "$($u.Port)" } else { "5432" }
  $env:DATABASE_NAME     = $u.AbsolutePath.TrimStart('/')
  $env:DATABASE_USER     = [uri]::UnescapeDataString($userInfo[0])
  $env:DATABASE_PASSWORD = if ($userInfo.Count -gt 1) { [uri]::UnescapeDataString($userInfo[1]) } else { "" }
  $env:PGPASSWORD        = $env:DATABASE_PASSWORD
  Write-Host "DB: $($env:DATABASE_USER)@$($env:DATABASE_HOST):$($env:DATABASE_PORT)/$($env:DATABASE_NAME)"
}

function Invoke-Psql($sql) {
  $out = & psql $env:E2E_DATABASE_URL -t -A -q -c $sql
  if ($LASTEXITCODE -ne 0) { throw "FAIL: psql 执行失败: $sql" }
  return ($out | Select-Object -First 1).Trim()
}

# 种双企业 + 三个身份（甲乙同属 A 企业，丙在 B 企业），并把员工目录写进 env。
# A30-1a：扁平白名单必须恰好等于主企业那一组，丙只出现在 ORGB 分组里，
# 否则启动自检会把进程拦在 listen 之前 —— 那时红的是"这个脚本的员工目录写错了"，不是业务。
function New-TwoTenantSeed($apiPort) {
  $sfx   = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString() + (Get-Random -Maximum 9999)
  $alice = "ou_wb_alice_$sfx"
  $bob   = "ou_wb_bob_$sfx"
  $carol = "ou_wb_carol_$sfx"
  $orgA = Invoke-Psql "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('WB-S2-A-$sfx', 'wb-s2-lk-a-$sfx', 'free') RETURNING id"
  $orgB = Invoke-Psql "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('WB-S2-B-$sfx', 'wb-s2-lk-b-$sfx', 'free') RETURNING id"
  if (-not $orgA -or -not $orgB) { throw "FAIL: 两家企业种子未建成" }

  $env:STAFF_FEISHU_OPENIDS       = "$alice,$bob"
  $env:STAFF_FEISHU_OPENIDS__ORGA = "$alice,$bob"
  $env:STAFF_FEISHU_OPENIDS__ORGB = "$carol"
  $env:STAFF_ORG_MAP              = "ORGA:$orgA,ORGB:$orgB"
  $env:FEISHU_API_BASE            = "http://localhost:$apiPort/api/_smoke/fake-feishu"
  $env:FEISHU_APP_ID              = "wb-s2-app-id"
  $env:FEISHU_APP_SECRET          = "wb-s2-app-secret"
  if (-not $env:BETTER_AUTH_SECRET) { $env:BETTER_AUTH_SECRET = "wb-s2-secret-not-for-prod-32-characters" }
  $env:NODE_ENV = "development"

  return @{ Sfx = $sfx; Alice = $alice; Bob = $bob; Carol = $carol; OrgA = $orgA; OrgB = $orgB }
}

# 杀进程**树**：`Start-Process cmd.exe /c npm...` 拿到的是 cmd.exe 的 PID，
# `Stop-Process` 只杀得掉那层壳，真正监听端口的 node 子进程会活下来。
function Stop-Tree($procId) {
  if (-not $procId) { return }
  & cmd.exe /c "taskkill /PID $procId /T /F >nul 2>&1"
}

<#
端口必须在起服务前先空出来。

2026-08-20 首跑实测：上一个 step 结束时只杀了 cmd.exe 外壳，node 还占着 5210；
本 step 起的新进程 EADDRINUSE 起不来，于是登录请求打到了**上一 step 那个进程**上——
它的 STAFF_FEISHU_OPENIDS 属于上一次 seed，认不出本次的 code，
报出来是 `invalid code (fake upstream)`，看着像假上游坏了，其实是打错了进程。
#>
function Clear-Port($port) {
  $conns = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
  foreach ($c in $conns) { Stop-Tree $c.OwningProcess }
  for ($i = 0; $i -lt 20; $i++) {
    if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) { return }
    Start-Sleep -Seconds 1
  }
  throw "FAIL: 端口 $port 被占用且 20s 内清不掉"
}

function Wait-Port($port, $timeoutSec) {
  $waited = 0
  do {
    Start-Sleep -Seconds 1; $waited++
    $c = Test-NetConnection -ComputerName localhost -Port $port -WarningAction SilentlyContinue
  } while (-not $c.TcpTestSucceeded -and $waited -lt $timeoutSec)
  return $c.TcpTestSucceeded
}

function Start-Api($repoRoot, $port) {
  Clear-Port $port
  $env:PORT = "$port"
  $p = Start-Process cmd.exe -ArgumentList "/c npm.cmd start" -WorkingDirectory "$repoRoot\apps\api" -PassThru -NoNewWindow
  if (-not (Wait-Port $port 60)) {
    throw "FAIL: apps/api 未在 60s 内就绪（端口 $port；A11 单组织自检可能把它拦在 listen 之前，看日志）"
  }
  return $p
}

# 真登录拿真会话 cookie：走真 /api/staff/feishu-login，上游是本地假飞书 ——
# 那是端点重定向不是代码分支，被测的会话签发路径一行没变。
function Get-SessionCookie($apiPort, $openId) {
  $body = @{ code = "wb-code-$openId" } | ConvertTo-Json -Compress
  $res = Invoke-WebRequest -Uri "http://localhost:$apiPort/api/staff/feishu-login" `
         -Method Post -ContentType "application/json" -Body $body -UseBasicParsing
  if ($res.StatusCode -ne 200) { throw "FAIL: 会话签发失败 open_id=$openId status=$($res.StatusCode)" }
  $sc = $res.Headers['Set-Cookie']
  if (-not $sc) { throw "FAIL: 登录未返回 Set-Cookie open_id=$openId" }
  $pairs = @($sc) | ForEach-Object { ($_ -split ';')[0] }
  return ($pairs -join '; ')
}

# staff-hub 走 vite proxy 打后端 —— 必须**同源**，否则会话 cookie 根本发不出去，
# 路③ 的闸只认 cookie，跨源直连一定是一片 401。
function Start-Hub($repoRoot, $hubPort, $apiPort) {
  Clear-Port $hubPort
  $env:VITE_SKIP_AUTH       = "true"
  $env:STAFF_HUB_API_TARGET = "http://localhost:$apiPort"
  $p = Start-Process cmd.exe -ArgumentList "/c npx.cmd vite --port $hubPort --strictPort" `
       -WorkingDirectory "$repoRoot\apps\staff-hub" -PassThru -NoNewWindow
  if (-not (Wait-Port $hubPort 90)) { throw "FAIL: staff-hub 未在 90s 内就绪（端口 $hubPort）" }
  return $p
}

function Stop-Procs($procs) {
  foreach ($p in $procs) {
    if ($null -ne $p) { Stop-Tree $p.Id }
  }
}
