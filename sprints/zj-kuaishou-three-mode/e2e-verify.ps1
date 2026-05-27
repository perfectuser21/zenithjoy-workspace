# final-e2e 验证脚本 — 快手 publisher dryrun（windows-latest）
# 由 .github/workflows/e2e-windows.yml 触发（workflow_dispatch）
param(
  [string]$QueueJson = "$PSScriptRoot\test-queue.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path "$scriptDir\..\.."

# 1. 安装依赖
Write-Host "▶ npm ci..."
$p = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory "$repoRoot\services\agent" `
  -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: npm ci failed" }

# 2. 安装 Playwright 浏览器
Write-Host "▶ playwright install chromium..."
$p = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory "$repoRoot\services\agent" `
  -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "FAIL: playwright install failed" }

# 3. 创建图文测试队列文件
$queue = [PSCustomObject]@{
  title   = "[DRY-RUN] E2E harness 自检 $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
  content = "Harness evaluator 自动化验证"
  images  = @()
}
$queue | ConvertTo-Json -Depth 5 | Out-File -FilePath $QueueJson -Encoding utf8
Write-Host "▶ 图文队列文件: $QueueJson"

# 4. 执行 image-dryrun（KUAISHOU_COOKIES 由 GHA secrets 注入到 env）
Write-Host "▶ image-dryrun..."
$screenshotDir = "$repoRoot\screenshots-image"
$env:SCREENSHOT_DIR = $screenshotDir
$imgScript = "$repoRoot\services\agent\publishers\kuaishou-publisher\publish-kuaishou-image-dryrun.cjs"
$imgOut = & node $imgScript $QueueJson 2>&1
$imgLastJson = ($imgOut | Where-Object { $_ -match '^\{' } | Select-Object -Last 1)

if (-not $imgLastJson) {
  Write-Error "FAIL: image-dryrun 无 JSON 输出`n输出内容:`n$imgOut"
  exit 1
}

$imgResult = $imgLastJson | ConvertFrom-Json
if (-not $imgResult.ok -or -not $imgResult.dryRun) {
  Write-Error "FAIL: image-dryrun ok=$($imgResult.ok) dryRun=$($imgResult.dryRun)"
  exit 1
}
# 验证禁用字段不存在
if ($imgResult.PSObject.Properties['result'] -or $imgResult.PSObject.Properties['status'] -or
    $imgResult.PSObject.Properties['data']   -or $imgResult.PSObject.Properties['payload']) {
  Write-Error "FAIL: image-dryrun 输出含禁用字段"
  exit 1
}
# 验证 imagesCount 字段类型
if ($null -eq $imgResult.imagesCount) {
  Write-Error "FAIL: image-dryrun 输出缺 imagesCount 字段"
  exit 1
}
Write-Host "✅ image-dryrun PASS: ok=$($imgResult.ok) dryRun=$($imgResult.dryRun) url=$($imgResult.url) imagesCount=$($imgResult.imagesCount)"

# 5. 创建视频测试队列文件
$videoQueue = "$PSScriptRoot\test-queue-video.json"
$qv = [PSCustomObject]@{
  title   = "[DRY-RUN] 视频 E2E harness 自检 $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
  content = "Harness evaluator 视频自动化验证"
}
$qv | ConvertTo-Json -Depth 5 | Out-File -FilePath $videoQueue -Encoding utf8
Write-Host "▶ 视频队列文件: $videoQueue"

# 6. 执行 video-dryrun
Write-Host "▶ video-dryrun..."
$screenshotDirV = "$repoRoot\screenshots-video"
$env:SCREENSHOT_DIR = $screenshotDirV
$vidScript = "$repoRoot\services\agent\publishers\kuaishou-publisher\publish-kuaishou-video-dryrun.cjs"
$vidOut = & node $vidScript $videoQueue 2>&1
$vidLastJson = ($vidOut | Where-Object { $_ -match '^\{' } | Select-Object -Last 1)

if (-not $vidLastJson) {
  Write-Error "FAIL: video-dryrun 无 JSON 输出`n输出内容:`n$vidOut"
  exit 1
}

$vidResult = $vidLastJson | ConvertFrom-Json
if (-not $vidResult.ok -or -not $vidResult.dryRun) {
  Write-Error "FAIL: video-dryrun ok=$($vidResult.ok) dryRun=$($vidResult.dryRun)"
  exit 1
}
if ($vidResult.PSObject.Properties['result'] -or $vidResult.PSObject.Properties['status'] -or
    $vidResult.PSObject.Properties['data']   -or $vidResult.PSObject.Properties['payload']) {
  Write-Error "FAIL: video-dryrun 输出含禁用字段"
  exit 1
}
# video 不应有 imagesCount
if ($null -ne $vidResult.imagesCount) {
  Write-Error "FAIL: video-dryrun 输出含 imagesCount（video schema 只有 4 字段）"
  exit 1
}
Write-Host "✅ video-dryrun PASS: ok=$($vidResult.ok) dryRun=$($vidResult.dryRun) url=$($vidResult.url)"

Write-Host "✅ 快手三模式 E2E 全部通过"
exit 0
