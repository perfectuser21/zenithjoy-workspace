# final-e2e 验证脚本 — 快手 publisher dryrun（windows-latest）
# 由 .github/workflows/kuaishou-e2e.yml 触发（workflow_dispatch）
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
# 验证 url + title 字段存在（PRD oracle）
if (-not $imgResult.url)   { Write-Error "FAIL: image-dryrun url 字段缺失或空"; exit 1 }
if (-not $imgResult.title) { Write-Error "FAIL: image-dryrun title 字段缺失或空"; exit 1 }
# 验证 imagesCount 字段存在
if ($null -eq $imgResult.imagesCount) {
  Write-Error "FAIL: image-dryrun 输出缺 imagesCount 字段"
  exit 1
}
# 验证 keys 完整性（image: dryRun,imagesCount,ok,title,url）
$imgKeys = ($imgResult.PSObject.Properties.Name | Sort-Object) -join ","
$expectedImgKeys = "dryRun,imagesCount,ok,title,url"
if ($imgKeys -ne $expectedImgKeys) {
  Write-Error "FAIL: image-dryrun keys 不匹配 actual=$imgKeys expected=$expectedImgKeys"
  exit 1
}
# 验证禁用字段不存在
foreach ($f in @('result','status','data','payload')) {
  if ($imgResult.PSObject.Properties[$f]) { Write-Error "FAIL: image-dryrun 输出含禁用字段 $f"; exit 1 }
}
Write-Host "✅ image-dryrun PASS: ok=$($imgResult.ok) dryRun=$($imgResult.dryRun) url=$($imgResult.url) title=$($imgResult.title) imagesCount=$($imgResult.imagesCount)"

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
# 验证 url + title 字段存在（PRD oracle）
if (-not $vidResult.url)   { Write-Error "FAIL: video-dryrun url 字段缺失或空"; exit 1 }
if (-not $vidResult.title) { Write-Error "FAIL: video-dryrun title 字段缺失或空"; exit 1 }
# 验证 keys 完整性（video: dryRun,ok,title,url — 无 imagesCount）
$vidKeys = ($vidResult.PSObject.Properties.Name | Sort-Object) -join ","
$expectedVidKeys = "dryRun,ok,title,url"
if ($vidKeys -ne $expectedVidKeys) {
  Write-Error "FAIL: video-dryrun keys 不匹配 actual=$vidKeys expected=$expectedVidKeys"
  exit 1
}
# 验证禁用字段不存在
foreach ($f in @('result','status','data','payload')) {
  if ($vidResult.PSObject.Properties[$f]) { Write-Error "FAIL: video-dryrun 输出含禁用字段 $f"; exit 1 }
}
Write-Host "✅ video-dryrun PASS: ok=$($vidResult.ok) dryRun=$($vidResult.dryRun) url=$($vidResult.url) title=$($vidResult.title)"

Write-Host "✅ 快手三模式 E2E 全部通过"
exit 0
