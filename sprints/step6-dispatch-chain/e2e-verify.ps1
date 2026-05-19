#!/usr/bin/env pwsh
# e2e-verify.ps1 — Step 6 Dispatch Chain 全链路验证（Windows Agent 模拟）
# target_environment: windows_cloud | 由 .github/workflows/e2e-windows.yml 调用
param(
  [string]$ApiBase = $Env:ZENITHJOY_API_BASE
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $ApiBase) {
  Write-Error "ZENITHJOY_API_BASE 未设置（GitHub Variable 或 -ApiBase 参数必须提供）"
  exit 1
}

$Ts = [System.DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$Email = "e2e-s6-${Ts}@zenithjoy.test"
$Password = "Pass1234!"
$ContentType = "application/json"

function Invoke-Api {
  param([string]$Method, [string]$Path, $Body, [hashtable]$Headers = @{}, [hashtable]$Session = $null)
  $uri = "$ApiBase$Path"
  $params = @{ Method = $Method; Uri = $uri; ContentType = $ContentType; Headers = $Headers; UseBasicParsing = $true }
  if ($Body) { $params.Body = ($Body | ConvertTo-Json -Depth 5) }
  if ($Session) { $params.WebSession = $Session }
  return Invoke-RestMethod @params
}

# 1. 注册并取 license_key
Write-Host "Step 1: 注册测试用户 $Email"
$ws = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-RestMethod -Method POST -Uri "$ApiBase/api/auth/sign-up/email" `
  -ContentType $ContentType -SessionVariable 'ws' `
  -Body (@{email=$Email; password=$Password; name="e2e-s6"} | ConvertTo-Json) | Out-Null
$me = Invoke-RestMethod -Method GET -Uri "$ApiBase/api/account/me" `
  -ContentType $ContentType -WebSession $ws
$LicenseKey = $me.license.license_key
if (-not $LicenseKey) { Write-Error "FAIL: license_key 未返回"; exit 1 }

# 2. 心跳注册 Agent（模拟 Windows Agent 启动）
Write-Host "Step 2: Agent 心跳 (Windows Agent 模拟)"
$hb1 = Invoke-RestMethod -Method POST -Uri "$ApiBase/api/agent/heartbeat" `
  -ContentType $ContentType `
  -Headers @{"x-license-key"=$LicenseKey} `
  -Body (@{hostname="e2e-windows-agent-$Ts"; version="1.0.0"} | ConvertTo-Json)
if (-not $hb1.agent_id) { Write-Error "FAIL: heartbeat 未返回 agent_id"; exit 1 }
$AgentId = $hb1.agent_id
Write-Host "  agent_id=$AgentId"

# 3. 创建 work
Write-Host "Step 3: 创建测试 work"
$work = Invoke-RestMethod -Method POST -Uri "$ApiBase/api/works" `
  -ContentType $ContentType -WebSession $ws `
  -Body (@{title="e2e-s6-test-$Ts"; content_type="video"; body="body"} | ConvertTo-Json)
$WorkId = $work.id
if (-not $WorkId) { Write-Error "FAIL: work 创建失败"; exit 1 }

# 4. 调用 POST /api/works/:id/publish
Write-Host "Step 4: POST /api/works/$WorkId/publish"
$pub = Invoke-RestMethod -Method POST -Uri "$ApiBase/api/works/$WorkId/publish" `
  -ContentType $ContentType -WebSession $ws
if ($pub.status -ne "queued") { Write-Error "FAIL: status=$($pub.status), 期望 queued"; exit 1 }
$taskIdType = $pub.task_id.GetType().Name
if (-not ($pub.task_id -match '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) {
  Write-Error "FAIL: task_id 不是 UUID: $($pub.task_id)"; exit 1
}
$pubKeys = ($pub | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name | Sort-Object) -join ","
if ($pubKeys -ne "status,task_id") { Write-Error "FAIL: publish response keys=$pubKeys, 期望 status,task_id"; exit 1 }
$TaskId = $pub.task_id
Write-Host "  task_id=$TaskId ✅"

# 5. 验证 works.publish_status = queued
$workAfterPub = Invoke-RestMethod -Method GET -Uri "$ApiBase/api/works/$WorkId" `
  -ContentType $ContentType -WebSession $ws
if ($workAfterPub.publish_status -ne "queued") {
  Write-Error "FAIL: works.publish_status=$($workAfterPub.publish_status), 期望 queued"; exit 1
}

# 6. 心跳二次拉取任务队列（模拟 Windows Agent 心跳）
Write-Host "Step 5: 心跳拉取 queued_tasks"
$hb2 = Invoke-RestMethod -Method POST -Uri "$ApiBase/api/agent/heartbeat" `
  -ContentType $ContentType `
  -Headers @{"x-license-key"=$LicenseKey} `
  -Body (@{hostname="e2e-windows-agent-$Ts"} | ConvertTo-Json)
$queuedTaskIds = $hb2.queued_tasks | ForEach-Object { $_.task_id }
if ($TaskId -notin $queuedTaskIds) {
  Write-Error "FAIL: heartbeat queued_tasks 未含 task_id=$TaskId"; exit 1
}
Write-Host "  queued_tasks 含 task_id=$TaskId ✅"

# 7. task-ack 确认执行
Write-Host "Step 6: POST /api/agent/task-ack"
$ack = Invoke-RestMethod -Method POST -Uri "$ApiBase/api/agent/task-ack" `
  -ContentType $ContentType `
  -Headers @{"x-license-key"=$LicenseKey} `
  -Body (@{task_id=$TaskId; result="dryrun ok"} | ConvertTo-Json)
if ($ack.ok -ne $true) { Write-Error "FAIL: ack.ok=$($ack.ok), 期望 true"; exit 1 }
$ackKeys = ($ack | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name | Sort-Object) -join ","
if ($ackKeys -ne "ok") { Write-Error "FAIL: task-ack response keys=$ackKeys, 期望 ok"; exit 1 }
Write-Host "  ok=true ✅"

# 8. 验证最终状态 works.publish_status = success
Write-Host "Step 7: GET /api/works/$WorkId → publish_status=success"
$workFinal = Invoke-RestMethod -Method GET -Uri "$ApiBase/api/works/$WorkId" `
  -ContentType $ContentType -WebSession $ws
if ($workFinal.publish_status -ne "success") {
  Write-Error "FAIL: works.publish_status=$($workFinal.publish_status), 期望 success"; exit 1
}
Write-Host "  publish_status=success ✅"

Write-Host ""
Write-Host "✅ Step 6 Dispatch Chain E2E 全链路验证通过 (windows_cloud)"
exit 0
