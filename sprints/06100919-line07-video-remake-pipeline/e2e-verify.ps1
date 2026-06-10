# final-e2e 验证脚本 — ZenithJoy Dashboard Playwright + backend smoke（windows-latest）
# Phase 1: Playwright UI 测试（API stub，验证 Dashboard 行为）
# Phase 2: 后端 smoke（真实 TOAPI + DashScope 调用，ffprobe 验证）
# Sprint: Line 07 AI爆款视频翻拍 9节点可视化流水线（thin）
param(
  [string]$BaseUrl = "http://localhost:5174",
  [string]$SuperAdminEmail = $env:E2E_SUPER_ADMIN_EMAIL,
  [string]$SuperAdminPassword = $env:E2E_SUPER_ADMIN_PASSWORD
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$VitePort = 5174
$ApiPort  = 3001
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptDir\..\.."

# =========================================================
# Phase 1: Playwright UI 测试（API stub，验证 Dashboard 行为）
# =========================================================

# 1. 安装依赖
Write-Host "▶ [Phase 1] Installing dependencies..."
$installProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd ci --prefer-offline" `
  -WorkingDirectory $repoRoot `
  -Wait -PassThru -NoNewWindow
if ($installProc.ExitCode -ne 0) { throw "FAIL: npm ci failed exitCode=$($installProc.ExitCode)" }
Write-Host "✅ 依赖安装完成"

# 2. 安装 Playwright 浏览器
Write-Host "▶ [Phase 1] Installing Playwright Chromium..."
$pwProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright install chromium --with-deps" `
  -WorkingDirectory $repoRoot `
  -Wait -PassThru -NoNewWindow
if ($pwProc.ExitCode -ne 0) { throw "FAIL: playwright install failed exitCode=$($pwProc.ExitCode)" }
Write-Host "✅ Playwright 安装完成"

# 3. Build Dashboard
Write-Host "▶ [Phase 1] Building dashboard..."
$buildProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npm.cmd run build" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow
if ($buildProc.ExitCode -ne 0) { throw "FAIL: dashboard build failed exitCode=$($buildProc.ExitCode)" }
Write-Host "✅ Dashboard 构建完成"

# 4. 启动 Vite preview（--port $VitePort 固定端口）
Write-Host "▶ [Phase 1] Starting Vite preview on port $VitePort..."
$serverProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -PassThru -NoNewWindow

# 5. 等待 Vite 就绪（Test-NetConnection 兼容 IPv4/IPv6）
$maxWait = 30; $waited = 0
do {
  Start-Sleep -Seconds 1; $waited++
  $conn = Test-NetConnection -ComputerName localhost -Port $VitePort -WarningAction SilentlyContinue
} while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)

if (-not $conn.TcpTestSucceeded) {
  Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: Vite 未在 ${maxWait}s 内就绪 port=$VitePort"
}
Write-Host "✅ Vite 就绪 port=$VitePort（等待 ${waited}s）"

# 6. 跑 Playwright E2E（Phase 1 UI，使用 API stub）
Write-Host "▶ [Phase 1] Running Playwright E2E: video-remake.spec.ts..."
$env:BASE_URL     = $BaseUrl
$env:CI           = "true"
$env:E2E_EMAIL    = $SuperAdminEmail
$env:E2E_PASSWORD = $SuperAdminPassword

$e2eProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd playwright test e2e/video-remake.spec.ts --reporter=list" `
  -WorkingDirectory "$repoRoot\apps\dashboard" `
  -Wait -PassThru -NoNewWindow

Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue

if ($e2eProc.ExitCode -ne 0) {
  throw "FAIL: Playwright E2E 失败 exitCode=$($e2eProc.ExitCode)"
}
Write-Host "✅ [Phase 1] Playwright UI 验证通过"

# =========================================================
# Phase 2: 后端 smoke — 真实 AI 调用（N04 gpt-image-2 + N08 DashScope i2v）
# =========================================================

Write-Host "▶ [Phase 2] Backend smoke — 真实 AI 调用（N04 gpt-image-2 + N08 DashScope i2v）..."

# 验证 API keys 已注入（缺 key = CI 环境未就绪 = FAIL，禁止 exit 0 跳过）
if ([string]::IsNullOrEmpty($env:TOAPI_API_KEY)) {
  throw "FAIL: TOAPI_API_KEY 未注入。请在 .github/workflows/e2e-windows.yml env 段添加: TOAPI_API_KEY: `${{ secrets.TOAPI_API_KEY }}"
}
if ([string]::IsNullOrEmpty($env:DASHSCOPE_API_KEY)) {
  throw "FAIL: DASHSCOPE_API_KEY 未注入。请在 .github/workflows/e2e-windows.yml env 段添加: DASHSCOPE_API_KEY: `${{ secrets.DASHSCOPE_API_KEY }}"
}

# 启动 API server（注入真实 API keys，CI=true 使流水线自动选帧）
$env:PORT     = $ApiPort
$env:NODE_ENV = "production"
$env:CI       = "true"

$apiProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c node apps/api/src/index.js" `
  -WorkingDirectory $repoRoot `
  -PassThru -NoNewWindow

# 等待 API server 就绪
$waited = 0
do {
  Start-Sleep -Seconds 2; $waited += 2
  $apiConn = Test-NetConnection -ComputerName localhost -Port $ApiPort -WarningAction SilentlyContinue
} while (-not $apiConn.TcpTestSucceeded -and $waited -lt 30)

if (-not $apiConn.TcpTestSucceeded) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: API server 未在 30s 内就绪 port=$ApiPort"
}
Write-Host "✅ API server 就绪 port=$ApiPort"

# 生成 1s 测试 MP4（ffmpeg 在 windows-latest 内置）
$testVideoPath = "$env:TEMP\test-smoke-1s.mp4"
$ffmpegArgs = "-f lavfi -i testsrc=duration=1:size=64x64:rate=1 -f lavfi -i sine=duration=1 -c:v libx264 -c:a aac -y `"$testVideoPath`""
$ffmpegProc = Start-Process -FilePath "ffmpeg" `
  -ArgumentList $ffmpegArgs `
  -Wait -PassThru -NoNewWindow -ErrorAction SilentlyContinue

if ($null -eq $ffmpegProc -or $ffmpegProc.ExitCode -ne 0 -or -not (Test-Path $testVideoPath)) {
  # fallback：使用预生成 fixture（Generator 负责提供）
  $testVideoPath = Join-Path $scriptDir "tests\fixtures\test-1s-64x64.mp4"
  if (-not (Test-Path $testVideoPath)) {
    Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
    throw "FAIL: 无法生成测试视频，且 fixture 不存在: $testVideoPath"
  }
}
Write-Host "✅ 测试视频就绪: $testVideoPath ($([math]::Round((Get-Item $testVideoPath).Length/1KB, 1)) KB)"

# POST /api/video-remake/jobs（上传测试视频，multipart form-data）
$jobRespRaw = cmd.exe /c "curl -sf -X POST http://localhost:${ApiPort}/api/video-remake/jobs -F video=@`"$testVideoPath`"" 2>&1
if ($LASTEXITCODE -ne 0) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: POST /api/video-remake/jobs 失败 (exit=$LASTEXITCODE): $jobRespRaw"
}
$jobResp = $jobRespRaw | ConvertFrom-Json
$jobId = $jobResp.job_id
if ([string]::IsNullOrEmpty($jobId)) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: job_id 为空: $jobRespRaw"
}
Write-Host "✅ 任务已创建 job_id=$jobId"

# 轮询直到 N09 completed（CI=true 自动选帧；最多 40 分钟，涵盖真实 i2v 时间）
$maxPoll = 2400; $polled = 0
do {
  Start-Sleep -Seconds 15; $polled += 15
  $statusRaw = cmd.exe /c "curl -sf http://localhost:${ApiPort}/api/video-remake/jobs/$jobId" 2>&1
  $statusObj = $statusRaw | ConvertFrom-Json
  Write-Host "  轮询 ${polled}s status=$($statusObj.status)"
} while ($statusObj.status -notin @('completed', 'failed') -and $polled -lt $maxPoll)

if ($statusObj.status -eq 'failed') {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: 流水线 status=failed（检查 N04/N08 API key 是否有效）"
}
if ($statusObj.status -ne 'completed') {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: 超时 ${maxPoll}s，最终 status=$($statusObj.status)"
}
Write-Host "✅ 流水线 N09 completed"

# 验证 GET /api/video-remake/jobs/:id 响应 schema（Reviewer Round-4 阻塞项：filename/duration_seconds/width/height/nodes.Count==9）
if ([string]::IsNullOrEmpty($statusObj.filename)) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: GET /jobs/:id response 缺 filename 或为空"
}
if ($null -eq $statusObj.duration_seconds) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: GET /jobs/:id response 缺 duration_seconds"
}
if ($null -eq $statusObj.width) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: GET /jobs/:id response 缺 width"
}
if ($null -eq $statusObj.height) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: GET /jobs/:id response 缺 height"
}
if ($statusObj.nodes.Count -ne 9) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: GET /jobs/:id response nodes.Count=$($statusObj.nodes.Count) 非 9"
}
Write-Host "✅ GET /jobs/:id schema 验证通过: filename=$($statusObj.filename) w=$($statusObj.width) h=$($statusObj.height) nodes=$($statusObj.nodes.Count)"

# GET /api/video-remake/jobs/:id/output — 验证 schema
$outputRaw = cmd.exe /c "curl -sf http://localhost:${ApiPort}/api/video-remake/jobs/$jobId/output" 2>&1
if ($LASTEXITCODE -ne 0) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: GET /output 失败: $outputRaw"
}
$output = $outputRaw | ConvertFrom-Json
if ($output.has_video_stream -ne $true) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: has_video_stream != true, got $($output.has_video_stream)"
}
if ($output.duration_seconds -le 0) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: duration_seconds <= 0, got $($output.duration_seconds)"
}
Write-Host "✅ output schema 验证通过 has_video_stream=true duration_seconds=$($output.duration_seconds)"

# 下载翻拍 MP4，运行 ffprobe 验证
$outputVideoPath = "$env:TEMP\remake-output.mp4"
cmd.exe /c "curl -sf `"$($output.download_url)`" -o `"$outputVideoPath`"" 2>&1
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $outputVideoPath)) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: 下载翻拍 MP4 失败 download_url=$($output.download_url)"
}

$ffprobeCodec = ffprobe -v error -select_streams v:0 -show_entries stream=codec_type -of default=noprint_wrappers=1:nokey=1 "$outputVideoPath" 2>&1
if ($ffprobeCodec -notmatch "video") {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: ffprobe 无视频流 output=$ffprobeCodec"
}

$ffprobeDuration = ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$outputVideoPath" 2>&1
if ([double]$ffprobeDuration -le 0) {
  Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
  throw "FAIL: ffprobe duration=$ffprobeDuration <= 0"
}

Write-Host "✅ ffprobe 验证通过 duration=$ffprobeDuration has_video_stream=true"

Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
Write-Host "✅ [Phase 2] backend smoke 验证通过（真实 gpt-image-2 + DashScope i2v + ffprobe）"
Write-Host "✅ video-remake 9节点流水线 E2E 全部通过（Phase 1 UI + Phase 2 smoke）"
exit 0
