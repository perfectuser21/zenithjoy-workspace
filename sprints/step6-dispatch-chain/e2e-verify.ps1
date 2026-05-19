# e2e-verify.ps1 — ZenithJoy Step 6 Dispatch Chain E2E Verification
# 供 e2e-windows.yml 在 windows_cloud runner 执行
# 验证完整 dispatch chain：publish → task-ack → publish_status=success

param()

$ApiBase = $env:ZENITHJOY_API_BASE
if (-not $ApiBase) {
    Write-Error "ERROR: ZENITHJOY_API_BASE 环境变量未设置"
    exit 1
}

$TestPassword = if ($env:TEST_PASSWORD) { $env:TEST_PASSWORD } else { "Smoke!Test2026" }
$TestEmail = "smoke-e2e-$(Get-Date -Format 'yyyyMMddHHmmss')@zenithjoy.test"

function Invoke-ApiRequest {
    param(
        [string]$Method,
        [string]$Path,
        [hashtable]$Body = $null,
        [hashtable]$Headers = @{},
        [System.Net.CookieContainer]$Cookies = $null
    )
    $Uri = "$ApiBase$Path"
    $ReqHeaders = @{ "Content-Type" = "application/json" } + $Headers
    $BodyJson = if ($Body) { $Body | ConvertTo-Json -Compress } else { $null }

    $Handler = [System.Net.Http.HttpClientHandler]::new()
    if ($Cookies) { $Handler.CookieContainer = $Cookies; $Handler.UseCookies = $true }
    $Client = [System.Net.Http.HttpClient]::new($Handler)
    foreach ($h in $ReqHeaders.GetEnumerator()) { $Client.DefaultRequestHeaders.TryAddWithoutValidation($h.Key, $h.Value) | Out-Null }

    $Content = if ($BodyJson) { [System.Net.Http.StringContent]::new($BodyJson, [System.Text.Encoding]::UTF8, "application/json") } else { $null }
    $Task = switch ($Method) {
        "POST"   { $Client.PostAsync($Uri, $Content) }
        "GET"    { $Client.GetAsync($Uri) }
        default  { throw "Unsupported method: $Method" }
    }
    $Response = $Task.Result
    $ResponseBody = $Response.Content.ReadAsStringAsync().Result
    $Client.Dispose()
    return @{ StatusCode = [int]$Response.StatusCode; Body = $ResponseBody }
}

$CookieJar = [System.Net.CookieContainer]::new()

Write-Host "▶ Step 6 E2E: 注册用户"
$SignupBody = @{ email = $TestEmail; password = $TestPassword; name = "e2e-smoke" }
$SignupResult = Invoke-ApiRequest -Method POST -Path "/api/auth/sign-up/email" -Body $SignupBody -Cookies $CookieJar
if ($SignupResult.StatusCode -ne 200) {
    Write-Error "FAIL: sign-up expected 200, got $($SignupResult.StatusCode)"
    exit 1
}
Write-Host "✅ sign-up OK"

$MeResult = Invoke-ApiRequest -Method GET -Path "/api/account/me" -Cookies $CookieJar
if ($MeResult.StatusCode -ne 200) {
    Write-Error "FAIL: /api/account/me expected 200, got $($MeResult.StatusCode)"
    exit 1
}
$MeData = $MeResult.Body | ConvertFrom-Json
$LicenseKey = $MeData.license.license_key
if (-not $LicenseKey) {
    Write-Error "FAIL: license_key not found in /api/account/me response"
    exit 1
}
Write-Host "✅ license_key=$LicenseKey"

Write-Host "▶ Step 6 E2E: Agent heartbeat"
$HeartbeatBody = @{ machine_id = "e2e-windows-smoke"; agent_version = "0.1.8" }
$HeartbeatHeaders = @{ "x-license-key" = $LicenseKey }
$HbResult = Invoke-ApiRequest -Method POST -Path "/api/agent/heartbeat" -Body $HeartbeatBody -Headers $HeartbeatHeaders
if ($HbResult.StatusCode -ne 200) {
    Write-Error "FAIL: heartbeat expected 200, got $($HbResult.StatusCode)"
    exit 1
}
$HbData = $HbResult.Body | ConvertFrom-Json
$AgentId = $HbData.agent_id
Write-Host "✅ agent_id=$AgentId"

Write-Host "▶ Step 6 E2E: 创建 work"
$WorkBody = @{ title = "e2e-windows-step6"; content_type = "video"; body = "e2e smoke" }
$WorkResult = Invoke-ApiRequest -Method POST -Path "/api/works" -Body $WorkBody -Cookies $CookieJar
if ($WorkResult.StatusCode -ne 201) {
    Write-Error "FAIL: POST /api/works expected 201, got $($WorkResult.StatusCode)"
    exit 1
}
$WorkData = $WorkResult.Body | ConvertFrom-Json
$WorkId = $WorkData.id
if (-not $WorkId) {
    Write-Error "FAIL: no work id in response"
    exit 1
}
Write-Host "✅ work_id=$WorkId"

Write-Host "▶ Step 6 E2E: 派发 publish 任务"
$PublishResult = Invoke-ApiRequest -Method POST -Path "/api/works/$WorkId/publish" -Cookies $CookieJar
if ($PublishResult.StatusCode -ne 201) {
    Write-Error "FAIL: POST /api/works/:id/publish expected 201, got $($PublishResult.StatusCode)"
    exit 1
}
$PublishData = $PublishResult.Body | ConvertFrom-Json
$TaskId = $PublishData.task_id
$QueueStatus = $PublishData.status
if (-not $TaskId) {
    Write-Error "FAIL: no task_id in publish response"
    exit 1
}
if ($QueueStatus -ne "queued") {
    Write-Error "FAIL: status='$QueueStatus' expected 'queued'"
    exit 1
}
Write-Host "✅ task_id=$TaskId status=queued"

Write-Host "▶ Step 6 E2E: Agent task-ack"
$AckBody = @{ task_id = $TaskId; result = "dryrun ok" }
$AckHeaders = @{ "x-license-key" = $LicenseKey }
$AckResult = Invoke-ApiRequest -Method POST -Path "/api/agent/task-ack" -Body $AckBody -Headers $AckHeaders
if ($AckResult.StatusCode -ne 200) {
    Write-Error "FAIL: POST /api/agent/task-ack expected 200, got $($AckResult.StatusCode)"
    exit 1
}
$AckData = $AckResult.Body | ConvertFrom-Json
if (-not $AckData.ok) {
    Write-Error "FAIL: task-ack ok=$($AckData.ok) expected true"
    exit 1
}
Write-Host "✅ task-ack ok=true"

Write-Host "▶ Step 6 E2E: 验证 publish_status=success"
$GetWorkResult = Invoke-ApiRequest -Method GET -Path "/api/works/$WorkId" -Cookies $CookieJar
if ($GetWorkResult.StatusCode -ne 200) {
    Write-Error "FAIL: GET /api/works/:id expected 200, got $($GetWorkResult.StatusCode)"
    exit 1
}
$WorkFinal = $GetWorkResult.Body | ConvertFrom-Json
$FinalPublishStatus = $WorkFinal.publish_status
if ($FinalPublishStatus -ne "success") {
    Write-Error "FAIL: publish_status='$FinalPublishStatus' expected 'success'"
    exit 1
}
Write-Host "✅ publish_status=success"

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host "✅ Step 6 E2E 全通 — dispatch chain: publish → task-ack → publish_status=success"
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
