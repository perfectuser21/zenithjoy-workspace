# e2e-verify.ps1 — Agent 客户端封装 去黑窗+静默通知（windows_cloud / GHA windows-latest）
# 由 evaluator 模式 B dispatch .github/workflows/e2e-windows.yml 执行。
# 只验【可证伪的机制层】；视觉"无黑窗"/"图形通知"/"重启自起"为接缝（GHA headless 不可视觉验），
# 见 contract-draft.md「接缝清单 S1/S2/S3」，在真目标 xian-pc 验前标 logic-done-pending。
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ScriptStart = Get-Date                       # 时间戳防伪基准
$repo = Resolve-Path "$PSScriptRoot\..\.."    # sprints/<x>/ → repo root
$agentDir = "$repo\services\agent"
$logDir = "$env:APPDATA\zenithjoy-agent"
$launchLog = "$logDir\launch.log"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Remove-Item $launchLog -ErrorAction SilentlyContinue

# ---- Phase 1: 打包产物含 start.vbs（dryrun）----
Write-Host "▶ Phase 1: build-install-pack 含 start.vbs"
$pack = "$env:TEMP\zj-pack-test"
& bash -lc "cd '$agentDir' && CUSTOM_OUT='$($pack -replace '\\','/')' bash scripts/build-install-pack.sh --dryrun" 2>&1 | Select-Object -Last 8
if (-not (Test-Path "$pack\start.vbs")) { throw "FAIL: dryrun 产物缺 start.vbs" }
Write-Host "  ✅ 产物含 start.vbs"

# ---- Phase 2: 真跑 start.vbs → start.bat 隐藏链（probe 模式）----
Write-Host "▶ Phase 2: vbs 隐藏拉起 bat（probe）"
$probeMarker = "$logDir\probe-marker.txt"
Remove-Item $probeMarker -ErrorAction SilentlyContinue
$env:ZJ_LAUNCH_PROBE = "1"                     # start.bat 顶部守卫：写 probe 标记 + exit /b 0
Copy-Item "$agentDir\install-pack\start.vbs" "$pack\" -Force
& wscript.exe "$pack\start.vbs"               # Run(...,0,False) 立即返回
$ok = $false
for ($i=0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 500
  if ((Test-Path $launchLog) -and (Select-String -Path $launchLog -Pattern 'launch' -Quiet)) { $ok = $true; break }
}
if (-not $ok) { throw "FAIL: launch.log 未出现拉起记录（vbs 未隐藏拉起 bat）" }
if (-not (Test-Path $probeMarker)) { throw "FAIL: start.bat probe 标记缺失，vbs→bat 链未真执行" }
if ((Get-Item $launchLog).LastWriteTime -lt $ScriptStart.AddMinutes(-1)) { throw "FAIL: launch.log 为历史遗留冒充" }
$visible = Get-Process cmd,conhost -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
if ($visible) { throw "FAIL: 出现可见 cmd/conhost 窗口" }
Write-Host "  ✅ vbs 隐藏拉起 bat 成功，launch.log + probe 标记均本轮写入"

# ---- Phase 3: 单实例守卫（已运行则跳过）----
Write-Host "▶ Phase 3: 单实例守卫"
Remove-Item $launchLog -ErrorAction SilentlyContinue
$stubExe = "$env:TEMP\zenithjoy-agent.exe"
Copy-Item "$env:SystemRoot\System32\timeout.exe" $stubExe -Force
$stub = Start-Process -FilePath $stubExe -ArgumentList "/t","30","/nobreak" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 1
& wscript.exe "$pack\start.vbs"
Start-Sleep -Seconds 2
$skipped = (Test-Path $launchLog) -and (Select-String -Path $launchLog -Pattern 'skip|already' -Quiet)
Stop-Process -Id $stub.Id -Force -ErrorAction SilentlyContinue
Remove-Item $stubExe -ErrorAction SilentlyContinue
if (-not $skipped) { throw "FAIL: 已运行时未跳过（单实例失效）" }
Write-Host "  ✅ 单实例守卫生效（已运行 → skip）"

# ---- Phase 4: launch.log 大小轮转 ----
Write-Host "▶ Phase 4: launch.log 轮转"
$big = New-Object byte[] (1100000)            # >1MB
[IO.File]::WriteAllBytes($launchLog, $big)
& wscript.exe "$pack\start.vbs"
Start-Sleep -Seconds 2
$sz = (Get-Item $launchLog).Length
if ($sz -ge 1048576) { throw "FAIL: launch.log 未轮转 size=$sz" }
Write-Host "  ✅ launch.log 已轮转 size=$sz"

# ---- Phase 5: tray.ts 零 powershell（去黑窗硬保证）----
Write-Host "▶ Phase 5: tray.ts 无 powershell 通知路径"
if (Select-String -Path "$agentDir\src\tray.ts" -Pattern 'powershell' -Quiet) {
  throw "FAIL: tray.ts 仍含 powershell（未删干净，可能闪窗）"
}
if (-not (Select-String -Path "$agentDir\src\tray.ts" -Pattern 'node-notifier' -Quiet)) {
  throw "FAIL: tray.ts 未走 node-notifier"
}
Write-Host "  ✅ tray.ts 零 powershell + 走 node-notifier"

Remove-Item Env:\ZJ_LAUNCH_PROBE -ErrorAction SilentlyContinue
Write-Host "✅ windows_cloud E2E 全部通过（机制层；视觉/重启接缝见 contract 接缝清单，logic-done-pending）"
exit 0
